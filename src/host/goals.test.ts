import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chat, Goal, GoalRole, Item, ProviderId, Turn, TurnStatus, UsageSnapshot } from '../shared/types.ts'
import { GoalRunner, type GoalHub } from './goals.ts'
import { Store } from './store.ts'

type Sent = { turnId: string; chatId: string; provider: ProviderId; text: string; role: GoalRole }

/** A hub that records each turn the runner sends and lets the test end it. */
class FakeHub implements GoalHub {
  sent: Sent[] = []
  stopped: string[] = []
  items = new Map<string, Item[]>()
  usageOf: Partial<Record<ProviderId, UsageSnapshot>> = {}
  busy = false
  private seq = 0

  constructor(private readonly store: Store) {}

  createChat(cwd: string, title: string): Chat {
    const chat: Chat = { id: `chat-${++this.seq}`, title, cwd, lastProvider: null, createdAt: 1, updatedAt: 1 }
    this.store.createChat(chat)
    return chat
  }
  send(chatId: string, provider: ProviderId, _model: string | null, text: string, role: GoalRole): string {
    if (this.busy) throw new Error('This chat is still answering the last message')
    const turnId = `turn-${++this.seq}`
    this.sent.push({ turnId, chatId, provider, text, role })
    return turnId
  }
  async stop(chatId: string): Promise<void> { this.stopped.push(chatId) }
  async usage(provider: ProviderId): Promise<UsageSnapshot> {
    return this.usageOf[provider] ?? { provider, account: null, plan: null, windows: [], note: null, unavailable: 'not signed in', updatedAt: 0 }
  }
  turnItems(_chatId: string, turnId: string): Item[] { return this.items.get(turnId) ?? [] }
  last(): Sent { return this.sent.at(-1)! }
}

function usage(provider: ProviderId, percent: number, resetsAt: number | null = null): UsageSnapshot {
  return { provider, account: 'me', plan: 'Pro', windows: [{ label: '5-hour', percent, resetsAt }], note: null, unavailable: null, updatedAt: 0 }
}

/** Let the runner's usage reads and the steps after them settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))

function setup() {
  const store = new Store(':memory:')
  const hub = new FakeHub(store)
  const events: Goal[] = []
  hub.usageOf.codex = usage('codex', 10)
  const runner = new GoalRunner(store, hub, (goal) => events.push(goal))
  const goal = (): Goal => store.goals()[0]!
  /** End the last sent turn, after the model called goal_report with `args` (or did not, with null). */
  const end = async (args: Record<string, unknown> | null, status: TurnStatus = 'completed', error: string | null = null): Promise<void> => {
    const sent = hub.last()
    if (args) assert.equal(runner.report(sent.chatId, args).ok, true, 'the report is accepted')
    const turn: Turn = { id: sent.turnId, chatId: sent.chatId, provider: sent.provider, model: null, status, error, handoffTurns: 0, goalRole: sent.role, startedAt: 1, endedAt: 2 }
    runner.turnEnded(turn)
    await settle()
  }
  const brief = { goal: 'History shows in the address dropdown.', criteria: [{ text: 'Matches appear while typing', how: 'tried in the browser' }, { text: 'Tests pass', how: 'runs them' }] }
  return { store, hub, runner, events, goal, end, brief }
}

