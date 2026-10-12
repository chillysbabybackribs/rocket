import type { Orchestration } from '../../shared/orchestrator.ts'
import { collectAttachments, restoreDraft, updateDraft } from './drafts.ts'
import { useSyncExternalStore } from 'react'
import type { ChatLinkTarget, Chat, Attachment, AttachmentPreview, FileAttachment, MessageDraft, HostEvent, Item, ModelInfo, ProviderId, QueuedMessage, Turn, TurnPatch, UsageSnapshot } from '../../shared/types.ts'

export type ArtifactView =
  | Extract<ChatLinkTarget, { kind: 'artifact' }>
  | { kind: 'changes'; chatId: string; turnId: string; patch: TurnPatch }
  /** An attached PDF or text file; `preview` is null while it loads. */
  | { kind: 'attachment'; attachment: FileAttachment; preview: AttachmentPreview | null; error: string | null }
  /** A file opened from the library; `view` is null while it loads. */
  | { kind: 'library'; entry: LibraryEntry; view: LibraryView | null; error: string | null }
import { PROVIDERS, TURN_PAGE, planItemId } from '../../shared/types.ts'
import type { LibraryEntry, LibraryFilters, LibraryPreview, LibraryView } from '../../shared/library.ts'
import { call, connectHost } from './host.ts'
import { clampSpeed } from '../../shared/reading.ts'
import { DEFAULT_TOOLBAR, normalizeToolbar, type ToolbarPrefs } from './toolbar.ts'

// Client state. Two kinds of subscription keep a fast token stream cheap: components that care
// about structure (which chats, which turns, which items exist) read `useApp`, and each
// transcript row reads its own item with `useItem`. A text delta therefore re-renders exactly
// one row, never the list around it.
//
// The chat card holds one to four panes, each a whole chat with its own tabs and composer. What
// a pane shows is in `panes`; what a shown chat holds (its turns, their items, what is waiting)
// is in `views`, keyed by chat, so two panes on the same chat share one copy. Every action that
// means "in this chat" takes the pane it was asked in; the toolbar acts on the focused pane.

/** The most panes the card splits into: side by side, two over one, then quadrants. */
export const MAX_PANES = 4

export type Pane = {
  /** Stable while the pane is open, so closing one pane never remounts another. */
  key: number
  /** The chat on screen, or null for a new chat that has not been sent to yet. */
  chatId: string | null
  /** The chats open as tabs over this pane's composer, in the order they were opened. */
  tabs: string[]
  /** The provider chosen in this pane's chat, or for the next new one. */
  provider: ProviderId
  /** The model chosen per provider, in the same place; a provider absent here runs its own default. */
  modelChoice: ModelChoices
  /** Text handed back to the composer (a waiting message taken back); `at` tells one hand-back from the next. */
  restored: { text: string; at: number } | null
}

export type ChatView = {
  turns: Turn[]
  /** turnId → its item ids, in order. */
  turnItems: Record<string, string[]>
  /** Messages waiting for the chat's turn in flight to end. */
  queued: QueuedMessage[]
  /**
   * The turn whose plan shows in the drawer beside the chat, or null while it is closed. It opens
   * by itself on the first plan of a running turn unless this chat has closed it before.
   */
  planTurnId: string | null
  /** Whether the chat has turns before the first one loaded, which come as the reader scrolls up (`loadOlder`). */
  hasOlder: boolean
}

const EMPTY_VIEW: ChatView = { turns: [], turnItems: {}, queued: [], planTurnId: null, hasOlder: false }

export type AppState = {
  ready: boolean
  chats: Chat[]
  panes: Pane[]
  /** The pane the user last worked in: where the toolbar opens chats, and whose chat it marks. */
  focused: number
  /** Each chat on screen, keyed by chat id. */
  views: Record<string, ChatView>
  /** Chats with a turn in flight, including ones not on screen. */
  running: ReadonlySet<string>
  orchestrations: Record<string, Orchestration>
  usage: Partial<Record<ProviderId, UsageSnapshot>>
  /** Each provider's models, once read. A provider absent here has not been asked yet. */
  models: Partial<Record<ProviderId, ModelInfo[]>>
  /** What the panel beside the chat shows: a file a link opened, or what a turn changed. */
  artifact: ArtifactView | null
  /** Hands-free reading's speed, one for web pages and files alike (shared/reading.ts). */
  readingSpeed: number
  browserOpen: boolean
  /** The library beside the chat: every file the chats touched (docs/library-plan.md). */
  libraryOpen: boolean
  library: LibraryState
  /** The toolbar's sections: the drawer open or not, and what the user kept, renamed and reordered. */
  toolbar: ToolbarPrefs
  /** Width of the plan drawer beside the chat, in pixels. */
  sideWidth: number
  /** Width of the browser pane beside the chat, in pixels (null for default ratio). */
  browserWidth: number | null
  /** The folder a new chat starts in: the last one the user chose, or their home folder. */
  defaultCwd: string
  error: string | null
}

export type ModelChoices = Partial<Record<ProviderId, { id: string; label: string }>>

