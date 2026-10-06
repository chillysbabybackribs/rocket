import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { listScenariosForUi } from './eval-live.ts'

export type EvalDashboardCell = {
  scenarioId: string
  provider: string
  model: string | null
  trial: number
  pass: boolean
  graders: Record<string, boolean>
  turnPath?: string
}

export type EvalDashboardExperiment = {
  id: string
  name: string
  createdAt: string
  datasetId: string
  kind: 'matrix' | 'harness'
  passRate: number
  cellCount: number
  passCount: number
  durationMs: number | null
  scores: Record<string, number>
  cells: EvalDashboardCell[]
  sourcePath?: string
}

export type EvalDashboardDatasetRow = {
  id: string
  input: string
  expected: string
  tags: string[]
}

export type EvalDashboardDataset = {
  id: string
  description: string
  rows: EvalDashboardDatasetRow[]
}

export type EvalDashboardData = {
  project: string
  org: string
  datasets: EvalDashboardDataset[]
  experiments: EvalDashboardExperiment[]
  syncedAt: string
}

function loadBase(repoRoot: string): EvalDashboardData {
  const path = join(repoRoot, 'docs/evals/mock-ui/sample-data.json')
  return JSON.parse(readFileSync(path, 'utf8')) as EvalDashboardData
}

function mergeArtifactExperiments(repoRoot: string, experiments: EvalDashboardExperiment[]): EvalDashboardExperiment[] {
  const artifacts = join(repoRoot, '.artifacts/evals')
  const out = [...experiments]
  if (!existsSync(artifacts)) return out
  for (const name of readdirSync(artifacts)) {
    const runDir = join(artifacts, name)
    if (!statSync(runDir).isDirectory()) continue
    const summaryPath = join(runDir, 'summary.json')
    if (!existsSync(summaryPath)) continue
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
      passCount?: number
      cellCount?: number
      cells?: Array<{
        scenarioId: string
        provider: string
        model: string | null
        trial: number
        pass: boolean
        turnPath?: string
      }>
      finishedAt?: string
      createdAt?: string
    }
    const passCount = summary.passCount ?? summary.cells?.filter((c) => c.pass).length ?? 0
    const cellCount = summary.cellCount ?? summary.cells?.length ?? 0
    const id = `exp-${name}`
    if (out.some((e) => e.id === id)) continue
    out.unshift({
      id,
      name: name.replace(/-run$/, ''),
      createdAt: summary.finishedAt ?? summary.createdAt ?? new Date().toISOString(),
      datasetId: summary.cells?.[0]?.scenarioId ?? 'goal-draft-minimal',
      kind: 'matrix',
      passRate: cellCount ? passCount / cellCount : 0,
      cellCount,
      passCount,
      durationMs: null,
      scores: {},
      cells: (summary.cells ?? []).map((cell) => ({
        scenarioId: cell.scenarioId,
        provider: cell.provider,
        model: cell.model,
        trial: cell.trial,
        pass: cell.pass,
        graders: {}
      })),
      sourcePath: summaryPath
    })
  }
  return out
}

function mergeScenarioDatasets(repoRoot: string, datasets: EvalDashboardDataset[]): EvalDashboardDataset[] {
  const { scenarios } = listScenariosForUi(repoRoot)
  const byId = new Map(datasets.map((d) => [d.id, d]))
  for (const scenario of scenarios) {
    const existing = byId.get(scenario.id)
    const row = {
      id: scenario.id,
      input: scenario.message,
      expected: `graders: ${scenario.graders.join(', ')}`,
      tags: ['matrix', ...(scenario.openGoal ? ['goal'] : [])]
    }
    if (existing) {
      if (!existing.rows.some((r) => r.id === row.id)) existing.rows.push(row)
    } else {
      byId.set(scenario.id, {
        id: scenario.id,
        description: `Lane B scenario (${scenario.matrix.length} providers × ${scenario.trials} trial(s)).`,
        rows: [row]
      })
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function loadEvalDashboard(repoRoot: string): EvalDashboardData {
  const base = loadBase(repoRoot)
  const experiments = mergeArtifactExperiments(repoRoot, base.experiments)
  const datasets = mergeScenarioDatasets(repoRoot, base.datasets)
  return {
    ...base,
    datasets,
    experiments,
    syncedAt: new Date().toISOString()
  }
}