test('a goal is drafted, confirmed, worked, checked and done', async () => {
  const { hub, runner, goal, end, brief } = setup()
  runner.draft({ cwd: '/work', text: 'find stuff from my history like chrome', provider: 'claude', model: 'opus' })
  await settle()
  assert.equal(goal().status, 'drafting')
  assert.equal(hub.last().role, 'draft')
  assert.match(hub.last().text, /find stuff from my history like chrome/)
  assert.equal(goal().checker.provider, 'codex', 'another signed-in provider checks')

  await end({ ...brief, question: { text: 'Include bookmarks?', options: ['Yes', 'No'] } })
  assert.equal(goal().status, 'confirming')
  assert.equal(goal().criteria.length, 2)
  assert.equal(goal().question?.text, 'Include bookmarks?')

  runner.update(goal().id, { answer: 'No', criteria: [...brief.criteria, { text: 'It stays fast', how: 'measured' }] })
  runner.start(goal().id)
  await settle()
  assert.equal(goal().status, 'working')
  assert.equal(hub.last().role, 'work')
  assert.equal(hub.last().provider, 'claude')
  assert.match(hub.last().text, /answered: No/)
  assert.match(hub.last().text, /3\. It stays fast/)

  hub.items.set(hub.last().turnId, [{ type: 'tool', id: 'e', turnId: hub.last().turnId, kind: 'edit', label: 'src/a.ts', status: 'done', output: '' }])
  await end({ status: 'done', summary: 'Added history search.' })
  assert.equal(goal().status, 'checking')
  assert.equal(hub.last().role, 'check')
  assert.equal(hub.last().provider, 'codex')
  assert.match(hub.last().text, /Added history search/)
  assert.deepEqual(goal().rounds[0]!.files, ['src/a.ts'])

  await end({ verdicts: [{ line: 1, met: true, evidence: 'saw it' }, { line: 2, met: true, evidence: 'green' }, { line: 3, met: false, evidence: '200ms' }], findings: 'Too slow.' })
  assert.equal(goal().status, 'working', 'an unmet line starts another round')
  assert.equal(goal().rounds.length, 2)
  assert.match(hub.last().text, /Too slow\./)
  assert.match(hub.last().text, /3\. It stays fast/)
  assert.doesNotMatch(hub.last().text, /1\. Matches appear/, 'met lines are not repeated as unmet')

  await end({ status: 'done', summary: 'Indexed it.' })
  await end({ verdicts: [1, 2, 3].map((line) => ({ line, met: true, evidence: 'ok' })), findings: '' })
  assert.equal(goal().status, 'done')
  assert.deepEqual(goal().criteria.map((line) => line.metInRound), [1, 1, 2])
})

test('a worker that forgets to report goes to the checker with its last reply', async () => {
  const { hub, runner, goal, end, brief } = setup()
  runner.draft({ cwd: '/w', text: 'x', provider: 'claude', model: null })
  await settle()
  await end(brief)
  runner.start(goal().id)
  await settle()
  hub.items.set(hub.last().turnId, [{ type: 'assistant', id: 'a', turnId: hub.last().turnId, text: 'All finished.', streaming: false }])
  await end(null)
  assert.equal(hub.last().role, 'check')
  assert.equal(goal().rounds[0]!.summary, 'All finished.')
})

test('the same gap twice in a row asks the user, and a note carries on', async () => {
  const { hub, runner, goal, end, brief } = setup()
  runner.draft({ cwd: '/w', text: 'x', provider: 'claude', model: null })
  await settle()
  await end(brief)
  runner.start(goal().id)
  await settle()
  const halfway = { verdicts: [{ line: 1, met: true, evidence: '' }, { line: 2, met: false, evidence: 'red' }], findings: 'Test b fails.' }
  await end({ status: 'done', summary: '' })
  await end(halfway)
  await end({ status: 'done', summary: '' })
  await end(halfway)
  assert.equal(goal().status, 'needs_you')
  assert.match(goal().reason!, /same gap twice/)

  runner.steer(goal().id, 'Look at the fixture, not the test.')
  await settle()
  assert.equal(goal().status, 'working')
  assert.match(hub.last().text, /Look at the fixture/)
  assert.deepEqual(goal().steer, [], 'a note is used once')
})

test('a worker that needs the user waits, and the answer is its next message', async () => {
  const { hub, runner, goal, end, brief } = setup()
  runner.draft({ cwd: '/w', text: 'x', provider: 'claude', model: null })
  await settle()
  await end(brief)
  runner.start(goal().id)
  await settle()
  await end({ status: 'needs_you', summary: 'Which database?' })
  assert.equal(goal().status, 'needs_you')
  assert.match(goal().reason!, /Which database\?/)
  runner.steer(goal().id, 'SQLite')
  await settle()
  assert.equal(hub.last().role, 'work')
  assert.match(hub.last().text, /SQLite/)
})

test('a draft without a brief asks the user, and their answer redrafts', async () => {
  const { hub, runner, goal, end } = setup()
  runner.draft({ cwd: '/w', text: 'make it better', provider: 'claude', model: null })
  await settle()
  await end(null)
  assert.equal(goal().status, 'needs_you')
  runner.steer(goal().id, 'Faster startup')
  await settle()
  assert.equal(hub.last().role, 'draft')
  assert.match(hub.last().text, /Faster startup/)
})

