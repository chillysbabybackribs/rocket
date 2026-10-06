import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HostEvent } from '../shared/types.ts'
import { Hub, type TurnTiming } from './hub.ts'
import { unavailableUsage, type OpenUnprompted, type PrepareRequest, type ProviderAdapter, type RunRequest, type RunResult, type TurnSink } from './providers/provider.ts'
import { Store } from './store.ts'

/** An adapter that records what it was asked and answers a turn when the test says so. */
class FakeAdapter implements ProviderAdapter {
  readonly id = 'claude' as const
  prepared: PrepareRequest[] = []
  ran: RunRequest[] = []
  forgotten: string[] = []
  answer: ((sink: TurnSink) => void) | null = null
  private finish: ((result: RunResult) => void) | null = null

  run(request: RunRequest, sink: TurnSink): Promise<RunResult> {
    this.ran.push(request)
    sink.session('session-1')
    this.answer?.(sink)
    return new Promise((resolve) => { this.finish = resolve })
  }
  complete(): void { this.finish?.({ status: 'completed' }) }
  protected finishWith(result: RunResult): void { this.finish?.(result) }
  fail(): void { this.finish?.({ status: 'failed', error: 'boom' }) }
  lose(): void { this.finish?.({ status: 'failed', sessionLost: true }) }
  async prepare(request: PrepareRequest): Promise<void> { this.prepared.push(request) }
  async stop(): Promise<void> {}
  forget(chatId: string): void { this.forgotten.push(chatId) }
  async usage() { return unavailableUsage('claude', 'test') }
  async models() { return [] }
  shutdown(): void {}
}

function setup() {
  const adapter = new FakeAdapter()
  const events: HostEvent[] = []
  const timings: TurnTiming[] = []
  const adapters = { claude: adapter, codex: adapter, cursor: adapter, antigravity: adapter }
  const hub = new Hub(new Store(':memory:'), adapters, (event) => events.push(event), (timing) => timings.push(timing))
  const ended = (): Promise<void> => new Promise((resolve) => {
    const poll = (): void => (timings.length ? resolve() : void setImmediate(poll))
    poll()
  })
  return { adapter, hub, timings, ended }
}

test('prepare hands the provider the chat folder and the session it would resume', async () => {
  const { adapter, hub, ended } = setup()
  const chat = hub.createChat('/work')
  await hub.prepare(chat.id, 'claude', 'm1', '/elsewhere')
  assert.deepEqual(adapter.prepared, [{ chatId: chat.id, cwd: '/work', sessionId: null, model: 'm1' }])

  hub.send(chat.id, 'claude', null, 'hello')
  await hub.prepare(chat.id, 'claude', null, '/work')
  assert.equal(adapter.prepared.length, 1, 'a chat that is answering is left alone')
  adapter.complete()
  await ended()

  await hub.prepare(chat.id, 'claude', null, '/work')
  assert.equal(adapter.prepared[1]!.sessionId, 'session-1')
})

test('prepare for the next new chat passes the folder it will start in, and never throws', async () => {
  const { adapter, hub } = setup()
  await hub.prepare(null, 'claude', null, '/next')
  assert.deepEqual(adapter.prepared, [{ chatId: null, cwd: '/next', sessionId: null, model: null }])
  adapter.prepare = async () => { throw new Error('not installed') }
  await hub.prepare(null, 'claude', null, '/next')
  await hub.prepare('no-such-chat', 'claude', null, '/next')
})

test('a turn reports when it first showed anything and when it first showed text', async () => {
  const { adapter, hub, timings, ended } = setup()
  const chat = hub.createChat('/work')
  adapter.answer = (sink) => {
    sink.item({ type: 'tool', id: 'tool', turnId: 't', kind: 'read', label: 'file', status: 'running', output: '' })
    sink.item({ type: 'assistant', id: 'a', turnId: 't', text: '', streaming: true })
  }
  hub.send(chat.id, 'claude', null, 'hello')
  assert.equal(timings.length, 0)
  adapter.complete()
  await ended()
  assert.equal(timings[0]!.status, 'completed')
  assert.equal(typeof timings[0]!.firstEventMs, 'number')
  assert.equal(timings[0]!.firstTextMs, null, 'an empty reply row and a tool call are not text')

  timings.length = 0
  adapter.answer = (sink) => {
    sink.item({ type: 'assistant', id: 'b', turnId: 't', text: '', streaming: true })
    sink.delta('b', 'Hi')
  }
  hub.send(chat.id, 'claude', null, 'again')
  adapter.complete()
  await ended()
  assert.ok(timings[0]!.firstTextMs !== null && timings[0]!.firstTextMs >= timings[0]!.firstEventMs!)
})