/** The library panel's shelf, filters and card pictures. Filters live here, not in the panel, because the app map sets them too. */
export type LibraryState = {
  entries: LibraryEntry[]
  loaded: boolean
  error: string | null
  filters: LibraryFilters
  view: 'grid' | 'list'
  /** The card last opened, outlined when the grid comes back. */
  selected: string | null
  /** A card's picture: absent until asked for, null while it is made. */
  previews: Record<string, LibraryPreview | null>
}

// Each chat keeps its own provider and models, so a change in one never shows up in another. The
// empty screen has a choice of its own, which a chat takes with it when it is created there.
type Selection = { provider: ProviderId; modelChoice: ModelChoices }

const PREFS_KEY = 'rocket.prefs'
type Prefs = {
  /** The empty screen's choice, and what a chat with none of its own falls back to. */
  provider?: ProviderId
  modelChoice?: ModelChoices
  /** chatId → that chat's choice. */
  selections?: Record<string, Selection>
  browserOpen?: boolean
  readingSpeed?: number
  libraryOpen?: boolean
  libraryView?: 'grid' | 'list'
  toolbar?: ToolbarPrefs
  sideWidth?: number
  browserWidth?: number | null
  /** @deprecated migrated to sideWidth */
  goalWidth?: number
  /** Chats whose plan drawer the user closed; it no longer opens by itself there. */
  planClosed?: Record<string, true>
  /** The panes as they were, in order, and which one had the focus. */
  panes?: { chatId: string | null; tabs: string[]; key?: number }[]
  focused?: number
  /** Before panes, the one chat and its tabs; read once to become the first pane. */
  activeChatId?: string | null
  tabs?: string[]
  cwd?: string
}

function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs
  } catch {
    return {}
  }
}

function writePrefs(patch: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch }))
  } catch {
    // Preferences are a convenience; the app works without them.
  }
}

const prefs = readPrefs()

function selectionFor(chatId: string | null): Selection {
  const saved = readPrefs()
  const own = chatId ? saved.selections?.[chatId] : undefined
  const provider = own?.provider ?? saved.provider
  const modelChoice = { ...(own?.modelChoice ?? saved.modelChoice) }
  // A remembered model the provider no longer offers would fail the turn; fall back to default.
  for (const entry of PROVIDERS) {
    const offered = state.models[entry.id]
    const chosen = modelChoice[entry.id]
    if (offered?.length && chosen && !offered.some((model) => model.id === chosen.id)) delete modelChoice[entry.id]
  }
  return { provider: PROVIDERS.some((entry) => entry.id === provider) ? provider! : 'claude', modelChoice }
}

function saveSelection(chatId: string | null, selection: Selection): void {
  if (chatId) writePrefs({ selections: { ...readPrefs().selections, [chatId]: selection } })
  else writePrefs(selection)
}

function forgetSelection(chatId: string): void {
  const saved = readPrefs()
  const { [chatId]: _gone, ...selections } = saved.selections ?? {}
  const { [chatId]: _closed, ...planClosed } = saved.planClosed ?? {}
  writePrefs({ selections, planClosed })
}

let nextPaneKey = 1

function newPane(chatId: string | null = null, tabs: string[] = []): Pane {
  return { key: nextPaneKey++, chatId, tabs, restored: null, ...selectionFor(chatId) }
}

let state: AppState = {
  artifact: null,
  ready: false,
  chats: [],
  panes: [],
  focused: 0,
  views: {},
  running: new Set(),
  orchestrations: {},
  usage: {},
  models: {},
  readingSpeed: clampSpeed(prefs.readingSpeed ?? 1),
  browserOpen: prefs.browserOpen === true,
  libraryOpen: prefs.libraryOpen === true,
  library: { entries: [], loaded: false, error: null, filters: {}, view: prefs.libraryView === 'list' ? 'list' : 'grid', selected: null, previews: {} },
  toolbar: normalizeToolbar(prefs.toolbar),
  sideWidth: prefs.sideWidth ?? prefs.goalWidth ?? 400,
  browserWidth: typeof prefs.browserWidth === 'number' ? prefs.browserWidth : null,
  defaultCwd: prefs.cwd || window.rocket.homeDir,
  error: null
}
// The first pane exists before anything is loaded, so the composer has somewhere to be.
state.panes = [newPane()]
const items = new Map<string, Item>()
const stateListeners = new Set<() => void>()
const itemListeners = new Map<string, Set<() => void>>()

function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch }
  for (const listener of stateListeners) listener()
}

function notifyItem(id: string): void {
  for (const listener of itemListeners.get(id) ?? []) listener()
}

export function useApp<T>(select: (state: AppState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      stateListeners.add(listener)
      return () => { stateListeners.delete(listener) }
    },
    () => select(state)
  )
}

/** An item as it stands, without subscribing. For what never changes about it, such as its type. */
export function peekItem(id: string): Item | undefined {
  return items.get(id)
}

