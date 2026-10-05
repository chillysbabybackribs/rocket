import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Item } from '../shared/types.ts'
import { buildHandoff, stripHandoff, withHandoff, type MissedTurn } from './handoff.ts'

function turn(provider: MissedTurn['provider'], user: string, reply: string, extra: Item[] = []): MissedTurn {
  return {
    provider,
    model: 'm1',
    status: 'completed',
    items: [
      { type: 'user', id: 'u', turnId: 't', text: user },
      { type: 'reasoning', id: 'r', turnId: 't', text: 'private thinking', streaming: false },
      ...extra,
      { type: 'assistant', id: 'a', turnId: 't', text: reply, streaming: false }
    ]
  }
}

test('nothing missed means no handoff', () => {
  assert.equal(buildHandoff([]), null)
  assert.equal(withHandoff(null, 'hello'), 'hello')
})

test('a handoff carries user and assistant text, tool lines, and no reasoning or tool output', () => {
  const handoff = buildHandoff([
    turn('codex', 'fix the bug', 'Fixed in parser.ts.', [
      { type: 'tool', id: 'x', turnId: 't', kind: 'command', label: 'npm test', status: 'failed', output: 'SECRET OUTPUT' }
    ])
  ])!
  assert.equal(handoff.turns, 1)
  assert.match(handoff.text, /Turn answered by Codex \(m1\)/)
  assert.match(handoff.text, /fix the bug/)
  assert.match(handoff.text, /Fixed in parser\.ts\./)
  assert.match(handoff.text, /- command: npm test \(failed\)/)
  assert.doesNotMatch(handoff.text, /private thinking|SECRET OUTPUT/)
  assert.deepEqual(handoff.messages.map((message) => message.role), ['user', 'assistant'])
  assert.equal(handoff.messages[0]!.text, 'fix the bug')
})

test('the user sees their own words when a message went out with a handoff in front', () => {
  const handoff = buildHandoff([turn('claude', 'a', 'b')])
  assert.equal(stripHandoff(withHandoff(handoff, 'what next?')), 'what next?')
})

test('an oversized handoff is cut to the budget and keeps the newest turn whole', () => {
  const handoff = buildHandoff([
    turn('codex', 'old question', 'x'.repeat(50_000)),
    turn('cursor', 'new question', 'the newest answer')
  ], 5_000)!
  assert.ok(handoff.text.length < 6_000, `handoff was ${handoff.text.length} characters`)
  assert.match(handoff.text, /characters omitted/)
  assert.match(handoff.text, /the newest answer/)
  assert.match(handoff.text, /old question/)
})

test('files a turn touched are named once each, relative to the chat folder, edits ahead of reads', () => {
  const tool = (id: string, kind: 'read' | 'edit' | 'command', label: string, status: 'done' | 'failed' = 'done'): Item =>
    ({ type: 'tool', id, turnId: 't', kind, label, status, output: '' })
  const handoff = buildHandoff([
    turn('claude', 'tidy up', 'Done.', [
      tool('1', 'read', '/work/src/a.ts'),
      tool('2', 'read', '/work/src/a.ts'),
      tool('3', 'read', '/work/src/b.ts'),
      tool('4', 'edit', '/work/src/b.ts'),
      tool('5', 'read', '/etc/hosts'),
      tool('6', 'read', '/work/missing.ts', 'failed'),
      tool('7', 'command', 'npm test')
    ])
  ], undefined, '/work')!
  assert.match(handoff.text, /- edited: src\/b\.ts\n- read: src\/a\.ts, \/etc\/hosts\n- read: \/work\/missing\.ts \(failed\)\n- command: npm test/)
})
