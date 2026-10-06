import type { Item, ProviderId } from './types.ts'
import { pageKey } from './sources.ts'

// "Fill with Rocket": the user right-clicks a text field (or a form) in the browser and a model
// writes the answer straight into the page. No chat is shown and nothing is kept. Main finds the
// fields and owns the chip beside them; the host runs one turn in a hidden chat and reads the
// answer back. What crosses between them, the message the model is given and the reading of its
// reply live here, as pure functions, so they can be tested without a page or a CLI.
// The design is docs/mockups/fill-with-rocket.html.

/** One field Rocket can fill, as main found it on the page. */
export type FillField = {
  /** f1, f2…: how the model and the reply name it. */
  id: string
  /** What the page calls it: its label, aria-label, placeholder or name. */
  label: string
  /** line: a one-line input; text: a textarea; rich: a contenteditable editor. */
  kind: 'line' | 'text' | 'rich'
  /** The input's type for a one-line field (email, url, search…), else ''. */
  inputType: string
  value: string
  placeholder: string
  required: boolean
  maxLength: number | null
  /** A CSS selector for the field, for a model reading the page around it. */
  selector: string
}

/** What the user pointed at: one field, or the fields of one form. */
export type FillTarget = {
  /** The tab, by the name models know it by (t4). */
  tab: string
  url: string
  title: string
  mode: 'field' | 'form'
  fields: FillField[]
  /** Fields of the form Rocket will not fill (passwords, payment), each with why. */
  skipped: Array<{ label: string; reason: string }>
  /** The text around the field on the page, so the model knows what it is answering. */
  context: string
}

/** What to do: fill afresh, or rework what the fields hold now. */
export type FillVariant = 'fill' | 'voice' | 'shorter' | 'more' | 'friendlier' | 'different'

/** A page or command the turn used, for the chip's Sources list. */
export type FillSource = { kind: 'page' | 'command'; title: string; detail: string; url: string | null }

/** Main → host. */
export type MainToHostFill =
  | { type: 'fillStart'; id: string; target: FillTarget; variant: FillVariant; instructions: string | null; provider: ProviderId | null }
  | { type: 'fillStop'; id: string }

/** Host → main. */
export type HostToMainFill =
  /** The model a fill will use, for the menu's label; sent at start-up and whenever it changes. */
  | { type: 'fillModel'; label: string | null }
  /** The hidden chat a fill runs in, before its turn starts, so its tabs stay in the background. */
  | { type: 'fillChat'; id: string; chatId: string; model: string }
  | { type: 'fillStep'; id: string; step: string; sources: FillSource[] }
  | { type: 'fillDone'; id: string; values: Record<string, string>; left: Record<string, string>; sources: FillSource[] }
  /** `alternative`: another provider to offer, when one has room. */
  | { type: 'fillFailed'; id: string; error: string; alternative: { provider: ProviderId; label: string } | null }
  /** The fill's chat is gone; its tabs can be forgotten. */
  | { type: 'fillEnded'; id: string; chatId: string }

/** What the chip shows. Main owns it; the chip's page only draws it and reports clicks. */
export type FillChipState =
  | { phase: 'ask'; model: string }
  | { phase: 'working'; model: string; step: string; startedAt: number; sources: FillSource[] }
  /** `warn` is short enough for the chip; `detail` says which fields were left and why, on hover. */
  | { phase: 'done'; label: string; warn: string | null; detail: string | null; sources: FillSource[] }
  | { phase: 'failed'; message: string; alternative: string | null }

/** What the chip asks of main. */
export type FillChipAction =
  | { action: 'start'; instructions: string }
  | { action: 'cancel' }
  | { action: 'stop' }
  | { action: 'undo' }
  | { action: 'close' }
  | { action: 'again'; variant: FillVariant }
  | { action: 'instructions' }
  | { action: 'retry' }
  | { action: 'alternative' }
  | { action: 'openSource'; url: string }
  /** The chip's page is this tall now (a dropdown opened or closed). */
  | { action: 'size'; height: number }

