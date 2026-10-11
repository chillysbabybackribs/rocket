import { AttachmentStore, validateAttachments } from './attachments.ts'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  MainAgentOp, BrowserAgentReply, BrowserDownload, BrowserAgentRequest, UiSnapshot,
  HostApi, HostEvent, HostMethod, HostRequestMessage, HostToRenderer, ProviderId, UsageSnapshot
} from '../shared/types.ts'
import { FillRunner } from './fill.ts'
import { ImageRunner } from './image.ts'
import { Orchestrator } from './orchestrator.ts'
import { orchestratorTools } from './tools/orchestrator.ts'
import { Library } from './library.ts'
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
import { agentEnvironmentContext } from './agent-situation.ts'
import { browserContext, browserTools } from './tools/browser.ts'
import { ToolChannel } from './tools/channel.ts'
import { imageTools } from './tools/image.ts'
import { libraryTools } from './tools/library.ts'
import { ToolRegistry } from './tools/registry.ts'
import { memoryTools } from './tools/memory.ts'
import { selfCheckTools } from './tools/self-check.ts'
import { uiSnapshotTools } from './tools/ui-snapshot.ts'
import { askWhere, describeWhere, uiMapTools } from './tools/ui-map.ts'
import { photocraftBrief, photocraftTools } from './tools/photocraft.ts'
import { rocketSourceRoot, UiRunManager } from './tools/ui-run.ts'
import { LiveUiRunner } from './tools/ui-live.ts'
import { redactText, ToolLedger } from './tool-ledger.ts'
import { loadToolLedgerCallDetail, loadToolLedgerPanel, setToolLedgerReview } from './tool-ledger-panel.ts'
import type { ReviewLifecycle } from './tool-ledger.ts'
import { toolHistoryTools } from './tools/tool-history.ts'
import { toolReviewTools } from './tools/tool-review.ts'
import { Teamwork } from './teamwork.ts'
import { workspaceContext } from './workspace.ts'
import { UiTestAdapter, uiTestProfile } from './ui-test.ts'
import type { TurnTiming } from './hub.ts'
import type { MainToHostFill } from '../shared/fill.ts'

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
const PHOTOCRAFT_TIMEOUT_MS = 20 * 60_000
let browserSeq = 0
const browserPending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()

/** Ask main to do something in the browser, which lives there. */
function askBrowser(op: MainAgentOp, timeoutMs = BROWSER_TIMEOUT_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!parentPort) return reject(new Error('The browser is only available inside the app'))
    const id = ++browserSeq
    const timer = setTimeout(() => {
      browserPending.delete(id)
      reject(new Error('The browser did not answer in time'))
    }, timeoutMs)
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

// The library's shelf: attachments, downloads, plans and opened files (docs/library-plan.md).
const library = new Library(store, attachments, join(dataDir, 'library-previews'), {
  hidden: (chatId) => { const chat = store.chat(chatId); return chat !== null && (fills.owns(chat.cwd) || images.owns(chat.cwd)) },
  changed: () => emit({ type: 'library' }),
  downloads: async (chat, since) => await askBrowser({ op: 'downloads', chat, since }) as BrowserDownload[]
})
void library.backfill().catch((error) => journal.add('host', 'warn', 'library', `The library could not add earlier plans: ${messageOf(error)}`))

