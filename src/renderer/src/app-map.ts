import { ACTIONS, PLACES, isAction, isPlace, type ActionName, type PlaceName } from '../../shared/app-map.ts'
import { PROVIDERS, type ProviderId, type UiMapResult, type UiWhere } from '../../shared/types.ts'
import { call } from './host.ts'
import { playgroundRows, playgroundTasks, runPlayground, runSheetCell, visibleRows, type Dataset, type Scenario } from './eval-run.ts'
import {
  addPane, closeArtifact, closePane, focusPane, openChat, patchEvals, patchPlayground, patchRunSheet, peekState,
  setBrowserOpen, setEvalsOpen, showEvalView, type AppState, type EvalView
} from './store.ts'

// The one dispatcher behind the app map. The dashboard's buttons call `go` and `act`, and so do
// main's `uiMap` ops for the host's rocket_ui_* tools, so a model's navigation is a click's
// navigation. Every place and action in `src/shared/app-map.ts` has its handler here; the
// `Record<PlaceName | ActionName, …>` types make a missing one a type error.

type Params = Record<string, unknown>

const EVAL_VIEW_PLACE: Record<EvalView, PlaceName> = {
  overview: 'evals.overview', logs: 'evals.logs', playgrounds: 'evals.playgrounds', experiments: 'evals.experiments',
  experiment: 'evals.experiment', datasets: 'evals.datasets', dataset: 'evals.dataset', scorers: 'evals.scorers', tools: 'evals.tools'
}

function placeOf(state: AppState): PlaceName {
  if (state.artifact) return 'chat'
  if (state.evalsOpen) return EVAL_VIEW_PLACE[state.evals.view]
  if (state.browserOpen) return 'browser'
  return 'chat'
}

