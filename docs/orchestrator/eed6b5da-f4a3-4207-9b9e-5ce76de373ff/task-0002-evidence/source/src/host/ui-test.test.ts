import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UiTestAdapter, uiTestProfile } from './ui-test.ts'
import type { TurnSink } from './providers/provider.ts'

test('UI mode requires an explicit marked profile and matching host data directory', () => {
  const profile = mkdtempSync(join(tmpdir(), 'rocket-ui-guard-'))
  try {
    assert.equal(uiTestProfile({}), null)
    assert.throws(() => uiTestProfile({ ROCKET_UI_TEST: '1' }), /isolated profile/)
    assert.throws(() => uiTestProfile({ ROCKET_UI_TEST: '1', ROCKET_USER_DATA: profile }), /isolated profile/)
    writeFileSync(join(profile, 'ui-test-profile'), 'rocket-ui-check-v1')
    assert.equal(uiTestProfile({ ROCKET_UI_TEST: '1', ROCKET_USER_DATA: profile }), profile)
    assert.throws(() => uiTestProfile({ ROCKET_UI_TEST: '1', ROCKET_USER_DATA: profile, ROCKET_DATA_DIR: '/other' }), /isolated profile/)
  } finally { rmSync(profile, { recursive: true, force: true }) }
})

test('a controlled stream remains pending until stopped and emits no final response after stop', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'rocket-ui-stream-'))
  const adapter = new UiTestAdapter('codex', profile)
  const deltas: string[] = []
  const sink: TurnSink = { item: () => {}, delta: (_id, text) => deltas.push(text), session: () => {}, model: () => {}, usage: () => {}, tokens: () => {}, activity: () => {} }
  try {
    const result = adapter.run({ chatId: 'chat', turnId: 'turn', cwd: profile, sessionId: null, model: null, text: 'UI check: stop', handoff: null }, sink)
    assert.deepEqual(deltas, ['Streaming from codex.'])
    await adapter.stop('chat')
    assert.deepEqual(await result, { status: 'interrupted' })
    assert.deepEqual(deltas, ['Streaming from codex.'])
  } finally { adapter.shutdown(); rmSync(profile, { recursive: true, force: true }) }
})

test('controlled worker writes its report only after release, and cancellation delivers none', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'rocket-ui-report-'))
  const adapter = new UiTestAdapter('claude', profile)
  const sink: TurnSink = { item: () => {}, delta: () => {}, session: () => {}, model: () => {}, usage: () => {}, tokens: () => {}, activity: () => {} }
  try {
    const report = join(profile, 'worker.md')
    const request = { chatId: 'worker', turnId: 'one', cwd: profile, sessionId: null, model: null, handoff: null,
      text: `<rocket-orchestration>\nAssignment: UI shell worker one\nWrite your report to ${report}. Keep isolated evidence beside it.` }
    const interrupted = adapter.run(request, sink)
    assert.equal(existsSync(report), false)
    await adapter.stop('worker')
    assert.deepEqual(await interrupted, { status: 'interrupted' })
    assert.equal(existsSync(report), false)
    writeFileSync(join(profile, 'ui-release-two'), '')
    assert.deepEqual(await adapter.run({ ...request, turnId: 'two' }, sink), { status: 'completed' })
    assert.match(readFileSync(report, 'utf8'), /Controlled worker report/)
  } finally { adapter.shutdown(); rmSync(profile, { recursive: true, force: true }) }
})

test('controlled leader invokes real HTTP tool boundary and retains rejected fourth dispatch', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'rocket-ui-orchestra-'))
  const adapter = new UiTestAdapter('codex', profile)
  const calls: Array<Record<string, unknown>> = []
  const server = createServer(async (request, response) => {
    assert.equal(request.url, '/mcp/fixture/codex/owner')
    let text = ''
    for await (const chunk of request) text += chunk
    const body = JSON.parse(text)
    assert.equal(body.params.name, 'orchestrator')
    calls.push(body.params.arguments)
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {
      ...(calls.length === 5 ? { isError: true } : {}), content: [{ type: 'text', text: calls.length === 5 ? 'Three workers are already running.' : '{}' }]
    } }))
  })
  const tools: string[] = []
  const sink: TurnSink = { item: item => { if (item.type === 'tool') tools.push(item.status) }, delta: () => {}, session: () => {}, model: () => {}, usage: () => {}, tokens: () => {}, activity: () => {} }
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    writeFileSync(join(profile, 'tool-channel.json'), JSON.stringify({ port: address.port, secret: 'fixture' }))
    writeFileSync(join(profile, 'ui-release-leader'), '')
    const result = await adapter.run({ chatId: 'owner', turnId: 'leader', cwd: profile, sessionId: null, model: null, text: 'UI check: orchestra-shell', handoff: null }, sink)
    assert.equal(result.status, 'completed')
    assert.deepEqual(calls.map(call => call.action), ['start', 'dispatch', 'dispatch', 'dispatch', 'dispatch'])
    assert.deepEqual(calls.slice(1).map(call => call.provider), ['claude', 'cursor', 'antigravity', 'codex'])
    assert.deepEqual(tools.slice(0, 5), ['done', 'done', 'done', 'done', 'failed'])
    assert.equal(JSON.parse(readFileSync(join(profile, 'ui-orchestra.json'), 'utf8')).results[4].isError, true)
  } finally {
    adapter.shutdown()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(profile, { recursive: true, force: true })
  }
})