// The tools are served before any provider starts, so every session is born knowing them.
const liveUi = new LiveUiRunner(rocketSourceRoot(), join(dataDir, 'ui-runs'), askBrowser)
const uiRuns = new UiRunManager(rocketSourceRoot(), undefined, (args, chatId) => liveUi.run(args, chatId))
let orchestration: Orchestrator | undefined
let ledger: ToolLedger | undefined
try {
  const build = createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex')
  ledger = new ToolLedger(join(dataDir, 'tool-calls.db'), build, context => {
    const turn = context.chatId ? store.runningTurn(context.chatId, context.provider) : undefined
    return { model: turn?.model ?? null, turnId: turn?.id ?? null }
  })
} catch (error) { journal.add('host', 'warn', 'ledger-unavailable', messageOf(error)) }
const turnTiming = new Map<string, TurnTiming>()
const toolRegistry = new ToolRegistry((name, message, { provider, chatId }) => journal.add(`tool:${name}`, 'warn', 'tool-error', redactText(message).slice(0, 500), { provider, chatId }), ledger)
  .add(...browserTools({ request: askBrowser }, join(dataDir, 'browser-results'), (chatId) => (chatId ? store.chat(chatId)?.cwd ?? null : null), (chatId, url) => hub.noteOpened(chatId, url)))
  .add(...uiSnapshotTools(async () => await askBrowser({ op: 'uiSnapshot' }) as UiSnapshot))
  .add(...uiMapTools(askBrowser))
  // PhotoCraft runs a long filter in its page's one thread and answers when it is done: a lens blur on
  // a 24-megapixel image outlasts the browser's 150 s, so its requests wait longer.
  .add(...photocraftTools((op) => askBrowser(op, PHOTOCRAFT_TIMEOUT_MS), (chatId) => (chatId ? store.chat(chatId)?.cwd ?? null : null)))
  .add(...uiRuns.tools())
  .add(...(ledger ? [...toolHistoryTools(ledger), ...toolReviewTools(ledger)] : []))
  .add(...memoryTools(store))
  .add(...libraryTools(library, store))
  .add(...imageTools(() => images))
  .add(...askTools(() => hub))
  .add(...orchestratorTools(() => {
    if (!orchestration) throw new Error('The orchestrator is still starting.')
    return orchestration
  }))
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
  // A fill's chat goes nowhere near the window: its steps go to main for the chip beside the page.
  // A picture's chat (generate_image) is as hidden, and says nothing at all.
  const hidden = fills.observe(event) || images.observe(event)
  if (!hidden) emit(event)
  if (event.type === 'turn' && event.turn.status !== 'running') {
    void askBrowser({ op: 'rest', chat: event.turn.chatId }).catch(() => {})
    try { orchestration?.turnEnded(event.turn) } catch (error) { journal.add('host', 'warn', 'orchestrator', messageOf(error)) }
    const { id } = event.turn
    const ended = event.turn
    void teamwork.turnEnded(ended).then((files) => library.turnEnded(ended, files))
      .catch((error) => journal.add('host', 'warn', 'library', messageOf(error), { turnId: id }))
    turnTiming.delete(event.turn.chatId)
  } else if (event.type === 'chatDeleted') {
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
        askWhere(askBrowser, chatId).then(async (where) => {
          const photocraft = await photocraftBrief(askBrowser, where.side === 'photocraft')
          return [agentEnvironmentContext(describeWhere(where), fresh), photocraft].filter(Boolean).join('\n\n')
        }, () => agentEnvironmentContext(null, fresh))
      ])
    ]
    return parts.filter(Boolean).join('\n\n') || null
  },
  ids => attachments.resolve(ids),
  // A picture a model made joins the library as soon as Rocket has its copy.
  async (source, caption) => {
    const image = await attachments.keepGenerated(source, caption)
    emit({ type: 'library' })
    return image
  }
)

// Fill with Rocket: one hidden turn per fill, its chat and folder deleted when it ends (fill.ts).
const fills: FillRunner = new FillRunner(
  store, hub, join(dataDir, 'fill'),
  (message) => parentPort?.postMessage(message),
  undefined,
  (message) => journal.add('host', 'warn', 'fill', message)
)
void fills.recover().catch((error) => journal.add('host', 'warn', 'fill', `Fills left by the last exit could not be cleared: ${messageOf(error)}`))
  .then(() => fills.announce())

// generate_image: one hidden Codex turn per picture, for every provider (image.ts).
const images: ImageRunner = new ImageRunner(
  store, hub, join(dataDir, 'image-chats'), join(dataDir, 'generated-images'),
  (id) => attachments.resolve([id])[0]!.path,
  (message) => journal.add('host', 'warn', 'image', message)
)
void images.recover().catch((error) => journal.add('host', 'warn', 'image', `Pictures left by the last exit could not be cleared: ${messageOf(error)}`))

orchestration = new Orchestrator(join(dataDir, 'orchestrator.json'), store, hub, run => emit({ type: 'orchestrator', run }))
if (orchestration.stateError) journal.add('host', 'warn', 'orchestrator', orchestration.stateError)
orchestration.startMonitoring()

