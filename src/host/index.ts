import { AttachmentStore, validateAttachments } from './attachments.ts'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  MainAgentOp, BrowserAgentReply, BrowserAgentRequest, UiSnapshot,
  HostApi, HostEvent, HostMethod, HostRequestMessage, HostToRenderer, ProviderId, UsageSnapshot
} from '../shared/types.ts'
import { GoalRunner } from './goals.ts'
import { describeTiming, Hub } from './hub.ts'
import { messageOf, oneLine } from './json.ts'
import { Journal } from './journal.ts'
import { stopAllProcessGroups } from './process-tree.ts'
import { AntigravityAdapter } from './providers/antigravity.ts'
import { ClaudeAdapter } from './providers/claude.ts'
import { CodexAdapter } from './providers/codex.ts'
import { CursorAdapter } from './providers/cursor.ts'
import type { ProviderAdapter } from './providers/provider.ts'
import { Store } from './store.ts'
import { answerMessage, askTools } from './tools/ask.ts'
import { agentSituationContext } from './agent-situation.ts'
import { browserContext, browserTools } from './tools/browser.ts'
import { ToolChannel } from './tools/channel.ts'
import { goalTools } from './tools/goal.ts'
import { ToolRegistry } from './tools/registry.ts'
import { memoryTools } from './tools/memory.ts'
import { selfCheckTools } from './tools/self-check.ts'
import { uiSnapshotTools } from './tools/ui-snapshot.ts'
import { askWhere, describeWhere, uiMapTools } from './tools/ui-map.ts'
import { rocketSourceRoot, UiRunManager } from './tools/ui-run.ts'
import { LiveUiRunner } from './tools/ui-live.ts'
import { redactText, ToolLedger } from './tool-ledger.ts'
import { loadToolLedgerCallDetail, loadToolLedgerPanel, setToolLedgerReview } from './tool-ledger-panel.ts'
import { loadToolEvalScores } from './tool-eval-scores.ts'
import type { ReviewLifecycle } from './tool-ledger.ts'
import { toolHistoryTools } from './tools/tool-history.ts'
import { toolReviewTools } from './tools/tool-review.ts'
import { Teamwork } from './teamwork.ts'
import { workspaceContext } from './workspace.ts'
import { UiTestAdapter, uiTestProfile } from './ui-test.ts'
import { EvalExport } from './eval-export.ts'
import { EvalRuns, evalRunsRoot } from './eval-runs.ts'
import { listScenarios } from './eval-scenarios.ts'
import { runEvalCell } from './eval-run-cell.ts'
import type { TurnTiming } from './hub.ts'

// The agent host: a utility process forked by Electron's main process. Everything that talks to
// a provider or to the transcript store lives here, so none of it can stall the window or the
// browser. Main hands this process one end of a MessageChannel whose other end is in the
// renderer; the two then talk directly, without main relaying a single token.

// Electron's utility-process port; typed structurally so this file also loads under plain Node.
type Port = {
  on: (event: 'message', listener: (event: { data: unknown; ports: Port[] }) => void) => void
  postMessage: (message: unknown) => void
  start?: () => void
  close?: () => void
}
const parentPort = (process as unknown as { parentPort?: Port }).parentPort

const EVENT_FLUSH_MS = 16

const testProfile = uiTestProfile()
const dataDir = process.env.ROCKET_DATA_DIR || join(homedir(), '.config', 'rocket')
const store = new Store(join(dataDir, 'rocket.db'))
// Eval runs work in copies under here; their chats and goals stay out of the chat list and goals.
const evalRoot = evalRunsRoot(dataDir)
const inEvalFolder = (cwd: string): boolean => cwd.startsWith(evalRoot + '/')
const attachments = new AttachmentStore(store, join(dataDir, 'attachments'))
// The journal records always, since a crash is worth keeping; the tools and nudges that surface it are opt-in.
const journal = new Journal(join(dataDir, 'journal.jsonl'))
const selfCheck = process.env.ROCKET_SELF_CHECK === '1'

let rendererPort: Port | null = null
let queued: HostEvent[] = []
let flushTimer: NodeJS.Timeout | null = null
let lastFlush = 0

