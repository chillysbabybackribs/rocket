import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Tool } from './tools/registry.ts'
import type { ToolLedger } from './tool-ledger.ts'
import { evalRunsRoot } from './eval-runs.ts'
import { listScenarios } from './eval-scenarios.ts'

export type ToolEvalWeights = { wR: number; wP: number; description?: string }

export type ToolEvalScoreRow = {
  tool: string
  tes: number | null
  r: number | null
  p: number | null
  ledgerCalls: number
  scenarioCells: number
  scenarioPasses: number
  scenarioIds: string[]
}

export type ToolEvalScoresData = {
  weights: ToolEvalWeights
  syncedAt: string
  tools: ToolEvalScoreRow[]
  note: string
}

/** Wilson score interval lower bound at ~95% (z=1.96). */
export function wilsonLowerBound(successes: number, trials: number, z = 1.96): number | null {
  if (trials <= 0) return null
  const p = successes / trials
  const z2 = z * z
  const denom = 1 + z2 / trials
  const center = p + z2 / (2 * trials)
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials)
  return Math.max(0, (center - margin) / denom)
}

export function loadToolEvalWeights(repoRoot: string): ToolEvalWeights {
  const path = join(repoRoot, 'config/tool-eval-weights.json')
  if (!existsSync(path)) return { wR: 0.35, wP: 0.65 }
  const body = JSON.parse(readFileSync(path, 'utf8')) as ToolEvalWeights
  return { wR: Number(body.wR) || 0.35, wP: Number(body.wP) || 0.65, description: body.description }
}

function ledgerReliability(ledger: ToolLedger, tool: string): { r: number | null; calls: number } {
  const summary = ledger.summary({ tool, since: 0, limit: 50 }) as { scopes?: Array<{ scope: string[]; successes: number; failures: number }> }
  let successes = 0
  let failures = 0
  for (const scope of summary.scopes ?? []) {
    if (scope.scope[0] !== tool) continue
    successes += scope.successes
    failures += scope.failures
  }
  const completed = successes + failures
  return { r: wilsonLowerBound(successes, completed), calls: completed }
}

function scenarioIdsForTool(repoRoot: string, tool: string): string[] {
  const { scenarios } = listScenarios(repoRoot)
  return scenarios.filter(row => row.targetTool === tool).map(row => row.id)
}

type CellOutcome = { scenarioId: string; allPass: boolean }

function collectEvalLiveOutcomes(evalRoot: string): CellOutcome[] {
  const out: CellOutcome[] = []
  if (!existsSync(evalRoot)) return out
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name === 'graders.json') {
        try {
          const body = JSON.parse(readFileSync(path, 'utf8')) as { allPass?: boolean }
          const cellDir = join(path, '..')
          const folder = cellDir.split(/[/\\]/).pop() ?? ''
          const scenarioId = folder.split('__')[0] ?? ''
          if (scenarioId) out.push({ scenarioId, allPass: body.allPass === true })
        } catch { /* skip corrupt */ }
      }
    }
  }
  walk(evalRoot)
  return out
}

function scenarioPassRate(outcomes: CellOutcome[], scenarioIds: string[]): { p: number | null; cells: number; passes: number } {
  if (scenarioIds.length === 0) return { p: null, cells: 0, passes: 0 }
  const set = new Set(scenarioIds)
  const matched = outcomes.filter(row => set.has(row.scenarioId))
  if (matched.length === 0) return { p: null, cells: 0, passes: 0 }
  const passes = matched.filter(row => row.allPass).length
  return { p: passes / matched.length, cells: matched.length, passes }
}

export function loadToolEvalScores(
  ledger: ToolLedger | undefined,
  registered: Tool[],
  repoRoot: string,
  dataDir: string
): ToolEvalScoresData {
  const weights = loadToolEvalWeights(repoRoot)
  const outcomes = collectEvalLiveOutcomes(evalRunsRoot(dataDir))
  const names = registered.map(t => t.name).sort()
  const tools: ToolEvalScoreRow[] = names.map(tool => {
    const scenarioIds = scenarioIdsForTool(repoRoot, tool)
    const { r, calls } = ledger ? ledgerReliability(ledger, tool) : { r: null, calls: 0 }
    const { p, cells, passes } = scenarioPassRate(outcomes, scenarioIds)
    const tes = r != null && p != null ? weights.wR * r + weights.wP * p : (r != null ? weights.wR * r : null) ?? (p != null ? weights.wP * p : null)
    return { tool, tes, r, p, ledgerCalls: calls, scenarioCells: cells, scenarioPasses: passes, scenarioIds }
  })
  return {
    weights,
    syncedAt: new Date().toISOString(),
    tools,
    note: 'P uses graders.json from profile eval-live runs for scenarios with targetTool. Run a scenario from the eval panel; a pass needs a real provider turn.'
  }
}