export function useItem(id: string): Item | undefined {
  return useSyncExternalStore(
    (listener) => {
      let set = itemListeners.get(id)
      if (!set) itemListeners.set(id, set = new Set())
      set.add(listener)
      return () => {
        set.delete(listener)
        if (set.size === 0) itemListeners.delete(id)
      }
    },
    () => items.get(id)
  )
}

// ── Reading panes ─────────────────────────────────────────────────────

export function paneAt(state: AppState, pane: number): Pane {
  return state.panes[pane] ?? state.panes[0]!
}

export function chatIdOf(state: AppState, pane: number): string | null {
  return paneAt(state, pane).chatId
}

/** The chat the focused pane shows: what the toolbar means by "the open chat". */
export function focusedChatId(state: AppState): string | null {
  return chatIdOf(state, state.focused)
}

export function viewOf(state: AppState, chatId: string | null): ChatView {
  return (chatId && state.views[chatId]) || EMPTY_VIEW
}

/** The folder a pane's chat works in, or the one new chats start in. */
export function cwdOf(state: AppState, pane: number): string {
  const chatId = chatIdOf(state, pane)
  return state.chats.find((chat) => chat.id === chatId)?.cwd ?? state.defaultCwd
}

function patchPane(pane: number, patch: Partial<Pane>): void {
  setState({ panes: state.panes.map((entry, index) => (index === pane ? { ...entry, ...patch } : entry)) })
}

function patchView(chatId: string, patch: Partial<ChatView>): void {
  const view = state.views[chatId]
  if (view) setState({ views: { ...state.views, [chatId]: { ...view, ...patch } } })
}

function savePanes(): void {
  writePrefs({ panes: state.panes.map((pane) => ({ chatId: pane.chatId, tabs: pane.tabs, key: pane.key })), focused: state.focused })
}

// ── Events ────────────────────────────────────────────────────────────

function sortChats(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt)
}

function putItem(chatId: string, item: Item): void {
  const known = items.has(item.id)
  items.set(item.id, item)
  if (known) {
    notifyItem(item.id)
    return
  }
  const view = state.views[chatId]!
  const list = view.turnItems[item.turnId] ?? []
  patchView(chatId, { turnItems: { ...view.turnItems, [item.turnId]: [...list, item.id] } })
}

function applyEvents(events: HostEvent[]): void {
  for (const event of events) {
    switch (event.type) {
      case 'orchestrator':
        setState({ orchestrations: { ...state.orchestrations, [event.run.chatId]: event.run } })
        void refreshOrchestratorArtifact(event.run.progressFile)
        break
      case 'item':
        if (!state.views[event.chatId]) break
        putItem(event.chatId, event.item)
        if (event.item.type === 'plan') openPlanIfNew(event.chatId, event.item.turnId)
        break
      case 'delta': {
        const item = state.views[event.chatId] ? items.get(event.itemId) : undefined
        if (!item) break
        if (item.type === 'assistant' || item.type === 'reasoning') items.set(item.id, { ...item, text: item.text + event.delta })
        else if (item.type === 'tool') items.set(item.id, { ...item, output: item.output + event.delta })
        notifyItem(item.id)
        break
      }
      case 'turn': {
        const { turn } = event
        const running = new Set(state.running)
        if (turn.status === 'running') running.add(turn.chatId)
        else running.delete(turn.chatId)
        setState({ running })
        const view = state.views[turn.chatId]
        // A turn above the loaded ones changed; it is read as it stands when the reader gets there.
        const above = view && view.hasOlder && !view.turns.some((entry) => entry.id === turn.id) && turn.startedAt < (view.turns[0]?.startedAt ?? 0)
        if (view && !above) {
          patchView(turn.chatId, {
            turns: view.turns.some((entry) => entry.id === turn.id)
              ? view.turns.map((entry) => (entry.id === turn.id ? turn : entry))
              : [...view.turns, turn]
          })
        }
        break
      }
      case 'chat': {
        const rest = state.chats.filter((chat) => chat.id !== event.chat.id)
        setState({ chats: sortChats([...rest, event.chat]) })
        break
      }
      case 'chatDeleted':
        updateDraft(event.chatId, { text: '', attachments: [] })
        setState({ chats: state.chats.filter((chat) => chat.id !== event.chatId) })
        forgetSelection(event.chatId)
        // Closing a pane shifts the ones after it, so the panes are walked from the end.
        for (let index = state.panes.length - 1; index >= 0; index--) {
          if (state.panes[index]!.tabs.includes(event.chatId)) closeTab(event.chatId, index)
        }
        break
      case 'usage':
        setState({ usage: { ...state.usage, [event.snapshot.provider]: event.snapshot } })
        break
      case 'queue':
        if (state.views[event.chatId]) patchView(event.chatId, { queued: event.queued })
        break
      case 'library':
        if (state.library.loaded) scheduleLibraryLoad()
        break
    }
  }
}

// ── Showing chats ─────────────────────────────────────────────────────

/**
 * Drop the views of chats no pane has open any more, and the items that were theirs. A chat open
 * as a tab keeps its view, which live events keep current, so going back to it asks the host for
 * nothing.
 */
