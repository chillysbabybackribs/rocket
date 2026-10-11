import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { MainAgentOp } from '../../shared/types.ts'
import { clipHead, describePhotocraft, findCommands, photocraftBrief, photocraftPath, photocraftTools, replyResult } from './photocraft.ts'
import type { ToolContext } from './registry.ts'

const context: ToolContext = { provider: 'claude', chatId: 'chat-1' }

/** A main that records what it was asked and answers control methods from `replies`. */
function fakeMain(replies: Record<string, unknown> = {}, cwd = '/work/chat') {
  const asked: MainAgentOp[] = []
  const main = async (op: MainAgentOp): Promise<unknown> => {
    asked.push(op)
    if (op.op !== 'photocraft') throw new Error('not PhotoCraft')
    if (op.call === 'show') return { shown: true }
    if (op.call === 'load') return { path: op.path, bytes: 3 }
    if (op.call === 'save') return { file: op.file, bytes: 5 }
    if (op.call === 'capture') return { base64: 'iVBOR', mime: 'image/png', width: 10, height: 8 }
    if (op.call === 'status') return { status: 'ready', message: null, title: null }
    const reply = replies[op.method]
    return typeof reply === 'function' ? (reply as (params: unknown) => unknown)(op.params) : reply ?? { ok: true, result: null }
  }
  const tools = Object.fromEntries(photocraftTools(main, () => cwd).map((tool) => [tool.name, tool]))
  return { asked, tools, control: () => asked.flatMap((op) => (op.op === 'photocraft' && op.call === 'control' ? [{ method: op.method, params: op.params }] : [])) }
}

const text = (result: { content: Array<{ type: string; text?: string }> }): string => result.content.map((part) => part.text ?? '').join('')

test('paths are taken from the chat\'s folder, the home folder or as given', () => {
  assert.equal(photocraftPath('poster.psd', '/work/chat'), '/work/chat/poster.psd')
  assert.equal(photocraftPath(' out/a.png ', '/work/chat'), '/work/chat/out/a.png')
  assert.equal(photocraftPath('/tmp/x.png', '/work/chat'), '/tmp/x.png')
  assert.equal(photocraftPath('~/Pictures/p.png', '/work/chat'), join(homedir(), 'Pictures/p.png'))
  assert.equal(photocraftPath('p.png', null), join(homedir(), 'p.png'))
})

test('a PhotoCraft error is a failure the model reads; a result is JSON', () => {
  const failed = replyResult({ ok: false, error: 'unknown method `x`' })
  assert.equal(failed.isError, true)
  assert.match(text(failed), /unknown method/)
  assert.equal(text(replyResult({ ok: true, result: { layer: 2 } })), '{"layer":2}')
})

test('command search looks in ids and labels first, then in params, a page at a time', () => {
  const commands = [
    { id: 'filter.blur.gaussianBlur', label: 'Gaussian Blur…', enabled: true, params: '{"radius":px}' },
    { id: 'filter.blur.motionBlur', label: 'Motion Blur…', enabled: true, params: '{"angle":deg}' },
    { id: 'layer.layerStyle.replace', label: 'Layer Style', enabled: true, params: '{"noise":0..1}' }
  ]
  const ids = (found: { shown: unknown[] }): string[] => found.shown.map((entry) => (entry as { id: string }).id)
  assert.deepEqual(ids(findCommands(commands, 'blur gaussian')), ['filter.blur.gaussianBlur'])
  const noise = findCommands({ commands }, 'noise')
  assert.deepEqual([ids(noise), noise.by], [['layer.layerStyle.replace'], 'text'], 'a params match only when no name matches')
  assert.equal(findCommands(commands, 'blur').by, 'name')
  assert.equal(findCommands({ commands }, '').total, 3)
  assert.equal(findCommands('nonsense', 'blur').total, 0)
  assert.deepEqual(ids(findCommands(commands, '', 2)), ['layer.layerStyle.replace'], 'offset pages through')
  const many = Array.from({ length: 30 }, (_, index) => ({ id: `cmd.${index}`, label: `Command ${index}`, enabled: true, params: '{}' }))
  assert.deepEqual(Object.keys(findCommands(many, 'cmd').shown[0] as object), ['id', 'label', 'enabled'], 'many matches list compactly')
  assert.ok('params' in (findCommands(many, 'cmd', 0, true).shown[0] as object))
  assert.ok('params' in (findCommands(commands, 'blur').shown[0] as object), 'few matches carry their params')
})

test('a long answer keeps its start and says how much was cut', () => {
  assert.equal(clipHead('abcdef', 10), 'abcdef')
  assert.equal(clipHead('abcdef', 3), 'abc… (3 more characters cut; ask for less)')
})

test('opening hands the file in under its absolute path, then opens or places it', async () => {
  const { asked, tools, control } = fakeMain({ 'app.open': { ok: true, result: { name: 'sky.png' } }, 'app.place': { ok: true, result: { placed: {} } } })
  const opened = await tools.photocraft_open!.run({ path: 'refs/sky.png' }, context)
  assert.equal(opened.isError, undefined)
  assert.deepEqual(asked.filter((op) => op.op === 'photocraft' && op.call === 'load'), [{ op: 'photocraft', call: 'load', file: '/work/chat/refs/sky.png', path: '/work/chat/refs/sky.png' }])
  assert.deepEqual(control()[0], { method: 'app.open', params: { path: '/work/chat/refs/sky.png' } })
  assert.ok(asked.some((op) => op.op === 'photocraft' && op.call === 'show'), 'the panel comes forward')
  await tools.photocraft_open!.run({ path: '/tmp/grid.jpg', as: 'layer' }, context)
  assert.deepEqual(control()[1], { method: 'app.place', params: { path: '/tmp/grid.jpg' } })
})

