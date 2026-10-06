import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProviderId } from '../shared/types.ts'
import { gradeTurnFile, type GradeSummary } from './eval-grade.ts'
import { cellDirectory, finishEvalCell, startEvalCell, type EvalCellDeps } from './eval-run-cell.ts'
import { listScenarioFiles, loadScenarios, type EvalScenario } from './eval-scenarios.ts'

export function evalLiveRoot(dataDir: string): string {
  return join(dataDir, 'eval-live')
}

export function listScenariosForUi(repoRoot: string): { files: string[]; scenarios: EvalScenario[] } {
  const files = listScenarioFiles(repoRoot)
  const scenarios = files.flatMap((file) => loadScenarios(repoRoot, file))
  return { files, scenarios }
}

export type RunCellUiInput = {
  scenarioId: string
  provider: ProviderId
  model: string | null
  trial?: number
  timeoutMs?: number
}

export type StartedCellUi = {
  runId: string
  chatId: string
  turnId: string
  cellDir: string
  scenarioId: string
  provider: ProviderId
  graders: string[]
}

export function startCellFromScenario(
  deps: EvalCellDeps,
  repoRoot: string,
  dataDir: string,
  input: RunCellUiInput
): StartedCellUi {
  const scenario = listScenarioFiles(repoRoot)
    .flatMap((file) => loadScenarios(repoRoot, file))
    .find((row) => row.id === input.scenarioId)
  if (!scenario) throw new Error(`Unknown scenario: ${input.scenarioId}`)
  const trial = input.trial ?? 0
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const runDir = join(evalLiveRoot(dataDir), runId)
  mkdirSync(runDir, { recursive: true })
  const cellDir = cellDirectory(runDir, scenario.id, input.provider, input.model, trial)
  writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({
    runId,
    scenarioId: scenario.id,
    provider: input.provider,
    model: input.model,
    trial,
    startedAt: new Date().toISOString()
  }, null, 2))

  const started = startEvalCell(deps, {
    cwd: scenario.cwd,
    message: scenario.message,
    provider: input.provider,
    model: input.model,
    outDir: cellDir,
    openGoal: scenario.openGoal,
    scenarioId: scenario.id,
    timeoutMs: input.timeoutMs
  })
  return {
    runId,
    ...started,
    scenarioId: scenario.id,
    provider: input.provider,
    graders: scenario.graders
  }
}

export async function finishCellFromScenario(
  deps: EvalCellDeps,
  started: Pick<StartedCellUi, 'chatId' | 'turnId' | 'cellDir'>,
  graders: string[],
  timeoutMs?: number
): Promise<{ turnPath: string; graders: GradeSummary }> {
  const result = await finishEvalCell(deps, started, { timeoutMs })
  const summary = gradeTurnFile(result.turnPath, graders)
  writeFileSync(join(started.cellDir, 'graders.json'), JSON.stringify({ ...summary, turnPath: result.turnPath }, null, 2))
  return { turnPath: result.turnPath, graders: summary }
}
