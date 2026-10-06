import { call } from './host.ts'
import { markPlaygroundCell, openChat, patchPlayground, patchRunSheet, peekState } from './store.ts'
import type { HostApi, ProviderId } from '../../shared/types.ts'

// Running eval cells, shared by the dashboard's buttons and the app map's actions. Progress goes
// into the store, so the grid, the run sheet and rocket_ui_where all read the same run.

export type Scenario = HostApi['eval.listScenarios'][1]['scenarios'][number]
export type DatasetRow = { id: string; input: string; expected: string; tags: string[] }
export type Dataset = { id: string; rows: DatasetRow[] }

export type Task = {
  id: string
  role: 'base' | 'comparison'
  provider: ProviderId
  model: string | null
  label: string
}

export type ScenarioCellResult = {
  allPass: boolean
  chatId: string
  grades: Array<{ name: string; pass: boolean; reason?: string }>
  /** Short text for playground grid cells */
  summary: string
}

/** Start a scenario cell, open the eval chat, wait for finish + graders. */
export async function runScenarioCell(input: {
  scenarioId: string
  provider: ProviderId
  trial?: number
}): Promise<ScenarioCellResult> {
  const { scenarios } = await call('eval.listScenarios', {})
  const scenario = scenarios.find((row) => row.id === input.scenarioId)
  if (!scenario) throw new Error(`Unknown scenario: ${input.scenarioId}`)
  const trial = input.trial ?? 0
  const started = await call('eval.startScenarioCell', {
    scenarioId: scenario.id,
    provider: input.provider,
    model: scenario.matrix.find((cell) => cell.provider === input.provider)?.model ?? null,
    trial,
    timeoutMs: 600_000
  })
  await openChat(started.chatId)
  const finished = await call('eval.finishScenarioCell', {
    chatId: started.chatId,
    turnId: started.turnId,
    cellDir: started.cellDir,
    graders: started.graders,
    timeoutMs: 600_000
  })
  const grades = Object.entries(finished.graders.graders).map(([name, row]) => ({
    name,
    pass: row.pass,
    reason: typeof row.metadata?.reason === 'string' ? row.metadata.reason : undefined
  }))
  const summary = finished.graders.allPass
    ? `Pass (${grades.filter((g) => g.pass).length}/${grades.length} graders)`
    : `Fail (${grades.filter((g) => g.pass).length}/${grades.length} graders)`
  return { allPass: finished.graders.allPass, chatId: started.chatId, grades, summary }
}

// ── Playground ────────────────────────────────────────────────────────

/** The playground's task columns: the scenario's matrix, the first cell as the base. */
export function playgroundTasks(scenario: Scenario | null): Task[] {
  if (!scenario) return []
  return scenario.matrix.map((cell, index) => ({
    id: `${cell.provider}-${index}`,
    role: index === 0 ? 'base' : 'comparison',
    provider: cell.provider,
    model: cell.model,
    label: index === 0 ? 'Base task' : 'Comparison task'
  }))
}

/** The playground's rows: the chosen dataset's, or one default row for a scenario without one. */
export function playgroundRows(datasets: Dataset[], datasetId: string, scenario: Scenario | null): DatasetRow[] {
  const dataset = datasets.find((entry) => entry.id === datasetId)
  if (dataset?.rows.length) return dataset.rows
  if (scenario) return [{ id: '0', input: '(default scenario run)', expected: scenario.graders.join(', '), tags: ['scenario'] }]
  return []
}

export function visibleRows(rows: DatasetRow[], filter: string): DatasetRow[] {
  return rows.filter((row) => row.input.toLowerCase().includes(filter.toLowerCase()))
}

export const cellKey = (rowId: string, taskId: string): string => `${rowId}::${taskId}`

async function executeCell(scenario: Scenario, row: DatasetRow, task: Task): Promise<void> {
  const key = cellKey(row.id, task.id)
  markPlaygroundCell(key, { status: 'running', output: undefined })
  patchPlayground({ error: null })
  try {
    const result = await runScenarioCell({ scenarioId: scenario.id, provider: task.provider, trial: 0 })
    markPlaygroundCell(key, { status: 'done', output: result.summary, pass: result.allPass })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    markPlaygroundCell(key, { status: 'error', output: message.slice(0, 120) })
    patchPlayground({ error: message })
  }
}

/**
 * Run playground cells one after another: every pair of the given rows and tasks. One run at a
 * time; a second call while busy is refused rather than queued.
 */
export async function runPlayground(scenario: Scenario, rows: DatasetRow[], tasks: Task[]): Promise<{ ran: number }> {
  if (peekState().evals.playground.busy) throw new Error('The playground is already running. Wait for it to finish before starting another run.')
  if (rows.length === 0 || tasks.length === 0) throw new Error('There is nothing to run: the playground has no rows or no tasks.')
  patchPlayground({ busy: true, error: null })
  let ran = 0
  try {
    for (const row of rows) for (const task of tasks) { await executeCell(scenario, row, task); ran++ }
  } finally {
    patchPlayground({ busy: false })
  }
  return { ran }
}

// ── Run sheet ─────────────────────────────────────────────────────────

/** Run the sheet's cell and keep its result on the sheet. */
export async function runSheetCell(): Promise<ScenarioCellResult> {
  const sheet = peekState().evals.runSheet
  if (sheet.phase === 'running') throw new Error('The Run cell sheet is already running a cell. Wait for it to finish.')
  if (!sheet.scenarioId) throw new Error('Choose a scenario before running the cell.')
  patchRunSheet({ phase: 'running', error: null, grades: null })
  try {
    const result = await runScenarioCell({ scenarioId: sheet.scenarioId, provider: sheet.provider, trial: sheet.trial })
    patchRunSheet({ phase: 'done', chatId: result.chatId, grades: result.grades })
    return result
  } catch (error) {
    patchRunSheet({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}