/** The chip's width in CSS pixels. Fixed in every phase, so it never jumps as the steps change. */
export const FILL_CHIP_WIDTH = 500
/** Room around the chip in its view for its shadow. */
export const FILL_CHIP_MARGIN = 10
export const FILL_CHIP_HEIGHT = 34

const FENCE = 'rocket-fill'

const VARIANT_ASK: Record<Exclude<FillVariant, 'fill' | 'voice'>, string> = {
  shorter: 'Make it shorter. Keep what matters and cut the rest.',
  more: 'Add more detail where it helps the reader.',
  friendlier: 'Make it friendlier and warmer, without losing anything it says.',
  different: 'Write a different take on it: another angle or structure, the same facts.'
}

function fieldLine(field: FillField): string {
  const kind = field.kind === 'line'
    ? `one-line${field.inputType && field.inputType !== 'text' ? ` ${field.inputType}` : ''} input`
    : field.kind === 'text' ? 'multi-line text box' : 'rich text editor'
  const notes = [
    kind,
    field.required ? 'required' : '',
    field.maxLength ? `at most ${field.maxLength} characters` : '',
    field.placeholder && field.placeholder !== field.label ? `placeholder "${field.placeholder}"` : '',
    `selector ${field.selector}`
  ].filter(Boolean).join(', ')
  const value = field.value.trim()
  return `- ${field.id} · "${field.label || 'unlabelled'}" (${notes})${value ? `\n  It holds now:\n${indent(value, '    ')}` : ' · empty'}`
}

function indent(text: string, by: string): string {
  return text.split('\n').map((line) => `${by}${line}`).join('\n')
}

/**
 * The message a fill turn starts with. It is the whole of what the model knows about the job, so
 * it says where the field is, what is around it, what to do and exactly how to answer.
 */
export function fillPrompt(target: FillTarget, variant: FillVariant, instructions: string | null, voice: string[] = []): string {
  const what = target.mode === 'field'
    ? `one field, "${target.fields[0]?.label || 'unlabelled'}"`
    : `a form with ${target.fields.length} field${target.fields.length === 1 ? '' : 's'} to fill`
  const rework = variant !== 'fill'
  const job: string[] = []
  if (variant === 'voice') {
    job.push(
      'Rewrite what the fields hold now so it sounds like the user wrote it. Keep every fact, link and piece of code, and do not research again.',
      'Below are messages the user wrote in Rocket\'s chats, for their voice: word choice, casing, punctuation, how they open and close. They were written to an assistant, so they are shorter and blunter than a post would be: take the voice, not the length or the bluntness. Never quote them or mention them.',
      `<user-messages>\n${voice.map((message) => message.trim()).join('\n---\n')}\n</user-messages>`
    )
  } else if (rework) {
    job.push(`Rework what the fields hold now. ${VARIANT_ASK[variant]} Keep the facts; research again only if the change needs it.`)
  } else {
    job.push('Write what the user would put here: the best answer you can give, checked.')
  }
  if (instructions?.trim()) job.push(`The user's instructions for this: ${instructions.trim()}`)

  return [
    '<rocket-fill>',
    'You are filling in a web page for the user, from Rocket\'s browser. No chat is shown: Rocket reads only the fill block at the end of your final message and types it into the page, where the user reviews it before sending anything.',
    '',
    `Page: tab ${target.tab} · ${target.title || 'untitled'} · ${target.url}`,
    `Pointed at: ${what}.`,
    '',
    'Fields:',
    ...target.fields.map(fieldLine),
    ...(target.skipped.length ? ['', `Not for you (leave these alone): ${target.skipped.map((entry) => `"${entry.label}" (${entry.reason})`).join(', ')}.`] : []),
    ...(target.context.trim() ? ['', 'The page around it:', '"""', target.context.trim(), '"""'] : []),
    '',
    ...job,
    '',
    'How to work:',
    `- Read whatever you need. browser_read on tab ${target.tab} (with a field's selector, or none) shows the page. That tab is the user's and the fields are in it: read it, but never navigate, click, type or submit there. Open other pages in your own tab.`,
    '- You have every tool you would have in a chat. Check what you state against primary sources: open the page, since a search result is only a lead. Run a command when it is the way to know something (a version, a setting).',
    '- Write as the user, ready to send: first person, no preamble ("Here is a reply"), no notes to the user, no sign-off unless the page expects one. Match the page\'s language and register. A plain text box gets plain text, not Markdown headings or bold; code may stay as code.',
    '- If a field already holds text and you were not asked to rework it, work from it: finish it, fix it or answer it, as fits.',
    '- Fill only what you can fill truthfully. Leave a field that would need the user\'s own details you do not know (their name, email, phone, address, account or payment details), and say which and why.',
    '- Never submit, post, send or save anything.',
    '',
    'End your final message with exactly one block like this, and nothing after it. Values are JSON strings, with newlines written as \\n. Leave "left" out when you filled every field.',
    '```' + FENCE,
    `{"fields": {${target.fields.slice(0, 2).map((field) => `"${field.id}": "…"`).join(', ')}}, "left": {"f9": "why you left it"}}`,
    '```',
    '</rocket-fill>'
  ].join('\n')
}

