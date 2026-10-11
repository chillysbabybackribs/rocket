// Isolated lifecycle checks for the cursor review of C5–C10 and C13.
// Uses Rocket's host modules against temp databases and fake peers. No provider CLI is started.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { buildHandoff, HANDOFF_BUDGET_CHARS, type MissedTurn } from '../../../../../src/host/handoff.ts'
import { Hub } from '../../../../../src/host/hub.ts'
import { CodexAdapter } from '../../../../../src/host/providers/codex.ts'
import { unavailableUsage, type PrepareRequest, type ProviderAdapter, type RunRequest, type RunResult, type TurnSink } from '../../../../../src/host/providers/provider.ts'
import { CursorAdapter, cursorExtensionReply } from '../../../../../src/host/providers/cursor.ts'
import { Store } from '../../../../../src/host/store.ts'
import { JsonRpcPeerError, StdioJsonRpcClient } from '../../../../../src/host/stdio-json-rpc.ts'
import { EvalExport } from '../../../../../src/host/eval-export.ts'
import { EvalRuns } from '../../../../../src/host/eval-runs.ts'
import type { EvalScenario } from '../../../../../src/host/eval-scenarios.ts'
import { GoalRunner } from '../../../../../src/host/goals.ts'
import { ToolLedger } from '../../../../../src/host/tool-ledger.ts'
import { askTools } from '../../../../../src/host/tools/ask.ts'
import { SHARED, ToolChannel } from '../../../../../src/host/tools/channel.ts'
import { memoryTools } from '../../../../../src/host/tools/memory.ts'
import { ToolRegistry } from '../../../../../src/host/tools/registry.ts'
import { sourcesNotice } from '../../../../../src/shared/sources.ts'
import type { HostEvent, Item, ProviderId } from '../../../../../src/shared/types.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const peers = join(here, 'peers')
const work = mkdtempSync(join(tmpdir(), 'rocket-lifecycle-'))
const killed: number[] = []

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}
async function until(label: string, predicate: () => boolean, ms = 2_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${label}`)
    await sleep(10)
  }
}

class HoldAdapter implements ProviderAdapter {
  readonly id: ProviderId
  private readonly held: Array<{ chatId: string; sink: TurnSink; finish: (result: RunResult) => void }> = []
  usageCalls = 0
  private releaseUsage: (() => void) | null = null
  holdUsage = false
  constructor(id: ProviderId) { this.id = id }
  run(request: RunRequest, sink: TurnSink): Promise<RunResult> {
    sink.session('session-held')
    return new Promise((resolve) => { this.held.push({ chatId: request.chatId, sink, finish: resolve }) })
  }
  sinkOf(chatId: string): TurnSink | undefined { return this.held.find((run) => run.chatId === chatId)?.sink }
  /** Finish the given chat's turn, or the oldest one held. */
  complete(chatId?: string): void {
    const index = chatId ? this.held.findIndex((run) => run.chatId === chatId) : 0
    if (index < 0 || !this.held[index]) return
    const [run] = this.held.splice(index, 1)
    run!.finish({ status: 'completed' })
  }
  async prepare(_request: PrepareRequest): Promise<void> {}
  async stop(): Promise<void> {}
  forget(): void {}
  async usage() {
    this.usageCalls += 1
    if (this.holdUsage) await new Promise<void>((resolve) => { this.releaseUsage = resolve })
    return unavailableUsage(this.id, 'experiment')
  }
  releaseHeldUsage(): void { this.releaseUsage?.(); this.releaseUsage = null }
  async models() { return [] }
  shutdown(): void {}
}

function adapters(partial: Partial<Record<ProviderId, ProviderAdapter>>): Record<ProviderId, ProviderAdapter> {
  const idle = new HoldAdapter('claude')
  return { claude: idle, codex: idle, cursor: idle, antigravity: idle, ...partial }
}

async function sample(pid: number, seconds = 8): Promise<boolean[]> {
  const out: boolean[] = []
  for (let i = 0; i < seconds; i++) {
    await sleep(100)
    out.push(alive(pid))
  }
  return out
}

function spawnWrapper(mode: 'eof' | 'stay' | 'grand', pidFile: string, exitFile: string, grandFile: string): ChildProcess {
  const childScript = mode === 'stay'
    ? join(peers, 'stay.mjs')
    : mode === 'eof'
      ? join(peers, 'exit-on-eof.mjs')
      : join(peers, 'exit-on-eof-with-grandchild.mjs')
  const args = mode === 'grand'
    ? [childScript, join(peers, 'stay.mjs'), grandFile]
    : [childScript]
  const source = `
    import { spawn } from 'node:child_process'
    import { writeFileSync } from 'node:fs'
    process.on('exit', () => writeFileSync(process.argv[1], 'ran'))
    const child = spawn(process.execPath, process.argv.slice(3), { detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    writeFileSync(process.argv[2], String(child.pid))
    setInterval(() => {}, 1000)
  `
  return spawn(process.execPath, ['--input-type=module', '-e', source, exitFile, pidFile, ...args], {
    stdio: 'ignore'
  })
}

async function processFate(): Promise<unknown> {
  const cases: Array<'eof' | 'stay' | 'grand'> = ['eof', 'stay', 'grand']
  const results = []
  for (const mode of cases) {
    const pidFile = join(work, `${mode}.pid`)
    const exitFile = join(work, `${mode}.exit`)
    const grandFile = join(work, `${mode}.grand`)
    const wrapper = spawnWrapper(mode, pidFile, exitFile, grandFile)
    killed.push(wrapper.pid!)
    await until(`${mode} pid`, () => {
      try { return Number(readFileSync(pidFile, 'utf8')) > 0 } catch { return false }
    })
    const child = Number(readFileSync(pidFile, 'utf8'))
    let grandchild = 0
    if (mode === 'grand') {
      await until('grandchild pid', () => {
        try { grandchild = Number(readFileSync(grandFile, 'utf8')); return grandchild > 0 } catch { return false }
      })
    }
    const before = alive(child)
    process.kill(wrapper.pid!, 'SIGKILL')
    const childSamples = await sample(child)
    const grandSamples = grandchild ? await sample(grandchild) : []
    let exitHandler = false
    try { exitHandler = readFileSync(exitFile, 'utf8') === 'ran' } catch { exitHandler = false }
    if (alive(child)) { process.kill(child, 'SIGKILL'); killed.push(child) }
    if (grandchild && alive(grandchild)) { process.kill(grandchild, 'SIGKILL'); killed.push(grandchild) }
    results.push({
      mode,
      child,
      grandchild: grandchild || null,
      aliveBeforeKill: before,
      childAliveSamplesAfter100ms: childSamples,
      grandchildAliveSamplesAfter100ms: grandSamples,
      wrapperExitHandlerRan: exitHandler
    })
  }
  return results
}

async function cancelDoesNotSettlePrompt(): Promise<unknown> {
  const logPath = join(work, 'peer-log.json')
  writeFileSync(logPath, '[]')
  const client = new StdioJsonRpcClient({
    peer: 'fake-acp',
    executable: process.execPath,
    cwd: work,
    args: [join(peers, 'jsonrpc-peer.mjs')],
    version: '2.0',
    defaultTimeoutMs: 30_000
  })
  process.env.PEER_LOG = logPath
  await client.start()
  const runs: Array<{ timeoutMs: number; elapsedMs: number; error: string; cancelLoggedBeforeReject: boolean }> = []
  for (const timeoutMs of [250, 700]) {
    const started = Date.now()
    const pending = client.request('session/prompt', { sessionId: 's' }, timeoutMs)
    let settled = false
    void pending.then(() => { settled = true }, () => { settled = true })
    await sleep(40)
    client.notify('session/cancel', { sessionId: 's' })
    await sleep(40)
    const stillPendingAfterCancel = !settled
    let error = ''
    try { await pending } catch (caught) { error = caught instanceof Error ? caught.message : String(caught) }
    const log = JSON.parse(readFileSync(logPath, 'utf8')) as Array<{ method: string | null; at: number }>
    const cancelAt = log.find((entry) => entry.method === 'session/cancel')?.at ?? 0
    runs.push({
      timeoutMs,
      elapsedMs: Date.now() - started,
      error,
      cancelLoggedBeforeReject: cancelAt > 0 && cancelAt < Date.now(),
      stillPendingAfterCancel
    } as typeof runs[number] & { stillPendingAfterCancel: boolean })
  }
  client.stop()
  return runs
}

async function codexStop(mode: 'reject' | 'ack'): Promise<unknown> {
  const calls: Array<{ method: string; at: number }> = []
  const client = {
    connected: true,
    request: async (method: string) => {
      calls.push({ method, at: Date.now() })
      if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'fake' }
      if (method === 'turn/start') return { turn: { id: 'turn-remote' } }
      if (method === 'turn/interrupt') {
        if (mode === 'reject') throw new Error('turn/interrupt rejected')
        return {}
      }
      if (method === 'account/read') return { account: {} }
      if (method === 'account/rateLimits/read') return { rateLimits: {} }
      return {}
    }
  }
  const codex = new CodexAdapter(() => {})
  const internals = codex as unknown as {
    client: typeof client
    onNotification(notification: { method: string; params: unknown }): void
  }
  internals.client = client
  const store = new Store(join(work, `codex-${mode}.db`))
  const events: HostEvent[] = []
  const hub = new Hub(store, adapters({ codex }), (event) => events.push(event))
  const chat = hub.createChat('/work')
  const started = Date.now()
  hub.send(chat.id, 'codex', null, 'keep going')
  await until('turn/start', () => calls.some((call) => call.method === 'turn/start'))
  const stopStarted = Date.now()
  await hub.stop(chat.id)
  const stopReturnedMs = Date.now() - stopStarted
  await sleep(mode === 'ack' ? 400 : 50)
  const whileWaiting = store.turns(chat.id)[0]
  if (mode === 'ack') {
    internals.onNotification({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-remote', status: 'interrupted' } } })
    await until('ack completion', () => store.turns(chat.id)[0]?.status !== 'running')
  } else {
    await until('reject completion', () => store.turns(chat.id)[0]?.status !== 'running')
    const beforeLate = store.turns(chat.id)[0]
    internals.onNotification({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-remote', status: 'completed' } } })
    await sleep(30)
    const afterLate = store.turns(chat.id)[0]
    hub.send(chat.id, 'codex', null, 'again')
    await until('second turn/start', () => calls.filter((call) => call.method === 'turn/start').length >= 2)
    store.close()
    return {
      mode,
      stopReturnedMs,
      statusAfterStopWait: whileWaiting?.status,
      statusBeforeLateCompletion: beforeLate?.status,
      statusAfterLateCompletedNotification: afterLate?.status,
      endedAtUnchanged: beforeLate?.endedAt === afterLate?.endedAt,
      secondTurnStartWhileFirstStillOpenOnServer: calls.filter((call) => call.method === 'turn/start').length,
      methods: calls.map((call) => call.method),
      totalMs: Date.now() - started
    }
  }
  const settled = store.turns(chat.id)[0]
  store.close()
  return {
    mode,
    stopReturnedMs,
    statusDuring400msAfterStopReturned: whileWaiting?.status,
    statusAfterCompletedNotification: settled?.status,
    methods: calls.map((call) => call.method)
  }
}

async function hubStopLeavesTurnRunning(): Promise<unknown> {
  const cursor = new HoldAdapter('cursor')
  const store = new Store(':memory:')
  const hub = new Hub(store, adapters({ cursor }), () => {})
  const chat = hub.createChat('/work')
  hub.send(chat.id, 'cursor', null, 'do not finish')
  const stopStarted = Date.now()
  await hub.stop(chat.id)
  await sleep(300)
  let sendError = ''
  try { hub.send(chat.id, 'cursor', null, 'next') } catch (error) { sendError = error instanceof Error ? error.message : String(error) }
  return {
    stopReturnedMs: Date.now() - stopStarted,
    stillRunningAfter300ms: hub.isRunning(chat.id),
    status: store.turns(chat.id)[0]?.status,
    sendWhileStuck: sendError
  }
}

async function claudeFollowUpDropped(): Promise<unknown> {
  const cursor = new HoldAdapter('cursor')
  const claude = new HoldAdapter('claude')
  let open: ((chatId: string, reason: string) => { turnId: string; sink: TurnSink; finish: (result: RunResult) => void } | null) | null = null
  claude.onUnprompted = (fn) => { open = fn }
  const store = new Store(':memory:')
  const hub = new Hub(store, adapters({ cursor, claude }), () => {})
  const chat = hub.createChat('/work')
  hub.send(chat.id, 'cursor', null, 'other provider is busy')
  const dropped = open!(chat.id, 'Finished in the background: the synthesis')
  const itemsWhileBusy = hub.openChat(chat.id).items.map((item) => item.type)
  cursor.complete()
  await until('cursor ended', () => !hub.isRunning(chat.id))
  const opened = open!(chat.id, 'Finished in the background: the synthesis')
  opened?.sink.item({ type: 'assistant', id: `${opened.turnId}:a`, turnId: opened.turnId, text: 'Recovered follow-up.', streaming: false })
  opened?.finish({ status: 'completed' })
  await until('follow-up ended', () => !hub.isRunning(chat.id))
  return {
    droppedWhileBusy: dropped === null,
    itemsWhileBusy,
    followUpAfterIdle: opened !== null,
    itemsAfter: hub.openChat(chat.id).items.map((item) => item.type),
    droppedTextStored: hub.openChat(chat.id).items.some((item) => item.type === 'assistant' && item.text.includes('synthesis'))
  }
}

async function toolOwnership(): Promise<unknown> {
  const antigravity = new HoldAdapter('antigravity')
  const store = new Store(join(work, 'tools.db'))
  const ledger = new ToolLedger(join(work, 'ledger.db'), 'experiment', (context) => {
    const turn = context.chatId ? store.runningTurn(context.chatId, context.provider) : undefined
    return { model: turn?.model ?? null, turnId: turn?.id ?? null }
  })
  const seen: Array<{ chatId: string | null; url: string }> = []
  const hub = new Hub(store, adapters({ antigravity }), () => {})
  const registry = new ToolRegistry(() => {}, ledger)
    .add(...askTools(() => hub))
    .add(...memoryTools(store))
    .add({
      name: 'probe_open',
      description: 'Record a page open the way the browser tool does.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
      run: (args, context) => {
        const url = String(args.url ?? '')
        hub.noteOpened(context.chatId, url)
        seen.push({ chatId: context.chatId, url })
        return { content: [{ type: 'text', text: `chat=${context.chatId}` }] }
      }
    })
  const channel = new ToolChannel(registry, null, (provider) => hub.runningChat(provider))
  await channel.start()
  const chatA = hub.createChat('/repo/a')
  const chatB = hub.createChat('/repo/b')
  hub.send(chatA.id, 'antigravity', null, 'first')
  hub.send(chatB.id, 'antigravity', null, 'second')
  const shared = channel.url('antigravity', SHARED)
  const call = async (url: string, name: string, args: Record<string, unknown>): Promise<unknown> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
    })
    return response.json()
  }
  const question = {
    question: 'Ship the parser?',
    options: [{ label: 'Ship', detail: 'Land the change.' }, { label: 'Hold', detail: 'Leave it unstaged.' }],
    recommended: 0
  }
  const both = {
    running: hub.runningChat('antigravity'),
    ask: await call(shared, 'ask_user', question),
    remember: await call(shared, 'remember', { note: 'The fixture lives in tests/ui.' }),
    open: await call(shared, 'probe_open', { url: 'https://example.com/owned' })
  }
  const questionsWhileBoth = [chatA.id, chatB.id].map((id) => hub.openChat(id).items.filter((item) => item.type === 'question').length)
  const notesAfterBoth = { a: storeClosedNotes(join(work, 'tools.db'), '/repo/a'), b: storeClosedNotes(join(work, 'tools.db'), '/repo/b'), noCwd: storeNullCwdNotes(join(work, 'tools.db')) }
  antigravity.sinkOf(chatA.id)?.item({
    type: 'assistant', id: 'cite', turnId: store.runningTurn(chatA.id)!.id, text: 'See [the page](https://example.com/owned).', streaming: false
  })
  antigravity.complete(chatA.id)
  await until('chat A ended', () => !hub.isRunning(chatA.id))
  // Models a late call from chat A's agy process (e.g. a tool call still in flight) after A's turn ended.
  const afterA = {
    running: hub.runningChat('antigravity'),
    remember: await call(shared, 'remember', { note: 'Sent on behalf of chat A after its turn ended.' }),
    open: await call(shared, 'probe_open', { url: 'https://example.com/straggler' }),
    chatBOpenedList: hub.opened(chatB.id)
  }
  const perChat = await call(channel.url('antigravity', chatA.id), 'probe_open', { url: 'https://example.com/named' })
  const unbound = await call(channel.url('antigravity', 'not-a-chat'), 'probe_open', { url: 'https://example.com/unbound' })
  antigravity.complete()
  await until('chat B ended', () => !hub.isRunning(chatB.id))
  const none = {
    running: hub.runningChat('antigravity'),
    remember: await call(shared, 'remember', { note: 'Nobody is answering.' })
  }
  const rows = ledger.query({ limit: 20 }).calls.map((call) => ({
    tool: call.tool, chatId: call.chatId, turnId: call.turnId, outcome: call.outcome
  }))
  const settledA = store.lastSettledTurn(chatA.id)
  channel.stop()
  ledger.close()
  store.close()
  return {
    bothLiveRunningChat: both.running,
    askText: textOf(both.ask),
    rememberText: textOf(both.remember),
    openText: textOf(both.open),
    questionItemsPerChat: questionsWhileBoth,
    notesAfterBoth,
    opensRecorded: seen,
    openedListsWhileBothWereLive: 'recorded via probe chat ids above',
    afterAEndedRunningChat: afterA.running,
    rememberAfterAEnded: textOf(afterA.remember),
    openAfterAEnded: textOf(afterA.open),
    chatBOpenedAfterAStraggler: afterA.chatBOpenedList,
    notesAtEnd: { a: storeClosedNotes(join(work, 'tools.db'), '/repo/a'), b: storeClosedNotes(join(work, 'tools.db'), '/repo/b') },
    namedChatUrl: textOf(perChat),
    unboundKey: textOf(unbound),
    noneLiveRunningChat: none.running,
    rememberWhenNoneLive: textOf(none.remember),
    ledger: rows,
    chatASources: settledA?.sources ?? null,
    chatASourcesNotice: sourcesNotice(settledA?.sources ?? null)
  }
}

function textOf(message: unknown): string {
  const record = message as { result?: { content?: Array<{ text?: string }> } }
  return record.result?.content?.map((part) => part.text ?? '').join('\n') ?? JSON.stringify(message)
}

function storeClosedNotes(path: string, cwd: string): Array<{ text: string; chatId: string | null }> {
  const db = new DatabaseSync(path)
  const rows = db.prepare('SELECT text, chat_id FROM notes WHERE cwd = ?').all(cwd) as Array<{ text: string; chat_id: string | null }>
  db.close()
  return rows.map((row) => ({ text: row.text, chatId: row.chat_id }))
}

function storeNullCwdNotes(path: string): Array<{ text: string; chatId: string | null }> {
  const db = new DatabaseSync(path)
  const rows = db.prepare('SELECT text, chat_id FROM notes WHERE cwd IS NULL').all() as Array<{ text: string; chat_id: string | null }>
  db.close()
  return rows.map((row) => ({ text: row.text, chatId: row.chat_id }))
}

function turnEndSplit(): unknown {
  const path = join(work, 'split.db')
  const store = new Store(path)
  store.createChat({ id: 'c', title: 'Cursor chat', cwd: '/work', lastProvider: 'cursor', createdAt: 1, updatedAt: 1 })
  const turn = store.createTurn({
    id: 't1', chatId: 'c', provider: 'cursor', model: 'composer', status: 'running', error: null,
    handoffTurns: 0, goalRole: null, changes: null, tokens: null, sources: null, startedAt: 10, endedAt: null
  })
  const assistant: Item = { type: 'assistant', id: 'a', turnId: turn.id, text: 'The parser now rejects empty input.', streaming: false }
  store.putItem('c', { type: 'user', id: 'u', turnId: turn.id, text: 'Fix the parser.' })
  store.putItem('c', assistant)
  store.setSession('c', 'cursor', { sessionId: 'sess', seenTurnSeq: 0 })
  const reader = new DatabaseSync(path)
  store.updateTurn({ ...turn, status: 'completed', endedAt: 20, error: null })
  const mid = {
    status: String(reader.prepare('SELECT status FROM turns WHERE id = ?').get(turn.id)?.status),
    seen: Number(reader.prepare(`SELECT seen_turn_seq AS n FROM provider_sessions WHERE chat_id = 'c' AND provider = 'cursor'`).get()?.n)
  }
  reader.close()
  store.close()
  const reopened = new Store(path)
  const missed = reopened.turnsWithItems('c', reopened.session('c', 'cursor').seenTurnSeq)
  const handoff = buildHandoff(missed.map(({ turn: row, items }) => ({ provider: row.provider, model: row.model, status: row.status, items })))
  const split = {
    visibleToOtherConnectionBeforeSessionMark: mid,
    afterReopen: {
      status: reopened.turn(turn.id)?.status,
      seenTurnSeq: reopened.session('c', 'cursor').seenTurnSeq,
      handoffTurns: handoff?.turns ?? 0,
      saysOtherAssistants: handoff?.text.includes('other assistants') ?? false,
      saysAnsweredByCursor: handoff?.text.includes('Turn answered by Cursor') ?? false,
      includesOwnReply: handoff?.text.includes('The parser now rejects empty input.') ?? false,
      excerpt: handoff?.text.slice(0, 500) ?? ''
    }
  }
  reopened.close()

  const cut = join(work, 'cut.db')
  const running = new Store(cut)
  running.createChat({ id: 'c', title: 'Cursor chat', cwd: '/work', lastProvider: 'cursor', createdAt: 1, updatedAt: 1 })
  const partial = running.createTurn({
    id: 't2', chatId: 'c', provider: 'cursor', model: null, status: 'running', error: null,
    handoffTurns: 0, goalRole: null, changes: null, tokens: null, sources: null, startedAt: 10, endedAt: null
  })
  running.putItem('c', { type: 'assistant', id: 'a2', turnId: partial.id, text: 'Halfway through the edit.', streaming: false })
  running.setSession('c', 'cursor', { sessionId: 'sess', seenTurnSeq: 0 })
  running.close()
  const resumed = new Store(cut)
  const missedPartial = resumed.turnsWithItems('c', 0)
  const partialHandoff = buildHandoff(missedPartial.map(({ turn: row, items }) => ({ provider: row.provider, model: row.model, status: row.status, items })))
  const beforeStatusUpdate = {
    status: resumed.turn(partial.id)?.status,
    saysStoppedByUser: partialHandoff?.text.includes('stopped by the user') ?? false,
    saysOtherAssistants: partialHandoff?.text.includes('other assistants') ?? false
  }
  resumed.close()

  const patchDb = join(work, 'patch.db')
  const patchStore = new Store(patchDb)
  patchStore.createChat({ id: 'c', title: 't', cwd: '/work', lastProvider: null, createdAt: 1, updatedAt: 1 })
  const patchTurn = patchStore.createTurn({
    id: 't3', chatId: 'c', provider: 'codex', model: null, status: 'completed', error: null,
    handoffTurns: 0, goalRole: null, changes: null, tokens: null, sources: null, startedAt: 1, endedAt: 2
  })
  const writer = new DatabaseSync(patchDb)
  writer.prepare('UPDATE turns SET changes = ? WHERE id = ?').run(JSON.stringify({ files: 1, additions: 1, deletions: 0, undone: false }), patchTurn.id)
  const between = {
    changes: writer.prepare('SELECT changes FROM turns WHERE id = ?').get(patchTurn.id)?.changes ?? null,
    patchRows: Number(writer.prepare('SELECT COUNT(*) AS n FROM turn_patches WHERE turn_id = ?').get(patchTurn.id)?.n)
  }
  writer.close()
  patchStore.close()

  const own = 'OWN REPLY '.repeat(400)
  const other = (provider: MissedTurn['provider'], text: string): MissedTurn => ({
    provider, model: null, status: 'completed',
    items: [
      { type: 'user', id: `${provider}-u`, turnId: provider, text: `Ask ${provider}` },
      { type: 'assistant', id: `${provider}-a`, turnId: provider, text, streaming: false }
    ]
  })
  const crowded = buildHandoff([
    other('claude', 'Claude answer. '.repeat(200)),
    other('codex', 'Codex answer. '.repeat(200)),
    other('antigravity', 'Antigravity answer. '.repeat(200)),
    other('cursor', own)
  ], 8_000)
  return {
    split,
    beforeStatusUpdate,
    patchStatementsVisibleSeparately: between,
    handoffBudgetChars: HANDOFF_BUDGET_CHARS,
    crowdedAt8000: {
      turnsKept: crowded?.turns ?? 0,
      droppedNote: crowded?.text.includes('left out') ?? false,
      keptOwnReply: crowded?.text.includes('OWN REPLY') ?? false,
      keptClaude: crowded?.text.includes('Claude answer') ?? false
    }
  }
}

async function usageForce(): Promise<unknown> {
  const antigravity = new HoldAdapter('antigravity')
  antigravity.holdUsage = true
  const store = new Store(':memory:')
  const hub = new Hub(store, adapters({ antigravity }), () => {})
  const first = hub.createChat('/repo/a')
  const second = hub.createChat('/repo/b')
  const third = hub.createChat('/repo/c')
  hub.send(first.id, 'antigravity', null, 'one')
  antigravity.complete()
  await until('first usage', () => antigravity.usageCalls === 1)
  hub.send(second.id, 'antigravity', null, 'two')
  antigravity.complete()
  await sleep(30)
  const callsWhileFirstReadPending = antigravity.usageCalls
  antigravity.holdUsage = false
  antigravity.releaseHeldUsage()
  await sleep(20)
  hub.send(third.id, 'antigravity', null, 'three')
  antigravity.complete()
  await until('third usage', () => antigravity.usageCalls >= 2)
  await sleep(20)
  return {
    callsWhilePreviousReadStillPending: callsWhileFirstReadPending,
    callsAfterCacheBypassOnNextEnd: antigravity.usageCalls
  }
}

// The real CursorAdapter with its ACP client replaced by an in-process fake. The fake answers
// `session/prompt` the way cursor-agent 2026.10.01's handlePrompt does (6136.index.js): an error
// inside processPrompt becomes an `agent_message_chunk` "\n\nError: ${String(e)}" and the prompt
// still answers `{stopReason: "end_turn"}`.
type PromptScript = (ctx: { chunk: (text: string) => void; cancelled: () => boolean }) => Promise<unknown>
async function cursorOutcome(label: string, script: PromptScript, options: { stopAfterMs?: number; waitMs?: number } = {}): Promise<unknown> {
  const cursor = new CursorAdapter(null)
  const notes: string[] = []
  let cancelled = false
  const internals = cursor as unknown as {
    client: unknown
    onNotification(notification: { method: string; params: unknown }): void
  }
  const fake = {
    connected: true,
    supportsImages: false,
    request: async (method: string, params: Record<string, unknown>) => {
      notes.push(method)
      if (method === 'session/new') return { sessionId: 'acp-1', models: { currentModelId: 'fake', availableModels: [{ modelId: 'fake', name: 'Fake' }] } }
      if (method === 'session/prompt') {
        return script({
          chunk: (text) => internals.onNotification({ method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } }),
          cancelled: () => cancelled
        })
      }
      return {}
    },
    notify: (method: string) => { notes.push(`notify:${method}`); if (method === 'session/cancel') cancelled = true },
    on: () => fake,
    stop: () => {}
  }
  internals.client = fake
  const store = new Store(':memory:')
  const hub = new Hub(store, adapters({ cursor }), () => {})
  const chat = hub.createChat('/work')
  hub.send(chat.id, 'cursor', null, 'do the research')
  if (options.stopAfterMs !== undefined) {
    await sleep(options.stopAfterMs)
    await hub.stop(chat.id)
  }
  const deadline = Date.now() + (options.waitMs ?? 1_000)
  while (hub.isRunning(chat.id) && Date.now() < deadline) await sleep(10)
  const turn = store.turns(chat.id)[0]
  const assistant = hub.openChat(chat.id).items.filter((item) => item.type === 'assistant').map((item) => (item as { text: string }).text)
  const result = {
    label,
    stillRunning: hub.isRunning(chat.id),
    status: turn?.status,
    error: turn?.error ?? null,
    lastAssistantTail: assistant.at(-1)?.slice(-80) ?? null,
    seenTurnSeqAdvanced: store.session(chat.id, 'cursor').seenTurnSeq === turn?.seq,
    acpCalls: notes
  }
  store.close()
  return result
}

async function cursorOutcomes(): Promise<unknown> {
  return [
    await cursorOutcome('transport error streamed as text, end_turn', async ({ chunk }) => {
      chunk('Partial findings so far.')
      chunk('\n\nError: RetriableError: [unavailable] PING timed out')
      return { stopReason: 'end_turn' }
    }),
    await cursorOutcome('error text only, end_turn (store seq 308 shape)', async ({ chunk }) => {
      chunk('\n\nError: RetriableError: [unavailable] getaddrinfo EAI_AGAIN example.invalid')
      return { stopReason: 'end_turn' }
    }),
    await cursorOutcome('prompt request rejected (JSON-RPC error)', async () => {
      throw new JsonRpcPeerError('Internal error: upstream unavailable', -32603, null)
    }),
    await cursorOutcome('stop honoured: agent answers cancelled', async ({ cancelled }) => {
      while (!cancelled()) await sleep(5)
      return { stopReason: 'cancelled' }
    }, { stopAfterMs: 50 }),
    await cursorOutcome('stop sent but agent answers end_turn', async ({ cancelled }) => {
      while (!cancelled()) await sleep(5)
      return { stopReason: 'end_turn' }
    }, { stopAfterMs: 50 }),
    await cursorOutcome('stop sent, agent never answers', () => new Promise(() => {}), { stopAfterMs: 50, waitMs: 1_500 })
  ]
}

// EvalRuns with a deterministic adapter that never finishes and a 300 ms cell timeout.
async function evalTimeout(): Promise<unknown> {
  const dir = mkdtempSync(join(work, 'eval-'))
  const fixture = join(dir, 'fixture')
  mkdirSync(fixture)
  writeFileSync(join(fixture, 'README.md'), '# Fixture\n')
  const cursor = new HoldAdapter('cursor')
  let stopCalls = 0
  let runCalls = 0
  const originalRun = cursor.run.bind(cursor)
  cursor.run = (request, sink) => { runCalls += 1; return originalRun(request, sink) }
  cursor.stop = async () => { stopCalls += 1 }
  const store = new Store(':memory:')
  const hub = new Hub(store, adapters({ cursor }), () => {})
  const goals = new GoalRunner(store, hub, () => {})
  const scenario: EvalScenario = {
    id: 'timeout', file: 'x.jsonl', cwd: fixture, message: 'Never finish.', openGoal: false,
    graders: ['turn_completed'], trials: 2, runsAlone: false, matrix: [{ provider: 'cursor', model: null }]
  }
  const runs = new EvalRuns({
    hub, goals, store,
    evalExport: new EvalExport(dir, dir, () => store, () => undefined),
    timingForChat: () => undefined,
    root: join(dir, 'eval-live'),
    scenarios: () => [scenario],
    emit: () => {},
    providerBusy: (provider) => hub.working().some((turn) => turn.provider === provider),
    timeoutMs: 300
  })
  const run = runs.start({ scenarioId: 'timeout' })
  await until('cell 0 error', () => runs.list()[0]!.cells[0]!.status === 'error', 3_000)
  await sleep(1_500)
  const cells = runs.list()[0]!.cells
  const firstChat = cells[0]!.chatId!
  const atTimeoutPlus1500 = {
    cell0: { status: cells[0]!.status, error: cells[0]!.error },
    cell1: { status: cells[1]!.status },
    firstTurnStillRunning: hub.isRunning(firstChat),
    firstTurnStatusInStore: store.turns(firstChat)[0]?.status,
    adapterStopCalls: stopCalls,
    adapterRunCalls: runCalls
  }
  cursor.complete()
  await until('cell 1 running', () => runs.list()[0]!.cells[1]!.status === 'running', 3_000)
  const afterFirstTurnEnded = {
    firstTurnStatusInStore: store.turns(firstChat)[0]?.status,
    cell0Status: runs.list()[0]!.cells[0]!.status,
    cell1Status: runs.list()[0]!.cells[1]!.status,
    adapterRunCalls: runCalls
  }
  await until('run ended', () => runs.list()[0]!.status !== 'running', 3_000)
  const secondChat = runs.list()[0]!.cells[1]!.chatId!
  const atRunEnd = {
    runStatus: runs.list()[0]!.status,
    cell1: runs.list()[0]!.cells[1]!.status,
    secondTurnStillRunning: hub.isRunning(secondChat),
    adapterStopCalls: stopCalls
  }
  cursor.complete()
  await until('second turn ended', () => !hub.isRunning(secondChat), 3_000)
  store.close()
  return { runId: run.id, atTimeoutPlus1500, afterFirstTurnEnded, atRunEnd }
}

async function main(): Promise<void> {
  const results = {
    processFate: await processFate(),
    cancelDoesNotSettlePrompt: await cancelDoesNotSettlePrompt(),
    hubStopLeavesTurnRunning: await hubStopLeavesTurnRunning(),
    codexInterruptRejected: await codexStop('reject'),
    codexInterruptAcknowledgedWithoutCompletion: await codexStop('ack'),
    claudeFollowUpDropped: await claudeFollowUpDropped(),
    toolOwnership: await toolOwnership(),
    turnEndSplit: turnEndSplit(),
    usageForce: await usageForce(),
    cursorOutcomes: await cursorOutcomes(),
    evalTimeout: await evalTimeout(),
    cursorUpdateTodosReply: cursorExtensionReply('cursor/update_todos', { todos: [{ content: 'Ship', status: 'pending' }] })
  }
  const out = join(here, 'results.json')
  writeFileSync(out, JSON.stringify(results, null, 2))
  console.log(out)
  console.log(JSON.stringify(results, null, 2))
}

try {
  await main()
} finally {
  for (const pid of killed) if (alive(pid)) { try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ } }
  rmSync(work, { recursive: true, force: true })
}
