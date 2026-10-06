import { isAbsolute, relative, resolve } from 'node:path'
import { providerLabel, type Item, type ProviderId, type Turn } from '../shared/types.ts'
import { parsePatch, patchTotals } from '../shared/patch.ts'
import { changedBetween, commitBlocker, commitPaths, patchBetween, repoRoot, snapshot } from './git.ts'
import { messageOf, oneLine } from './json.ts'
import { publicTurn, type Store } from './store.ts'

// Several assistants, one folder. Chats can run at the same time in the same project, and other
// things change its files too: the user, an editor, an agent outside the app. This is how a
// model learns of it and how its own work is kept, without either being its job:
//
// - Ahead of a message, the model is told who else is working in the folder right now and on
//   what, what other chats finished there since its last turn, and which files changed under it.
// - When a turn ends, the files that changed during it are committed to git by the app, alone,
//   under the user's request as the message. Models are told not to commit or talk about it.
//
// A turn's changes are found by comparing a snapshot of the folder at its start with one at its
// end (git.ts), so files a model changed through a shell command count as well as its edits.
// With two turns running in one folder that comparison sees both, so a file another running turn
// has edited is left for that turn to commit.

/** A turn in flight, as the hub describes it. */
export type Working = { chatId: string; provider: ProviderId; model: string | null; request: string; edited: string[] }

const FILES_SHOWN = 30
const TURNS_SHOWN = 8
const CONTEXT_WAIT_MS = 1_500

const RULES = 'Rocket commits your changes to git itself when your turn ends. Do not stage, commit, branch or push, '
  + 'and do not bring up git or commits in your replies unless the user asks about them.'