test('changing the folder drops every provider\'s warm session for the chat', () => {
  const { adapter, hub } = setup()
  const chat = hub.createChat('/work')
  hub.setCwd(chat.id, '/work')
  assert.equal(adapter.forgotten.length, 0, 'the same folder changes nothing')
  hub.setCwd(chat.id, '/other')
  assert.deepEqual(adapter.forgotten, [chat.id, chat.id, chat.id, chat.id])
})

test('a failed turn the provider had started answering is not handed back to it', async () => {
  const { adapter, hub, timings, ended } = setup()
  const chat = hub.createChat('/work')
  adapter.answer = (sink) => sink.item({ type: 'assistant', id: 'a', turnId: 't', text: 'half an answer', streaming: true })
  hub.send(chat.id, 'claude', null, 'first')
  adapter.fail()
  await ended()

  timings.length = 0
  adapter.answer = null
  hub.send(chat.id, 'claude', null, 'second')
  assert.equal(adapter.ran[1]!.handoff, null)
  adapter.fail()
  await ended()

  // That one failed before the provider did anything, so its message is still owed.
  timings.length = 0
  hub.send(chat.id, 'claude', null, 'third')
  assert.equal(adapter.ran[2]!.handoff?.turns, 1)
  assert.match(adapter.ran[2]!.handoff!.text, /second/)
  adapter.complete()
  await ended()
})

test('a session that was lost is told the app\'s context again', async () => {
  const adapter = new FakeAdapter()
  const timings: TurnTiming[] = []
  const asked: boolean[] = []
  const adapters = { claude: adapter, codex: adapter, cursor: adapter, antigravity: adapter }
  const hub = new Hub(new Store(':memory:'), adapters, () => {}, (timing) => timings.push(timing), async (_chat, _provider, fresh) => {
    asked.push(fresh)
    return fresh ? '<tabs>' : null
  })
  const ended = async (): Promise<void> => { while (!timings.length) await new Promise((resolve) => setImmediate(resolve)) }
  const chat = hub.createChat('/work')
  hub.send(chat.id, 'claude', null, 'one')
  await new Promise((resolve) => setImmediate(resolve))
  adapter.complete()
  await ended()

  timings.length = 0
  hub.send(chat.id, 'claude', null, 'two')
  await new Promise((resolve) => setImmediate(resolve))
  adapter.lose()
  await new Promise((resolve) => setImmediate(resolve))
  adapter.complete()
  await ended()
  assert.deepEqual(asked, [true, false, true])
  assert.deepEqual(adapter.ran.map((request) => request.text), ['<tabs>\n\none', 'two', '<tabs>\n\ntwo'])
})

test("a goal's turn does not name the chat after the app's message", async () => {
  const { hub, adapter, ended } = setup()
  const chat = hub.createChat('/work', 'Search my history')
  const turnId = hub.send(chat.id, 'claude', null, 'The user wants this done…', 'draft')
  assert.equal(hub.listChats()[0]!.title, 'Search my history')
  assert.equal(hub.isRunning(chat.id), true)
  adapter.complete()
  await ended()
  assert.equal(hub.openChat(chat.id).turns.find((turn) => turn.id === turnId)!.goalRole, 'draft')
})

test('a turn the provider starts by itself is recorded, replied in, and settled', async () => {
  const adapter = new FakeAdapter()
  const claude = new FakeAdapter()
  const opener: { open: OpenUnprompted | null } = { open: null }
  ;(claude as ProviderAdapter).onUnprompted = (open) => { opener.open = open }
  const events: HostEvent[] = []
  const adapters = { claude, codex: adapter, cursor: adapter, antigravity: adapter }
  const store = new Store(':memory:')
  const hub = new Hub(store, adapters, (event) => events.push(event))
  const open = opener.open
  assert.ok(open, 'the hub registers with adapters that can start turns')
  const chat = hub.createChat('/work')

  const opened = open!(chat.id, 'Finished in the background: research')!
  assert.equal(hub.isRunning(chat.id), true)
  assert.equal(open!(chat.id, 'again'), null, 'a busy chat takes no second turn')
  opened.sink.session('session-9')
  opened.sink.item({ type: 'assistant', id: `${opened.turnId}:a`, turnId: opened.turnId, text: 'Here is the synthesis.', streaming: false })
  opened.finish({ status: 'completed' })

  const snapshot = hub.openChat(chat.id)
  assert.equal(snapshot.turns[0]!.status, 'completed')
  assert.deepEqual(snapshot.items.map((item) => item.type), ['notice', 'assistant'])
  assert.equal(hub.isRunning(chat.id), false)
  assert.equal(store.session(chat.id, 'claude').sessionId, 'session-9')
  assert.equal(store.session(chat.id, 'claude').seenTurnSeq, store.turns(chat.id)[0]!.seq, 'the session holds its own turn')
  assert.equal(open!('no-such-chat', 'x'), null)
})

