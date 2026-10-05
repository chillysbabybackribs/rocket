import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Journal, parseEntries, type TimingReading } from './journal.ts'

function journal(clock: { now: number }): Journal {
  return new Journal(join(mkdtempSync(join(tmpdir(), 'rocket-journal-')), 'journal.jsonl'), () => clock.now)
}

const timing = (firstTextMs: number, status = 'completed'): TimingReading =>
  ({ chatId: 'c', provider: 'claude', model: 'm', status, firstEventMs: 100, firstTextMs, totalMs: firstTextMs + 500 })

test('a torn last line does not hide the entries before it', () => {
  const entries = parseEntries('{"at":1,"source":"host","severity":"error","kind":"crash","message":"x"}\n{"at":2,"sou')
  assert.equal(entries.length, 1)
})

test('a turn far slower than usual is a warning, and the usual stays unspoiled', () => {
  const clock = { now: 1_000 }
  const j = journal(clock)
  for (let i = 0; i < 6; i++) j.noteTiming(timing(2_000))
  j.noteTiming(timing(30_000))
  const slow = j.read({ severity: 'warn' })
  assert.equal(slow.length, 1)
  assert.equal(slow[0]!.kind, 'slow-turn')
})

test('a failed turn is an error that carries its reason', () => {
  const j = journal({ now: 1 })
  j.noteTiming({ ...timing(0, 'failed'), error: 'claude could not start' })
  assert.match(j.read({ severity: 'error' })[0]!.message, /could not start/)
})

test('a chat hears about new trouble once, and not about trouble from before the host started', () => {
  const clock = { now: 1_000 }
  const j = journal(clock)
  j.add('host', 'error', 'crash', 'before')
  clock.now = 2_000
  assert.equal(j.nudge('c1'), null)
  clock.now = 2_500
  j.add('host', 'error', 'crash', 'boom')
  clock.now = 3_000
  assert.match(j.nudge('c1')!, /1 error.*boom/s)
  assert.equal(j.nudge('c1'), null)
  // Another chat has not heard yet.
  assert.match(j.nudge('c2')!, /boom/)
})

test('a note a model filed is not announced back to it', () => {
  const clock = { now: 1_000 }
  const j = journal(clock)
  clock.now = 2_000
  j.add('model', 'warn', 'observation', 'saw it')
  clock.now = 3_000
  assert.equal(j.nudge('c1'), null)
})
