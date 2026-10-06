import { call } from './host.ts'
import { patchEvals, peekState, type AppState } from './store.ts'
import type { EvalRun, EvalRunCell, ProviderId } from '../../shared/types.ts'

// What the eval panel's views and the app map's actions both need: which run a page shows, how a
// run adds up per provider, and starting one. Runs themselves come whole from the host.

/** A scenario's runs, newest first. */
export function runsOf(runs: EvalRun[], scenarioId: string | null): EvalRun[] {
  return scenarioId ? runs.filter((run) => run.scenarioId === scenarioId) : []
}

/** The run the scenario page or run view shows: the one chosen, else the scenario's latest. */
export function shownRun(state: AppState): EvalRun | null {
  const { view, runId, cell, runs, scenarioId } = state.evals
  if (view === 'run' && cell) return runs.find((run) => run.id === cell.runId) ?? null
  if (view !== 'scenario') return null
  return (runId ? runs.find((run) => run.id === runId) : undefined) ?? runsOf(runs, scenarioId)[0] ?? null
}

export function cellOf(run: EvalRun | null | undefined, provider: ProviderId, trial: number): EvalRunCell | null {
  return run?.cells.find((cell) => cell.provider === provider && cell.trial === trial) ?? null
}

export type ProviderTally = { provider: ProviderId; model: string | null; passed: number; total: number; finished: number; running: boolean; times: number[] }

/** Per provider, in matrix order: cells passed, cells in all, and the finished cells' times. */
export function tally(run: EvalRun): ProviderTally[] {
  const out = new Map<ProviderId, ProviderTally>()
  for (const cell of run.cells) {
    const row = out.get(cell.provider) ?? { provider: cell.provider, model: cell.model, passed: 0, total: 0, finished: 0, running: false, times: [] }
    row.total++
    if (cell.pass) row.passed++
    if (cell.status === 'running') row.running = true
    if (cell.status === 'done' || cell.status === 'error') {
      row.finished++
      if (cell.startedAt && cell.endedAt) row.times.push(cell.endedAt - cell.startedAt)
    }
    out.set(cell.provider, row)
  }
  return [...out.values()]
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

export function duration(ms: number | null): string {
  if (ms === null) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

export function when(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const date = new Date(at)
  const today = new Date()
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (date.toDateString() === today.toDateString()) return `Today ${time}`
  if (date.toDateString() === new Date(today.getTime() - 86_400_000).toDateString()) return `Yesterday ${time}`
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

/** Start a run; it shows at once, and the host's events carry it from there. */
export async function startRun(scenarioId: string, message?: string): Promise<EvalRun> {
  const running = runsOf(peekState().evals.runs, scenarioId).find((run) => run.status === 'running')
  if (running) throw new Error(`Scenario ${scenarioId} is already running. Wait for it to finish or stop it first.`)
  const run = await call('evalRuns.start', { scenarioId, ...(message ? { message } : {}) })
  const rest = peekState().evals.runs.filter((entry) => entry.id !== run.id)
  patchEvals({ runs: [run, ...rest].sort((a, b) => b.startedAt - a.startedAt), runId: null })
  return run
}

/** Resolve with the run once it has finished or stopped. */
export function finished(runId: string): Promise<EvalRun> {
  return new Promise((resolve) => {
    const check = (): void => {
      const run = peekState().evals.runs.find((entry) => entry.id === runId)
      if (run && run.status !== 'running') resolve(run)
      else setTimeout(check, 500)
    }
    check()
  })
}
