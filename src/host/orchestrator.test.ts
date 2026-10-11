import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Orchestrator, NOTES_MARKER, type OrchestratorHub } from './orchestrator.ts'
import { orchestratorTools } from './tools/orchestrator.ts'
import type { Chat, Item, ProviderId, Turn } from '../shared/types.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rocket-orchestrator-'))
  const chats = new Map<string, Chat>()
  const live = new Map<string, Turn>()
  const sent: Array<{ turn: Turn; text: string; model: string | null }> = []
  const stopped: string[] = []
  const items = new Map<string, Item[]>()
  let seq = 0
  const hub: OrchestratorHub = {
    createChat(cwd, title) {
      const chat = { id: `chat-${++seq}`, cwd, title, lastProvider: null, createdAt: 1, updatedAt: 1 }
      chats.set(chat.id, chat)
      return chat
    },
    send(chatId, provider, model, text) {
      assert.ok(![...live.values()].some(turn => turn.chatId === chatId), 'no duplicate send to busy owner')
      const turn: Turn = { id: `turn-${++seq}`, chatId, provider, model, status: 'running', error: null, handoffTurns: 0, goalRole: null, changes: null, sources: null, tokens: null, startedAt: 1, endedAt: null }
      live.set(turn.id, turn)
      sent.push({ turn, text, model })
      return turn.id
    },
    working: () => [...live.values()],
    turnItems: (_chat, turn) => items.get(turn) ?? [],
    async stop(chatId) { stopped.push(chatId) }
  }
  const store = { chat: (id: string) => chats.get(id) ?? null }
  const stateFile = join(root, 'profile', 'orchestrator.json')
  const runner = new Orchestrator(stateFile, store, hub, () => {}, () => 100)
  const owner = hub.createChat(root, 'User task').id
  const end = (id: string, status: Turn['status'] = 'completed', error: string | null = null) => {
    const turn = live.get(id)!
    assert.ok(turn)
    live.delete(id)
    runner.turnEnded({ ...turn, status, error, endedAt: 2 })
  }
  const start = () => runner.start(owner, 'codex', 'Investigate the codebase, review evidence, and deepen the useful questions.')
  return { root, hub, store, stateFile, runner, owner, sent, live, stopped, items, end, start, close: () => { runner.shutdown(); rmSync(root, { recursive: true, force: true }) } }
}

test('continuous review uses defaults, waits for workers, then dispatches fresh deeper chats', () => {
  const f = fixture()
  try {
    const run = f.start()
    f.runner.tick()
    const leader = f.sent.at(-1)!.turn.id
    f.runner.tick()
    assert.equal(f.sent.length, 1)
    const first = f.runner.dispatch(f.owner, 'claude', 'Check the startup path').tasks[0]!
    f.runner.checkpoint(f.owner, 'Investigating startup', 'Review the experiment')
    f.end(leader)
    f.runner.tick()
    assert.equal(f.sent.length, 2, 'wait rather than empty leader turns while worker runs')
    writeFileSync(first.report, '# Evidence\nAn isolated reproduction and its limitations.')
    f.end(first.turnId!)
    assert.throws(() => f.runner.dispatch(f.owner, 'cursor', 'Unreviewed follow-up'), /Review the finished worker evidence/)
    f.runner.tick()
    assert.match(f.sent.at(-1)!.text, /Review the experiment/)
    assert.match(f.sent.at(-1)!.text, /task-0001-claude.md/)
    f.runner.checkpoint(f.owner, 'Reproduction reviewed', 'Check the underlying startup ordering', first.id, 'Accepted the isolated result; production incidence unknown.')
    const next = f.runner.dispatch(f.owner, 'claude', 'Investigate why the startup ordering causes the observed result').tasks[1]!
    assert.notEqual(next.chatId, first.chatId)
    assert.ok(f.sent.every(each => each.model === null))
    assert.match(readFileSync(run.progressFile, 'utf8'), /Accepted the isolated result/)
  } finally { f.close() }
})

