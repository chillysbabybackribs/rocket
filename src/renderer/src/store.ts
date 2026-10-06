import { useSyncExternalStore } from 'react'
import type { ChatLinkTarget, Chat, Goal, GoalEdit, HostEvent, Item, ModelInfo, ProviderId, QueuedMessage, Turn, TurnPatch, UsageSnapshot } from '../../shared/types.ts'

export type ArtifactView =
  | Extract<ChatLinkTarget, { kind: 'artifact' }>
  | { kind: 'changes'; chatId: string; turnId: string; patch: TurnPatch }
import { PROVIDERS, providerLabel } from '../../shared/types.ts'
import { call, connectHost } from './host.ts'

// Client state. Two kinds of subscription keep a fast token stream cheap: components that care
// about structure (which chats, which turns, which items exist) read `useApp`, and each
// transcript row reads its own item with `useItem`. A text delta therefore re-renders exactly
// one row, never the list around it.

export type AppState = {
  ready: boolean
  chats: Chat[]
  activeChatId: string | null
  /** The chats open as tabs over the composer, in the order they were opened. */
  tabs: string[]
  turns: Turn[]
  /** turnId → its item ids, in order. */
  turnItems: Record<string, string[]>
  /** Chats with a turn in flight, including ones not on screen. */
  running: ReadonlySet<string>
  /** The open chat's messages waiting for its turn in flight to end. */
  queued: QueuedMessage[]
  /** Text handed back to the composer (a waiting message taken back); `at` tells one hand-back from the next. */
  restored: { text: string; at: number } | null
  usage: Partial<Record<ProviderId, UsageSnapshot>>
  /** The provider chosen in the open chat, or on the empty screen for the next new one. */
  provider: ProviderId
  /** Each provider's models, once read. A provider absent here has not been asked yet. */
  models: Partial<Record<ProviderId, ModelInfo[]>>
  /** The model chosen per provider, in the same place; a provider absent here runs its own default. */
  modelChoice: ModelChoices
  /** What the panel beside the chat shows: a file a link opened, or what a turn changed. */
  artifact: ArtifactView | null
  browserOpen: boolean
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
  goalPaneOpen?: boolean
  goalWidth?: number
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
  const { [chatId]: _gone, ...selections } = readPrefs().selections ?? {}
  writePrefs({ selections })
}

let state: AppState = {
  artifact: null,
  ready: false,
  chats: [],
  activeChatId: null,
  tabs: [],
  turns: [],
  turnItems: {},
  running: new Set(),
  queued: [],
  restored: null,
  usage: {},
  provider: PROVIDERS.some((provider) => provider.id === prefs.provider) ? prefs.provider! : 'claude',
  models: {},
  modelChoice: prefs.modelChoice ?? {},
  browserOpen: prefs.browserOpen === true,
  goals: [],
  goalPaneOpen: prefs.goalPaneOpen !== false,
  goalWidth: prefs.goalWidth ?? 400,
  newGoal: null,
  defaultCwd: prefs.cwd || window.rocket.homeDir,
  error: null
}
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

function sortChats(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt)
}

function putItem(item: Item): void {
  const known = items.has(item.id)
  items.set(item.id, item)
  if (known) {
    notifyItem(item.id)
    return
  }
  const list = state.turnItems[item.turnId] ?? []
  setState({ turnItems: { ...state.turnItems, [item.turnId]: [...list, item.id] } })
}

