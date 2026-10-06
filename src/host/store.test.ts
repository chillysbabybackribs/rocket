import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chat, Turn } from '../shared/types.ts'
import { Store } from './store.ts'

const chat: Chat = { id: 'c1', title: 'Chat', cwd: '/tmp', lastProvider: null, createdAt: 1, updatedAt: 1 }

function turn(id: string, provider: Turn['provider']): Turn {
  return { id, chatId: 'c1', provider, model: null, status: 'completed', error: null, handoffTurns: 0, goalRole: null, changes: null, tokens: null, startedAt: 1, endedAt: 2 }
}

test('an item updated in place keeps its first position', () => {
  const store = new Store(':memory:')
  store.createChat(chat)
  store.createTurn(turn('t1', 'claude'))
  store.putItem('c1', { type: 'assistant', id: 'a', turnId: 't1', text: 'par', streaming: true })
  store.putItem('c1', { type: 'notice', id: 'n', turnId: 't1', text: 'note', tone: 'info' })
  store.putItem('c1', { type: 'assistant', id: 'a', turnId: 't1', text: 'partial, then whole', streaming: false })
  const items = store.snapshot('c1')!.items
  assert.deepEqual(items.map((item) => item.id), ['a', 'n'])
  assert.equal(items[0]!.type === 'assistant' && items[0].text, 'partial, then whole')
})

test('a provider is owed exactly the turns after the one its session last saw', () => {
  const store = new Store(':memory:')
  store.createChat(chat)
  const first = store.createTurn(turn('t1', 'claude'))
  store.setSession('c1', 'claude', { sessionId: 's-claude', seenTurnSeq: first.seq })
  store.createTurn(turn('t2', 'codex'))
  store.createTurn(turn('t3', 'cursor'))
  assert.deepEqual(store.turnsAfter('c1', store.session('c1', 'claude').seenTurnSeq).map((entry) => entry.id), ['t2', 't3'])
  // A provider that has never answered here has seen nothing.
  assert.deepEqual(store.session('c1', 'antigravity'), { sessionId: null, seenTurnSeq: 0 })
  assert.equal(store.turnsAfter('c1', 0).length, 3)
})

test('deleting a chat removes its turns, items and sessions', () => {
  const store = new Store(':memory:')
  store.createChat(chat)
  store.createTurn(turn('t1', 'claude'))
  store.putItem('c1', { type: 'user', id: 'u', turnId: 't1', text: 'hi' })
  store.setSession('c1', 'claude', { sessionId: 's', seenTurnSeq: 1 })
  store.deleteChat('c1')
  assert.equal(store.snapshot('c1'), null)
  assert.deepEqual(store.turns('c1'), [])
  assert.deepEqual(store.session('c1', 'claude'), { sessionId: null, seenTurnSeq: 0 })
})

test('a store made before goals gains the goal_role column, and turns keep their role', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const path = join(mkdtempSync(join(tmpdir(), 'rocket-store-')), 'old.db')
  const old = new DatabaseSync(path)
  old.exec(`CREATE TABLE turns (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, chat_id TEXT NOT NULL, provider TEXT NOT NULL,
    model TEXT, status TEXT NOT NULL, error TEXT, handoff_turns INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL, ended_at INTEGER)`)
  old.close()
  const store = new Store(path)
  store.createChat(chat)
  store.createTurn({ ...turn('t1', 'codex'), goalRole: 'check' })
  assert.equal(store.turns('c1')[0]!.goalRole, 'check')
  store.close()
})

test("a turn's tokens are saved with it, and a turn without them reads as null", () => {
  const store = new Store(':memory:')
  store.createChat({ id: 'c1', title: 'chat', cwd: '/work', lastProvider: null, createdAt: 1, updatedAt: 1 })
  const stored = store.createTurn(turn('t1', 'claude'))
  assert.equal(store.turn('t1')!.tokens, null)
  const tokens = { input: 1_200, cached: 1_000, output: 30, context: 1_100, contextWindow: 200_000 }
  store.updateTurn({ ...stored, tokens })
  assert.deepEqual(store.turn('t1')!.tokens, tokens)
})