test('user file edits survive checkpoints and wake an idle owner without spurious self-updates', () => {
  const f = fixture()
  try {
    const run = f.start()
    f.runner.tick()
    f.runner.dispatch(f.owner, 'cursor', 'Measure a limit')
    f.runner.checkpoint(f.owner, 'Measuring', 'Review results')
    f.end(f.sent[0]!.turn.id)
    const before = f.sent.length
    f.runner.tick(); f.runner.tick()
    assert.equal(f.sent.length, before, 'writing progress must not look like a new user note')
    const doc = readFileSync(run.progressFile, 'utf8')
    writeFileSync(run.progressFile, doc.slice(0, doc.indexOf(NOTES_MARKER) + NOTES_MARKER.length) + '\nFocus on cancellation.\n')
    f.runner.tick()
    assert.match(f.sent.at(-1)!.text, /Focus on cancellation/)
    f.runner.checkpoint(f.owner, 'Changed direction', 'Inspect cancel ownership')
    assert.ok(readFileSync(run.progressFile, 'utf8').endsWith('Focus on cancellation.\n'))
    f.runner.userMessage(f.owner, 'Keep all changes isolated')
    assert.match(readFileSync(run.progressFile, 'utf8'), /Keep all changes isolated/)
  } finally { f.close() }
})

test('drain refuses new dispatch and produces one final review after all workers finish', () => {
  const f = fixture()
  try {
    f.start(); f.runner.tick()
    const leader = f.sent[0]!.turn.id
    const task = f.runner.dispatch(f.owner, 'claude', 'Research').tasks[0]!
    f.runner.stop(f.owner, true)
    assert.throws(() => f.runner.dispatch(f.owner, 'cursor', 'More'), /Resume/)
    f.end(leader)
    f.runner.tick()
    assert.equal(f.sent.length, 2)
    assert.deepEqual(f.stopped, [])
    writeFileSync(task.report, 'Evidence')
    f.end(task.turnId!)
    f.runner.tick()
    assert.match(f.sent.at(-1)!.text, /Final review/)
    f.runner.checkpoint(f.owner, 'Final accepted findings', 'Resume later with the remaining question', task.id, 'Reviewed')
    f.end(f.sent.at(-1)!.turn.id)
    assert.equal(f.runner.get(f.owner)!.status, 'stopped')
    f.runner.tick()
    assert.equal(f.sent.length, 3)
  } finally { f.close() }
})

test('Stop requests cancellation only for owned workers, retains unresolved work, and never restarts on late completion', () => {
  const f = fixture()
  try {
    f.start()
    const task = f.runner.dispatch(f.owner, 'claude', 'Research').tasks[0]!
    const other = f.hub.createChat(f.root, 'Unrelated')
    f.hub.send(other.id, 'cursor', null, 'Unrelated work')
    f.runner.stop(f.owner)
    assert.deepEqual(f.stopped, [task.chatId])
    assert.equal(f.runner.get(f.owner)!.tasks[0]!.status, 'running', 'stop request is not completion')
    writeFileSync(task.report, 'Late result')
    f.end(task.turnId!)
    f.runner.tick()
    assert.equal(f.sent.length, 2)
    assert.equal(f.runner.get(f.owner)!.status, 'stopped')
    assert.equal(f.runner.get(f.owner)!.tasks[0]!.status, 'completed')
  } finally { f.close() }
})

test('completed-with-error-prose but missing report is not accepted as a successful worker', () => {
  const f = fixture()
  try {
    f.start()
    const task = f.runner.dispatch(f.owner, 'cursor', 'Research').tasks[0]!
    f.items.set(task.turnId!, [{ type: 'assistant', id: 'error', turnId: task.turnId!, text: 'Error: PING timed out', streaming: false }])
    f.end(task.turnId!)
    assert.equal(f.runner.get(f.owner)!.tasks[0]!.status, 'failed')
    assert.match(f.runner.get(f.owner)!.tasks[0]!.result, /No report was delivered/)
    f.runner.tick()
    assert.match(f.sent.at(-1)!.text, /PING timed out/)
  } finally { f.close() }
})

