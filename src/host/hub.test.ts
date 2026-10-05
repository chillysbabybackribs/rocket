import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HostEvent } from '../shared/types.ts'
import { Hub, type TurnTiming } from './hub.ts'
import { unavailableUsage, type PrepareRequest, type ProviderAdapter, type RunRequest, type RunResult, type TurnSink } from './providers/provider.ts'
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
