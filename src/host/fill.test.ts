import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { HostToMainFill } from '../shared/fill.ts'
import type { HostEvent, ModelInfo } from '../shared/types.ts'
import { FillRunner } from './fill.ts'
import { Hub } from './hub.ts'
import { unavailableUsage, type ProviderAdapter, type RunRequest, type RunResult, type TurnSink } from './providers/provider.ts'
import { Store } from './store.ts'

/** A provider whose turn says what the test hands it, then ends. */
class ScriptedAdapter implements ProviderAdapter {
  readonly id = 'claude' as const
  ran: RunRequest[] = []
  constructor(private readonly script: (request: RunRequest, sink: TurnSink) => RunResult) {}
  async run(request: RunRequest, sink: TurnSink): Promise<RunResult> {
    this.ran.push(request)
    sink.session('s1')
    return this.script(request, sink)
  }
  async prepare(): Promise<void> {}
  async stop(): Promise<void> {}
  forget(): void {}
  async usage() { return unavailableUsage('claude', 'test') }
  async models(): Promise<ModelInfo[]> { return [{ id: 'opus', label: 'Opus 5.5', description: '', isDefault: true }] }
  shutdown(): void {}
}

const target = {
  tab: 't1', url: 'https://forum.example/t/1', title: 'Thread', mode: 'field' as const,
  fields: [{ id: 'f1', label: 'Reply', kind: 'text' as const, inputType: '', value: '', placeholder: '', required: false, maxLength: null, selector: '#reply' }],
  skipped: [], context: 'Why do renamed windows stay tiled?'
}

function setup(script: (request: RunRequest, sink: TurnSink) => RunResult) {
  const store = new Store(':memory:')
  const adapter = new ScriptedAdapter(script)
  const shown: HostEvent[] = []
  const posted: HostToMainFill[] = []
  const root = join(mkdtempSync(join(tmpdir(), 'rocket-fill-')), 'fill')
  let fills: FillRunner
  const hub = new Hub(store, { claude: adapter, codex: adapter, cursor: adapter, antigravity: adapter }, (event) => {
    if (!fills.observe(event)) shown.push(event)
  })
  fills = new FillRunner(store, hub, root, (message) => posted.push(message))
  const ended = (): Promise<void> => new Promise((resolve) => {
    const check = (): void => { if (posted.some((message) => message.type === 'fillEnded')) resolve(); else setTimeout(check, 5) }
    check()
  })
  return { store, hub, fills, adapter, shown, posted, root, ended }
}

test('a fill runs in a chat the window never sees, answers from its fill block, and leaves nothing behind', async () => {
  const { store, fills, adapter, shown, posted, root, ended } = setup((request, sink) => {
    sink.item({ type: 'tool', id: 'x1', turnId: request.turnId, kind: 'web', label: 'https://wiki.hypr.land/rules', status: 'done', output: '' })
    sink.item({ type: 'assistant', id: 'a1', turnId: request.turnId, streaming: false, text: 'Checked the wiki.\n```rocket-fill\n{"fields": {"f1": "Float is static: it is matched once, at open."}}\n```' })
    return { status: 'completed' }
  })
  const user = fills.observe({ type: 'chat', chat: { id: 'x', title: '', cwd: '/home/me/code', lastProvider: null, createdAt: 0, updatedAt: 0 } })
  assert.equal(user, false, 'a chat of the user\'s own is not a fill\'s')
  await fills.handle({ type: 'fillStart', id: 'fill-1', target, variant: 'fill', instructions: null, provider: null })
  await ended()

  assert.match(adapter.ran[0]!.text, /<rocket-fill>/)
  assert.equal(adapter.ran[0]!.cwd.startsWith(root + '/'), true)
  assert.deepEqual(shown.filter((event) => event.type !== 'usage'), [], 'nothing of the fill reaches the window, though a usage reading does')
  const chat = posted.find((message) => message.type === 'fillChat')
  assert.equal(chat?.type === 'fillChat' && chat.model, 'Opus 5.5')
  assert.ok(posted.some((message) => message.type === 'fillStep' && message.step === 'Opening wiki.hypr.land/rules'))
  const done = posted.find((message) => message.type === 'fillDone')
  assert.deepEqual(done?.type === 'fillDone' && done.values, { f1: 'Float is static: it is matched once, at open.' })
  assert.deepEqual(done?.type === 'fillDone' && done.sources.map((source) => source.title), ['wiki.hypr.land/rules'])
  assert.deepEqual(store.listChats(), [], 'the fill\'s chat is deleted')
  assert.deepEqual(readdirSync(root).filter((name) => name !== 'model.json'), [], 'and so is its folder')
  store.close()
})

test('a reply with no fill block fails with a sentence, and the last model sent with is the one used', async () => {
  const { store, fills, adapter, posted, ended } = setup((request, sink) => {
    sink.item({ type: 'assistant', id: 'a1', turnId: request.turnId, streaming: false, text: 'Here is a reply: hello' })
    return { status: 'completed' }
  })
  fills.noteSent('codex', 'gpt-x')
  await fills.handle({ type: 'fillStart', id: 'fill-2', target, variant: 'fill', instructions: null, provider: null })
  await ended()
  assert.equal(adapter.ran[0]!.model, 'gpt-x')
  const failed = posted.find((message) => message.type === 'fillFailed')
  assert.match(failed?.type === 'fillFailed' ? failed.error : '', /answered without a fill/)
  assert.equal(existsSync(adapter.ran[0]!.cwd), false)
  store.close()
})

test('Sound like you is given the user\'s own messages, never a fill\'s or an eval\'s', async () => {
  const { store, hub, fills, adapter, ended } = setup((request, sink) => {
    sink.item({ type: 'assistant', id: 'a1', turnId: request.turnId, streaming: false, text: '```rocket-fill\n{"fields": {"f1": "ok"}}\n```' })
    return { status: 'completed' }
  })
  const mine = hub.createChat('/home/me/code')
  await hub.post(mine.id, 'claude', null, 'change humanize to Sound like you - thats much better')
  await hub.waitForTurn(mine.id)
  await fills.handle({ type: 'fillStart', id: 'fill-3', target: { ...target, fields: [{ ...target.fields[0]!, value: 'That is expected.' }] }, variant: 'voice', instructions: null, provider: null })
  await ended()
  const told = adapter.ran.at(-1)!.text
  assert.match(told, /<user-messages>\nchange humanize to Sound like you - thats much better\n<\/user-messages>/)
  store.close()
})