function pruneViews(panes: Pane[]): Record<string, ChatView> {
  const open = new Set(panes.flatMap((pane) => [pane.chatId, ...pane.tabs]))
  const views: Record<string, ChatView> = {}
  for (const [chatId, view] of Object.entries(state.views)) {
    if (open.has(chatId)) views[chatId] = view
    else dropItems(view.turnItems)
  }
  return views
}

function dropItems(turnItems: Record<string, string[]>): void {
  for (const ids of Object.values(turnItems)) for (const id of ids) items.delete(id)
}

/**
 * A kept chat cut back to its newest page as it comes back on screen, so returning to it costs
 * the same however far up it was read. Not while another pane shows it, which would lose its place.
 */
function newestPage(view: ChatView): ChatView {
  if (view.turns.length <= TURN_PAGE) return view
  const turns = view.turns.slice(-TURN_PAGE)
  const kept = new Set(turns.map((turn) => turn.id))
  const turnItems: Record<string, string[]> = {}
  for (const [turnId, ids] of Object.entries(view.turnItems)) {
    if (kept.has(turnId)) turnItems[turnId] = ids
    else dropItems({ [turnId]: ids })
  }
  return { ...view, turns, turnItems, hasOlder: true }
}

/** What `chat.open` gave for a chat; without one, the chat's kept view is shown. */
type Page = { turns: Turn[]; items: Item[]; queued: QueuedMessage[]; hasOlder: boolean }

function showChat(pane: number, chatId: string | null, page?: Page): void {
  linkRequest++
  setState({ artifact: null })
  const running = new Set(state.running)
  for (const turn of page?.turns ?? []) if (turn.status === 'running') running.add(turn.chatId)
  const current = paneAt(state, pane)
  const tabs = chatId && !current.tabs.includes(chatId) ? [...current.tabs, chatId] : current.tabs
  const panes = state.panes.map((entry, index) => (index === pane ? { ...entry, chatId, tabs, restored: null, ...selectionFor(chatId) } : entry))
  const views = pruneViews(panes)
  if (chatId && page) {
    // A fresh snapshot replaces whatever another pane loaded of the same chat; it is the newer.
    if (views[chatId]) dropItems(views[chatId].turnItems)
    const turnItems: Record<string, string[]> = {}
    for (const item of page.items) {
      items.set(item.id, item)
      ;(turnItems[item.turnId] ??= []).push(item.id)
    }
    views[chatId] = { turns: page.turns, turnItems, queued: page.queued, planTurnId: null, hasOlder: page.hasOlder }
  } else if (chatId && views[chatId] && !state.panes.some((entry, index) => index !== pane && entry.chatId === chatId)) {
    views[chatId] = newestPage(views[chatId])
  }
  setState({ panes, views, running })
  savePanes()
  // Coming back to a chat whose turn is still planning shows the plan again, as it did when it started.
  const planning = chatId ? views[chatId]?.turns.findLast((turn) => turn.status === 'running' && items.has(planItemId(turn.id))) : undefined
  if (chatId && planning) openPlanIfNew(chatId, planning.id)
}

/** The drawer opens itself for a running turn's plan, once per chat, until the user closes it there. */
function openPlanIfNew(chatId: string, turnId: string): void {
  const view = state.views[chatId]
  if (!view || view.planTurnId !== null || readPrefs().planClosed?.[chatId]) return
  if (view.turns.find((turn) => turn.id === turnId)?.status !== 'running') return
  patchView(chatId, { planTurnId: turnId })
}

/** Show a turn's plan beside its chat, or close the drawer; closing is remembered for that chat. */
export function togglePlan(chatId: string, turnId: string): void {
  if (viewOf(state, chatId).planTurnId === turnId) {
    closePlan(chatId)
    return
  }
  const { [chatId]: _reopened, ...planClosed } = readPrefs().planClosed ?? {}
  writePrefs({ planClosed })
  patchView(chatId, { planTurnId: turnId })
}

export function closePlan(chatId: string): void {
  writePrefs({ planClosed: { ...readPrefs().planClosed, [chatId]: true } })
  patchView(chatId, { planTurnId: null })
}

function setTabs(pane: number, tabs: string[]): void {
  patchPane(pane, { tabs })
  // A tab closed in the background lets its chat go.
  setState({ views: pruneViews(state.panes) })
  savePanes()
}

function fail(error: unknown): void {
  setState({ error: error instanceof Error ? error.message : String(error) })
}

export function dismissError(): void {
  setState({ error: null })
}

/** Show a chat (or the new-chat screen) in a pane; the focused one unless said otherwise. */
export async function openChat(chatId: string | null, pane: number = state.focused): Promise<void> {
  if (chatId === null) {
    showChat(pane, null)
    return
  }
  // A chat open as a tab is kept current by live events, so it is shown as it stands.
  if (state.views[chatId]) {
    showChat(pane, chatId)
    return
  }
  try {
    const snapshot = await call('chat.open', { chatId })
    showChat(pane, chatId, { turns: snapshot.turns, items: snapshot.items, queued: snapshot.queued ?? [], hasOlder: snapshot.hasOlder })
  } catch (error) {
    setTabs(pane, paneAt(state, pane).tabs.filter((id) => id !== chatId))
    showChat(pane, null)
    fail(error)
  }
}