/** A fake whose turns take the user's words while they run, until told not to. */
class SteeringAdapter extends FakeAdapter {
  steered: Array<{ chatId: string; text: string; taken: () => void }> = []
  takes = true
  async steer(chatId: string, text: string, taken: () => void): Promise<boolean> {
    if (!this.takes) return false
    this.steered.push({ chatId, text, taken })
    return true
  }
  interrupted(): void { this.finishWith({ status: 'interrupted' }) }
}

function steerSetup() {
  const claude = new SteeringAdapter()
  const cursor = new FakeAdapter()
  const events: HostEvent[] = []
  const timings: TurnTiming[] = []
  const hub = new Hub(new Store(':memory:'), { claude, codex: cursor, cursor, antigravity: cursor }, (event) => events.push(event), (timing) => timings.push(timing))
  const ended = (count: number): Promise<void> => new Promise((resolve) => {
    const poll = (): void => (timings.length >= count ? resolve() : void setImmediate(poll))
    poll()
  })
  const queueOf = (chatId: string): string[] => {
    const last = events.findLast((event) => event.type === 'queue' && event.chatId === chatId)
    return last?.type === 'queue' ? last.queued.map((entry) => entry.text) : []
  }
  return { claude, cursor, hub, ended, queueOf }
}

test('words sent to the provider answering join its turn, told not to acknowledge them', async () => {
  const { claude, hub, ended } = steerSetup()
  const chat = hub.createChat('/work')
  const turnId = hub.send(chat.id, 'claude', null, 'Restyle settings')
  await hub.post(chat.id, 'claude', null, '  Leave the account section  ')

  assert.equal(claude.ran.length, 1, 'no second turn')
  assert.match(claude.steered[0]!.text, /do not stop to acknowledge/)
  assert.match(claude.steered[0]!.text, /Leave the account section$/)
  const users = (): Array<[string, string, boolean]> => hub.openChat(chat.id).items
    .flatMap((item) => (item.type === 'user' ? [[item.turnId, item.text, item.steer === true] as [string, string, boolean]] : []))
  assert.deepEqual(users(), [[turnId, 'Restyle settings', false]], 'not in the turn until the model reads it')
  assert.deepEqual(hub.queued(chat.id).map((entry) => [entry.text, entry.taking]), [['Leave the account section', true]])

  claude.steered[0]!.taken()
  assert.deepEqual(users(), [[turnId, 'Restyle settings', false], [turnId, 'Leave the account section', true]])
  assert.deepEqual(hub.queued(chat.id), [])
  claude.complete()
  await ended(1)
})

test('words a turn never said it read are kept when it completes, and sent next when it is stopped', async () => {
  const { claude, hub, ended } = steerSetup()
  const chat = hub.createChat('/work')
  const first = hub.send(chat.id, 'claude', null, 'One')
  await hub.post(chat.id, 'claude', null, 'unannounced')
  claude.complete()
  await ended(1)
  assert.deepEqual(hub.openChat(chat.id).items.filter((item) => item.type === 'user').map((item) => [item.turnId, item.text]), [
    [first, 'One'], [first, 'unannounced']
  ], 'recorded, not sent twice')

  hub.send(chat.id, 'claude', null, 'Two')
  await hub.post(chat.id, 'claude', null, 'cut off')
  await hub.stop(chat.id)
  claude.interrupted()
  await ended(2)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(claude.ran.length, 3, 'the stop dropped them, so they are the next message')
  assert.match(claude.ran[2]!.text, /cut off$/)
  claude.complete()
  await ended(3)
})