test('failed or empty leader turns pause rather than spend usage in automatic retries', () => {
  for (const status of ['failed', 'completed'] as const) {
    const f = fixture()
    try {
      f.start(); f.runner.tick()
      f.end(f.sent[0]!.turn.id, status, status === 'failed' ? 'Quota reached' : null)
      assert.equal(f.runner.get(f.owner)!.status, 'paused')
      f.runner.tick()
      assert.equal(f.sent.length, 1)
      f.runner.resume(f.owner); f.runner.tick()
      assert.equal(f.sent.length, 2)
    } finally { f.close() }
  }
})

test('restart preserves evidence and pauses; damaged user-note boundary is never overwritten', () => {
  const f = fixture()
  try {
    const run = f.start()
    f.runner.dispatch(f.owner, 'antigravity', 'Research')
    const recovered = new Orchestrator(f.stateFile, f.store, f.hub, () => {})
    assert.equal(recovered.get(f.owner)!.status, 'paused')
    assert.equal(recovered.get(f.owner)!.tasks[0]!.status, 'interrupted')
    recovered.tick()
    assert.equal(f.sent.length, 1)
    writeFileSync(run.progressFile, 'My replacement notes; preserve these.')
    f.runner.tick()
    assert.equal(f.runner.get(f.owner)!.status, 'paused')
    assert.equal(readFileSync(run.progressFile, 'utf8'), 'My replacement notes; preserve these.')
  } finally { f.close() }
})

test('tool context cannot control another chat and worker concurrency is bounded', async () => {
  const f = fixture()
  try {
    f.start()
    const providers: ProviderId[] = ['claude', 'cursor', 'antigravity']
    for (const provider of providers) f.runner.dispatch(f.owner, provider, `Task for ${provider}`)
    assert.throws(() => f.runner.dispatch(f.owner, 'codex', 'Fourth worker'), /Three workers/)
    const worker = f.runner.get(f.owner)!.tasks[0]!
    assert.throws(() => f.runner.start(worker.chatId, 'claude', 'Nested'), /nested/)
    const tool = orchestratorTools(() => f.runner)[0]!
    assert.equal((await tool.run({ action: 'checkpoint', summary: 'Hijack', next: 'More' }, { chatId: worker.chatId, provider: 'claude' })).isError, true)
    assert.equal((await tool.run({ action: 'start', task: 'Task' }, { chatId: null, provider: 'antigravity' })).isError, true)
    assert.equal((await tool.run({ action: 'dispatch', provider: 'bad', task: 'Task' }, { chatId: f.owner, provider: 'codex' })).isError, true)
  } finally { f.close() }
})

test('a damaged saved state disables orchestration without losing evidence or preventing host startup', () => {
  const f = fixture()
  try {
    f.start()
    writeFileSync(f.stateFile, '{broken json')
    const recovered = new Orchestrator(f.stateFile, f.store, f.hub, () => {})
    assert.match(recovered.stateError!, /file was preserved/)
    assert.throws(() => recovered.start(f.owner, 'codex', 'Retry'), /Cannot read/)
    recovered.shutdown()
    assert.equal(readFileSync(f.stateFile, 'utf8'), '{broken json')
  } finally { f.close() }
})

test('Antigravity shared identity is not used concurrently with another active chat', () => {
  const f = fixture()
  try {
    f.start()
    const other = f.hub.createChat(f.root, 'Other Antigravity chat')
    f.hub.send(other.id, 'antigravity', null, 'Existing work')
    assert.throws(() => f.runner.dispatch(f.owner, 'antigravity', 'Research'), /shared tool identity/)
    assert.equal(f.runner.get(f.owner)!.tasks.length, 0)
  } finally { f.close() }
})
