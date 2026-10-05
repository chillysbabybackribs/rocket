import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chat, Turn } from '../shared/types.ts'
import { Store } from './store.ts'

const chat: Chat = { id: 'c1', title: 'Chat', cwd: '/tmp', lastProvider: null, createdAt: 1, updatedAt: 1 }

function turn(id: string, provider: Turn['provider']): Turn {
  return { id, chatId: 'c1', provider, model: null, status: 'completed', error: null, handoffTurns: 0, startedAt: 1, endedAt: 2 }
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