test('Stop gives back words on their way into the turn with those waiting for it', async () => {
  const { claude, hub, ended } = steerSetup()
  const chat = hub.createChat('/work')
  hub.send(chat.id, 'claude', null, 'Start')
  await hub.post(chat.id, 'claude', null, 'on its way')
  await hub.post(chat.id, 'cursor', null, 'waiting')
  assert.equal(hub.withdraw(chat.id), 'on its way\n\nwaiting')
  await hub.stop(chat.id)
  claude.interrupted()
  await ended(1)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(claude.ran.length, 1, 'nothing is sent after the stop')
  assert.deepEqual(hub.openChat(chat.id).items.filter((item) => item.type === 'user').length, 1)
})

test('words for a provider that cannot take them wait, and go out together when the turn ends', async () => {
  const { claude, cursor, hub, ended, queueOf } = steerSetup()
  const chat = hub.createChat('/work')
  hub.send(chat.id, 'cursor', null, 'Find the blank tab bug')
  await hub.post(chat.id, 'cursor', null, 'Only with more than five tabs')
  await hub.post(chat.id, 'claude', 'opus', 'And check the restore order')

  assert.equal(cursor.ran.length, 1)
  assert.deepEqual(queueOf(chat.id), ['Only with more than five tabs', 'And check the restore order'])
  assert.deepEqual(hub.openChat(chat.id).queued!.map((entry) => entry.provider), ['cursor', 'claude'])
  cursor.complete()
  await ended(1)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(claude.ran.length, 1, 'the latest waiting message picks the provider')
  assert.equal(claude.ran[0]!.model, 'opus')
  assert.match(claude.ran[0]!.text, /Only with more than five tabs\n\nAnd check the restore order$/)
  assert.deepEqual(queueOf(chat.id), [])
  claude.complete()
  await ended(2)
})

test('a turn that cannot take words leaves them waiting, and later words keep their place behind them', async () => {
  const { claude, hub, ended, queueOf } = steerSetup()
  const chat = hub.createChat('/work')
  hub.send(chat.id, 'claude', null, 'Start')
  claude.takes = false
  await hub.post(chat.id, 'claude', null, 'first')
  claude.takes = true
  await hub.post(chat.id, 'claude', null, 'second')
  assert.equal(claude.steered.length, 0, 'not steered past a waiting message')
  assert.deepEqual(queueOf(chat.id), ['first', 'second'])

  const [first] = hub.queued(chat.id)
  assert.equal(hub.unqueue(chat.id, first!.id), 'first')
  assert.equal(hub.withdraw(chat.id), 'second')
  assert.equal(hub.withdraw(chat.id), null)
  claude.complete()
  await ended(1)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(claude.ran.length, 1, 'nothing was left to send')
})

for (const retry of [false, true]) {
  test(`Stop during ${retry ? 'lost-session retry' : 'initial'} context prevents provider startup`, async () => {
    const store = new Store(':memory:')
    const adapter = new FakeAdapter()
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    let contexts = 0
    const hub = new Hub(store, { claude: adapter, codex: adapter, cursor: adapter, antigravity: adapter }, () => {}, () => {}, async () => {
      if (++contexts === (retry ? 2 : 1)) await waiting
      return null
    })
    const chat = hub.createChat('/work')
    hub.send(chat.id, 'claude', null, 'hello')
    if (retry) {
      await new Promise((resolve) => setImmediate(resolve))
      adapter.lose()
      await new Promise((resolve) => setImmediate(resolve))
    }
    await hub.stop(chat.id)
    release()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(adapter.ran.length, retry ? 1 : 0)
    assert.equal(hub.isRunning(chat.id), false)
    assert.equal(store.turns(chat.id)[0]!.status, 'interrupted')
    store.close()
  })
}

test("a turn's tokens are kept on it and reported with its timing; the latest reading wins", async () => {
  const { adapter, hub, timings, ended } = setup()
  const chat = hub.createChat('/work')
  adapter.answer = (sink) => {
    sink.tokens({ input: 10, cached: 0, output: 1, context: 10, contextWindow: null })
    sink.tokens({ input: 900, cached: 800, output: 40, context: 500, contextWindow: 200_000 })
  }
  hub.send(chat.id, 'claude', null, 'hello')
  adapter.complete()
  await ended()
  const tokens = { input: 900, cached: 800, output: 40, context: 500, contextWindow: 200_000 }
  assert.deepEqual(timings[0]!.tokens, tokens)
  assert.deepEqual(hub.openChat(chat.id).turns[0]!.tokens, tokens)
})
