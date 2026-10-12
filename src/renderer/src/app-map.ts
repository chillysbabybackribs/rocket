import { ACTIONS, PLACES, isAction, isPlace, type ActionName, type PlaceName } from '../../shared/app-map.ts'
import type { UiMapResult, UiWhere } from '../../shared/types.ts'
import { filterEntries, parseFilters } from '../../shared/library.ts'
import {
  addPane, closeArtifact, closePane, focusPane, loadLibrary, openChat, openLibraryEntry, patchLibrary, peekState,
  setBrowserOpen, setLibraryOpen
} from './store.ts'

// The one dispatcher behind the app map. The dashboard's buttons call `go` and `act`, and so do
// main's `uiMap` ops for the host's rocket_ui_* tools, so a model's navigation is a click's
// navigation. Every place and action in `src/shared/app-map.ts` has its handler here; the
// `Record<PlaceName | ActionName, …>` types make a missing one a type error.

type Params = Record<string, unknown>

function placeOf(state: ReturnType<typeof peekState>): PlaceName {
  if (state.artifact) return 'chat'
  if (state.libraryOpen) return 'library'
  if (state.browserOpen) return 'browser'
  return 'chat'
}

function libraryWhere(state: ReturnType<typeof peekState>): NonNullable<UiWhere['library']> {
  const { library } = state
  const title = (chatId: string): string => state.chats.find((chat) => chat.id === chatId)?.title ?? ''
  return { filters: library.filters, view: library.view, shown: filterEntries(library.entries, library.filters, title).length, total: library.entries.length }
}

/** Where the shell is now, in the map's words. */
export function where(): UiWhere {
  const state = peekState()
  return {
    place: placeOf(state),
    panes: state.panes.map((pane, index) => {
      const chat = state.chats.find((entry) => entry.id === pane.chatId)
      return {
        index,
        chatId: pane.chatId,
        title: chat?.title ?? 'New chat',
        provider: pane.provider,
        focused: index === state.focused,
        running: pane.chatId !== null && state.running.has(pane.chatId),
        planOpen: pane.chatId !== null && state.views[pane.chatId]?.planTurnId != null
      }
    }),
    focused: state.focused,
    side: state.artifact ? 'artifact' : state.libraryOpen ? 'library' : state.browserOpen ? 'browser' : 'chat',
    artifact: state.artifact ? { kind: state.artifact.kind, path: state.artifact.kind === 'artifact' ? state.artifact.path : null } : null,
    library: state.libraryOpen ? libraryWhere(state) : null,
    dialogs: []
  }
}

function text(params: Params, name: string): string | undefined {
  const value = params[name]
  if (value === undefined || value === null || value === '') return undefined
  return String(value)
}

function integer(params: Params, name: string, min: number): number | undefined {
  const value = params[name]
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be a whole number of at least ${min}.`)
  return n
}

function paneIndex(params: Params, name = 'pane', required = false): number {
  const state = peekState()
  const n = integer(params, name, 0)
  if (n === undefined) {
    if (required) throw new Error(`Give ${name}: a pane index from 0 to ${state.panes.length - 1}.`)
    return state.focused
  }
  if (n >= state.panes.length) throw new Error(`There is no pane ${n}. The panes are 0 to ${state.panes.length - 1}.`)
  return n
}

async function painted(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

const places: Record<PlaceName, (params: Params) => Promise<void>> = {
  chat: async () => {
    closeArtifact()
    if (peekState().browserOpen) setBrowserOpen(false)
    if (peekState().libraryOpen) setLibraryOpen(false)
  },
  library: async (params) => {
    const view = text(params, 'view')
    if (view !== undefined && view !== 'grid' && view !== 'list') throw new Error('view is "grid" or "list".')
    const filtering = ['source', 'kind', 'chat', 'added', 'q'].some((name) => params[name] !== undefined)
    const filters = filtering ? parseFilters(params) : undefined
    if (filters?.chat && !peekState().chats.some((chat) => chat.id === filters.chat)) throw new Error(`There is no chat "${filters.chat}". rocket_ui_where lists the chats on screen; library_list shows each file's chat.`)
    if (!peekState().libraryOpen || peekState().artifact) setLibraryOpen(true)
    if (!peekState().library.loaded) await loadLibrary()
    patchLibrary({ ...(filters ? { filters } : {}), ...(view ? { view } : {}) })
  },
  browser: async () => { setBrowserOpen(true) }
}

const actions: Record<ActionName, (params: Params) => Promise<unknown>> = {
  'pane.focus': async (params) => { focusPane(paneIndex(params, 'pane', true)) },
  'pane.add': async (params) => {
    const before = peekState().panes.length
    addPane(paneIndex(params, 'after'))
    if (peekState().panes.length === before) throw new Error(`There are already ${before} panes, the most the card holds.`)
  },
  'pane.close': async (params) => {
    const pane = paneIndex(params, 'pane', true)
    if (peekState().panes.length <= 1) throw new Error('The only pane cannot close.')
    closePane(pane)
  },
  'chat.open': async (params) => {
    const chatId = text(params, 'chatId')
    if (!chatId) throw new Error('Give chatId: the chat to show.')
    if (!peekState().chats.some((chat) => chat.id === chatId)) throw new Error(`There is no chat "${chatId}".`)
    await openChat(chatId, paneIndex(params))
  },
  'chat.new': async (params) => { await openChat(null, paneIndex(params)) },
  'library.clear': async () => { patchLibrary({ filters: {} }) },
  'library.open': async (params) => {
    const id = text(params, 'id')
    if (!id) throw new Error('Give id: a file id from library_list.')
    await loadLibrary()
    await openLibraryEntry(id)
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function go(place: string, params: Params = {}): Promise<UiMapResult> {
  if (!isPlace(place)) return { ok: false, error: `There is no place "${place}". The places are ${Object.keys(PLACES).join(', ')}.`, where: where() }
  try {
    await places[place](params)
    await painted()
    return { ok: true, value: null, where: where() }
  } catch (error) {
    return { ok: false, error: message(error), where: where() }
  }
}

export async function act(action: string, params: Params = {}): Promise<UiMapResult> {
  if (!isAction(action)) return { ok: false, error: `There is no action "${action}". The actions are ${Object.keys(ACTIONS).join(', ')}.`, where: where() }
  try {
    const home = (ACTIONS[action] as { place?: PlaceName }).place
    if (home && where().place !== home) await places[home]({})
    const value = await actions[action](params)
    await painted()
    return { ok: true, value: value ?? null, where: where() }
  } catch (error) {
    return { ok: false, error: message(error), where: where() }
  }
}

export const rocketMap = { where, go, act }