/**
 * Close a chat's tab in a pane. The chat stays in the history; closing the open one moves to its
 * neighbour. A pane whose last tab closes goes away, unless it is the only pane: that one shows
 * the new-chat screen instead.
 */
export function closeTab(chatId: string, pane: number): void {
  const current = paneAt(state, pane)
  const index = current.tabs.indexOf(chatId)
  if (index === -1) return
  const tabs = current.tabs.filter((id) => id !== chatId)
  if (tabs.length === 0 && state.panes.length > 1) {
    closePane(pane)
    return
  }
  setTabs(pane, tabs)
  if (current.chatId === chatId) void openChat(tabs[index] ?? tabs[index - 1] ?? null, pane)
}

// ── Panes ─────────────────────────────────────────────────────────────

export function focusPane(pane: number): void {
  if (pane === state.focused || !state.panes[pane]) return
  setState({ focused: pane })
  savePanes()
}

/** Add a pane after the one asked from, showing the new-chat screen, and give it the focus. */
export function addPane(after: number = state.focused): void {
  if (state.panes.length >= MAX_PANES) return
  const panes = [...state.panes]
  const at = Math.min(after + 1, panes.length)
  panes.splice(at, 0, newPane())
  setState({ panes, focused: at })
  savePanes()
}

/** Close a pane; the others take its room. The only pane cannot close. */
export function closePane(pane: number): void {
  if (state.panes.length <= 1 || !state.panes[pane]) return
  const panes = state.panes.filter((_, index) => index !== pane)
  const focused = state.focused > pane || state.focused >= panes.length ? Math.max(0, state.focused - 1) : state.focused
  setState({ panes, views: pruneViews(panes), focused })
  savePanes()
}

// ── Sending ───────────────────────────────────────────────────────────

/** Send in a pane's chat, creating one first when the composer is on the new-chat screen. */
export async function send(pane: number, text: string, attachments: Attachment[] = []): Promise<boolean> {
  try {
    const current = paneAt(state, pane)
    let chatId = current.chatId
    if (!chatId) {
      const chat = await call('chat.create', { cwd: state.defaultCwd })
      saveSelection(chat.id, { provider: current.provider, modelChoice: current.modelChoice })
      chatId = chat.id
    }
    await call('chat.send', { chatId, provider: current.provider, model: current.modelChoice[current.provider]?.id ?? null, text, attachmentIds: attachments.map(each => each.id) })
    updateDraft(current.chatId ?? `new:${current.key}`, { text: '', attachments: [], sending: false, error: null })
    const at = state.panes.findIndex(entry => entry.key === current.key && entry.chatId === current.chatId)
    if (!current.chatId && at >= 0) await openChat(chatId, at)
    return true
  } catch (error) {
    fail(error)
    return false
  }
}

/**
 * Have the host warm up the chosen provider for a pane's chat (or for the next new one), so the
 * message being typed does not wait on a cold start. Costs nothing to repeat.
 */
export function prepare(pane: number): void {
  const { chatId, provider, modelChoice } = paneAt(state, pane)
  if (!state.ready || (chatId && state.running.has(chatId))) return
  void call('chat.prepare', { chatId, cwd: state.defaultCwd, provider, model: modelChoice[provider]?.id ?? null }).catch(() => {})
}

/** Stop a pane's turn. Messages that were waiting on it come back to the composer. */
export function stop(pane: number): void {
  const chatId = chatIdOf(state, pane)
  if (!chatId) return
  void call('chat.stop', { chatId })
    .then((withdrawn) => { if (withdrawn) restore(pane, withdrawn, chatId) })
    .catch(fail)
}

/** Stop a pane's turn and send what was waiting on it straight away. */
export function sendNow(pane: number): void {
  const chatId = chatIdOf(state, pane)
  if (chatId) void call('chat.stop', { chatId, sendQueued: true }).catch(fail)
}

/** Take a waiting message back into the composer. */
export function editQueued(pane: number, id: string): void {
  const chatId = chatIdOf(state, pane)
  if (!chatId) return
  void call('chat.unqueue', { chatId, id }).then((text) => restore(pane, text, chatId)).catch(fail)
}

function restore(pane: number, message: string | MessageDraft, chatId: string): void {
  restoreDraft(chatId, message)
  if (state.panes[pane]?.chatId === chatId) patchPane(pane, { restored: { text: '', at: Date.now() } })
}

/** Answer a question a model asked in a pane's chat; the provider picked in its composer takes the reply. */
export async function answerQuestion(pane: number, itemId: string, answer: string): Promise<void> {
  const { chatId, provider, modelChoice } = paneAt(state, pane)
  if (!chatId) return
  try {
    await call('question.answer', { chatId, itemId, answer, provider, model: modelChoice[provider]?.id ?? null })
  } catch (error) {
    fail(error)
  }
}

export function deleteChat(chatId: string): void {
  void call('chat.delete', { chatId }).catch(fail)
}

