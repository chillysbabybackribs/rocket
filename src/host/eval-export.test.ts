import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildTurnExport, EvalExport, writeTurnExport } from './eval-export.ts'
import { Store } from './store.ts'
import type { Chat, Turn } from '../shared/types.ts'

test('buildTurnExport includes turn items and timing fallback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rocket-eval-'))
  const store = new Store(join(dir, 'rocket.db'))
  const chat: Chat = { id: 'c1', title: 'Eval', cwd: '/tmp/fixture', lastProvider: 'claude', createdAt: 1, updatedAt: 1 }
  store.createChat(chat)
  const turn: Turn = {
    id: 't1', chatId: 'c1', provider: 'claude', model: 'm1', status: 'completed', error: null,
    handoffTurns: 0, goalRole: null, changes: null, tokens: null, startedAt: 1000, endedAt: 4000
  }
  store.createTurn(turn)
  store.putItem('c1', { type: 'user', id: 'u1', turnId: 't1', text: 'hello' })
  store.putItem('c1', { type: 'assistant', id: 'a1', turnId: 't1', text: 'hi', streaming: false })
  const body = buildTurnExport(store, 't1')
  assert.ok(body)
  assert.equal(body.turn.id, 't1')
  assert.equal(body.items.length, 2)
  assert.equal(body.timing.totalMs, 3000)
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

test('EvalExport writes tagged chat turns to inbox', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rocket-eval-'))
  const dataDir = join(dir, 'data')
  const repoRoot = join(dir, 'repo')
  const store = new Store(join(dataDir, 'rocket.db'))
  const chat: Chat = { id: 'c1', title: 'Eval', cwd: '/tmp/fixture', lastProvider: 'claude', createdAt: 1, updatedAt: 1 }
  store.createChat(chat)
  const turn: Turn = {
    id: 't-export', chatId: 'c1', provider: 'codex', model: null, status: 'completed', error: null,
    handoffTurns: 0, goalRole: null, changes: null, tokens: null, startedAt: 1, endedAt: 2
  }
  store.createTurn(turn)
  const prev = process.env.ROCKET_EVAL_EXPORT
  process.env.ROCKET_EVAL_EXPORT = 'tagged'
  const exporter = new EvalExport(dataDir, repoRoot, () => store, () => undefined)
  exporter.tagChat('c1')
  const path = exporter.onTurnEnded(turn)
  assert.ok(path)
  const parsed = JSON.parse(readFileSync(path!, 'utf8'))
  assert.equal(parsed.turn.id, 't-export')
  process.env.ROCKET_EVAL_EXPORT = prev
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

test('writeTurnExport also writes ledger-slice.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rocket-eval-'))
  const body = {
    formatVersion: 1 as const,
    exportedAt: 1,
    git: { sha: null, dirty: null },
    chat: { id: 'c', title: 't', cwd: '/' },
    turn: { id: 't', chatId: 'c', provider: 'claude' as const, model: null, status: 'completed' as const, error: null, handoffTurns: 0, goalRole: null, changes: null, tokens: null, startedAt: 0, endedAt: 1 },
    items: [],
    timing: { firstEventMs: null, firstTextMs: null, totalMs: 1 },
    ledger: { path: null, calls: [] },
    cellDir: null
  }
  writeTurnExport(body, dir)
  assert.ok(readFileSync(join(dir, 'turn.json'), 'utf8').includes('"turn"'))
  assert.ok(readFileSync(join(dir, 'ledger-slice.json'), 'utf8'))
  rmSync(dir, { recursive: true, force: true })
})