export class Teamwork {
  /** chatId → the folder's snapshot when the turn now running began. */
  private readonly starts = new Map<string, string>()
  /** chatId → the folder's snapshot when the chat's last turn ended. */
  private readonly ends = new Map<string, string>()
  /** chatId → files its turns changed that are not committed yet (a turn that was stopped or failed). */
  private readonly pending = new Map<string, Set<string>>()
  /** chat and provider → when that session was last told what others did. */
  private readonly heard = new Map<string, number>()
  /** Sessions that have been given the rules in this run of the app. */
  private readonly ruled = new Set<string>()
  /** top → the last git work queued there, so two turns ending together do not commit over each other. */
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly store: Store,
    private readonly working: () => Working[],
    private readonly options: {
      /** Whether the app commits a turn's changes. Without it, models are only told about each other. */
      commit: boolean
      /** Hears a turn once its changes are recorded on it, so the window can show them. */
      changed?: (turn: Turn) => void
      warn?: (message: string, details: Record<string, unknown>) => void
      now?: () => number
    }
  ) {}

  /** What to tell a model ahead of its message; null when there is nothing. Also marks where its turn starts. */
  async context(chatId: string, provider: ProviderId, fresh: boolean): Promise<string | null> {
    const chat = this.store.chat(chatId)
    if (!chat) return null
    const key = `${chatId}:${provider}`
    const now = (this.options.now ?? Date.now)()
    // A session new to the chat is not owed the folder's past, only its present.
    const since = this.heard.get(key) ?? (fresh ? now : this.store.lastEnded(chatId, provider) ?? now)
    this.heard.set(key, now)

    const top = await repoRoot(chat.cwd)
    const base = top ?? chat.cwd
    const here = (label: string): string[] => pathsOf(label, chat.cwd, base)
    const lines: string[] = []

    const active = this.working().filter((other) => other.chatId !== chatId && this.store.chat(other.chatId)?.cwd === chat.cwd)
    if (active.length) {
      lines.push('Working here right now:', ...active.map((other) =>
        `- ${name(other.provider, other.model)}, asked "${oneLine(other.request, 120)}"${list(' and has edited ', [...new Set(other.edited.flatMap(here))])}`))
    }
    const finished = this.store.turnsEndedInFolder(chat.cwd, chatId, since).slice(-TURNS_SHOWN)
    const accounted = new Set(active.flatMap((other) => other.edited.flatMap(here)))
    if (finished.length) {
      lines.push('Finished here since your last turn, in other chats:', ...finished.map((turn) => {
        const items = this.store.turnItems(turn.chatId, turn.id)
        const edited = editedIn(items, here)
        for (const path of edited) accounted.add(path)
        return `- ${name(turn.provider, turn.model)}, asked "${oneLine(requestOf(items), 120)}"${list(' and edited ', edited) || ', and edited nothing'}`
      }))
    }
    if (top) {
      // Taken once per turn: a session that is started over mid-turn keeps the turn's first mark.
      const taken = this.starts.get(chatId) ?? await this.queue(top, () => withTimeout(snapshot(top), CONTEXT_WAIT_MS))
      if (taken) this.starts.set(chatId, taken)
      const before = this.ends.get(chatId)
      const moved = taken && before ? (await changedBetween(top, before, taken).catch(() => [])).filter((path) => !accounted.has(path)) : []
      if (moved.length) lines.push(`Changed since your last turn, by the user or something outside this chat:${list(' ', moved)}`)
    }

    const parts: string[] = []
    if (lines.length) {
      parts.push(`<others>\nYou share this folder with other assistants and the user.\n${lines.join('\n')}\n`
        + 'Read a file named here again before you change it, and leave a file someone is working on now to them unless the user says otherwise.\n</others>')
    }
    if (top && this.options.commit && !this.ruled.has(key)) {
      this.ruled.add(key)
      parts.push(`<git>\n${RULES}\n</git>`)
    }
    return parts.join('\n\n') || null
  }

  /**
   * A turn is over: note where the folder stands, and commit what the turn changed. Returns the
   * files it changed, relative to the repository (empty outside one). Never throws.
   */
  async turnEnded(turn: Turn): Promise<string[]> {
    const start = this.starts.get(turn.chatId)
    this.starts.delete(turn.chatId)
    const chat = this.store.chat(turn.chatId)
    if (!chat) return []
    let changed: string[] = []
    try {
      const top = await repoRoot(chat.cwd)
      if (!top) return []
      await this.queue(top, async () => {
        const end = await snapshot(top)
        if (end) this.ends.set(turn.chatId, end)
        const items = this.store.turnItems(turn.chatId, turn.id)
        const here = (label: string): string[] => pathsOf(label, chat.cwd, top)
        changed = start && end ? await changedBetween(top, start, end) : editedIn(items, here)
        const theirs = new Set(this.working()
          .filter((other) => other.chatId !== turn.chatId)
          .flatMap((other) => other.edited.flatMap((label) => pathsOf(label, this.store.chat(other.chatId)?.cwd ?? chat.cwd, top))))
        const own = changed.filter((path) => !theirs.has(path))
        // What the turn did, kept with it for the window: the patch between its two snapshots.
        if (start && end && own.length) {
          try {
            const patch = await patchBetween(top, start, end, own)
            const files = parsePatch(patch.patch)
            if (files.length) {
              const recorded = this.store.setTurnChanges(turn.id, patchTotals(files), patch)
              if (recorded) this.options.changed?.(publicTurn(recorded))
            }
          } catch (error) {
            // The record is a courtesy to the window; the commit below must not wait on it.
            this.options.warn?.(`A turn's changes could not be read: ${messageOf(error)}`, { chatId: turn.chatId })
          }
        }
        if (!this.options.commit) return
        const pending = this.pending.get(turn.chatId) ?? new Set<string>()
        this.pending.set(turn.chatId, pending)
        for (const path of changed) if (!theirs.has(path)) pending.add(path)
        // Work that was stopped or failed is half done; it is committed with the turn that finishes it.
        if (turn.status !== 'completed' || !pending.size) return
        const blocker = await commitBlocker(top)
        if (blocker) return this.options.warn?.(`A turn's changes were not committed: ${blocker}.`, { chatId: turn.chatId, top })
        const subject = oneLine(requestOf(items), 72) || 'Changes from a Rocket turn'
        await commitPaths(top, [...pending], `${subject}\n\n${name(turn.provider, turn.model)} in Rocket, chat "${oneLine(chat.title, 80)}".`)
        pending.clear()
      })
    } catch (error) {
      this.options.warn?.(`A turn's changes could not be committed: ${messageOf(error)}`, { chatId: turn.chatId })
    }
    return changed
  }

  forget(chatId: string): void {
    for (const map of [this.starts, this.ends, this.pending]) map.delete(chatId)
  }

  private queue<T>(top: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(top) ?? Promise.resolve()).then(work, work)
    this.queues.set(top, next.catch(() => {}))
    return next
  }
}

function name(provider: ProviderId, model: string | null): string {
  return providerLabel(provider) + (model ? ` (${model})` : '')
}

function list(lead: string, paths: string[]): string {
  if (!paths.length) return ''
  return `${lead}${paths.slice(0, FILES_SHOWN).join(', ')}${paths.length > FILES_SHOWN ? ` (+${paths.length - FILES_SHOWN} more)` : ''}`
}

function requestOf(items: Item[]): string {
  return items.find((item) => item.type === 'user')?.text ?? ''
}

function editedIn(items: Item[], here: (label: string) => string[]): string[] {
  return [...new Set(items.flatMap((item) => (item.type === 'tool' && item.kind === 'edit' && item.status !== 'failed' ? here(item.label) : [])))]
}

/** An edit's label as paths relative to `base`; a provider gives one path or several, absolute or relative to the chat's folder. */
function pathsOf(label: string, cwd: string, base: string): string[] {
  return label.split(', ').filter(Boolean).map((path) => {
    const full = isAbsolute(path) ? path : resolve(cwd, path)
    const within = relative(base, full)
    return within && !within.startsWith('..') ? within : full
  })
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([work, new Promise<null>((done) => setTimeout(() => done(null), ms))])
}