export function setProvider(pane: number, provider: ProviderId): void {
  const current = paneAt(state, pane)
  patchPane(pane, { provider })
  saveSelection(current.chatId, { provider, modelChoice: current.modelChoice })
}

/** Pick a provider's model, or null to go back to that provider's default. Also selects the provider. */
export function selectModel(pane: number, provider: ProviderId, model: ModelInfo | null): void {
  const current = paneAt(state, pane)
  const modelChoice = { ...current.modelChoice }
  if (model) modelChoice[provider] = { id: model.id, label: model.label }
  else delete modelChoice[provider]
  patchPane(pane, { provider, modelChoice })
  saveSelection(current.chatId, { provider, modelChoice })
}

const modelLoads = new Map<ProviderId, Promise<void>>()

/** Read a provider's models once per session; a failed read can be tried again. */
export function loadModels(provider: ProviderId): Promise<void> {
  let load = modelLoads.get(provider)
  if (!load) {
    load = call('models.list', { provider }).then((models) => {
      setState({ models: { ...state.models, [provider]: models } })
      // Drops a remembered model the provider no longer offers; other chats drop theirs when shown.
      setState({ panes: state.panes.map((pane) => ({ ...pane, modelChoice: selectionFor(pane.chatId).modelChoice })) })
    }).catch(() => {
      modelLoads.delete(provider)
      setState({ models: { ...state.models, [provider]: [] } })
    })
    modelLoads.set(provider, load)
  }
  return load
}

export function setSideWidth(sideWidth: number, save: boolean): void {
  setState({ sideWidth })
  if (save) writePrefs({ sideWidth })
}

export function setBrowserWidth(browserWidth: number | null, save: boolean): void {
  setState({ browserWidth })
  if (save) writePrefs({ browserWidth })
}

/**
 * One reading speed everywhere. Main keeps the browser's (it scrolls web pages), so a change made
 * here is passed on to it, and one made there (Alt+↑/↓ in a page) comes back through `fromBrowser`.
 */
export function setReadingSpeed(speed: number, fromBrowser = false): void {
  const readingSpeed = clampSpeed(speed)
  if (readingSpeed === state.readingSpeed) return
  setState({ readingSpeed })
  writePrefs({ readingSpeed })
  if (!fromBrowser) window.rocket.browser.send({ type: 'readingSpeed', speed: readingSpeed })
}

export function patchToolbar(patch: Partial<ToolbarPrefs>): void {
  const toolbar = { ...state.toolbar, ...patch }
  setState({ toolbar })
  writePrefs({ toolbar })
}

/** Back to every section in the drawer under its own name, leaving the drawer as it stands. */
export function resetToolbar(): void {
  patchToolbar({ ...DEFAULT_TOOLBAR, open: state.toolbar.open })
}

/** The side panel the toolbar shows as on: an artifact covers them all. */
export function sideShown(state: AppState): 'library' | 'browser' | null {
  if (state.artifact) return null
  if (state.libraryOpen) return 'library'
  return state.browserOpen ? 'browser' : null
}

export function setBrowserOpen(browserOpen: boolean): void {
  linkRequest++
  const libraryOpen = browserOpen ? false : state.libraryOpen
  setState({ browserOpen, libraryOpen, artifact: null })
  writePrefs({ browserOpen, libraryOpen })
}

// ── Library ───────────────────────────────────────────────────────────

/** Show or hide the library beside the chat; it takes the side from the browser. */
export function setLibraryOpen(libraryOpen: boolean): void {
  linkRequest++
  const others = libraryOpen ? { browserOpen: false } : {}
  setState({ libraryOpen, ...others, artifact: null })
  writePrefs({ libraryOpen, ...others })
  if (libraryOpen && !state.library.loaded) void loadLibrary()
}

export function patchLibrary(patch: Partial<LibraryState>): void {
  setState({ library: { ...state.library, ...patch } })
  if (patch.view) writePrefs({ libraryView: patch.view })
}

/** Read the shelf from the host. Card pictures of files that changed are asked for again. */
export async function loadLibrary(): Promise<void> {
  try {
    const entries = await call('library.list', {})
    const kept = new Set(entries.map((entry) => `${entry.id}:${entry.size}`))
    const previous = new Map(state.library.entries.map((entry) => [entry.id, `${entry.id}:${entry.size}`]))
    const previews = Object.fromEntries(Object.entries(state.library.previews).filter(([id]) => previous.has(id) && kept.has(previous.get(id)!)))
    patchLibrary({ entries, previews, loaded: true, error: null })
  } catch (error) {
    patchLibrary({ loaded: true, error: error instanceof Error ? error.message : 'The library could not be read. Close it and open it again.' })
  }
}

let libraryTimer: ReturnType<typeof setTimeout> | null = null
/** Several files often arrive together at a turn's end; the shelf is read once for them. */
function scheduleLibraryLoad(): void {
  if (libraryTimer) clearTimeout(libraryTimer)
  libraryTimer = setTimeout(() => { libraryTimer = null; void loadLibrary() }, 250)
}