/**
 * Queue an event for the renderer. Consecutive deltas to one item merge into one. After a quiet
 * spell the queue goes out at once, so the first token of a reply does not wait out a frame;
 * within a stream it goes out once per frame.
 */
function emit(event: HostEvent): void {
  const last = queued.at(-1)
  if (event.type === 'delta' && last?.type === 'delta' && last.itemId === event.itemId && last.chatId === event.chatId) {
    last.delta += event.delta
  } else {
    queued.push(event.type === 'delta' ? { ...event } : event)
  }
  flushTimer ??= setTimeout(flush, Math.max(0, EVENT_FLUSH_MS - (performance.now() - lastFlush)))
}

function flush(): void {
  flushTimer = null
  lastFlush = performance.now()
  if (!queued.length || !rendererPort) {
    // With no window attached, state is in the store; a window that opens later reads it there.
    queued = []
    return
  }
  const events = queued
  queued = []
  post({ kind: 'events', events })
}

function post(message: HostToRenderer): void {
  try {
    rendererPort?.postMessage(message)
  } catch {
    // The renderer went away; main will hand over a new port when it is back.
  }
}

// Longer than anything main waits for on a page, so main's own, clearer error arrives first.
const BROWSER_TIMEOUT_MS = 150_000
let browserSeq = 0
const browserPending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()

/** Ask main to do something in the browser, which lives there. */
function askBrowser(op: MainAgentOp): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!parentPort) return reject(new Error('The browser is only available inside the app'))
    const id = ++browserSeq
    const timer = setTimeout(() => {
      browserPending.delete(id)
      reject(new Error('The browser did not answer in time'))
    }, BROWSER_TIMEOUT_MS)
    browserPending.set(id, { resolve, reject, timer })
    parentPort.postMessage({ type: 'browser', id, op } satisfies BrowserAgentRequest)
  })
}

function onBrowserReply(reply: BrowserAgentReply): void {
  const pending = browserPending.get(reply.id)
  if (!pending) return
  browserPending.delete(reply.id)
  clearTimeout(pending.timer)
  if (reply.ok) pending.resolve(reply.result)
  else pending.reject(new Error(reply.error))
}

// The tools are served before any provider starts, so every session is born knowing them.
const liveUi = new LiveUiRunner(rocketSourceRoot(), join(dataDir, 'ui-runs'), askBrowser)
const uiRuns = new UiRunManager(rocketSourceRoot(), undefined, (args, chatId) => liveUi.run(args, chatId))
let ledger: ToolLedger | undefined
try {
  const build = createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex')
  ledger = new ToolLedger(join(dataDir, 'tool-calls.db'), build, context => {
    const turn = context.chatId ? store.runningTurn(context.chatId, context.provider) : undefined
    return { model: turn?.model ?? null, turnId: turn?.id ?? null }
  })
} catch (error) { journal.add('host', 'warn', 'ledger-unavailable', messageOf(error)) }
const evalExport = new EvalExport(dataDir, rocketSourceRoot(), () => store, () => ledger)
const turnTiming = new Map<string, TurnTiming>()
const toolRegistry = new ToolRegistry((name, message, { provider, chatId }) => journal.add(`tool:${name}`, 'warn', 'tool-error', redactText(message).slice(0, 500), { provider, chatId }), ledger)
  .add(...browserTools({ request: askBrowser }, join(dataDir, 'browser-results')))
  .add(...uiSnapshotTools(async () => await askBrowser({ op: 'uiSnapshot' }) as UiSnapshot))
  .add(...uiMapTools(askBrowser))
  .add(...uiRuns.tools())
  .add(...(ledger ? [...toolHistoryTools(ledger), ...toolReviewTools(ledger)] : []))
  .add(...memoryTools(store))
  .add(...askTools(() => hub))
  .add(...goalTools(() => goals))
  .add(...(selfCheck ? selfCheckTools(journal, (chatId) => (chatId ? store.chat(chatId)?.cwd ?? null : null)) : []))
const tools = new ToolChannel(
  toolRegistry,
  join(dataDir, 'tool-channel.json'),
  (provider) => hub.runningChat(provider)
)
await tools.start()

