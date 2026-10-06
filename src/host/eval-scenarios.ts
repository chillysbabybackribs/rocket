import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ProviderId } from '../shared/types.ts'

export type EvalScenario = {
  id: string
  cwd: string
  message: string
  openGoal: boolean
  graders: string[]
  trials: number
  matrix: Array<{ provider: ProviderId; model: string | null }>
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
        cwd: cwd.startsWith('/') ? cwd : join(repoRoot, cwd),
        message: String(row.message ?? ''),
        openGoal: (row.setup as { openGoal?: boolean } | undefined)?.openGoal === true,
        graders: Array.isArray(row.graders) ? row.graders.map(String) : ['turn_completed'],
        trials: typeof row.trials === 'number' ? row.trials : 1,
        matrix: (Array.isArray((row.matrix as { include?: unknown })?.include)
          ? (row.matrix as { include: Array<{ provider: ProviderId; model: string | null }> }).include
          : [{ provider: 'claude' as const, model: null }])
      }
    } catch {
      throw new Error(`Invalid scenario JSONL at ${path}:${index + 1}`)
    }
  })
}

export function listScenarioFiles(repoRoot: string): string[] {
  const dir = join(repoRoot, 'docs/evals/scenarios')
  return readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort()
}