/** Ask for a card's picture once; the grid calls this as a card scrolls into view. */
export async function loadLibraryPreview(id: string): Promise<void> {
  if (id in state.library.previews) return
  patchLibrary({ previews: { ...state.library.previews, [id]: null } })
  let preview: LibraryPreview
  try {
    preview = await call('library.preview', { id })
  } catch {
    preview = { type: 'none' }
  }
  patchLibrary({ previews: { ...state.library.previews, [id]: preview } })
}

/** Open a library file in the side panel, over the library; closing it brings the library back. */
export async function openLibraryEntry(id: string): Promise<void> {
  const entry = state.library.entries.find((each) => each.id === id)
  if (!entry) throw new Error(`There is no library file "${id}". Its id may have changed; list the library again.`)
  const request = ++linkRequest
  patchLibrary({ selected: id })
  setState({ artifact: { kind: 'library', entry, view: null, error: null } })
  try {
    const view = await call('library.view', { id })
    if (request === linkRequest) setState({ artifact: { kind: 'library', entry, view, error: null } })
  } catch (error) {
    if (request === linkRequest) setState({ artifact: { kind: 'library', entry, view: null, error: error instanceof Error ? error.message : 'This file could not be shown. Open the library again.' } })
  }
}

/**
 * Fetch the output a page left out of a finished tool call (`outputLength`), when its step is
 * opened. The row re-renders with it; a call that has since gone keeps showing none.
 */
export async function loadOutput(chatId: string, itemId: string): Promise<void> {
  const item = items.get(itemId)
  if (item?.type !== 'tool' || !item.outputLength || item.output) return
  try {
    const output = await call('item.output', { chatId, itemId })
    const current = items.get(itemId)
    if (current?.type !== 'tool') return
    const { outputLength: _left, ...rest } = current
    items.set(itemId, { ...rest, output })
    notifyItem(itemId)
  } catch (error) {
    fail(error)
  }
}

/** Chats whose earlier turns are on their way, so a scroll that fires twice asks once. */
const loadingOlder = new Set<string>()

/**
 * Bring in the turns before the first one a shown chat has loaded, as its reader scrolls up.
 * They go in front of what is there; a chat that was closed or reopened meanwhile keeps its own.
 */
export async function loadOlder(chatId: string): Promise<void> {
  const view = state.views[chatId]
  const first = view?.turns[0]
  if (!view?.hasOlder || !first || loadingOlder.has(chatId)) return
  loadingOlder.add(chatId)
  try {
    const page = await call('chat.older', { chatId, before: first.id })
    const current = state.views[chatId]
    if (current?.turns[0]?.id !== first.id) return
    const turnItems: Record<string, string[]> = {}
    for (const item of page.items) {
      items.set(item.id, item)
      ;(turnItems[item.turnId] ??= []).push(item.id)
    }
    // The page's lists are whole; anything held for those turns was only what live events brought.
    patchView(chatId, { turns: [...page.turns, ...current.turns], turnItems: { ...current.turnItems, ...turnItems }, hasOlder: page.hasOlder })
  } catch (error) {
    fail(error)
  } finally {
    loadingOlder.delete(chatId)
  }
}

/** The current state without subscribing, for the dispatcher. */
export function peekState(): AppState {
  return state
}

/** Choose the folder a pane's chat works in, or the folder new chats start in. */
export async function chooseFolder(pane: number): Promise<void> {
  const chat = state.chats.find((entry) => entry.id === chatIdOf(state, pane))
  const picked = await window.rocket.pickFolder(chat?.cwd ?? state.defaultCwd)
  if (!picked) return
  writePrefs({ cwd: picked })
  setState({ defaultCwd: picked })
  if (chat) await call('chat.setCwd', { chatId: chat.id, cwd: picked }).catch(fail)
}

export function refreshUsage(provider: ProviderId, force = false): Promise<void> {
  return call('usage.read', { provider, force })
    .then((snapshot) => setState({ usage: { ...state.usage, [provider]: snapshot } }))
    .catch(() => {})
}

/** The panes as they were last time, keeping only chats that still exist; a profile from before panes becomes one pane. */
function savedPanes(saved: Prefs, chats: Chat[]): { panes: Pane[]; focused: number } {
  const exists = (id: string | null): id is string => id !== null && chats.some((chat) => chat.id === id)
  const entries = saved.panes ?? [{ chatId: saved.activeChatId ?? null, tabs: saved.tabs ?? [] }]
  nextPaneKey = Math.max(nextPaneKey, ...entries.map(entry => ('key' in entry && typeof entry.key === 'number' ? entry.key : 0) + 1))
  const panes = entries.slice(0, MAX_PANES).map((entry) => {
    const pane = newPane(exists(entry.chatId) ? entry.chatId : null, entry.tabs.filter(exists))
    if ('key' in entry && typeof entry.key === 'number') pane.key = entry.key
    return pane
  })
  if (panes.length === 0) panes.push(newPane())
  return { panes, focused: Math.min(Math.max(0, saved.focused ?? 0), panes.length - 1) }
}