const onUsage = (snapshot: UsageSnapshot): void => hub.noteUsage(snapshot)
const adapters: Record<ProviderId, ProviderAdapter> = testProfile ? {
  codex: new UiTestAdapter('codex', testProfile),
  claude: new UiTestAdapter('claude', testProfile),
  cursor: new UiTestAdapter('cursor', testProfile),
  antigravity: new UiTestAdapter('antigravity', testProfile)
} : {
  codex: new CodexAdapter(onUsage, tools),
  claude: new ClaudeAdapter(onUsage, tools),
  cursor: new CursorAdapter(tools),
  antigravity: new AntigravityAdapter(tools)
}
/** Events go to the renderer; the ones that end a chat's use of the browser go to main as well. */
function onEvent(event: HostEvent): void {
  // Eval runs' chats work in folders under the profile's eval root; the panel shows them, the
  // chat list does not. Their turns and items still go out, for the panel's live transcript.
  if (!(event.type === 'chat' && inEvalFolder(event.chat.cwd))) emit(event)
  if (event.type === 'turn' && event.turn.status !== 'running') {
    void askBrowser({ op: 'rest', chat: event.turn.chatId }).catch(() => {})
    goals.turnEnded(event.turn)
    const { id } = event.turn
    void teamwork.turnEnded(event.turn).then((files) => goals.noteFiles(id, files))
    try {
      const path = evalExport.onTurnEnded(event.turn, turnTiming.get(event.turn.chatId))
      if (path) journal.add('host', 'info', 'eval-export', `Wrote ${path}`, { turnId: id, chatId: event.turn.chatId })
    } catch (error) {
      journal.add('host', 'warn', 'eval-export', messageOf(error), { turnId: id })
    }
    turnTiming.delete(event.turn.chatId)
  } else if (event.type === 'chatDeleted') {
    goals.forget(event.chatId)
    void askBrowser({ op: 'forget', chat: event.chatId }).catch(() => {})
    teamwork.forget(event.chatId)
  }
}
// ROCKET_AUTO_COMMIT=0 leaves committing to the user; models are still told about each other.
const teamwork: Teamwork = new Teamwork(store, () => hub.working(), {
  commit: !testProfile && process.env.ROCKET_AUTO_COMMIT !== '0',
  // Straight to the window: through onEvent, an ended turn would end again.
  changed: (turn) => emit({ type: 'turn', turn }),
  warn: (message, details) => journal.add('host', 'warn', 'commit', message, details)
})
const browserTabs = browserContext({ request: askBrowser })
const workspace = workspaceContext(store)
const hub: Hub = new Hub(
  store, adapters, onEvent,
  (timing) => {
    console.log(`[host] ${describeTiming(timing)}`)
    turnTiming.set(timing.chatId, timing)
    journal.noteTiming(timing)
  },
  async (chatId, provider, fresh) => {
    const parts = [
      selfCheck ? journal.nudge(chatId) : null,
      ...await Promise.all([
        workspace(chatId, provider, fresh),
        teamwork.context(chatId, provider, fresh),
        browserTabs(chatId, provider, fresh),
        // The window may be closed or still loading; the block then says to ask rocket_ui_where.
        askWhere(askBrowser, chatId).then((where) => agentSituationContext(describeWhere(where)), () => agentSituationContext())
      ])
    ]
    return parts.filter(Boolean).join('\n\n') || null
  },
  ids => attachments.resolve(ids)
)

// Built after the hub, which it drives; goals cut off by the last exit wait for the user.
const goals: GoalRunner = new GoalRunner(store, hub, (goal) => { if (!inEvalFolder(goal.cwd)) emit({ type: 'goal', goal }) })

const evalRuns: EvalRuns = new EvalRuns({
  ...evalDeps(),
  root: evalRoot,
  scenarios: () => listScenarios(rocketSourceRoot()).scenarios,
  emit: (run) => emit({ type: 'evalRun', run }),
  providerBusy: (provider) => hub.working().some((turn) => turn.provider === provider)
})

