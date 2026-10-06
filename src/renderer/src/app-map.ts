import { ACTIONS, PLACES, isAction, isPlace, type ActionName, type PlaceName } from '../../shared/app-map.ts'
import { PROVIDERS, type EvalScenarioInfo, type ProviderId, type UiMapResult, type UiWhere } from '../../shared/types.ts'
import { call } from './host.ts'
import { finished, runsOf, shownRun, startRun } from './eval-run.ts'
import {
  addPane, closeArtifact, closePane, focusPane, loadEvals, openChat, patchEvals, peekState,
  setBrowserOpen, setEvalsOpen, showEvalView, type AppState, type EvalView
} from './store.ts'

// The one dispatcher behind the app map. The dashboard's buttons call `go` and `act`, and so do
// main's `uiMap` ops for the host's rocket_ui_* tools, so a model's navigation is a click's
// navigation. Every place and action in `src/shared/app-map.ts` has its handler here; the
// `Record<PlaceName | ActionName, …>` types make a missing one a type error.

type Params = Record<string, unknown>

const EVAL_VIEW_PLACE: Record<EvalView, PlaceName> = {
  scenarios: 'evals.scenarios', scenario: 'evals.scenario', run: 'evals.run', tools: 'evals.tools'
}

function placeOf(state: AppState): PlaceName {
  if (state.artifact) return 'chat'
  if (state.evalsOpen) return EVAL_VIEW_PLACE[state.evals.view]
  if (state.browserOpen) return 'browser'
  return 'chat'
}

function evalsWhere(state: AppState): NonNullable<UiWhere['evals']> {
  const { evals } = state
  const run = shownRun(state)
  return {
    view: evals.view,
    scenario: evals.view === 'scenarios' || evals.view === 'tools' ? null : evals.scenarioId,
    run: run ? {
      id: run.id,
      status: run.status,
      edited: run.edited,
      cells: run.cells.map((cell) => ({
        provider: cell.provider, trial: cell.trial, status: cell.status, pass: cell.pass,
        failed: cell.grades.filter((grade) => !grade.pass).map((grade) => grade.name), error: cell.error
      }))
    } : null,
    cell: evals.view === 'run' && evals.cell ? { provider: evals.cell.provider, trial: evals.cell.trial } : null,
    tools: { section: evals.tools.section === 'scores' ? 'evaluate' : 'health' }
  }
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
        goal: state.goals.find((goal) => goal.chatId === pane.chatId)?.title ?? null,
        planOpen: pane.chatId !== null && state.views[pane.chatId]?.planTurnId != null
      }
    }),
    focused: state.focused,
    side: state.artifact ? 'artifact' : state.evalsOpen ? 'evals' : state.browserOpen ? 'browser' : 'chat',
    artifact: state.artifact ? { kind: state.artifact.kind, path: state.artifact.kind === 'artifact' ? state.artifact.path : null } : null,
    evals: state.evalsOpen ? evalsWhere(state) : null,
    dialogs: state.newGoal ? ['goal.new'] : [],
    railOpen: state.railOpen
  }
}

// ── Parameter reading ─────────────────────────────────────────────────

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