/** Where the shell is now, in the map's words. */
export function where(): UiWhere {
  const state = peekState()
  const { evals } = state
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
    evals: state.evalsOpen ? {
      view: evals.view,
      experimentId: evals.experimentId,
      datasetId: evals.datasetId,
      playground: {
        scenario: evals.playground.scenarioId, dataset: evals.playground.datasetId, compare: evals.playground.compare, diff: evals.playground.diff,
        filter: evals.playground.filter, busy: evals.playground.busy, error: evals.playground.error,
        cells: Object.entries(evals.playground.cells).map(([key, cell]) => {
          const [rowId = '', taskId = ''] = key.split('::')
          return { rowId, provider: taskId.replace(/-\d+$/, '') as ProviderId, status: cell.status, pass: cell.pass ?? null, output: cell.output ?? null }
        })
      },
      runSheet: { open: evals.runSheet.open, scenario: evals.runSheet.scenarioId, provider: evals.runSheet.provider, trial: evals.runSheet.trial, phase: evals.runSheet.phase, chatId: evals.runSheet.chatId, error: evals.runSheet.error, grades: evals.runSheet.grades },
      tools: { section: evals.tools.section === 'scores' ? 'evaluate' : 'health' }
    } : null,
    dialogs: [...(state.newGoal ? ['goal.new'] : []), ...(state.evalsOpen && evals.runSheet.open ? ['evals.runSheet'] : [])],
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

function flag(params: Params, name: string): boolean | undefined {
  const value = params[name]
  if (value === undefined || value === null || value === '') return undefined
  return value === true || value === 'true'
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

async function scenarioNamed(id: string | undefined, fallback: string): Promise<Scenario> {
  const { scenarios } = await call('eval.listScenarios', {})
  const wanted = id || fallback || scenarios[0]?.id
  const found = scenarios.find((entry) => entry.id === wanted)
  if (!found) throw new Error(`There is no scenario "${wanted ?? ''}". The scenarios are ${scenarios.map((entry) => entry.id).join(', ') || 'none; add one under evals/'}.`)
  return found
}

async function datasets(): Promise<Dataset[]> {
  return (await call('eval.loadDashboard', {})).datasets
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
  'evals.overview': async () => showEvalView('overview'),
  'evals.logs': async () => showEvalView('logs'),
  'evals.playgrounds': async (params) => {
    const current = peekState().evals.playground
    const patch: Partial<AppState['evals']['playground']> = {}
    const scenario = text(params, 'scenario')
    if (scenario !== undefined) {
      await scenarioNamed(scenario, '')
      if (scenario !== current.scenarioId) Object.assign(patch, { scenarioId: scenario, cells: {} })
    }
    const dataset = text(params, 'dataset')
    if (dataset !== undefined) {
      const known = await datasets()
      if (!known.some((entry) => entry.id === dataset)) throw new Error(`There is no dataset "${dataset}". The datasets are ${known.map((entry) => entry.id).join(', ') || 'none'}.`)
      patch.datasetId = dataset
    }
    const compare = text(params, 'compare')
    if (compare !== undefined) patch.compare = compare
    const diff = flag(params, 'diff')
    if (diff !== undefined) patch.diff = diff
    patchPlayground(patch)
    showEvalView('playgrounds')
  },
  'evals.experiments': async () => showEvalView('experiments'),
  'evals.experiment': async (params) => {
    const id = text(params, 'id')
    if (!id) throw new Error('Give id: the experiment to open. evals.experiments lists them.')
    const { experiments } = await call('eval.loadDashboard', {})
    if (!experiments.some((entry) => entry.id === id)) throw new Error(`There is no experiment "${id}". The experiments are ${experiments.map((entry) => entry.id).join(', ') || 'none'}.`)
    showEvalView('experiment', { experimentId: id })
  },
  'evals.datasets': async () => showEvalView('datasets'),
  'evals.dataset': async (params) => {
    const id = text(params, 'id')
    if (!id) throw new Error('Give id: the dataset to open. evals.datasets lists them.')
    const known = await datasets()
    if (!known.some((entry) => entry.id === id)) throw new Error(`There is no dataset "${id}". The datasets are ${known.map((entry) => entry.id).join(', ') || 'none'}.`)
    showEvalView('dataset', { datasetId: id })
  },
  'evals.scorers': async () => showEvalView('scorers'),
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
  'evals.sync': async () => { patchEvals({ refresh: peekState().evals.refresh + 1 }) },
  'evals.playgrounds.run': async (params) => {
    const state = peekState().evals.playground
    const scenario = await scenarioNamed(state.scenarioId, '')
    const tasks = playgroundTasks(scenario)
    const rows = visibleRows(playgroundRows(await datasets(), state.datasetId, scenario), state.filter)
    const row = integer(params, 'row', 1)
    if (row !== undefined && row > rows.length) throw new Error(`There is no row ${row}. The playground shows ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}.`)
    const task = provider(params)
    if (task !== undefined && !tasks.some((entry) => entry.provider === task)) throw new Error(`The scenario has no ${task} task. Its tasks are ${tasks.map((entry) => entry.provider).join(', ')}.`)
    const run = runPlayground(scenario, row === undefined ? rows : [rows[row - 1]!], task === undefined ? tasks : tasks.filter((entry) => entry.provider === task))
      .finally(() => patchEvals({ refresh: peekState().evals.refresh + 1 }))
    return awaitRun(run, params, () => where().evals?.playground.cells)
  },
  'evals.runSheet.open': async (params) => {
    const sheet = peekState().evals.runSheet
    const scenario = await scenarioNamed(text(params, 'scenario'), sheet.scenarioId)
    const chosen = provider(params)
    if (chosen !== undefined && !scenario.matrix.some((cell) => cell.provider === chosen)) throw new Error(`Scenario ${scenario.id} has no ${chosen} cell. Its providers are ${scenario.matrix.map((cell) => cell.provider).join(', ')}.`)
    const trial = integer(params, 'trial', 0)
    if (trial !== undefined && trial >= Math.max(1, scenario.trials)) throw new Error(`Scenario ${scenario.id} has ${scenario.trials} ${scenario.trials === 1 ? 'trial' : 'trials'}; trial goes from 0 to ${Math.max(0, scenario.trials - 1)}.`)
    const matrixProvider = scenario.matrix.some((cell) => cell.provider === sheet.provider) ? sheet.provider : scenario.matrix[0]?.provider ?? 'claude'
    patchRunSheet({ open: true, scenarioId: scenario.id, provider: chosen ?? matrixProvider, trial: trial ?? 0, phase: 'idle', chatId: null, error: null, grades: null })
  },
  'evals.runSheet.run': async (params) => {
    await actions['evals.runSheet.open'](params)
    const run = runSheetCell().finally(() => patchEvals({ refresh: peekState().evals.refresh + 1 }))
    return awaitRun(run, params, () => where().evals?.runSheet)
  },
  'evals.runSheet.close': async () => { patchRunSheet({ open: false }) },
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
    if (home && !where().place.startsWith(home) && !(home === 'evals.experiments' && where().place === 'evals.experiment')) await places[home]({})
    const value = await actions[action](params)
    await painted()
    return { ok: true, value: value ?? null, where: where() }
  } catch (error) {
    return { ok: false, error: message(error), where: where() }
  }
}

export const rocketMap = { where, go, act }
