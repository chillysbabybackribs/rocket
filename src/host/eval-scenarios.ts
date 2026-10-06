import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ProviderId } from '../shared/types.ts'

export type EvalScenario = {
  id: string
  /** The scenario file it came from, relative to docs/evals/scenarios. */
  file: string
  cwd: string
  message: string
  openGoal: boolean
  graders: string[]
  trials: number
  matrix: Array<{ provider: ProviderId; model: string | null }>
  /**
   * Runs one cell at a time instead of one per provider side by side: for scenarios that use the
   * one Rocket window or browser, where cells running together would see each other's changes.
   */
  runsAlone: boolean
  /** When set, Tools → Evaluate attributes scenario pass rate to this MCP tool. */
  targetTool?: string
}

export function loadScenarios(repoRoot: string, file = 'matrix-smoke.jsonl'): EvalScenario[] {
  const path = resolve(repoRoot, 'docs/evals/scenarios', file)
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line, index) => {
    try {
      const row = JSON.parse(line) as Record<string, unknown>
      const id = String(row.id ?? `row-${index}`)
      const cwd = String(row.cwd ?? '')
      return {
        id,
        file,
        cwd: cwd.startsWith('/') ? cwd : join(repoRoot, cwd),
        message: String(row.message ?? ''),
        openGoal: (row.setup as { openGoal?: boolean } | undefined)?.openGoal === true,
        graders: Array.isArray(row.graders) ? row.graders.map(String) : ['turn_completed'],
        trials: typeof row.trials === 'number' ? row.trials : 1,
        runsAlone: row.runsAlone === true,
        matrix: (Array.isArray((row.matrix as { include?: unknown })?.include)
          ? (row.matrix as { include: Array<{ provider: ProviderId; model: string | null }> }).include
          : [{ provider: 'claude' as const, model: null }]),
        ...(row.targetTool ? { targetTool: String(row.targetTool) } : {})
      }
    } catch {
      throw new Error(`Invalid scenario JSONL at ${path}:${index + 1}`)
    }
  })
}

export function listScenarioFiles(repoRoot: string): string[] {
  const dir = join(repoRoot, 'docs/evals/scenarios')
  const root = readdirSync(dir).filter((name) => name.endsWith('.jsonl'))
  const toolsDir = join(dir, 'tools')
  const nested = existsSync(toolsDir)
    ? readdirSync(toolsDir).filter((name) => name.endsWith('.jsonl')).map((name) => join('tools', name))
    : []
  return [...root, ...nested].sort()
}

/** Every scenario in every file, as the eval panel and the tool scores list them. */
export function listScenarios(repoRoot: string): { files: string[]; scenarios: EvalScenario[] } {
  const files = listScenarioFiles(repoRoot)
  return { files, scenarios: files.flatMap((file) => loadScenarios(repoRoot, file)) }
}
