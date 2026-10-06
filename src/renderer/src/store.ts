import { useSyncExternalStore } from 'react'
import type { ChatLinkTarget, Chat, Goal, GoalEdit, HostEvent, Item, ModelInfo, ProviderId, QueuedMessage, Turn, TurnPatch, UsageSnapshot } from '../../shared/types.ts'

export type ArtifactView =
  | Extract<ChatLinkTarget, { kind: 'artifact' }>
  | { kind: 'changes'; chatId: string; turnId: string; patch: TurnPatch }
import { PROVIDERS, planItemId, providerLabel } from '../../shared/types.ts'
import { call, connectHost } from './host.ts'

// Client state. Two kinds of subscription keep a fast token stream cheap: components that care
// about structure (which chats, which turns, which items exist) read `useApp`, and each
// transcript row reads its own item with `useItem`. A text delta therefore re-renders exactly
// one row, never the list around it.
//
// The chat card holds one to four panes, each a whole chat with its own tabs and composer. What
// a pane shows is in `panes`; what a shown chat holds (its turns, their items, what is waiting)
// is in `views`, keyed by chat, so two panes on the same chat share one copy. Every action that
// means "in this chat" takes the pane it was asked in; the rail acts on the focused pane.

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
}

const EMPTY_VIEW: ChatView = { turns: [], turnItems: {}, queued: [], planTurnId: null }

export type AppState = {
  ready: boolean
  chats: Chat[]
  panes: Pane[]
  /** The pane the user last worked in: where the rail opens chats, and whose chat the rail marks. */
  focused: number
  /** Each chat on screen, keyed by chat id. */
  views: Record<string, ChatView>
  /** Chats with a turn in flight, including ones not on screen. */
  running: ReadonlySet<string>
  usage: Partial<Record<ProviderId, UsageSnapshot>>
  /** Each provider's models, once read. A provider absent here has not been asked yet. */
  models: Partial<Record<ProviderId, ModelInfo[]>>
  /** What the panel beside the chat shows: a file a link opened, or what a turn changed. */
  artifact: ArtifactView | null
  browserOpen: boolean
  /** Whether the rail stands open at its full width, or is folded to a strip that peeks on hover. */
  railOpen: boolean
  /** Every goal, newest first. A goal's chat is an ordinary chat with the goal beside it. */
  goals: Goal[]
  /** Whether the goal shows beside its chat; hiding it does not stop the goal. */
  goalPaneOpen: boolean
  /** The goal side's width, in pixels. */
  goalWidth: number
  /** The new-goal dialog: closed, describing, or following the goal it drafted. */
  newGoal: { goalId: string | null } | null
  /** The folder a new chat starts in: the last one the user chose, or their home folder. */
  defaultCwd: string
  error: string | null
}

export type ModelChoices = Partial<Record<ProviderId, { id: string; label: string }>>

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
  railOpen?: boolean
  goalPaneOpen?: boolean
  goalWidth?: number
  /** Chats whose plan drawer the user closed; it no longer opens by itself there. */
  planClosed?: Record<string, true>
  /** The panes as they were, in order, and which one had the focus. */
  panes?: { chatId: string | null; tabs: string[] }[]
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
  usage: {},
  models: {},
  browserOpen: prefs.browserOpen === true,
  railOpen: prefs.railOpen !== false,
  goals: [],
  goalPaneOpen: prefs.goalPaneOpen !== false,
  goalWidth: prefs.goalWidth ?? 400,
  newGoal: null,
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

/** The chat the focused pane shows: what the rail means by "the open chat". */
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
  writePrefs({ panes: state.panes.map((pane) => ({ chatId: pane.chatId, tabs: pane.tabs })), focused: state.focused })
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
        if (view) {
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
        setState({ chats: state.chats.filter((chat) => chat.id !== event.chatId), goals: state.goals.filter((goal) => goal.chatId !== event.chatId) })
        forgetSelection(event.chatId)
        // Closing a pane shifts the ones after it, so the panes are walked from the end.
        for (let index = state.panes.length - 1; index >= 0; index--) {
          if (state.panes[index]!.tabs.includes(event.chatId)) closeTab(event.chatId, index)
        }
        break
      case 'usage':
        setState({ usage: { ...state.usage, [event.snapshot.provider]: event.snapshot } })
        break
      case 'goal':
        putGoal(event.goal)
        break
      case 'queue':
        if (state.views[event.chatId]) patchView(event.chatId, { queued: event.queued })
        break
    }
  }
}

