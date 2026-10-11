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

for (const stress of [false, true]) test(`controlled leader accepts ${stress ? 40 : 6} dispatches across the HTTP boundary`, async () => {
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
      content: [{ type: 'text', text: '{}' }]
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
    const result = await adapter.run({ chatId: 'owner', turnId: 'leader', cwd: profile, sessionId: null, model: null, text: stress ? 'UI check: orchestra-stress' : 'UI check: orchestra-shell', handoff: null }, sink)
    assert.equal(result.status, 'completed')
    assert.deepEqual(calls.map(call => call.action), ['start', ...Array(stress ? 40 : 6).fill('dispatch')])
    assert.deepEqual(calls.slice(1).map(call => call.provider), Array.from({ length: stress ? 40 : 6 }, (_, index) => ['claude', 'cursor', 'antigravity'][index % 3]))
    assert.deepEqual(tools.slice(0, 7), Array(7).fill('done'))
    assert.equal(JSON.parse(readFileSync(join(profile, 'ui-orchestra.json'), 'utf8')).results.length, stress ? 41 : 7)
  } finally {
    adapter.shutdown()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(profile, { recursive: true, force: true })
  }
})

test('a user reply with quoted orchestration context completes instead of holding a worker stream', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'rocket-ui-reply-'))
  const adapter = new UiTestAdapter('claude', profile)
  const replies: string[] = []
  const sink: TurnSink = { item: item => { if (item.type === 'assistant') replies.push(item.text) }, delta: () => {}, session: () => {}, model: () => {}, usage: () => {}, tokens: () => {}, activity: () => {} }
  try {
    const result = await adapter.run({ chatId: 'worker', turnId: 'reply', cwd: profile, sessionId: null, model: null, handoff: null,
      text: '<others>\n- Cursor, asked "<rocket-orchestration> You are one worker..."\n</others>\n\nReply observed in worker transcript\nUI check: good evening' }, sink)
    assert.equal(result.status, 'completed')
    assert.deepEqual(replies, ['Good evening.'])
  } finally { adapter.shutdown(); rmSync(profile, { recursive: true, force: true }) }
})

 test('stress worker waits for board barrier, streams 100 deltas, and delivers a report', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'rocket-ui-stress-'))
  const adapter = new UiTestAdapter('cursor', profile)
  const deltas: string[] = []
  const sink: TurnSink = { item: () => {}, delta: (_id, text) => deltas.push(text), session: () => {}, model: () => {}, usage: () => {}, tokens: () => {}, activity: () => {} }
  try {
    const report = join(profile, 'stress.md')
    const request = { chatId: 'worker', turnId: 'stress', cwd: profile, sessionId: null, model: null, handoff: null,
      text: `<rocket-orchestration>\nAssignment: UI stress worker 1\nWrite your report to ${report}. Keep isolated evidence beside it.` }
    const cancelled = adapter.run(request, sink)
    assert.deepEqual(deltas, ['Streaming stress from cursor.\n'])
    assert.equal(existsSync(report), false)
    await adapter.stop('worker')
    assert.deepEqual(await cancelled, { status: 'interrupted' })
    assert.equal(existsSync(report), false)
    deltas.length = 0
    writeFileSync(join(profile, 'ui-stress-ready'), '')
    const started = Date.now()
    assert.deepEqual(await adapter.run(request, sink), { status: 'completed' })
    assert.ok(Date.now() - started >= 5_000)
    assert.equal(deltas.length, 102)
    assert.match(deltas[100], /Step 100:/)
    assert.match(readFileSync(report, 'utf8'), /100 deltas/)
  } finally { adapter.shutdown(); rmSync(profile, { recursive: true, force: true }) }
})
