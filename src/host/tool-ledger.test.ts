import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { ToolLedger, safeEvidence, normalizedError } from './tool-ledger.ts'
import { failureResult, ToolRegistry, type Tool } from './tools/registry.ts'
import { toolHistoryTools } from './tools/tool-history.ts'

const context = { provider: 'codex' as const, chatId: 'chat-1' }
const tool: Tool = { name: 'probe', description: 'Probe a fixture.', inputSchema: { type: 'object' }, run: () => ({ content: [] }) }
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'rocket-ledger-'))
  const path = join(dir, 'calls.db')
  let at = 1000
  const open = () => new ToolLedger(path, 'build-1', () => ({ model: 'test-model', turnId: 'turn-1' }), () => at)
  const ledger = open()
  return { dir, path, ledger, open, advance: (ms: number) => { at += ms }, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('ledger records failures and successes, immutable finishes, versions and denominator-safe grouping', async () => {
  const f = fixture()
  try {
    const registry = new ToolRegistry(undefined, f.ledger)
    registry.add({ ...tool, run: args => args.fail ? failureResult('AMBIGUOUS_TARGET', 'Two matching targets.', 'operation') : { content: [{ type: 'text', text: JSON.stringify({ directory: '/capture', images: [{ path: '/capture/window.png' }] }) }] } })
    await Promise.all([registry.call('probe', { fail: true, password: 'private' }, context), registry.call('probe', {}, context)])
    const summary = f.ledger.summary({ code: 'AMBIGUOUS_TARGET' }) as any
    assert.equal(summary.groups[0].count, 1)
    assert.equal(summary.groups[0].successes, 1)
    assert.equal(summary.groups[0].failureRate, 0.5)
    const calls = f.ledger.query() as any
    const failed = calls.calls.find((row: any) => row.outcome === 'failure')
    const detail = (f.ledger.query({ callId: failed.id }) as any).calls[0]
    assert.equal(detail.arguments.password, '[REDACTED]')
    assert.equal(detail.model, 'test-model')
    assert.equal(detail.turnId, 'turn-1')
    f.ledger.finish(failed.id, { content: [] })
    assert.equal((f.ledger.query({ callId: failed.id }) as any).calls[0].outcome, 'failure')
    assert.deepEqual(calls.calls.find((row: any) => row.outcome === 'success').finish.artifacts, ['/capture', '/capture/window.png'])
    const newId = f.ledger.start('probe', { ...tool, version: 2 }, {}, context)
    f.ledger.finish(newId, failureResult('AMBIGUOUS_TARGET', 'Two matching targets.', 'operation'))
    assert.equal((f.ledger.summary() as any).groups.length, 2)
    assert.equal(statSync(f.path).mode & 0o777, 0o600)
  } finally { f.ledger.close(); f.cleanup() }
})

test('restart distinguishes interrupted calls, malformed evidence is skipped and retention preserves active calls', () => {
  const f = fixture()
  let reopened: ToolLedger | undefined
  try {
    const id = f.ledger.start('probe', tool, {}, context)
    assert.equal((f.ledger.query() as any).calls[0].outcome, 'running')
    f.ledger.close()
    reopened = f.open()
    assert.equal((reopened.query({ callId: id }) as any).calls[0].outcome, 'interrupted')
    const db = new DatabaseSync(f.path)
    db.prepare('INSERT INTO calls VALUES (?, ?, ?, ?)').run('bad', 1000, 'old-instance', '{torn')
    db.close()
    assert.equal((reopened.query() as any).matching, 1)
    f.advance(31 * 86_400_000)
    const active = reopened.start('probe', tool, {}, context)
    reopened.prune()
    assert.equal((reopened.query({ callId: id }) as any).matching, 0)
    assert.equal((reopened.query({ callId: active }) as any).calls[0].outcome, 'running')
  } finally { reopened?.close(); f.cleanup() }
})

test('redacted evidence is bounded and fallback grouping removes volatile paths and numeric values', () => {
  const evidence = safeEvidence({ authorization: 'private', code: 'fetch("https://example.org/?token=private"); const apiKey = "hidden words"; Bearer opaque', items: Array.from({ length: 100 }, () => 'x'.repeat(10_000)) })
  const encoded = JSON.stringify(evidence)
  assert.equal(encoded.includes('private'), false)
  assert.equal(encoded.includes('hidden'), false)
  assert.equal(encoded.includes('words'), false)
  assert.equal(encoded.includes('opaque'), false)
  assert.ok(Buffer.byteLength(encoded) <= 16_000)
  assert.equal(normalizedError('Failed /tmp/session-one at 4000'), normalizedError('Failed /tmp/session-two at 5000'))
})

test('broken recording and diagnostics do not change tool behavior', async () => {
  const registry = new ToolRegistry(() => { throw new Error('diagnostic failure') }, {
    start: () => { throw new Error('disk full') }, finish: () => { throw new Error('write failure') }
  })
  registry.add(tool, { ...tool, name: 'throws', run: () => { throw new Error('Original exception') } })
  assert.deepEqual(await registry.call('probe', {}, context), { content: [] })
  const failed = await registry.call('throws', {}, context)
  assert.equal(failed.structuredContent?.error?.code, 'TOOL_EXCEPTION')
  assert.equal(failed.content[0].type === 'text' && failed.content[0].text, 'Original exception')
  assert.equal((await registry.call('missing', {}, context)).structuredContent?.error?.code, 'UNKNOWN_TOOL')
})

test('query tool validates filters and bounds JSON responses without returning arguments in lists', async () => {
  const f = fixture()
  try {
    for (let i = 0; i < 30; i++) {
      f.advance(1)
      const id = f.ledger.start('probe', tool, { code: 'x'.repeat(9000) }, context)
      f.ledger.finish(id, failureResult('UNCLASSIFIED', `failure ${i}: ${'text '.repeat(1000)}`, 'tool'))
    }
    const query = toolHistoryTools(f.ledger)[0]
    assert.equal((await query.run({ limit: Infinity }, context)).isError, true)
    const response = await query.run({ mode: 'calls', since: 0, limit: 50 }, context)
    assert.equal(response.content[0].type, 'text')
    if (response.content[0].type !== 'text') return
    assert.ok(Buffer.byteLength(response.content[0].text) <= 12_000)
    const data = JSON.parse(response.content[0].text)
    assert.equal(data.truncated, true)
    assert.equal(data.calls[0].arguments, undefined)
  } finally { f.ledger.close(); f.cleanup() }
})

test('opening an unavailable ledger can be handled without corrupting an existing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rocket-ledger-invalid-'))
  try {
    const file = join(dir, 'not-a-directory')
    writeFileSync(file, 'keep')
    assert.throws(() => new ToolLedger(join(file, 'calls.db'), 'build'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