// ── Showing chats ─────────────────────────────────────────────────────

/** Drop the views no pane shows any more, and the items that were theirs. */
function pruneViews(panes: Pane[]): Record<string, ChatView> {
  const shown = new Set(panes.map((pane) => pane.chatId))
  const views: Record<string, ChatView> = {}
  for (const [chatId, view] of Object.entries(state.views)) {
    if (shown.has(chatId)) views[chatId] = view
    else for (const ids of Object.values(view.turnItems)) for (const id of ids) items.delete(id)
  }
  return views
}

function showChat(pane: number, chatId: string | null, turns: Turn[] = [], loaded: Item[] = [], queued: QueuedMessage[] = []): void {
  linkRequest++
  setState({ artifact: null })
  const running = new Set(state.running)
  for (const turn of turns) if (turn.status === 'running') running.add(turn.chatId)
  const current = paneAt(state, pane)
  const tabs = chatId && !current.tabs.includes(chatId) ? [...current.tabs, chatId] : current.tabs
  const panes = state.panes.map((entry, index) => (index === pane ? { ...entry, chatId, tabs, restored: null, ...selectionFor(chatId) } : entry))
  const views = pruneViews(panes)
  if (chatId) {
    // A fresh snapshot replaces whatever another pane loaded of the same chat; it is the newer.
    const turnItems: Record<string, string[]> = {}
    for (const item of loaded) {
      items.set(item.id, item)
      ;(turnItems[item.turnId] ??= []).push(item.id)
    }
    views[chatId] = { turns, turnItems, queued, planTurnId: null }
  }
  setState({ panes, views, running })
  savePanes()
  // Coming back to a chat whose turn is still planning shows the plan again, as it did when it started.
  const planning = turns.findLast((turn) => turn.status === 'running' && items.has(planItemId(turn.id)))
  if (chatId && planning) openPlanIfNew(chatId, planning.id)
}

