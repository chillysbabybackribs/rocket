import { useSyncExternalStore } from 'react'
import type { Chat, HostEvent, Item, ModelInfo, ProviderId, Turn, UsageSnapshot } from '../../shared/types.ts'
import { PROVIDERS } from '../../shared/types.ts'
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
  usage: Partial<Record<ProviderId, UsageSnapshot>>
  provider: ProviderId
  /** Each provider's models, once read. A provider absent here has not been asked yet. */
  models: Partial<Record<ProviderId, ModelInfo[]>>
  /** The model chosen per provider; a provider absent here runs its own default. */
  modelChoice: ModelChoices
  browserOpen: boolean
  /** The folder a new chat starts in: the last one the user chose, or their home folder. */
  defaultCwd: string
  error: string | null
}

export type ModelChoices = Partial<Record<ProviderId, { id: string; label: string }>>

const PREFS_KEY = 'rocket.prefs'
type Prefs = {
  provider?: ProviderId
  modelChoice?: ModelChoices
  browserOpen?: boolean
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

let state: AppState = {
  ready: false,
  chats: [],
  activeChatId: null,
  tabs: [],
  turns: [],
  turnItems: {},
  running: new Set(),
  usage: {},
  provider: PROVIDERS.some((provider) => provider.id === prefs.provider) ? prefs.provider! : 'claude',
  models: {},
  modelChoice: prefs.modelChoice ?? {},
  browserOpen: prefs.browserOpen === true,
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
        setState({ chats: state.chats.filter((chat) => chat.id !== event.chatId) })
        closeTab(event.chatId)
        break
      case 'usage':
        setState({ usage: { ...state.usage, [event.snapshot.provider]: event.snapshot } })
        break
    }
  }
}

function showChat(chatId: string | null, turns: Turn[] = [], loaded: Item[] = []): void {
  items.clear()
  const turnItems: Record<string, string[]> = {}
  for (const item of loaded) {
    items.set(item.id, item)
    ;(turnItems[item.turnId] ??= []).push(item.id)
  }
  const running = new Set(state.running)
  for (const turn of turns) if (turn.status === 'running') running.add(turn.chatId)
  const tabs = chatId && !state.tabs.includes(chatId) ? [...state.tabs, chatId] : state.tabs
  setState({ activeChatId: chatId, tabs, turns, turnItems, running })
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
    showChat(chatId, snapshot.turns, snapshot.items)
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

export function stop(): void {
  if (state.activeChatId) void call('chat.stop', { chatId: state.activeChatId }).catch(fail)
}

export function deleteChat(chatId: string): void {
  void call('chat.delete', { chatId }).catch(fail)
}

export function setProvider(provider: ProviderId): void {
  setState({ provider })
  writePrefs({ provider })
}

/** Pick a provider's model, or null to go back to that provider's default. Also selects the provider. */
export function selectModel(provider: ProviderId, model: ModelInfo | null): void {
  const modelChoice = { ...state.modelChoice }
  if (model) modelChoice[provider] = { id: model.id, label: model.label }
  else delete modelChoice[provider]
  setState({ provider, modelChoice })
  writePrefs({ provider, modelChoice })
}

const modelLoads = new Map<ProviderId, Promise<void>>()

/** Read a provider's models once per session; a failed read can be tried again. */
export function loadModels(provider: ProviderId): Promise<void> {
  let load = modelLoads.get(provider)
  if (!load) {
    load = call('models.list', { provider }).then((models) => {
      setState({ models: { ...state.models, [provider]: models } })
      // A remembered model the provider no longer offers would fail the turn; fall back to default.
      const chosen = state.modelChoice[provider]
      if (chosen && !models.some((model) => model.id === chosen.id)) {
        const modelChoice = { ...state.modelChoice }
        delete modelChoice[provider]
        setState({ modelChoice })
        writePrefs({ modelChoice })
      }
    }).catch(() => {
      modelLoads.delete(provider)
      setState({ models: { ...state.models, [provider]: [] } })
    })
    modelLoads.set(provider, load)
  }
  return load
}

export function setBrowserOpen(browserOpen: boolean): void {
  setState({ browserOpen })
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
    const chats = await call('chats.list', {})
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
}
