import assert from 'node:assert/strict'
import test from 'node:test'
import type { MainAgentOp, UiMapResult, UiSnapshot, UiWhere } from '../../shared/types.ts'
import { describeWhere, uiMapTools, whereForChat } from './ui-map.ts'

const where = (patch: Partial<UiWhere> = {}): UiWhere => ({
  place: 'chat',
  panes: [
    { index: 0, chatId: 'a', title: 'first chat', provider: 'claude', focused: true, running: false, goal: null, planOpen: false },
    { index: 1, chatId: 'b', title: 'second chat', provider: 'codex', focused: false, running: true, goal: null, planOpen: false }
  ],
  focused: 0, side: 'chat', artifact: null, evals: null, dialogs: [], railOpen: true, ...patch
})

const evals: NonNullable<UiWhere['evals']> = {
  view: 'playgrounds', experimentId: null, datasetId: null,
  playground: { scenario: 'goal-draft-minimal', dataset: 'goal-draft-minimal', compare: 'base', diff: false, filter: '', busy: true, error: null, cells: [] },
  runSheet: { open: false, scenario: '', provider: 'claude', trial: 0, phase: 'idle', chatId: null, error: null, grades: null },
  tools: { section: 'health' }
}

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
  const playground = describeWhere(whereForChat(where({ place: 'evals.playgrounds', side: 'evals', evals }), 'a'))
  assert.ok(playground.includes('evals open at evals.playgrounds, scenario goal-draft-minimal, running'))
  const tools = describeWhere(whereForChat(where({ place: 'evals.tools', side: 'evals', evals: { ...evals, view: 'tools', runSheet: { ...evals.runSheet, open: true, phase: 'running' } } }), 'a'))
  assert.ok(tools.includes('health section; Run cell sheet open (running)'))
})

test('go and act pass through the dispatcher, add the pane and the image, and refuse unknown names', async () => {
  const calls: MainAgentOp[] = []
  const main = async (op: MainAgentOp): Promise<unknown> => {
    calls.push(op)
    if (op.op === 'uiSnapshot') return snapshot
    if (op.op === 'uiMap' && op.call === 'where') return where()
    if (op.op === 'uiMap' && op.call === 'go') return { ok: true, value: null, where: where({ place: op.place, side: 'evals', evals }) } satisfies UiMapResult
    if (op.op === 'uiMap' && op.call === 'act') return { ok: false, error: 'There is no row 9.', where: where() } satisfies UiMapResult
    throw new Error('unexpected op')
  }
  const tools = Object.fromEntries(uiMapTools(main).map((tool) => [tool.name, tool]))
  const context = { provider: 'codex' as const, chatId: 'b' }

  const seen = await tools.rocket_ui_where!.run({}, context)
  const seenText = JSON.parse((seen.content[0] as { text: string }).text)
  assert.equal(seenText.where.yourPane, 1)
  assert.ok(seenText.summary.startsWith('Where you are:'))
  assert.equal(seen.content.length, 1)

  const went = await tools.rocket_ui_go!.run({ place: 'evals.playgrounds', params: { scenario: 'goal-draft-minimal' } }, context)
  assert.ok(!went.isError)
  const wentText = JSON.parse((went.content[0] as { text: string }).text)
  assert.equal(wentText.where.place, 'evals.playgrounds')
  assert.equal(wentText.capture.directory, '/tmp/x')
  assert.deepEqual(went.content[2], { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' })
  assert.deepEqual(calls.at(-2), { op: 'uiMap', call: 'go', place: 'evals.playgrounds', params: { scenario: 'goal-draft-minimal' } })

  const refused = await tools.rocket_ui_act!.run({ action: 'evals.playgrounds.run', params: { row: 9 }, capture: false }, context)
  assert.ok(refused.isError)
  assert.equal(refused.structuredContent?.error?.code, 'UI_MAP_REFUSED')
  assert.equal(refused.structuredContent?.error?.message, 'There is no row 9.')
  assert.equal(refused.content.length, 1)

  const unknown = await tools.rocket_ui_go!.run({ place: 'evals.nowhere' }, context)
  assert.equal(unknown.structuredContent?.error?.code, 'INVALID_ARGUMENT')
  assert.ok(!calls.some((op) => op.op === 'uiMap' && op.call === 'go' && op.place === 'evals.nowhere'))

  const closed = await uiMapTools(async () => { throw new Error('Rocket’s window is closed.') })[0]!.run({}, context)
  assert.equal(closed.structuredContent?.error?.code, 'UI_UNAVAILABLE')
  assert.ok((closed.content[0] as { text: string }).text.includes('Open the app and try again.'))
})

test('the schemas enumerate the map, so a model cannot invent a place or action', () => {
  const [, go, act] = uiMapTools(async () => null)
  const places = (go!.inputSchema.properties as { place: { enum: string[] } }).place.enum
  const actions = (act!.inputSchema.properties as { action: { enum: string[] } }).action.enum
  assert.ok(places.includes('evals.tools') && !places.includes('evals.playgrounds.run'))
  assert.ok(actions.includes('evals.playgrounds.run') && !actions.includes('evals.tools'))
  assert.ok(go!.description.includes('- evals.playgrounds {scenario'))
  assert.ok(!go!.description.includes('- evals.playgrounds.run'))
  assert.ok(act!.description.includes('- evals.playgrounds.run {row'))
})
