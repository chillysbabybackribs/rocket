import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Chat, ChatSnapshot, Goal, GoalRole, ImageAttachment, Item, ProviderId, QueuedMessage, Turn, TurnChanges, TurnStatus, TurnTokens } from '../shared/types.ts'

// The canonical transcript. The app owns the conversation; a provider's own session is a cache
// of the part of it that provider has already seen. Each (chat, provider) pair records the
// provider's session id and `seenTurnSeq`, the last turn that session contains, so a switch back
// to a provider resumes its session and hands over only the turns after that mark.
//
// Synchronous SQLite is deliberate: this runs in the agent host (a utility process), never in
// Electron's main process or the renderer, and every statement here is a point read or write.

export type ProviderSession = { sessionId: string | null; seenTurnSeq: number }
export type StoredTurn = Turn & { seq: number }

/** A turn as the window sees it: without the store's own ordering number. */
export function publicTurn(turn: StoredTurn): Turn {
  const { seq: _seq, ...rest } = turn
  return rest
}
/** One thing a model wrote down about a folder, for every later session there. Models cite it as m<seq>. */
export type Note = { seq: number; cwd: string; text: string; provider: ProviderId; chatId: string | null; createdAt: number }

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS message_queues (chat_id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    cwd TEXT NOT NULL,
    last_provider TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS turns (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT,
    status TEXT NOT NULL,
    error TEXT,
    handoff_turns INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS turns_by_chat ON turns(chat_id, seq);
  CREATE TABLE IF NOT EXISTS items (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    data TEXT NOT NULL,
    UNIQUE (chat_id, id)
  );
  CREATE INDEX IF NOT EXISTS items_by_chat ON items(chat_id, seq);
  CREATE TABLE IF NOT EXISTS provider_sessions (
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    session_id TEXT,
    seen_turn_seq INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, provider)
  );
  CREATE TABLE IF NOT EXISTS notes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    cwd TEXT NOT NULL,
    text TEXT NOT NULL,
    provider TEXT NOT NULL,
    chat_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notes_by_cwd ON notes(cwd, seq);
  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL UNIQUE REFERENCES chats(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS turn_patches (
    turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
    patch TEXT NOT NULL,
    truncated INTEGER NOT NULL
  );
`

// Columns added after the first release, for stores created before them.
const ADDED_COLUMNS: Array<{ table: string; column: string; definition: string }> = [
  { table: 'turns', column: 'goal_role', definition: 'TEXT' },
  { table: 'turns', column: 'changes', definition: 'TEXT' },
  { table: 'turn_patches', column: 'start_tree', definition: 'TEXT' },
  { table: 'turn_patches', column: 'end_tree', definition: 'TEXT' },
  { table: 'turns', column: 'tokens', definition: 'TEXT' }
]

/** What the store keeps of a turn's changes: the patch, and the two snapshots it was taken between, for undoing it. */
export type StoredPatch = { patch: string; truncated: boolean; startTree: string | null; endTree: string | null }

type Row = Record<string, unknown>

export class Store {
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;')
    this.db.exec(SCHEMA)
    for (const { table, column, definition } of ADDED_COLUMNS) {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name))
      if (!columns.includes(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
    // A turn still marked running was cut off by the last exit; nothing will ever finish it.
    this.db.prepare(`UPDATE turns SET status = 'interrupted', ended_at = ? WHERE status = 'running'`).run(Date.now())
  }

  close(): void {
    this.statements.clear()
    this.db.close()
  }

  saveAttachment(image: ImageAttachment): void {
    this.sql('INSERT INTO attachments (id, data, created_at) VALUES (?, ?, ?)').run(image.id, JSON.stringify(image), Date.now())
  }

  attachment(id: string): ImageAttachment | null {
    const row = this.sql('SELECT data FROM attachments WHERE id = ?').get(id)
    return row ? JSON.parse(String(row.data)) as ImageAttachment : null
  }

  /** Keep sent and queued images; the renderer supplies references held by unsent drafts. */
  unusedAttachments(keepIds: string[], before: number): ImageAttachment[] {
    const kept = new Set(keepIds)
    for (const row of this.sql('SELECT data FROM items').all()) {
      const item = JSON.parse(String(row.data)) as Item
      if (item.type === 'user') for (const image of item.attachments ?? []) kept.add(image.id)
    }
    for (const queue of this.queues()) for (const message of queue.messages) for (const image of message.attachments ?? []) kept.add(image.id)
    return this.sql('SELECT id, data FROM attachments WHERE created_at < ?').all(before)
      .filter(row => !kept.has(String(row.id))).map(row => JSON.parse(String(row.data)) as ImageAttachment)
  }

  deleteAttachment(id: string): void {
    this.sql('DELETE FROM attachments WHERE id = ?').run(id)
  }

  saveQueue(chatId: string, queue: Array<QueuedMessage & { model: string | null }>): void {
    if (!queue.length) this.sql('DELETE FROM message_queues WHERE chat_id = ?').run(chatId)
    else this.sql('INSERT OR REPLACE INTO message_queues (chat_id, data) VALUES (?, ?)').run(chatId, JSON.stringify(queue))
  }

  queues(): Array<{ chatId: string; messages: Array<QueuedMessage & { model: string | null }> }> {
    return this.sql('SELECT chat_id, data FROM message_queues').all().map(row => ({ chatId: String(row.chat_id), messages: JSON.parse(String(row.data)) }))
  }

  listChats(): Chat[] {
    return this.sql('SELECT * FROM chats ORDER BY updated_at DESC').all().map(chatOf)
  }

  chat(chatId: string): Chat | null {
    const row = this.sql('SELECT * FROM chats WHERE id = ?').get(chatId)
    return row ? chatOf(row) : null
  }

  createChat(chat: Chat): void {
    this.sql('INSERT INTO chats (id, title, cwd, last_provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(chat.id, chat.title, chat.cwd, chat.lastProvider, chat.createdAt, chat.updatedAt)
  }

  updateChat(chat: Chat): void {
    this.sql('UPDATE chats SET title = ?, cwd = ?, last_provider = ?, updated_at = ? WHERE id = ?')
      .run(chat.title, chat.cwd, chat.lastProvider, chat.updatedAt, chat.id)
  }

  deleteChat(chatId: string): void {
    this.saveQueue(chatId, [])
    this.sql('DELETE FROM chats WHERE id = ?').run(chatId)
  }

  snapshot(chatId: string): ChatSnapshot | null {
    const chat = this.chat(chatId)
    if (!chat) return null
    return {
      chat,
      turns: this.turns(chatId),
      items: this.sql('SELECT data FROM items WHERE chat_id = ? ORDER BY seq').all(chatId).map(itemOf)
    }
  }

  turns(chatId: string): StoredTurn[] {
    return this.sql('SELECT * FROM turns WHERE chat_id = ? ORDER BY seq').all(chatId).map(turnOf)
  }

  /** Turns after `seq`, oldest first: what a provider whose session ends at `seq` has not seen. */
  turnsAfter(chatId: string, seq: number): StoredTurn[] {
    return this.sql('SELECT * FROM turns WHERE chat_id = ? AND seq > ? ORDER BY seq').all(chatId, seq).map(turnOf)
  }

  createTurn(turn: Turn): StoredTurn {
    const result = this.sql(
      'INSERT INTO turns (id, chat_id, provider, model, status, error, handoff_turns, goal_role, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(turn.id, turn.chatId, turn.provider, turn.model, turn.status, turn.error, turn.handoffTurns, turn.goalRole, turn.startedAt, turn.endedAt)
    return { ...turn, seq: Number(result.lastInsertRowid) }
  }

  updateTurn(turn: Turn): void {
    this.sql('UPDATE turns SET model = ?, status = ?, error = ?, handoff_turns = ?, tokens = ?, ended_at = ? WHERE id = ?')
      .run(turn.model, turn.status, turn.error, turn.handoffTurns, turn.tokens ? JSON.stringify(turn.tokens) : null, turn.endedAt, turn.id)
  }

  turn(turnId: string): StoredTurn | undefined {
    const row = this.sql('SELECT * FROM turns WHERE id = ?').get(turnId)
    return row ? turnOf(row) : undefined
  }

  /** Record what a turn changed: the totals on the turn, the patch and its snapshots beside it. Returns the turn as it now stands. */
  setTurnChanges(turnId: string, changes: TurnChanges, patch: StoredPatch): StoredTurn | undefined {
    this.sql('UPDATE turns SET changes = ? WHERE id = ?').run(JSON.stringify(changes), turnId)
    this.sql(
      'INSERT INTO turn_patches (turn_id, patch, truncated, start_tree, end_tree) VALUES (?, ?, ?, ?, ?) '
      + 'ON CONFLICT (turn_id) DO UPDATE SET patch = excluded.patch, truncated = excluded.truncated, start_tree = excluded.start_tree, end_tree = excluded.end_tree'
    ).run(turnId, patch.patch, patch.truncated ? 1 : 0, patch.startTree, patch.endTree)
    return this.turn(turnId)
  }

  /** Mark a turn's changes undone. Returns the turn as it now stands. */
  setTurnUndone(turnId: string): StoredTurn | undefined {
    const turn = this.turn(turnId)
    if (turn?.changes) this.sql('UPDATE turns SET changes = ? WHERE id = ?').run(JSON.stringify({ ...turn.changes, undone: true }), turnId)
    return this.turn(turnId)
  }

  turnPatch(turnId: string): StoredPatch | undefined {
    const row = this.sql('SELECT patch, truncated, start_tree, end_tree FROM turn_patches WHERE turn_id = ?').get(turnId)
    return row
      ? {
          patch: String(row.patch),
          truncated: Number(row.truncated) === 1,
          startTree: typeof row.start_tree === 'string' ? row.start_tree : null,
          endTree: typeof row.end_tree === 'string' ? row.end_tree : null
        }
      : undefined
  }

  /** Insert or update by id; an item keeps the position it first appeared at. */
  putItem(chatId: string, item: Item): void {
    this.sql(
      'INSERT INTO items (chat_id, id, turn_id, data) VALUES (?, ?, ?, ?) ON CONFLICT (chat_id, id) DO UPDATE SET data = excluded.data'
    ).run(chatId, item.id, item.turnId, JSON.stringify(item))
  }

  item(chatId: string, itemId: string): Item | undefined {
    const row = this.sql('SELECT data FROM items WHERE chat_id = ? AND id = ?').get(chatId, itemId)
    return row ? itemOf(row) : undefined
  }

  turnItems(chatId: string, turnId: string): Item[] {
    return this.sql('SELECT data FROM items WHERE chat_id = ? AND turn_id = ? ORDER BY seq').all(chatId, turnId).map(itemOf)
  }

  session(chatId: string, provider: ProviderId): ProviderSession {
    const row = this.sql('SELECT session_id, seen_turn_seq FROM provider_sessions WHERE chat_id = ? AND provider = ?')
      .get(chatId, provider)
    return row
      ? { sessionId: typeof row.session_id === 'string' ? row.session_id : null, seenTurnSeq: Number(row.seen_turn_seq) }
      : { sessionId: null, seenTurnSeq: 0 }
  }

  setSession(chatId: string, provider: ProviderId, session: ProviderSession): void {
    this.sql(
      `INSERT INTO provider_sessions (chat_id, provider, session_id, seen_turn_seq) VALUES (?, ?, ?, ?)
       ON CONFLICT (chat_id, provider) DO UPDATE SET session_id = excluded.session_id, seen_turn_seq = excluded.seen_turn_seq`
    ).run(chatId, provider, session.sessionId, session.seenTurnSeq)
  }

  /** When this provider last finished a turn in the chat, or null when it never has. */
  lastEnded(chatId: string, provider: ProviderId): number | null {
    const row = this.sql('SELECT MAX(ended_at) AS at FROM turns WHERE chat_id = ? AND provider = ?').get(chatId, provider)
    return typeof row?.at === 'number' ? row.at : null
  }

  /** Turns that ended after `since` in other chats working in the same folder, oldest first. */
  turnsEndedInFolder(cwd: string, exceptChatId: string, since: number): StoredTurn[] {
    return this.sql(
      `SELECT turns.* FROM turns JOIN chats ON chats.id = turns.chat_id
       WHERE chats.cwd = ? AND turns.chat_id != ? AND turns.ended_at > ? ORDER BY turns.seq`
    ).all(cwd, exceptChatId, since).map(turnOf)
  }

  /** A folder's notes, oldest first. They belong to the folder, not to a chat, and outlive both. */
  notes(cwd: string): Note[] {
    return this.sql('SELECT * FROM notes WHERE cwd = ? ORDER BY seq').all(cwd).map((row) => ({
      seq: Number(row.seq),
      cwd: String(row.cwd),
      text: String(row.text),
      provider: String(row.provider) as ProviderId,
      chatId: typeof row.chat_id === 'string' ? row.chat_id : null,
      createdAt: Number(row.created_at)
    }))
  }

  addNote(note: Pick<Note, 'cwd' | 'text' | 'provider' | 'chatId'>): Note {
    const createdAt = Date.now()
    const result = this.sql('INSERT INTO notes (cwd, text, provider, chat_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(note.cwd, note.text, note.provider, note.chatId, createdAt)
    return { ...note, seq: Number(result.lastInsertRowid), createdAt }
  }

  /** Whether there was such a note in that folder to remove. */
  removeNote(cwd: string, seq: number): boolean {
    return Number(this.sql('DELETE FROM notes WHERE cwd = ? AND seq = ?').run(cwd, seq).changes) > 0
  }

  /** Every goal, newest first. A goal is one row of JSON: it is small, and read and written whole. */
  goals(): Goal[] {
    return this.sql('SELECT data FROM goals ORDER BY created_at DESC').all().map(goalOf)
  }

  goal(goalId: string): Goal | null {
    const row = this.sql('SELECT data FROM goals WHERE id = ?').get(goalId)
    return row ? goalOf(row) : null
  }

  /** Insert or replace. Its chat must exist; deleting the chat deletes the goal. */
  putGoal(goal: Goal): void {
    this.sql('INSERT INTO goals (id, chat_id, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data')
      .run(goal.id, goal.chatId, JSON.stringify(goal), goal.createdAt)
  }

  private sql(text: string): StatementSync {
    let statement = this.statements.get(text)
    if (!statement) {
      statement = this.db.prepare(text)
      this.statements.set(text, statement)
    }
    return statement
  }
}

function chatOf(row: Row): Chat {
  return {
    id: String(row.id),
    title: String(row.title),
    cwd: String(row.cwd),
    lastProvider: typeof row.last_provider === 'string' ? row.last_provider as ProviderId : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }
}

function turnOf(row: Row): StoredTurn {
  return {
    seq: Number(row.seq),
    id: String(row.id),
    chatId: String(row.chat_id),
    provider: String(row.provider) as ProviderId,
    model: typeof row.model === 'string' ? row.model : null,
    status: String(row.status) as TurnStatus,
    error: typeof row.error === 'string' ? row.error : null,
    handoffTurns: Number(row.handoff_turns),
    goalRole: typeof row.goal_role === 'string' ? row.goal_role as GoalRole : null,
    // Rows written before undo existed carry no `undone`.
    changes: typeof row.changes === 'string' ? { undone: false, ...JSON.parse(row.changes) as Partial<TurnChanges> } as TurnChanges : null,
    tokens: typeof row.tokens === 'string' ? JSON.parse(row.tokens) as TurnTokens : null,
    startedAt: Number(row.started_at),
    endedAt: row.ended_at === null ? null : Number(row.ended_at)
  }
}

function itemOf(row: Row): Item {
  return JSON.parse(String(row.data)) as Item
}

function goalOf(row: Row): Goal {
  return JSON.parse(String(row.data)) as Goal
}