const handlers: { [M in HostMethod]: (params: HostApi[M][0]) => HostApi[M][1] | Promise<HostApi[M][1]> } = {
  'attachment.import': ({ name, bytes, thumbnail }) => attachments.import(name, bytes, thumbnail),
  'attachment.importFile': ({ name, bytes }) => attachments.importFile(name, bytes),
  'attachment.read': ({ id, thumbnail }) => attachments.read(id, thumbnail),
  'attachment.preview': ({ id }) => attachments.preview(id),
  'attachment.export': async ({ id, path }) => { await attachments.export(id, path); return null },
  'attachment.locate': ({ id }) => attachments.resolve([id])[0].path,
  'attachment.collect': async ({ keepIds }) => { await attachments.collect(keepIds); return null },
  'chats.list': () => hub.listChats().filter((chat) => !inEvalFolder(chat.cwd)),
  'chat.create': ({ cwd }) => hub.createChat(cwd),
  'chat.open': ({ chatId }) => {
    // What is queued goes out ahead of the snapshot, which already holds it; sent after, it would be applied twice.
    flush()
    return hub.openChat(chatId)
  },
  'chat.older': ({ chatId, before }) => hub.olderTurns(chatId, before),
  'chat.setCwd': ({ chatId, cwd }) => hub.setCwd(chatId, cwd),
  'chat.delete': async ({ chatId }) => { await uiRuns.close(chatId); await hub.deleteChat(chatId); return null },
  'chat.send': async ({ chatId, provider, model, text, attachmentIds = [] }) => {
    const attached = attachments.resolve(attachmentIds).map(({ path: _path, textPath: _text, ...attachment }) => attachment)
    validateAttachments(attached)
    await hub.post(chatId, provider, model, text, attached)
    return null
  },
  'chat.stop': async ({ chatId, sendQueued }) => {
    const withdrawn = sendQueued ? null : hub.withdraw(chatId)
    await hub.stop(chatId)
    return withdrawn
  },
  'chat.unqueue': ({ chatId, id }) => hub.unqueue(chatId, id),
  'turn.changes': async ({ chatId, turnId }) => {
    const kept = store.turn(turnId)?.chatId === chatId ? store.turnPatch(turnId) : undefined
    if (!kept) return null
    return { patch: kept.patch, truncated: kept.truncated, undo: await teamwork.undoable(turnId) }
  },
  'turn.undo': ({ chatId, turnId }) => {
    if (store.turn(turnId)?.chatId !== chatId) throw new Error('That turn is not in this chat.')
    return teamwork.undo(turnId)
  },
  'question.answer': ({ chatId, itemId, answer, provider, model }) => {
    const text = answer.trim()
    if (!text) throw new Error('Pick an option or type an answer first')
    // A goal's chat is the goal's to drive: the answer goes to its next round as a note. In an
    // ordinary chat it is the next message, sent now, or the moment the turn that asked is over.
    const goal = goals.list().find((entry) => entry.chatId === chatId && entry.status !== 'done' && entry.status !== 'stopped')
    const question = hub.answerQuestion(chatId, itemId, text)
    const message = answerMessage(question, text)
    try {
      if (goal) goals.steer(goal.id, message)
      else hub.enqueue(chatId, provider, model, message)
    } catch (error) {
      hub.answerQuestion(chatId, itemId, null)
      throw error
    }
    return null
  },
  'chat.prepare': ({ chatId, cwd, provider, model }) => { void hub.prepare(chatId, provider, model, cwd); return null },
  'usage.read': ({ provider, force }) => hub.usage(provider, force),
  'models.list': ({ provider }) => hub.models(provider),
  'goals.list': () => goals.list().filter((goal) => !inEvalFolder(goal.cwd)),
  'goal.draft': (input) => goals.draft(input),
  'goal.update': ({ goalId, edit }) => goals.update(goalId, edit),
  'goal.start': ({ goalId }) => goals.start(goalId),
  'goal.pause': ({ goalId }) => goals.pause(goalId),
  'goal.resume': ({ goalId }) => goals.resume(goalId),
  'goal.stop': ({ goalId }) => goals.stop(goalId),
  'goal.steer': ({ goalId, text }) => goals.steer(goalId, text),
  'goal.referenceImage': ({ goalId, index }) => goals.referenceImage(goalId, index),
  'journal.report': ({ message, stack }) => {
    journal.add('renderer', 'error', 'crash', oneLine(String(message), 300), { stack: String(stack ?? '').split('\n').slice(0, 6).join('\n') })
    return null
  },
  'eval.tagChat': ({ chatId }) => { evalExport.tagChat(chatId); return null },
  'eval.untagChat': ({ chatId }) => { evalExport.untagChat(chatId); return null },
  'eval.listTaggedChats': () => evalExport.listTaggedChats(),
  'eval.exportTurn': ({ turnId, outDir }) => {
    const ended = store.turn(turnId)
    return evalExport.exportTurn(turnId, ended ? turnTiming.get(ended.chatId) : null, outDir ?? null)
  },
  'eval.setCellDir': ({ dir }) => { evalExport.setCellDir(dir); return null },
  'eval.runCell': (input) => runEvalCell(
    evalDeps(),
    input
  ),
  'eval.listScenarios': () => listScenarios(rocketSourceRoot()),
  'evalRuns.list': ({ scenarioId }) => evalRuns.list(scenarioId),
  'evalRuns.start': (input) => evalRuns.start(input),
  'evalRuns.stop': async ({ runId }) => { await evalRuns.stop(runId); return null },
  'toolLedger.loadPanel': () => loadToolLedgerPanel(ledger, toolRegistry.list()),
  'toolLedger.callDetail': ({ callId }: { callId: string }) => loadToolLedgerCallDetail(ledger, callId),
  'toolEval.scores': () => loadToolEvalScores(ledger, toolRegistry.list(), rocketSourceRoot(), dataDir),
  'toolLedger.setReview': (params: {
    callId: string; lifecycle?: ReviewLifecycle; retryCallId?: string | null; linkRetry?: boolean
    causeCode?: string | null; causeNote?: string | null; proposedFix?: string | null
  }) => {
    if (!ledger) throw new Error('Tool-call ledger is unavailable.')
    const review = setToolLedgerReview(ledger, params)
    return { path: ledger.path, review }
  }
}

