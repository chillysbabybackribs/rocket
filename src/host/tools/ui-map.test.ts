import assert from 'node:assert/strict'
import test from 'node:test'
import type { MainAgentOp, UiMapResult, UiSnapshot, UiWhere } from '../../shared/types.ts'
import { describeWhere, uiMapTools, whereForChat } from './ui-map.ts'

const where = (patch: Partial<UiWhere> = {}): UiWhere => ({
  place: 'chat',
  panes: [
    { index: 0, chatId: 'a', title: 'first chat', provider: 'claude', focused: true, running: false, planOpen: false },
    { index: 1, chatId: 'b', title: 'second chat', provider: 'codex', focused: false, running: true, planOpen: false }
  ],
  focused: 0, side: 'chat', artifact: null, library: null, dialogs: [], ...patch
})

const snapshot: UiSnapshot = {
  capturedAt: 'now', instance: { pid: 1, startedAt: 'then', version: '0', mainBundleSha256: 'x', rendererUrl: 'app://' },
  window: { bounds: { x: 0, y: 0, width: 10, height: 10 }, contentBounds: { x: 0, y: 0, width: 10, height: 10 }, focused: true, minimized: false },
  shell: { panels: [], controls: [], controlsTruncated: false }, views: [], capture: 'window', warnings: [], directory: '/tmp/x',
  images: [{ label: 'window', path: '/tmp/x/window.png', mimeType: 'image/jpeg', base64: 'AAAA' }]
}

test('the where line names the asking chat’s pane, the other panes and the side panel', () => {
  const own = whereForChat(where(), 'b')
  assert.equal(own.yourPane, 1)
  const line = describeWhere(own)
  assert.ok(line.includes('2 chat panes'))
  assert.ok(line.includes('this chat is pane 1 (ui.pane(1))'))
  assert.ok(line.includes('pane 0: first chat'))
  assert.ok(line.includes('no side panel'))
  assert.equal(whereForChat(where(), 'zzz').yourPane, null)
  assert.ok(describeWhere(whereForChat(where(), null)).includes('this chat is not on screen'))
  const library = describeWhere(whereForChat(where({ place: 'library', side: 'library', library: { filters: { kind: 'pdf' }, view: 'grid', shown: 3, total: 22 } }), 'a'))
  assert.ok(library.includes('the library is open beside the chat (grid, 3 of 22 files, filtered by kind pdf)'))
})

test('go and act pass through the dispatcher, add the pane and the image, and refuse unknown names', async () => {
  const calls: MainAgentOp[] = []
  const main = async (op: MainAgentOp): Promise<unknown> => {
    calls.push(op)
    if (op.op === 'uiSnapshot') return snapshot
    if (op.op === 'uiMap' && op.call === 'where') return where()
    if (op.op === 'uiMap' && op.call === 'go') return { ok: true, value: null, where: where({ place: op.place, side: op.place === 'library' ? 'library' : 'browser' }) } satisfies UiMapResult
    if (op.op === 'uiMap' && op.call === 'act') return { ok: false, error: 'Give id: a file id from library_list.', where: where() } satisfies UiMapResult
    throw new Error('unexpected op')
  }
  const tools = Object.fromEntries(uiMapTools(main).map((tool) => [tool.name, tool]))
  const context = { provider: 'codex' as const, chatId: 'b' }

  const seen = await tools.rocket_ui_where!.run({}, context)
  const seenText = JSON.parse((seen.content[0] as { text: string }).text)
  assert.equal(seenText.where.yourPane, 1)
  assert.ok(seenText.summary.startsWith('Where you are:'))
  assert.equal(seen.content.length, 1)

  const went = await tools.rocket_ui_go!.run({ place: 'library' }, context)
  assert.ok(!went.isError)
  const wentText = JSON.parse((went.content[0] as { text: string }).text)
  assert.equal(wentText.where.place, 'library')
  assert.equal(wentText.capture.directory, '/tmp/x')
  assert.deepEqual(went.content[2], { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' })
  assert.deepEqual(calls.at(-2), { op: 'uiMap', call: 'go', place: 'library', params: {} })

  const refused = await tools.rocket_ui_act!.run({ action: 'library.open', params: {}, capture: false }, context)
  assert.ok(refused.isError)
  assert.equal(refused.structuredContent?.error?.code, 'UI_MAP_REFUSED')
  assert.equal(refused.structuredContent?.error?.message, 'Give id: a file id from library_list.')
  assert.equal(refused.content.length, 1)

  const unknown = await tools.rocket_ui_go!.run({ place: 'library.nowhere' }, context)
  assert.equal(unknown.structuredContent?.error?.code, 'INVALID_ARGUMENT')
  assert.ok(!calls.some((op) => op.op === 'uiMap' && op.call === 'go' && op.place === 'library.nowhere'))

  const closed = await uiMapTools(async () => { throw new Error('Rocket’s window is closed.') })[0]!.run({}, context)
  assert.equal(closed.structuredContent?.error?.code, 'UI_UNAVAILABLE')
  assert.ok((closed.content[0] as { text: string }).text.includes('Open the app and try again.'))
})

test('the schemas enumerate the map, so a model cannot invent a place or action', () => {
  const [, go, act] = uiMapTools(async () => null)
  const places = (go!.inputSchema.properties as { place: { enum: string[] } }).place.enum
  const actions = (act!.inputSchema.properties as { action: { enum: string[] } }).action.enum
  assert.ok(places.includes('library') && !places.includes('library.open'))
  assert.ok(actions.includes('library.open') && !actions.includes('library'))
  assert.ok(go!.description.includes('- library {'))
  assert.ok(!go!.description.includes('- library.open'))
  assert.ok(act!.description.includes('- library.open {id'))
})