test('a failed turn is tried once more, then the user is asked', async () => {
  const { hub, runner, goal, end, brief } = setup()
  runner.draft({ cwd: '/w', text: 'x', provider: 'claude', model: null })
  await settle()
  await end(brief)
  runner.start(goal().id)
  await settle()
  await end(null, 'failed', 'rate limited')
  assert.equal(goal().status, 'working')
  assert.equal(hub.sent.filter((sent) => sent.role === 'work').length, 2)
  assert.equal(goal().rounds.length, 1, 'the failed round is replaced, not kept')
  await end(null, 'failed', 'rate limited')
  assert.equal(goal().status, 'needs_you')
  assert.match(goal().reason!, /rate limited/)
})

test('a checker with no verdict is asked once more, then the user', async () => {
  const { hub, runner, goal, end, brief } = setup()
  runner.draft({ cwd: '/w', text: 'x', provider: 'claude', model: null })
  await settle()
  await end(brief)
  runner.start(goal().id)
  await settle()
  await end({ status: 'done', summary: '' })
  await end(null)
  assert.equal(hub.last().role, 'check')
  assert.match(hub.last().text, /without calling goal_report/)
  await end(null)
  assert.equal(goal().status, 'needs_you')
})

test('usage at the pause level waits, and Resume goes ahead anyway', async () => {
  const { hub, runner, goal, end, brief } = setup()
  hub.usageOf.claude = usage('claude', 95, Date.now() + 3_600_000)
  runner.draft({ cwd: '/w', text: 'x', provider: 'claude', model: null })
  await settle()
  await end(brief)
  runner.start(goal().id)
  await settle()
  assert.equal(goal().status, 'needs_you')
  assert.match(goal().reason!, /Claude's 5-hour usage is at 95%/)
  assert.ok(goal().resumeAt)
  assert.equal(hub.sent.length, 1, 'no work was sent')

  runner.resume(goal().id)
  await settle()
  assert.equal(goal().status, 'working')
  assert.equal(hub.last().role, 'work')
  runner.shutdown()
})

test('pause waits for the turn in flight; stop cuts it off', async () => {
  const { hub, runner, goal, end, brief } = setup()
  runner.draft({ cwd: '/w', text: 'x', provider: 'claude', model: null })
  await settle()
  await end(brief)
  runner.start(goal().id)
  await settle()
  runner.pause(goal().id)
  assert.equal(goal().status, 'working')
  await end({ status: 'done', summary: '' })
  assert.equal(goal().status, 'paused')
  assert.equal(goal().next, 'check')

  runner.resume(goal().id)
  await settle()
  assert.equal(hub.last().role, 'check')
  runner.stop(goal().id)
  assert.equal(goal().status, 'stopped')
  assert.deepEqual(hub.stopped, [goal().chatId])
  await end(null, 'interrupted')
  assert.equal(goal().status, 'stopped', 'the cut-off turn does not revive it')
})

test('a goal cut off by the app closing waits for the user after a restart', async () => {
  const { store, hub, runner, goal, end, brief } = setup()
  runner.draft({ cwd: '/w', text: 'x', provider: 'claude', model: null })
  await settle()
  await end(brief)
  runner.start(goal().id)
  await settle()
  assert.equal(goal().status, 'working')

  const restarted = new GoalRunner(store, hub, () => {})
  assert.equal(goal().status, 'paused')
  assert.equal(goal().next, 'work')
  assert.match(goal().reason!, /Rocket was closed/)
  restarted.resume(goal().id)
  await settle()
  assert.equal(goal().rounds.length, 2, 'the cut-off round ends; the work starts a new one')
})

test('goal_report outside a goal turn, or with the wrong arguments, says what to do', async () => {
  const { runner, hub, goal } = setup()
  assert.equal(runner.report('nowhere', { status: 'done' }).ok, false)
  runner.draft({ cwd: '/w', text: 'x', provider: 'claude', model: null })
  await settle()
  const wrong = runner.report(hub.last().chatId, { status: 'done' })
  assert.equal(wrong.ok, false)
  assert.match(wrong.text, /drafting the brief/)
  assert.equal(goal().status, 'drafting')
})

test('with no other provider signed in, the worker checks its own work', async () => {
  const { hub, runner, goal } = setup()
  delete hub.usageOf.codex
  runner.draft({ cwd: '/w', text: 'x', provider: 'claude', model: null })
  await settle()
  assert.equal(goal().checker.provider, 'claude')
})
