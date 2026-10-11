import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { acceptResume, findTurn, nextPhase, promptFor, providers, receiptValid, tasksFor } from './research-loop.mjs'

test('each research claim gets another provider and reviewers rotate without self-review', () => {
  for (let round = 1; round <= 9; round++) {
    const tasks = tasksFor(round, 'review')
    assert.deepEqual(new Set(tasks.map(t => t.peer)), new Set(providers))
    assert.ok(tasks.every(t => t.peer !== t.provider))
  }
  assert.equal(new Set([1, 2, 3].map(r => tasksFor(r, 'review')[0].peer)).size, 3)
})

test('research and review barriers precede synthesis and unbounded deeper rounds', () => {
  assert.deepEqual(nextPhase(1, 'research'), { round: 1, phase: 'review' })
  assert.deepEqual(nextPhase(1, 'review'), { round: 1, phase: 'synthesis' })
  assert.deepEqual(nextPhase(9999, 'synthesis'), { round: 10000, phase: 'research' })
  assert.equal(tasksFor(3, 'synthesis').length, 1)
  assert.equal(new Set([1, 2, 3, 4].map(r => tasksFor(r, 'synthesis')[0].provider)).size, 4)
  const prompt = promptFor(tasksFor(2, 'research')[0])
  assert.match(prompt, /round-0001\/synthesis.md/)
  assert.match(prompt, /do not edit application source/)
})

test('old or empty report receipts cannot complete a new attempt', () => {
  const task = { ...tasksFor(1, 'research')[0], marker: 'new-attempt' }
  const receipt = { marker: task.marker, report: task.report, nextQuestions: ['How does recovery preserve queued turns?'] }
  assert.ok(receiptValid(receipt, task, 'evidence '.repeat(60)))
  assert.equal(receiptValid({ ...receipt, marker: 'old-attempt' }, task, 'evidence '.repeat(60)), false)
  assert.equal(receiptValid(receipt, task, ''), false)
  assert.equal(receiptValid({ ...receipt, nextQuestions: [] }, task, 'evidence '.repeat(60)), false)
})

test('transcript reconciliation recovers sends and explicit resume clears interrupted attempts', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE turns (id TEXT, chat_id TEXT, seq INTEGER, status TEXT); CREATE TABLE items (turn_id TEXT, data TEXT)')
    db.prepare('INSERT INTO turns VALUES (?, ?, ?, ?)').run('turn1', 'chat1', 1, 'interrupted')
    db.prepare('INSERT INTO items VALUES (?, ?)').run('turn1', JSON.stringify({ type: 'user', text: '[unique]\nResearch' }))
    const recovered = findTurn(db, '[unique]')
    assert.equal(recovered.id, 'turn1')
    assert.equal(findTurn(db, '[another]'), undefined)
    const task = { ...tasksFor(1, 'research')[0], marker: '[unique]', turnId: 'turn1', attempts: 1, status: 'running' }
    const state = { lanes: [{ chatId: 'chat1' }], tasks: [task], reason: 'Stopped' }
    acceptResume(state, db)
    assert.equal(task.marker, null)
    assert.equal(task.status, 'pending')
    assert.equal(task.retryAt, 0)
    assert.equal(state.lanes[0].lastTurnId, 'turn1')
  } finally { db.close() }
})