export type FillReply = { values: Record<string, string>; left: Record<string, string> }

/**
 * The fill block at the end of a reply, read against the fields asked for. Throws with a sentence
 * for the chip when there is none, or nothing in it fills anything.
 */
export function parseFillReply(text: string, ids: string[]): FillReply {
  const json = lastFillBlock(text)
  if (json === null) throw new Error('The model answered without a fill, so the field is unchanged. Try again.')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('The model\'s fill could not be read, so the field is unchanged. Try again.')
  }
  const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})
  const wanted = new Set(ids)
  const values: Record<string, string> = {}
  for (const [id, value] of Object.entries(record(record(parsed).fields))) {
    if (wanted.has(id) && typeof value === 'string') values[id] = value
  }
  const left: Record<string, string> = {}
  for (const [id, reason] of Object.entries(record(record(parsed).left))) {
    if (wanted.has(id) && !(id in values)) left[id] = typeof reason === 'string' && reason.trim() ? reason.trim() : 'left for you'
  }
  if (!Object.keys(values).length) {
    const why = Object.values(left)[0]
    throw new Error(why ? `The model left it for you: ${why}` : 'The model filled nothing, so the field is unchanged. Try again.')
  }
  return { values, left }
}

/** The JSON inside the last ```rocket-fill fence, or null. A value that holds a fence of its own sits inside a JSON string, never at the start of a line. */
function lastFillBlock(text: string): string | null {
  const lines = text.split('\n')
  for (let start = lines.length - 1; start >= 0; start--) {
    if (lines[start]!.trim() !== '```' + FENCE) continue
    const end = lines.findIndex((line, index) => index > start && line.trim() === '```')
    return lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim()
  }
  return null
}

/** A host and path as a short line, for a page with no title to hand. */
export function pageLine(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, '')
    const host = parsed.hostname.replace(/^www\./, '')
    return path ? `${host}${path.length > 40 ? `${path.slice(0, 39)}…` : path}` : host
  } catch {
    return url
  }
}

function argOf(label: string, key: string): string | null {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(label)
  return match ? match[1]!.replace(/\\(.)/g, '$1') : null
}

function short(text: string, max = 70): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * What the chip says a turn is doing, from the item it just reported; null for an item that
 * changes nothing worth saying. Read from the model's own tool calls, so it is never invented.
 */
export function describeStep(item: Item, pageUrl: string): string | null {
  switch (item.type) {
    case 'reasoning': return 'Thinking'
    case 'assistant': return 'Writing the answer'
    case 'plan': return 'Planning'
    case 'tool': break
    default: return null
  }
  const label = item.label
  switch (item.kind) {
    case 'command': return `Running ${short(label, 60)}`
    case 'read': return `Reading ${short(label.split('/').at(-1) || label, 50)}`
    case 'search': return `Searching files for ${short(label, 50)}`
    case 'edit': return `Writing ${short(label.split('/').at(-1) || label, 50)}`
    case 'web': return /^https?:\/\//i.test(label) ? `Opening ${pageLine(label)}` : `Searching the web for “${short(label, 50)}”`
    case 'mcp': {
      const tool = /^\S+ · (\w+)/.exec(label)?.[1] ?? ''
      const url = argOf(label, 'url')
      const here = url ? pageKey(url) === pageKey(pageUrl) : true
      if (tool === 'browser_read') return url && !here ? `Opening ${pageLine(url)}` : 'Reading the page'
      if (tool === 'browser_screenshot') return 'Looking at the page'
      if (tool === 'browser_run') return 'Working in a page'
      if (tool === 'browser_download') return 'Downloading a file'
      return tool ? `Using ${tool.replace(/_/g, ' ')}` : 'Using a tool'
    }
    default: return 'Working'
  }
}