function applyEvents(events: HostEvent[]): void {
  for (const event of events) {
    switch (event.type) {
      case 'item':
        if (event.chatId === state.activeChatId) putItem(event.item)
        break
      case 'delta': {
        const item = event.chatId === state.activeChatId ? items.get(event.itemId) : undefined
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
        const patch: Partial<AppState> = { running }
        if (turn.chatId === state.activeChatId) {
          patch.turns = state.turns.some((entry) => entry.id === turn.id)
            ? state.turns.map((entry) => (entry.id === turn.id ? turn : entry))
            : [...state.turns, turn]
        }
        setState(patch)
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
        closeTab(event.chatId)
        break
      case 'usage':
        setState({ usage: { ...state.usage, [event.snapshot.provider]: event.snapshot } })
        break
      case 'goal':
        putGoal(event.goal)
        break
      case 'queue':
        if (event.chatId === state.activeChatId) setState({ queued: event.queued })
        break
    }
  }
}

function showChat(chatId: string | null, turns: Turn[] = [], loaded: Item[] = [], queued: QueuedMessage[] = []): void {
  linkRequest++
  setState({ artifact: null })
  items.clear()
  const turnItems: Record<string, string[]> = {}
  for (const item of loaded) {
    items.set(item.id, item)
    ;(turnItems[item.turnId] ??= []).push(item.id)
  }
  const running = new Set(state.running)
  for (const turn of turns) if (turn.status === 'running') running.add(turn.chatId)
  const tabs = chatId && !state.tabs.includes(chatId) ? [...state.tabs, chatId] : state.tabs
  setState({ activeChatId: chatId, tabs, turns, turnItems, running, queued, ...selectionFor(chatId) })
  writePrefs({ activeChatId: chatId, tabs })
}

function setTabs(tabs: string[]): void {
  setState({ tabs })
  writePrefs({ tabs })
}

function fail(error: unknown): void {
  setState({ error: error instanceof Error ? error.message : String(error) })
}

export function dismissError(): void {
  setState({ error: null })
}

export async function openChat(chatId: string | null): Promise<void> {
  if (chatId === null) {
    showChat(null)
    return
  }
  try {
    const snapshot = await call('chat.open', { chatId })
    showChat(chatId, snapshot.turns, snapshot.items, snapshot.queued)
  } catch (error) {
    setTabs(state.tabs.filter((id) => id !== chatId))
    showChat(null)
    fail(error)
  }
}

/** Close a chat's tab. The chat stays in the history; closing the open one moves to its neighbour. */
export function closeTab(chatId: string): void {
  const index = state.tabs.indexOf(chatId)
  if (index === -1) return
  const tabs = state.tabs.filter((id) => id !== chatId)
  setTabs(tabs)
  if (state.activeChatId === chatId) void openChat(tabs[index] ?? tabs[index - 1] ?? null)
}

/** Send in the open chat, creating one first when the composer is on the empty screen. */
export async function send(text: string): Promise<void> {
  try {
    let chatId = state.activeChatId
    if (!chatId) {
      const chat = await call('chat.create', { cwd: state.defaultCwd })
      saveSelection(chat.id, { provider: state.provider, modelChoice: state.modelChoice })
      showChat(chat.id)
      chatId = chat.id
    }
    await call('chat.send', { chatId, provider: state.provider, model: state.modelChoice[state.provider]?.id ?? null, text })
  } catch (error) {
    fail(error)
  }
}

/**
 * Have the host warm up the chosen provider for the open chat (or for the next new one), so the
 * message being typed does not wait on a cold start. Costs nothing to repeat.
 */
export function prepare(): void {
  const chatId = state.activeChatId
  if (!state.ready || (chatId && state.running.has(chatId))) return
  const model = state.modelChoice[state.provider]?.id ?? null
  void call('chat.prepare', { chatId, cwd: state.defaultCwd, provider: state.provider, model }).catch(() => {})
}

/** Stop the open chat's turn. Messages that were waiting on it come back to the composer. */
export function stop(): void {
  if (!state.activeChatId) return
  void call('chat.stop', { chatId: state.activeChatId })
    .then((withdrawn) => { if (withdrawn) restore(withdrawn) })
    .catch(fail)
}

/** Stop the open chat's turn and send what was waiting on it straight away. */
export function sendNow(): void {
  if (state.activeChatId) void call('chat.stop', { chatId: state.activeChatId, sendQueued: true }).catch(fail)
}

/** Take a waiting message back into the composer. */
export function editQueued(id: string): void {
  if (!state.activeChatId) return
  void call('chat.unqueue', { chatId: state.activeChatId, id }).then(restore).catch(fail)
}

function restore(text: string): void {
  setState({ restored: { text, at: Date.now() } })
}

/** Answer a question a model asked in the open chat; the provider picked in the composer takes the reply. */
export async function answerQuestion(itemId: string, answer: string): Promise<void> {
  const chatId = state.activeChatId
  if (!chatId) return
  try {
    await call('question.answer', { chatId, itemId, answer, provider: state.provider, model: state.modelChoice[state.provider]?.id ?? null })
  } catch (error) {
    fail(error)
  }
}

export function deleteChat(chatId: string): void {
  void call('chat.delete', { chatId }).catch(fail)
}

export function setProvider(provider: ProviderId): void {
  setState({ provider })
  saveSelection(state.activeChatId, { provider, modelChoice: state.modelChoice })
}

/** Pick a provider's model, or null to go back to that provider's default. Also selects the provider. */
export function selectModel(provider: ProviderId, model: ModelInfo | null): void {
  const modelChoice = { ...state.modelChoice }
  if (model) modelChoice[provider] = { id: model.id, label: model.label }
  else delete modelChoice[provider]
  setState({ provider, modelChoice })
  saveSelection(state.activeChatId, { provider, modelChoice })
}

const modelLoads = new Map<ProviderId, Promise<void>>()

/** Read a provider's models once per session; a failed read can be tried again. */
export function loadModels(provider: ProviderId): Promise<void> {
  let load = modelLoads.get(provider)
  if (!load) {
    load = call('models.list', { provider }).then((models) => {
      setState({ models: { ...state.models, [provider]: models } })
      // Drops a remembered model the provider no longer offers; other chats drop theirs when shown.
      setState({ modelChoice: selectionFor(state.activeChatId).modelChoice })
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

/** Have the chosen provider draft a goal from what the user wrote, in a chat of its own. */
export async function draftGoal(text: string, cwd: string): Promise<void> {
  try {
    const goal = await call('goal.draft', { cwd, text, provider: state.provider, model: state.modelChoice[state.provider]?.id ?? null })
    putGoal(goal)
    saveSelection(goal.chatId, { provider: state.provider, modelChoice: state.modelChoice })
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

export function setBrowserOpen(browserOpen: boolean): void {
  linkRequest++
  setState({ browserOpen, artifact: null })
  writePrefs({ browserOpen })
}

/** Choose the folder the open chat works in, or the folder new chats start in. */
export async function chooseFolder(): Promise<void> {
  const chat = state.chats.find((entry) => entry.id === state.activeChatId)
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

async function load(): Promise<void> {
  try {
    const [chats, goals] = await Promise.all([call('chats.list', {}), call('goals.list', {})])
    setState({ goals })
    const saved = readPrefs()
    setState({ ready: true, chats: sortChats(chats) })
    setTabs((saved.tabs ?? []).filter((id) => chats.some((chat) => chat.id === id)))
    const last = saved.activeChatId
    if (last && chats.some((chat) => chat.id === last)) await openChat(last)
  } catch (error) {
    setState({ ready: true })
    fail(error)
  }
  // The warm-up is asked for ahead of the usage readings, so a provider that can answer those
  // from the process being warmed does not start another for them.
  prepare()
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

/** Show what a turn of the open chat changed, beside the conversation. */
export async function openTurnChanges(turnId: string): Promise<void> {
  const chatId = state.activeChatId
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
export async function undoTurn(turnId: string): Promise<void> {
  const chatId = state.activeChatId
  if (!chatId) return
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

export async function openChatLink(href: string, cwd?: string): Promise<void> {
  const request = ++linkRequest
  const folder = cwd ?? state.chats.find((chat) => chat.id === state.activeChatId)?.cwd ?? state.defaultCwd
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
