import { constants } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { MainAgentOp, PhotocraftOp } from '../../shared/types.ts'
import { messageOf, recordOf, stringOf } from '../json.ts'
import { failureResult, textResult, type Tool, type ToolContext, type ToolResult } from './registry.ts'

// PhotoCraft's tools. The editor runs beside the chat in a view main owns
// (src/main/photocraft-pane.ts); these speak its control protocol, the one the desktop app
// serves over TCP (the PhotoCraft fork's docs/control-protocol.md), through main. Engine commands
// get tools of their own because a model mostly runs those; everything else goes through
// photocraft_control. Files stay on Rocket's side: a file to open is handed into the page's
// file store under its own absolute path, and what PhotoCraft saves under a path is written to
// that path, so the document's name and its Save target are the real file.

type Main = (op: MainAgentOp) => Promise<unknown>
type CwdOf = (chatId: string | null) => string | null

const COMMAND_LIMIT = 80
/** Few enough matches to list each with its params. */
const COMMAND_DETAIL = 12

/** The start of a long answer, which holds what matters in PhotoCraft's replies, and how much was cut. */
export function clipHead(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… (${text.length - max} more characters cut; ask for less)` : text
}

/** A path a model gave, made absolute against the chat's folder. */
export function photocraftPath(path: string, cwd: string | null): string {
  const given = path.trim()
  if (given === '~' || given.startsWith('~/')) return join(homedir(), given.slice(2))
  return isAbsolute(given) ? resolve(given) : resolve(cwd ?? homedir(), given)
}

/**
 * Make sure files can be written in `folder`, creating it if needed. The nearest folder that
 * exists is checked first: Node's recursive mkdir never returns under /proc, so it is only called
 * once the parent is known to be writable.
 */
export async function writableFolder(folder: string): Promise<void> {
  let existing = folder
  for (;;) {
    try { await access(existing, constants.F_OK); break } catch { /* Not there yet: look one level up. */ }
    const up = dirname(existing)
    if (up === existing) break
    existing = up
  }
  await access(existing, constants.W_OK)
  if (existing !== folder) await mkdir(folder, { recursive: true })
  await access(folder, constants.W_OK)
}

/** PhotoCraft's reply envelope as a tool result: the result as JSON, or its error as a failure. */
export function replyResult(reply: unknown, max = 12_000): ToolResult {
  const envelope = recordOf(reply)
  if (envelope.ok === false) return failureResult('PHOTOCRAFT', stringOf(envelope.error) || 'PhotoCraft refused the request without saying why.', 'operation')
  return textResult(clipHead(JSON.stringify(envelope.result ?? null), max))
}

/**
 * Commands from `engine.commands` matching `filter`: those whose id or menu label has every word,
 * or, when none does, those whose params or help mention them. A page of `COMMAND_LIMIT` from
 * `offset`, each as id, label and whether it is enabled now; with few matches (or `detail`), their
 * params too.
 */
export function findCommands(result: unknown, filter: string, offset = 0, detail = false): { shown: unknown[]; total: number; by: 'name' | 'text' | 'all' } {
  const record = recordOf(result)
  const list = (Array.isArray(result) ? result : Array.isArray(record.commands) ? record.commands : []).map(recordOf)
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  const has = (text: string): boolean => words.every((word) => text.includes(word))
  const byName = words.length ? list.filter((entry) => has(`${stringOf(entry.id)} ${stringOf(entry.label)}`.toLowerCase())) : list
  const matching = byName.length || !words.length ? byName : list.filter((entry) => has(JSON.stringify(entry).toLowerCase()))
  const by = !words.length ? 'all' : byName.length ? 'name' : 'text'
  const full = detail || matching.length <= COMMAND_DETAIL
  const shown = matching.slice(Math.max(0, offset), Math.max(0, offset) + COMMAND_LIMIT)
    .map((entry) => (full ? entry : { id: entry.id, label: entry.label, enabled: entry.enabled }))
  return { shown, total: matching.length, by }
}

const BRIEF_LAYERS = 20
const BRIEF_TIMEOUT_MS = 1_500

/**
 * What a model is told about PhotoCraft ahead of a message, from `document.inspect`: the active
 * document and its layers, top first. Null when there is nothing to say.
 */
export function describePhotocraft(inspect: unknown, open: boolean): string {
  const where = `PhotoCraft is running${open ? ' beside the chat' : ' (its panel is closed)'}; the photocraft_* tools work in it.`
  const doc = recordOf(inspect)
  const layers = Array.isArray(doc.layers) ? doc.layers.map(recordOf) : []
  if (!stringOf(doc.name)) return `<photocraft>\n${where} No document is open.\n</photocraft>`
  const selected = new Set(Array.isArray(doc.selectedLayers) ? doc.selectedLayers : [])
  const named = layers.slice(0, BRIEF_LAYERS).map((layer) => {
    const notes = [stringOf(layer.kind), layer.visible === false ? 'hidden' : '', selected.has(layer.id) ? 'selected' : ''].filter(Boolean)
    return `"${stringOf(layer.name)}" (id ${String(layer.id)}${notes.length ? `, ${notes.join(', ')}` : ''})`
  })
  const more = layers.length > BRIEF_LAYERS ? `, and ${layers.length - BRIEF_LAYERS} more` : ''
  const bounds = Array.isArray(doc.selectionBounds) ? `selection ${doc.selectionBounds.join(', ')}` : 'no selection'
  const mode = [stringOf(doc.mode).toUpperCase(), doc.depth ? `${String(doc.depth)}-bit` : ''].filter(Boolean).join(' ')
  return `<photocraft>\n${where} Active document: ${stringOf(doc.name)}, ${String(doc.width)}×${String(doc.height)} px${mode ? `, ${mode}` : ''}, ${bounds}. Layers, top first: ${named.join('; ') || 'none'}${more}.\n</photocraft>`
}

/** The brief for the message about to go, or null while PhotoCraft is not running. Never starts it. */
export async function photocraftBrief(main: Main, open: boolean): Promise<string | null> {
  const work = (async () => {
    const state = recordOf(await main({ op: 'photocraft', call: 'status' }))
    if (state.status !== 'ready') return null
    const reply = recordOf(await main({ op: 'photocraft', call: 'control', method: 'engine.execute', params: { command: 'document.inspect' } }))
    return describePhotocraft(reply.ok === false ? null : reply.result, open)
  })()
  const late = new Promise<null>((done) => setTimeout(() => done(null), BRIEF_TIMEOUT_MS).unref())
  return await Promise.race([work.catch(() => null), late])
}

export function photocraftTools(main: Main, cwdOf: CwdOf): Tool[] {
  const ask = (op: PhotocraftOp): Promise<unknown> => main(op)
  const control = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => ask({ op: 'photocraft', call: 'control', method, params })
  // Bring the panel forward, so the user watches the model work; a failure here never stops the work.
  const show = (): Promise<unknown> => ask({ op: 'photocraft', call: 'show' }).catch(() => null)
  const guarded = (run: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>) =>
    async (args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
      try { return await run(args, context) } catch (error) { return failureResult('PHOTOCRAFT_UNAVAILABLE', messageOf(error), 'runner') }
    }

  return [
    {
      name: 'photocraft_run',
      description: `Run one PhotoCraft engine command on the active document in the PhotoCraft panel beside the chat: every menu item, tool and dialog is one (filters, adjustments, layers, selections, type, transforms, file.new, …). Find ids and their params with photocraft_commands. Long commands wait for their result unless wait is false (then poll jobs.list through photocraft_control). Open and save files with photocraft_open and photocraft_save, never file.open or file.save.`,
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command id, e.g. filter.blur.gaussianBlur or file.new.' },
          params: { type: 'object', description: 'The command\'s params, e.g. {"radius": 6}.' },
          wait: { type: 'boolean', description: 'Default true.' }
        },
        required: ['command']
      },
      run: guarded(async (args) => {
        await show()
        return replyResult(await control('engine.execute', { command: stringOf(args.command), params: recordOf(args.params), ...(args.wait === false ? { wait: false } : {}) }))
      })
    },
    {
      name: 'photocraft_batch',
      description: 'Run several PhotoCraft engine commands in order, as photocraft_run would one by one. Stops at the first failure unless stop_on_error is false. Answers with each step\'s result.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, params: { type: 'object' } }, required: ['command'] } },
          stop_on_error: { type: 'boolean', description: 'Default true.' }
        },
        required: ['steps']
      },
      run: guarded(async (args) => {
        const steps = Array.isArray(args.steps) ? args.steps.map(recordOf) : []
        if (!steps.length) return failureResult('NO_STEPS', 'Give at least one step: {"command": id, "params": {...}}.')
        await show()
        const results: Array<Record<string, unknown>> = []
        let failed = 0
        for (const step of steps) {
          const reply = recordOf(await control('engine.execute', { command: stringOf(step.command), params: recordOf(step.params) }))
          results.push({ command: step.command, ok: reply.ok !== false, ...(reply.ok === false ? { error: reply.error } : { result: reply.result }) })
          if (reply.ok === false) {
            failed++
            if (args.stop_on_error !== false) break
          }
        }
        const text = clipHead(JSON.stringify({ completed: results.length - failed, failed, results }), 12_000)
        return failed && args.stop_on_error !== false ? failureResult('PHOTOCRAFT', text, 'operation') : textResult(text)
      })
    },
    {
      name: 'photocraft_commands',
      description: `Find PhotoCraft engine commands. filter keeps those whose id or menu label has all its words (e.g. "gaussian blur", "layer style", "rasterize"), or, when none does, those whose params mention them. Answers ${COMMAND_LIMIT} at a time from offset, as id, label and whether each is enabled now; with ${COMMAND_DETAIL} matches or fewer, or detail true, with their params as well.`,
      inputSchema: {
        type: 'object',
        properties: {
          filter: { type: 'string' },
          offset: { type: 'number', description: 'Default 0.' },
          detail: { type: 'boolean', description: 'List params however many match.' }
        }
      },
      run: guarded(async (args) => {
        const reply = recordOf(await control('engine.commands'))
        if (reply.ok === false) return replyResult(reply)
        const filter = stringOf(args.filter).trim()
        const offset = Math.max(0, Math.floor(Number(args.offset) || 0))
        const { shown, total, by } = findCommands(reply.result, filter, offset, args.detail === true)
        const how = by === 'all' ? `${total} commands` : `${total} commands match "${filter}" ${by === 'name' ? 'by id or label' : 'in their params (none by id or label)'}`
        const range = shown.length ? `; ${offset + 1}–${offset + shown.length} below` : ''
        const next = offset + shown.length < total ? `\nThe next page starts at offset ${offset + shown.length}.` : ''
        return textResult(`${how}${range}.\n${clipHead(JSON.stringify(shown), 24_000)}${next}`)
      })
    },
    {
      name: 'photocraft_control',
      description: `Any other PhotoCraft control method, with its params as the desktop control protocol has them. The useful ones: ui.inspect (the whole UI state: tool, panels, dialogs, document and layer tree), ui.set {tool?, zoom?, fit?, panels?, …}, ui.pointer {events: [{kind: down|move|up, x, y, pressure?}], modifiers?} (drive the active tool in document pixels), ui.menu.list / ui.menu.invoke {id}, ui.dialog.open / set / confirm / cancel, ui.key / ui.type, ui.context.choose {id}, jobs.list / jobs.cancel, layer and selection state through engine.execute with document.inspect.`,
      inputSchema: {
        type: 'object',
        properties: { method: { type: 'string' }, params: { type: 'object' } },
        required: ['method']
      },
      run: guarded(async (args) => {
        const method = stringOf(args.method)
        if (!method) return failureResult('NO_METHOD', 'Give the control method, e.g. ui.inspect.')
        if (method === 'app.open' || method === 'app.place' || method === 'app.save') return failureResult('USE_FILE_TOOLS', `Use photocraft_open or photocraft_save instead of ${method}: they move the file between the disk and PhotoCraft.`)
        if (method.startsWith('ui.') && method !== 'ui.inspect' && method !== 'ui.menu.list') await show()
        return replyResult(await control(method, recordOf(args.params)), 16_000)
      })
    },
    {
      name: 'photocraft_open',
      description: 'Open an image or document file in the PhotoCraft panel: as a new document (PSD, PSB, .pcraft, PNG, JPEG, TIFF, WebP, camera raw, …), or with as="layer" placed as a new layer of the active document, the way File › Place Embedded does: centred, as a Smart Object, so rasterize it (layer.smartObjects.rasterize) before pixel edits such as removing its background. A relative path is taken from the chat\'s folder. For an image on the web, save it first with browser_download; for a generated one, use the file\'s path.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          as: { type: 'string', enum: ['document', 'layer'], description: 'Default document.' }
        },
        required: ['path']
      },
      run: guarded(async (args, context) => {
        const file = photocraftPath(stringOf(args.path), cwdOf(context.chatId))
        await show()
        await ask({ op: 'photocraft', call: 'load', file, path: file })
        return replyResult(await control(args.as === 'layer' ? 'app.place' : 'app.open', { path: file }))
      })
    },
    {
      name: 'photocraft_save',
      description: 'Save the active PhotoCraft document to a file, its format from the extension: .psd/.psb/.pcraft keep layers; .png, .jpg, .webp, .tif and others export a flattened copy and the document keeps its own file. Without path, it is written back to its own PSD, PSB or .pcraft file, like File › Save. A relative path is taken from the chat\'s folder; missing folders are made.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      run: guarded(async (args, context) => {
        const given = stringOf(args.path).trim()
        const target = given ? photocraftPath(given, cwdOf(context.chatId)) : null
        // Refuse a folder that can't be written before PhotoCraft reports the file as saved.
        if (target) {
          try {
            await writableFolder(dirname(target))
          } catch (error) {
            return failureResult('NOT_WRITABLE', `Rocket can't write to ${dirname(target)} (${messageOf(error)}). Save somewhere you can write, such as the chat's folder.`)
          }
        }
        const reply = recordOf(await control('app.save', target ? { path: target } : {}))
        if (reply.ok === false) return replyResult(reply)
        const saved = stringOf(recordOf(reply.result).path) || target
        if (!saved || !isAbsolute(saved)) return failureResult('NO_FILE', 'This document has no file of its own yet. Give a path to save it to, e.g. poster.psd.')
        const written = recordOf(await ask({ op: 'photocraft', call: 'save', path: saved, file: saved }))
        return textResult(JSON.stringify({ file: written.file, bytes: written.bytes, warnings: recordOf(reply.result).warnings ?? [] }))
      })
    },
    {
      name: 'photocraft_screenshot',
      description: 'A picture of the PhotoCraft panel as the user sees it: canvas, panels and any open dialog. Use it to check your work.',
      inputSchema: { type: 'object', properties: {} },
      run: guarded(async () => {
        const shot = recordOf(await ask({ op: 'photocraft', call: 'capture' }))
        const data = stringOf(shot.base64)
        if (!data) return failureResult('NO_IMAGE', 'Rocket could not take a picture of PhotoCraft. Try again once its panel is open.', 'operation')
        return { content: [{ type: 'text', text: `PhotoCraft, ${shot.width}×${shot.height}` }, { type: 'image', data, mimeType: stringOf(shot.mime) || 'image/png' }] }
      })
    }
  ]
}