test('saving writes what PhotoCraft saved to the file; without a path, to the document\'s own file', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'photocraft-save-'))
  const { asked, tools } = fakeMain({ 'app.save': (params: unknown) => ({ ok: true, result: { path: (params as { path?: string }).path ?? `${cwd}/poster.psd`, warnings: [] } }) }, cwd)
  const exported = await tools.photocraft_save!.run({ path: 'out/poster.png' }, context)
  assert.equal(exported.isError, undefined, text(exported))
  assert.ok(text(exported).includes(`"file":"${cwd}/out/poster.png"`))
  await tools.photocraft_save!.run({}, context)
  const saves = asked.flatMap((op) => (op.op === 'photocraft' && op.call === 'save' ? [op.file] : []))
  assert.deepEqual(saves, [`${cwd}/out/poster.png`, `${cwd}/poster.psd`])
})

test('a folder Rocket cannot write is refused before PhotoCraft reports a save', async () => {
  const { tools, control } = fakeMain({ 'app.save': { ok: true, result: { path: '/proc/nope/x.png', warnings: [] } } })
  const result = await tools.photocraft_save!.run({ path: '/proc/nope/x.png' }, context)
  assert.equal(result.isError, true)
  assert.match(text(result), /can't write to \/proc\/nope/)
  assert.deepEqual(control(), [], 'PhotoCraft was never asked to save')
})

test('a document with no file of its own needs a path to save to', async () => {
  const { tools } = fakeMain({ 'app.save': { ok: true, result: { path: 'Untitled-1', warnings: [] } } })
  const result = await tools.photocraft_save!.run({}, context)
  assert.equal(result.isError, true)
  assert.match(text(result), /Give a path/)
})

test('a batch stops at the first failure unless told to go on', async () => {
  let calls = 0
  const { tools } = fakeMain({ 'engine.execute': () => (++calls === 2 ? { ok: false, error: 'no selection' } : { ok: true, result: calls }) })
  const stopped = await tools.photocraft_batch!.run({ steps: [{ command: 'a' }, { command: 'b' }, { command: 'c' }] }, context)
  assert.equal(stopped.isError, true)
  assert.match(text(stopped), /"completed":1,"failed":1/)
  calls = 0
  const onward = await tools.photocraft_batch!.run({ steps: [{ command: 'a' }, { command: 'b' }, { command: 'c' }], stop_on_error: false }, context)
  assert.equal(onward.isError, undefined)
  assert.match(text(onward), /"completed":2,"failed":1/)
})

test('file methods go through the file tools, and an unreachable PhotoCraft says so', async () => {
  const { tools } = fakeMain()
  const refused = await tools.photocraft_control!.run({ method: 'app.save', params: { path: 'x.png' } }, context)
  assert.match(text(refused), /photocraft_save/)
  const down = photocraftTools(async () => { throw new Error('PhotoCraft\'s web build is not in /x.') }, () => null)
  const result = await down.find((tool) => tool.name === 'photocraft_run')!.run({ command: 'file.new' }, context)
  assert.equal(result.isError, true)
  assert.match(text(result), /web build is not in/)
})

test('a screenshot comes back as an image', async () => {
  const { tools } = fakeMain()
  const shot = await tools.photocraft_screenshot!.run({}, context)
  assert.deepEqual(shot.content[1], { type: 'image', data: 'iVBOR', mimeType: 'image/png' })
})

test('the brief names the active document and its layers, top first', () => {
  const brief = describePhotocraft({
    name: 'poster.psd', width: 1600, height: 1000, mode: 'Rgb', depth: 8, selectionBounds: null, selectedLayers: [11],
    layers: [{ id: 11, name: 'Hue/Saturation 1', kind: 'Adjustment' }, { id: 10, name: 'grid', kind: 'Pixel', visible: false }, { id: 1, name: 'Background', kind: 'Pixel' }]
  }, true)
  assert.match(brief, /^<photocraft>\nPhotoCraft is running beside the chat/)
  assert.match(brief, /poster\.psd, 1600×1000 px, RGB 8-bit, no selection/)
  assert.match(brief, /"Hue\/Saturation 1" \(id 11, Adjustment, selected\); "grid" \(id 10, Pixel, hidden\); "Background" \(id 1, Pixel\)/)
  assert.match(describePhotocraft(null, false), /panel is closed\).*No document is open/)
})

test('the brief is skipped while PhotoCraft is not running, and never starts it', async () => {
  const asked: MainAgentOp[] = []
  const off = await photocraftBrief(async (op) => { asked.push(op); return { status: 'off' } }, false)
  assert.equal(off, null)
  assert.deepEqual(asked, [{ op: 'photocraft', call: 'status' }])
  const slow = await photocraftBrief(() => new Promise(() => {}), true)
  assert.equal(slow, null, 'a PhotoCraft that does not answer in time is left out')
})