/** The pages a turn opened and the commands it ran, each once, for the chip's Sources. */
export function fillSources(opened: Array<{ url: string }>, items: Item[], pageUrl: string): FillSource[] {
  const sources: FillSource[] = []
  const pages = new Set<string>()
  const here = pageKey(pageUrl)
  for (const { url } of opened) {
    const key = pageKey(url)
    if (!key || pages.has(key)) continue
    pages.add(key)
    sources.push({ kind: 'page', title: key === here ? 'This page' : pageLine(url), detail: hostOf(url), url })
  }
  const commands = new Set<string>()
  for (const item of items) {
    if (item.type !== 'tool' || item.kind !== 'command' || item.status !== 'done' || commands.has(item.label)) continue
    commands.add(item.label)
    sources.push({ kind: 'command', title: `Ran ${short(item.label, 60)}`, detail: 'command', url: null })
  }
  return sources
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * The user's own messages, for "Sound like you": most recent first in, as many as fit. Pasted
 * text is not their voice, and a one-word reply or a wall of pasted logs says little about it.
 */
export function voiceSamples(messages: string[], limit = 40, budget = 8_000): string[] {
  const picked: string[] = []
  const seen = new Set<string>()
  let used = 0
  for (const raw of messages) {
    const text = raw.replace(/<pasted_content[\s\S]*?<\/pasted_content>/g, '').replace(/\n{3,}/g, '\n\n').trim()
    if (text.length < 12 || text.length > 1_200 || seen.has(text)) continue
    if (used + text.length > budget) break
    seen.add(text)
    picked.push(text)
    used += text.length
    if (picked.length >= limit) break
  }
  return picked
}

/**
 * The chip's line once a fill is in: what it did, and how many fields it left for the user. A
 * field's label can be any length, so the chip counts them and names them only on hover.
 */
export function doneLabel(variant: FillVariant, fields: FillField[], filled: string[], left: Record<string, string>): { label: string; warn: string | null; detail: string | null } {
  const leftOut = fields.filter((field) => field.id in left)
  const warn = leftOut.length ? `${leftOut.length} for you` : null
  const detail = leftOut.length ? `Left for you: ${leftOut.map((field) => `${field.label || field.id} (${left[field.id]})`).join('; ')}` : null
  if (fields.length > 1) return { label: `${filled.length} of ${fields.length}`, warn, detail }
  return { label: variant === 'voice' ? 'In your voice' : 'Filled', warn, detail }
}

type Box = { x: number; y: number; width: number; height: number }

/**
 * Where the chip's view goes in the window: above the field's top right corner, or below the
 * field when there is no room above it; at the page's edge when the field is scrolled away.
 */
export function chipBounds(page: Box, rect: Box, zoom: number, height: number): Box {
  const right = page.x + (rect.x + rect.width) * zoom
  const top = page.y + rect.y * zoom
  const bottom = page.y + (rect.y + rect.height) * zoom
  let x = right - FILL_CHIP_WIDTH
  let y = top - FILL_CHIP_HEIGHT - 6
  if (y < page.y + 4) y = bottom + 6
  x = Math.min(Math.max(x, page.x + 4), page.x + page.width - FILL_CHIP_WIDTH - 4)
  y = Math.min(Math.max(y, page.y + 4), page.y + page.height - FILL_CHIP_HEIGHT - 4)
  return {
    x: Math.round(x - FILL_CHIP_MARGIN),
    y: Math.round(y - FILL_CHIP_MARGIN),
    width: FILL_CHIP_WIDTH + FILL_CHIP_MARGIN * 2,
    height: Math.round(height + FILL_CHIP_MARGIN * 2)
  }
}