function provider(params: Params, name = 'provider'): ProviderId | undefined {
  const value = text(params, name)
  if (value === undefined) return undefined
  if (!PROVIDERS.some((entry) => entry.id === value)) throw new Error(`There is no provider "${value}". Choose one of ${PROVIDERS.map((entry) => entry.id).join(', ')}.`)
  return value as ProviderId
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

/** The scenarios, read from disk the first time the panel or a model needs them. */
async function scenarioNamed(id: string | undefined): Promise<EvalScenarioInfo> {
  if (!peekState().evals.loaded) await loadEvals()
  const { scenarios } = peekState().evals
  if (!id) throw new Error(`Give the scenario's id. The scenarios are ${scenarios.map((entry) => entry.id).join(', ') || 'none; add one under docs/evals/scenarios'}.`)
  const found = scenarios.find((entry) => entry.id === id)
  if (!found) throw new Error(`There is no scenario "${id}". The scenarios are ${scenarios.map((entry) => entry.id).join(', ') || 'none; add one under docs/evals/scenarios'}.`)
  return found
}

/** Two frames, so what the store changed is painted before a capture or a read. */
async function painted(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

// ── Places ────────────────────────────────────────────────────────────

const places: Record<PlaceName, (params: Params) => Promise<void>> = {
  chat: async () => {
    closeArtifact()
    if (peekState().evalsOpen) setEvalsOpen(false)
    if (peekState().browserOpen) setBrowserOpen(false)
  },
  browser: async () => { setBrowserOpen(true) },
  'evals.scenarios': async () => {
    if (!peekState().evals.loaded) await loadEvals()
    showEvalView('scenarios')
  },
  'evals.scenario': async (params) => {
    const scenario = await scenarioNamed(text(params, 'id'))
    const runId = text(params, 'run')
    if (runId !== undefined) {
      const runs = runsOf(peekState().evals.runs, scenario.id)
      if (!runs.some((run) => run.id === runId)) throw new Error(`Scenario ${scenario.id} has no run "${runId}". ${runs.length ? `Its runs are ${runs.map((run) => run.id).join(', ')}.` : 'It has never run.'}`)
    }
    showEvalView('scenario', { scenarioId: scenario.id, runId: runId ?? null })
  },
  'evals.run': async (params) => {
    if (!peekState().evals.loaded) await loadEvals()
    const runId = text(params, 'run')
    if (!runId) throw new Error('Give run: the run id. rocket_ui_where shows the shown scenario\'s run.')
    const run = peekState().evals.runs.find((entry) => entry.id === runId)
    if (!run) throw new Error(`There is no run "${runId}".`)
    const chosen = provider(params)
    if (!chosen) throw new Error(`Give provider: one of ${[...new Set(run.cells.map((cell) => cell.provider))].join(', ')}.`)
    const trial = integer(params, 'trial', 0) ?? 0
    if (!run.cells.some((cell) => cell.provider === chosen && cell.trial === trial)) {
      throw new Error(`Run ${run.id} has no ${chosen} trial ${trial}. Its cells are ${run.cells.map((cell) => `${cell.provider} ${cell.trial}`).join(', ')}.`)
    }
    showEvalView('run', { scenarioId: run.scenarioId, cell: { runId: run.id, provider: chosen, trial } })
  },
  'evals.tools': async (params) => {
    const section = text(params, 'section')
    if (section !== undefined) {
      if (section !== 'health' && section !== 'evaluate') throw new Error('section is "health" or "evaluate".')
      patchEvals({ tools: { section: section === 'evaluate' ? 'scores' : 'health' } })
    }
    showEvalView('tools')
  }
}

// ── Actions ───────────────────────────────────────────────────────────

const WAIT_DEFAULT = 100
const WAIT_MAX = 120

/** Wait for a run, but not past `wait` seconds: a long matrix is reported as still running. */
async function awaitRun<T>(run: Promise<T>, params: Params, running: () => unknown): Promise<T | { running: true; note: string; progress: unknown }> {
  const wait = Math.min(integer(params, 'wait', 1) ?? WAIT_DEFAULT, WAIT_MAX)
  run.catch(() => {})
  const timeout = new Promise<{ running: true; note: string; progress: unknown }>((resolve) => {
    setTimeout(() => resolve({ running: true, note: `Still running after ${wait}s. Call rocket_ui_where to follow its progress; the result shows under evals.`, progress: running() }), wait * 1000)
  })
  return Promise.race([run, timeout])
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
  'evals.sync': async () => {
    if (!peekState().evalsOpen) setEvalsOpen(true)
    await loadEvals()
    patchEvals({ refresh: peekState().evals.refresh + 1 })
  },
  'evals.run.start': async (params) => {
    const state = peekState().evals
    const scenario = await scenarioNamed(text(params, 'scenario') ?? state.scenarioId ?? undefined)
    const message = text(params, 'message') ?? state.drafts[scenario.id]
    const run = await startRun(scenario.id, message && message !== scenario.message ? message : undefined)
    return awaitRun(finished(run.id), params, () => where().evals?.run)
  },
  'evals.run.stop': async () => {
    const { scenarioId, runs } = peekState().evals
    const running = runsOf(runs, scenarioId).find((run) => run.status === 'running')
    if (!running) throw new Error(`Scenario ${scenarioId} has no run going.`)
    await call('evalRuns.stop', { runId: running.id })
  },
  'evals.tools.refresh': async () => { patchEvals({ refresh: peekState().evals.refresh + 1 }) }
}

// ── Entry points ──────────────────────────────────────────────────────

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Show a place. Parameters choose what it shows; a wrong one is refused with the right choices. */
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

/** Do an action, going to its place first when that is not on screen. */
export async function act(action: string, params: Params = {}): Promise<UiMapResult> {
  if (!isAction(action)) return { ok: false, error: `There is no action "${action}". The actions are ${Object.keys(ACTIONS).join(', ')}.`, where: where() }
  try {
    const home = (ACTIONS[action] as { place?: PlaceName }).place
    if (home === 'evals.scenario') {
      // A scenario action runs on the scenario named, else the one on screen; it is shown first.
      const id = text(params, 'scenario') ?? peekState().evals.scenarioId ?? undefined
      if (where().place !== 'evals.scenario' || id !== peekState().evals.scenarioId) await places['evals.scenario']({ id })
    } else if (home && where().place !== home) await places[home]({})
    const value = await actions[action](params)
    await painted()
    return { ok: true, value: value ?? null, where: where() }
  } catch (error) {
    return { ok: false, error: message(error), where: where() }
  }
}

export const rocketMap = { where, go, act }
