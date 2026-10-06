import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Item, Turn } from '../shared/types.ts'
import type { TurnTiming } from './hub.ts'
import { publicTurn, type Store } from './store.ts'
import type { ToolLedger } from './tool-ledger.ts'

export const TURN_EXPORT_VERSION = 1

export type TurnExport = {
  formatVersion: typeof TURN_EXPORT_VERSION
  exportedAt: number
  git: { sha: string | null; dirty: boolean | null }
  chat: { id: string; title: string; cwd: string }
  turn: Turn
  items: Item[]
  timing: {
    firstEventMs: number | null
    firstTextMs: number | null
    totalMs: number | null
  }
  ledger: { path: string | null; calls: unknown[] }
  cellDir: string | null
}

export type EvalExportMode = 'off' | 'tagged' | 'all'

function gitMeta(): TurnExport['git'] {
  try {
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const dirty = execSync('git status --porcelain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0
    return { sha, dirty }
  } catch {
    return { sha: null, dirty: null }
  }
}

function readTags(path: string): Set<string> {
  if (!existsSync(path)) return new Set()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { chatIds?: unknown }
    return new Set(Array.isArray(raw.chatIds) ? raw.chatIds.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeTags(path: string, chatIds: Set<string>): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ chatIds: [...chatIds].sort() }, null, 2))
}

export function exportMode(): EvalExportMode {
  const raw = (process.env.ROCKET_EVAL_EXPORT ?? 'tagged').toLowerCase()
  if (raw === '0' || raw === 'off' || raw === 'false') return 'off'
  if (raw === 'all' || raw === '1' || raw === 'true') return 'all'
  return 'tagged'
}

export function buildTurnExport(
  store: Store,
  turnId: string,
  options: { timing?: TurnTiming | null; ledger?: ToolLedger | null; cellDir?: string | null } = {}
): TurnExport | null {
  const stored = store.turn(turnId)
  if (!stored) return null
  const chat = store.chat(stored.chatId)
  if (!chat) return null
  const turn = publicTurn(stored)
  const ended = turn.endedAt ?? Date.now()
  const timing = options.timing
  const ledger = options.ledger
  let calls: unknown[] = []
  let ledgerPath: string | null = null
  if (ledger) {
    ledgerPath = ledger.path
    const slice = ledger.query({
      since: turn.startedAt - 1_000,
      until: ended + 5_000,
      limit: 50
    }) as { calls?: Array<{ turnId?: string | null }> }
    calls = (slice.calls ?? []).filter((call) => call.turnId === turnId)
  }
  return {
    formatVersion: TURN_EXPORT_VERSION,
    exportedAt: Date.now(),
    git: gitMeta(),
    chat: { id: chat.id, title: chat.title, cwd: chat.cwd },
    turn,
    items: store.turnItems(chat.id, turnId),
    timing: {
      firstEventMs: timing?.firstEventMs ?? null,
      firstTextMs: timing?.firstTextMs ?? null,
      totalMs: timing?.totalMs ?? (turn.endedAt !== null ? turn.endedAt - turn.startedAt : null)
    },
    ledger: { path: ledgerPath, calls },
    cellDir: options.cellDir ?? null
  }
}

export function writeTurnExport(body: TurnExport, directory: string): string {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'turn.json')
  writeFileSync(path, JSON.stringify(body, null, 2))
  const ledgerPath = join(directory, 'ledger-slice.json')
  writeFileSync(ledgerPath, JSON.stringify(body.ledger, null, 2))
  return path
}

/** Where ended turns are written when no matrix cell dir is set. */
export function evalInboxDir(repoRoot: string): string {
  return join(repoRoot, '.artifacts', 'evals', 'inbox')
}

export class EvalExport {
  private readonly tagsPath: string
  private tags: Set<string>
  private cellDir: string | null = process.env.ROCKET_EVAL_CELL?.trim() || null

  constructor(
    private readonly dataDir: string,
    private readonly repoRoot: string,
    private readonly store: () => Store,
    private readonly ledger: () => ToolLedger | undefined
  ) {
    this.tagsPath = join(dataDir, 'eval-chats.json')
    this.tags = readTags(this.tagsPath)
  }

  listTaggedChats(): string[] {
    return [...this.tags].sort()
  }

  tagChat(chatId: string): void {
    this.tags.add(chatId)
    writeTags(this.tagsPath, this.tags)
  }

  untagChat(chatId: string): void {
    this.tags.delete(chatId)
    writeTags(this.tagsPath, this.tags)
  }

  setCellDir(dir: string | null): void {
    this.cellDir = dir?.trim() || null
  }

  shouldExport(chatId: string): boolean {
    if (this.cellDir) return true
    const mode = exportMode()
    if (mode === 'off') return false
    if (mode === 'all') return true
    return this.tags.has(chatId)
  }

  exportTurn(turnId: string, timing?: TurnTiming | null, outDir?: string | null): string | null {
    const body = buildTurnExport(this.store(), turnId, {
      timing,
      ledger: this.ledger() ?? null,
      cellDir: outDir ?? this.cellDir
    })
    if (!body) return null
    const dir = outDir ?? this.cellDir ?? join(evalInboxDir(this.repoRoot), `${body.turn.id}__${body.exportedAt}`)
    return writeTurnExport(body, dir)
  }

  onTurnEnded(turn: Turn, timing?: TurnTiming | null): string | null {
    if (turn.status === 'running' || !this.shouldExport(turn.chatId)) return null
    return this.exportTurn(turn.id, timing)
  }
}