async function load(): Promise<void> {
  try {
    const [chats, orchestrations] = await Promise.all([call('chats.list', {}), call('orchestrator.list', {})])
    setState({ orchestrations: Object.fromEntries(orchestrations.map(run => [run.chatId, run])) })
    const saved = readPrefs()
    setState({ ready: true, chats: sortChats(chats) })
    const { panes, focused } = savedPanes(saved, chats)
    items.clear()
    setState({ panes, focused, views: {} })
    savePanes()
    collectAttachments()
    await Promise.all(panes.map((pane, index) => (pane.chatId ? openChat(pane.chatId, index) : Promise.resolve())))
  } catch (error) {
    setState({ ready: true })
    fail(error)
  }
  // The warm-up is asked for ahead of the usage readings, so a provider that can answer those
  // from the process being warmed does not start another for them.
  state.panes.forEach((_, index) => prepare(index))
  for (const provider of PROVIDERS) refreshUsage(provider.id)
}

export function start(): void {
  connectHost({
    events: applyEvents,
    // A restarted host has lost its live turns; read everything again from the store.
    reconnect: () => {
      modelLoads.clear()
      setState({ running: new Set(), models: {} })
      void load()
    }
  })
  void load()
  // Some readings start a provider's CLI, so none are taken for a window nobody is looking at.
  const refreshAll = (): void => {
    if (!document.hidden) for (const provider of PROVIDERS) refreshUsage(provider.id)
  }
  setInterval(refreshAll, 5 * 60_000)
  document.addEventListener('visibilitychange', refreshAll)
  // Something handed to a running app from the command line opens as a chat link would.
  window.rocket.onOpen(({ href, cwd }) => void openChatLink(href, cwd))
}

// A later click or pane close wins over an earlier file read that is still in flight.
let linkRequest = 0

export function closeArtifact(): void {
  linkRequest++
  setState({ artifact: null })
}

/** Show what a turn of a pane's chat changed, beside the conversation. */
export async function openTurnChanges(pane: number, turnId: string): Promise<void> {
  const chatId = chatIdOf(state, pane)
  if (!chatId) return
  const request = ++linkRequest
  try {
    const patch = await call('turn.changes', { chatId, turnId })
    if (request !== linkRequest) return
    if (!patch) throw new Error('The changes of this turn are no longer available.')
    setState({ artifact: { kind: 'changes', chatId, turnId, patch } })
  } catch (error) {
    if (request === linkRequest) fail(error)
  }
}

/** Show an attached file beside the conversation, the way a link opens one. */
export async function openAttachment(attachment: FileAttachment): Promise<void> {
  const request = ++linkRequest
  setState({ artifact: { kind: 'attachment', attachment, preview: null, error: null } })
  try {
    const preview = await call('attachment.preview', { id: attachment.id })
    if (request === linkRequest) setState({ artifact: { kind: 'attachment', attachment, preview, error: null } })
  } catch (error) {
    if (request === linkRequest) setState({ artifact: { kind: 'attachment', attachment, preview: null, error: error instanceof Error ? error.message : 'This file could not be previewed. Attach it again.' } })
  }
}

/** Put a turn's files back as they were before it. The panel stays on the (now dimmed) diff. */
export async function undoTurn(chatId: string, turnId: string): Promise<void> {
  try {
    await call('turn.undo', { chatId, turnId })
    const view = state.artifact
    if (view?.kind === 'changes' && view.turnId === turnId) {
      setState({ artifact: { ...view, patch: { ...view.patch, undo: { offered: false, reason: 'Already undone.' } } } })
    }
  } catch (error) {
    fail(error)
  }
}

/** Open a link from a chat; without a folder of its own it resolves against the focused pane's. */
export async function openChatLink(href: string, cwd?: string): Promise<void> {
  const request = ++linkRequest
  const folder = cwd ?? cwdOf(state, state.focused)
  try {
    const target = await window.rocket.openChatLink(href, folder)
    if (request !== linkRequest) return
    if (target.kind === 'browser') {
      setState({ artifact: null, browserOpen: true })
      writePrefs({ browserOpen: true })
      window.rocket.browser.send({ type: 'newTab', url: target.url })
    } else {
      setState({ artifact: target })
      void call('library.add', { path: target.path, chatId: chatIdOf(state, state.focused) }).catch(() => {})
    }
  } catch (error) {
    if (request === linkRequest) fail(error)
  }
}

/** Refresh a visible progress file without navigating away from the user's current panel. */
async function refreshOrchestratorArtifact(path: string): Promise<void> {
  const current = state.artifact
  if (current?.kind === 'library' && current.entry.path === path) {
    try {
      const view = await call('library.view', { id: current.entry.id })
      if (state.artifact === current) setState({ artifact: { ...current, view } })
    } catch { /* Reopening retries a failed preview. */ }
    return
  }
  if (current?.kind !== 'artifact' || current.path !== path) return
  try {
    const target = await window.rocket.openChatLink(path, path.slice(0, path.lastIndexOf('/')))
    if (target.kind === 'artifact' && state.artifact === current) setState({ artifact: target })
  } catch { /* The next progress event or reopening retries the preview. */ }
}
