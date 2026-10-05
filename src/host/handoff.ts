import { providerLabel, type Item, type ProviderId } from '../shared/types.ts'
import { oneLine } from './json.ts'

// What a provider is told about the turns it missed. When the user switches back to a provider,
// its own session is resumed, so it already holds everything up to its last turn; this builds
// the block for the turns since then, which other providers answered. The block rides at the
// head of the user's next message.
//
// Kept: every user message and every assistant reply in full where the budget allows, the files
// the turn edited and read (each named once, so the model knows where the relevant code is
// without searching for it again), and one line per other tool call. Left out: reasoning and
// tool output. Files other providers changed are on disk for the model to read.

export type MissedTurn = {
  provider: ProviderId
  model: string | null
  status: string
  items: Item[]
}

export const HANDOFF_BUDGET_CHARS = 60_000
const MAX_ACTIONS_PER_TURN = 20
const MAX_FILES_PER_LINE = 30
const TAG = 'conversation_handoff'

type Block = { head: string; user: string; reply: string; actions: string[] }

/**
 * The missed turns in both forms a provider can take them: `text`, one tagged block to put in
 * front of the user's message, and `messages`, the same turns as role-tagged history for a
 * provider that can append to its own history (Codex `thread/inject_items`).
 */
export type Handoff = {
  turns: number
  text: string
  messages: Array<{ role: 'user' | 'assistant'; text: string }>
}

/** Null when there is nothing to hand over. */
export function buildHandoff(turns: MissedTurn[], budget = HANDOFF_BUDGET_CHARS, root: string | null = null): Handoff | null {
  const blocks = turns.map((turn) => blockOf(turn, root)).filter((block) => block.user || block.reply || block.actions.length)
  if (blocks.length === 0) return null
  fit(blocks, budget)
  const text = [
    `<${TAG}>`,
    'This conversation is shared between several assistants, and the user chooses one for each message.',
    'Since your last turn here, other assistants answered the turns below (oldest first).',
    'Treat them as earlier history of this same conversation. Any file changes they made are already on disk.',
    'The files they read and edited are named, so go straight to those rather than searching for them again.',
    '',
    blocks.map(render).join('\n\n'),
    `</${TAG}>`
  ].join('\n')
  const messages: Handoff['messages'] = []
  for (const block of blocks) {
    if (block.user) messages.push({ role: 'user', text: block.user })
    const answer = [`[${block.head.replace(/^### /, '')}]`]
    if (block.actions.length) answer.push(`Actions taken:\n${block.actions.join('\n')}`)
    if (block.reply) answer.push(block.reply)
    messages.push({ role: 'assistant', text: answer.join('\n\n') })
  }
  return { turns: blocks.length, text, messages }
}

/** The user's own words, for showing a message that was sent with a handoff block in front. */
export function stripHandoff(text: string): string {
  return text.replace(new RegExp(`<${TAG}>[\\s\\S]*?</${TAG}>\\s*`, 'g'), '').trim()
}

export function withHandoff(handoff: Handoff | null, text: string): string {
  return handoff ? `${handoff.text}\n\n${text}` : text
}

/** `root` is the chat's folder; paths inside it are given relative to it. */
function blockOf(turn: MissedTurn, root: string | null): Block {
  const name = providerLabel(turn.provider) + (turn.model ? ` (${turn.model})` : '')
  const ending = turn.status === 'interrupted'
    ? ', stopped by the user before it finished'
    : turn.status === 'failed' ? ', which failed before finishing' : ''
  const user = turn.items.filter((item) => item.type === 'user').map((item) => item.text).join('\n\n')
  const reply = turn.items.filter((item) => item.type === 'assistant').map((item) => item.text.trim()).filter(Boolean).join('\n\n')
  const tools = turn.items.filter((item) => item.type === 'tool')
  // Files are named once each however often they were touched; a file that was edited was also read.
  const isFile = (tool: (typeof tools)[number]): boolean => (tool.kind === 'edit' || tool.kind === 'read') && tool.status !== 'failed'
  const paths = (kind: 'edit' | 'read'): string[] => [...new Set(tools.filter((tool) => isFile(tool) && tool.kind === kind)
    .flatMap((tool) => tool.label.split(', '))
    .map((path) => oneLine(root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path, 160)))]
  const edited = paths('edit')
  const read = paths('read').filter((path) => !edited.includes(path))
  const files = (verb: string, list: string[]): string[] => (list.length
    ? [`- ${verb}: ${list.slice(0, MAX_FILES_PER_LINE).join(', ')}${list.length > MAX_FILES_PER_LINE ? ` (+${list.length - MAX_FILES_PER_LINE} more)` : ''}`]
    : [])
  const others = tools.filter((tool) => !isFile(tool))
  const actions = [
    ...files('edited', edited),
    ...files('read', read),
    ...others.slice(0, MAX_ACTIONS_PER_TURN).map((tool) => `- ${tool.kind}: ${oneLine(tool.label, 160)}${tool.status === 'failed' ? ' (failed)' : ''}`)
  ]
  if (others.length > MAX_ACTIONS_PER_TURN) actions.push(`- …and ${others.length - MAX_ACTIONS_PER_TURN} more`)
  return { head: `### Turn answered by ${name}${ending}`, user, reply, actions }
}

function render(block: Block): string {
  const parts = [block.head]
  if (block.user) parts.push(`User:\n${block.user}`)
  if (block.actions.length) parts.push(`Actions taken:\n${block.actions.join('\n')}`)
  if (block.reply) parts.push(`Assistant:\n${block.reply}`)
  return parts.join('\n\n')
}

function size(blocks: Block[]): number {
  return blocks.reduce((total, block) => total + render(block).length + 2, 0)
}

/**
 * Shrink to the budget, giving up the least useful text first: action lines of older turns, then
 * the middle of the longest replies. The most recent turn is touched last.
 */
function fit(blocks: Block[], budget: number): void {
  for (let i = 0; i < blocks.length - 1 && size(blocks) > budget; i++) blocks[i]!.actions = []
  for (let guard = 0; guard < 200 && size(blocks) > budget; guard++) {
    const over = size(blocks) - budget
    const older = blocks.slice(0, -1)
    const pool = older.some((block) => block.reply.length > 400) ? older : blocks
    const longest = pool.reduce((a, b) => (b.reply.length > a.reply.length ? b : a))
    if (longest.reply.length <= 400) {
      const text = blocks.reduce((a, b) => (b.user.length > a.user.length ? b : a))
      if (text.user.length <= 400) return
      text.user = elide(text.user, Math.max(400, text.user.length - over - 40))
      continue
    }
    longest.reply = elide(longest.reply, Math.max(400, longest.reply.length - over - 40))
  }
}

/** Keep the start and the end; the conclusion of a reply is usually at the end. */
function elide(text: string, keep: number): string {
  if (text.length <= keep) return text
  const head = Math.floor(keep * 0.4)
  const tail = keep - head
  return `${text.slice(0, head)}\n[…${text.length - keep} characters omitted…]\n${text.slice(text.length - tail)}`
}