function evalDeps() {
  return { hub, goals, store, evalExport, timingForChat: (chatId: string) => turnTiming.get(chatId) }
}

async function handleRequest(message: HostRequestMessage): Promise<void> {
  try {
    const handler = handlers[message.method] as ((params: unknown) => unknown) | undefined
    if (!handler) throw new Error(`Unknown request: ${message.method}`)
    post({ kind: 'response', id: message.id, ok: true, result: await handler(message.params) })
  } catch (error) {
    post({ kind: 'response', id: message.id, ok: false, error: messageOf(error) })
  }
}

function attachRenderer(port: Port): void {
  rendererPort?.close?.()
  rendererPort = port
  port.on('message', (event) => {
    const message = event.data as HostRequestMessage
    if (message?.kind === 'request') void handleRequest(message)
  })
  port.start?.()
}

let exiting = false
async function shutdown(): Promise<void> {
  if (exiting) return
  exiting = true
  goals.shutdown()
  await uiRuns.shutdown()
  await liveUi.shutdown()
  await Promise.race([hub.shutdown(), new Promise((resolve) => setTimeout(resolve, 1_500))])
  stopAllProcessGroups()
  tools.stop()
  ledger?.close()
  store.close()
  process.exit(0)
}

parentPort?.on('message', (event) => {
  const message = event.data as { type?: string }
  if (message?.type === 'browserReply') onBrowserReply(message as BrowserAgentReply)
  else if (message?.type === 'connect' && event.ports[0]) attachRenderer(event.ports[0])
  else if (message?.type === 'shutdown') void shutdown()
})
process.on('SIGTERM', () => { void shutdown() })
process.on('SIGINT', () => { void shutdown() })
// A provider child must never outlive the host, whatever took the host down.
process.on('exit', () => stopAllProcessGroups())
process.on('uncaughtException', (error) => {
  console.error('[host] uncaught:', error)
  journal.add('host', 'error', 'crash', `Uncaught exception: ${messageOf(error)}`, { stack: error.stack?.split('\n').slice(0, 6).join('\n') })
})
process.on('unhandledRejection', (error) => {
  console.error('[host] unhandled rejection:', error)
  journal.add('host', 'error', 'crash', `Unhandled rejection: ${messageOf(error)}`, { stack: error instanceof Error ? error.stack?.split('\n').slice(0, 6).join('\n') : undefined })
})