const handlers: { [M in HostMethod]: (params: HostApi[M][0]) => HostApi[M][1] | Promise<HostApi[M][1]> } = {
  'attachment.import': ({ name, bytes, thumbnail }) => attachments.import(name, bytes, thumbnail),
  'attachment.importFile': ({ name, bytes }) => attachments.importFile(name, bytes),
  'attachment.read': ({ id, thumbnail }) => attachments.read(id, thumbnail),
  'attachment.preview': ({ id }) => attachments.preview(id),
  'attachment.export': async ({ id, path }) => { await attachments.export(id, path); return null },
  'attachment.locate': ({ id }) => attachments.resolve([id])[0].path,
  'attachment.collect': async ({ keepIds }) => { await attachments.collect(keepIds); return null },
  'chats.list': () => hub.listChats().filter((chat) => !fills.owns(chat.cwd) && !images.owns(chat.cwd)),
  'chat.create': ({ cwd }) => hub.createChat(cwd),
  'chat.open': ({ chatId }) => {
    // What is queued goes out ahead of the snapshot, which already holds it; sent after, it would be applied twice.
    flush()
    return hub.openChat(chatId)
  },
  'chat.older': ({ chatId, before }) => hub.olderTurns(chatId, before),
  'item.output': ({ chatId, itemId }) => hub.itemOutput(chatId, itemId),
  'chat.setCwd': ({ chatId, cwd }) => hub.setCwd(chatId, cwd),
  'chat.delete': async ({ chatId }) => { orchestration?.stop(chatId); await uiRuns.close(chatId); await hub.deleteChat(chatId); return null },
  'chat.send': async ({ chatId, provider, model, text, attachmentIds = [] }) => {
    const attached = attachments.resolve(attachmentIds).map(({ path: _path, textPath: _text, ...attachment }) => attachment)
    validateAttachments(attached)
    orchestration?.userMessage(chatId, text)
    await hub.post(chatId, provider, model, text, attached)
    fills.noteSent(provider, model)
    if (attached.length) emit({ type: 'library' })
    return null
  },
  'chat.stop': async ({ chatId, sendQueued }) => {
    orchestration?.stop(chatId)
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
    const question = hub.answerQuestion(chatId, itemId, text)
    const message = answerMessage(question, text)
    try {
      hub.enqueue(chatId, provider, model, message)
    } catch (error) {
      hub.answerQuestion(chatId, itemId, null)
      throw error
    }
    return null
  },
  'chat.prepare': ({ chatId, cwd, provider, model }) => { void hub.prepare(chatId, provider, model, cwd); return null },
  'usage.read': ({ provider, force }) => hub.usage(provider, force),
  'models.list': ({ provider }) => hub.models(provider),
  'orchestrator.list': () => orchestration?.list() ?? [],
  'journal.report': ({ message, stack }) => {
    journal.add('renderer', 'error', 'crash', oneLine(String(message), 300), { stack: String(stack ?? '').split('\n').slice(0, 6).join('\n') })
    return null
  },
  'library.list': () => library.list(),
  'library.preview': ({ id }) => library.preview(id),
  'library.view': ({ id }) => library.view(id),
  'library.add': ({ path, chatId }) => library.add(path, 'opened', chatId),
  'toolLedger.loadPanel': () => loadToolLedgerPanel(ledger, toolRegistry.list()),
  'toolLedger.callDetail': ({ callId }: { callId: string }) => loadToolLedgerCallDetail(ledger, callId),
  'toolLedger.setReview': (params: {
    callId: string; lifecycle?: ReviewLifecycle; retryCallId?: string | null; linkRetry?: boolean
    causeCode?: string | null; causeNote?: string | null; proposedFix?: string | null
  }) => {
    if (!ledger) throw new Error('Tool-call ledger is unavailable.')
    const review = setToolLedgerReview(ledger, params)
    return { path: ledger.path, review }
  }
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
  orchestration?.shutdown()
  await fills.shutdown()
  await images.shutdown()
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
  else if (message?.type === 'fillStart' || message?.type === 'fillStop') {
    void fills.handle(message as MainToHostFill).catch((error) => journal.add('host', 'warn', 'fill', messageOf(error)))
  }
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