/** The drawer opens itself for a running turn's plan, once per chat, until the user closes it there. */
function openPlanIfNew(chatId: string, turnId: string): void {
  const view = state.views[chatId]
  if (!view || view.planTurnId !== null || readPrefs().planClosed?.[chatId]) return
  if (goalOf(chatId)) return
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
  try {
    const snapshot = await call('chat.open', { chatId })
    showChat(pane, chatId, snapshot.turns, snapshot.items, snapshot.queued)
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
export async function send(pane: number, text: string): Promise<void> {
  try {
    const current = paneAt(state, pane)
    let chatId = current.chatId
    if (!chatId) {
      const chat = await call('chat.create', { cwd: state.defaultCwd })
      saveSelection(chat.id, { provider: current.provider, modelChoice: current.modelChoice })
      showChat(pane, chat.id)
      chatId = chat.id
    }
    await call('chat.send', { chatId, provider: current.provider, model: current.modelChoice[current.provider]?.id ?? null, text })
  } catch (error) {
    fail(error)
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
    .then((withdrawn) => { if (withdrawn) restore(pane, withdrawn) })
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
  void call('chat.unqueue', { chatId, id }).then((text) => restore(pane, text)).catch(fail)
}

function restore(pane: number, text: string): void {
  patchPane(pane, { restored: { text, at: Date.now() } })
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

// ── Goals ─────────────────────────────────────────────────────────────

/** A goal changed. When it finishes or needs the user, the desktop says so if the window is not in front. */
function putGoal(goal: Goal): void {
  const before = state.goals.find((entry) => entry.id === goal.id)
  setState({ goals: [goal, ...state.goals.filter((entry) => entry.id !== goal.id)].sort((a, b) => b.createdAt - a.createdAt) })
  if (!before || before.status === goal.status || !document.hidden && document.hasFocus()) return
  const body = goal.status === 'done' ? `Done: ${goal.title}`
    : goal.status === 'needs_you' ? `${goal.title}: ${goal.reason ?? 'needs you'}`
    : goal.status === 'confirming' ? `Check the plan for: ${goal.title}`
    : null
  if (!body) return
  try {
    const notice = new Notification('Rocket', { body, silent: false })
    notice.onclick = () => {
      window.focus()
      void openChat(goal.chatId)
    }
  } catch {
    // Notifications are a courtesy.
  }
}

export function goalOf(chatId: string | null): Goal | null {
  return chatId ? state.goals.find((goal) => goal.chatId === chatId) ?? null : null
}

export function openNewGoal(): void {
  setState({ newGoal: { goalId: null } })
}

export function closeNewGoal(): void {
  setState({ newGoal: null })
}

/** Have the focused pane's provider draft a goal from what the user wrote, in a chat of its own. */
export async function draftGoal(text: string, cwd: string): Promise<void> {
  try {
    const { provider, modelChoice } = paneAt(state, state.focused)
    const goal = await call('goal.draft', { cwd, text, provider, model: modelChoice[provider]?.id ?? null })
    putGoal(goal)
    saveSelection(goal.chatId, { provider, modelChoice })
    writePrefs({ cwd })
    setState({ defaultCwd: cwd, newGoal: { goalId: goal.id }, goalPaneOpen: true })
    void openChat(goal.chatId)
  } catch (error) {
    fail(error)
  }
}

async function goalCall(run: () => Promise<Goal>): Promise<boolean> {
  try {
    putGoal(await run())
    return true
  } catch (error) {
    fail(error)
    return false
  }
}

export function updateGoal(goalId: string, edit: GoalEdit): Promise<boolean> {
  return goalCall(() => call('goal.update', { goalId, edit }))
}

/** Save the brief as confirmed, then start the work. */
export async function startGoal(goalId: string, edit: GoalEdit): Promise<void> {
  if (!await updateGoal(goalId, edit)) return
  if (await goalCall(() => call('goal.start', { goalId }))) closeNewGoal()
}

export function pauseGoal(goalId: string): void { void goalCall(() => call('goal.pause', { goalId })) }
export function resumeGoal(goalId: string): void { void goalCall(() => call('goal.resume', { goalId })) }
export function stopGoal(goalId: string): void { void goalCall(() => call('goal.stop', { goalId })) }
export function steerGoal(goalId: string, text: string): Promise<boolean> { return goalCall(() => call('goal.steer', { goalId, text })) }

export function setGoalPaneOpen(goalPaneOpen: boolean): void {
  setState({ goalPaneOpen })
  writePrefs({ goalPaneOpen })
}

export function setGoalWidth(goalWidth: number, save: boolean): void {
  setState({ goalWidth })
  if (save) writePrefs({ goalWidth })
}

export function agentLabel(agent: { provider: ProviderId }): string {
  return providerLabel(agent.provider)
}

export function setRailOpen(railOpen: boolean): void {
  setState({ railOpen })
  writePrefs({ railOpen })
}

export function setBrowserOpen(browserOpen: boolean): void {
  linkRequest++
  setState({ browserOpen, artifact: null })
  writePrefs({ browserOpen })
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
  const panes = entries.slice(0, MAX_PANES).map((entry) => newPane(exists(entry.chatId) ? entry.chatId : null, entry.tabs.filter(exists)))
  if (panes.length === 0) panes.push(newPane())
  return { panes, focused: Math.min(Math.max(0, saved.focused ?? 0), panes.length - 1) }
}

async function load(): Promise<void> {
  try {
    const [chats, goals] = await Promise.all([call('chats.list', {}), call('goals.list', {})])
    setState({ goals })
    const saved = readPrefs()
    setState({ ready: true, chats: sortChats(chats) })
    const { panes, focused } = savedPanes(saved, chats)
    items.clear()
    setState({ panes, focused, views: {} })
    savePanes()
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
    }
  } catch (error) {
    if (request === linkRequest) fail(error)
  }
}
