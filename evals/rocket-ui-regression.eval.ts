/**
 * Braintrust remote eval: runs Rocket UI regression cases from the rocket-ui-regression dataset.
 * Dev server: npm run eval:ui:dev  (then Experiments → Task → Remote eval → localhost:8300)
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Eval, initDataset } from 'braintrust'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT = 'My Project'
const DATASET = 'rocket-ui-regression'

function recordOf(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      return { scenario: input }
    }
  }
  return {}
}

function grepOf(input: unknown): string | null {
  const row = recordOf(input)
  for (const key of ['playwright_grep', 'metadata.playwright_grep'] as const) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  const nested = row.input
  if (typeof nested === 'string') return grepOf(nested)
  if (nested && typeof nested === 'object') return grepOf(nested)
  return null
}

function labelOf(input: unknown, grep: string): string {
  const row = recordOf(input)
  const name = row.input ?? row.scenario
  if (typeof name === 'string' && name.trim()) return name.trim()
  return grep
}

Eval(PROJECT, {
  data: initDataset(PROJECT, { dataset: DATASET }),
  task: async (input) => {
    const grep = grepOf(input)
    if (!grep) {
      return {
        status: 'skip' as const,
        reason: 'Row has no playwright_grep (delete stray manual rows in the dataset).',
        input,
      }
    }
    const label = labelOf(input, grep)
    const started = Date.now()
    const result = spawnSync('npm', ['run', 'check:ui', '--', `--grep=${grep}`], {
      cwd: root,
      encoding: 'utf8',
      env: process.env,
      timeout: 25 * 60 * 1000,
    })
    const exitCode = result.status ?? 1
    const log = `${result.stdout ?? ''}${result.stderr ?? ''}`
    return {
      status: exitCode === 0 ? ('pass' as const) : ('fail' as const),
      scenario: label,
      playwright_grep: grep,
      exitCode,
      durationMs: Date.now() - started,
      logTail: log.slice(-6000),
    }
  },
  scores: [
    ({ output, expected }) => {
      if (output && typeof output === 'object' && (output as { status?: string }).status === 'skip') {
        return { name: 'ui_regression', score: null, metadata: { skipped: true } }
      }
      const want =
        expected && typeof expected === 'object' && 'status' in (expected as object)
          ? String((expected as { status: string }).status)
          : 'pass'
      const got =
        output && typeof output === 'object' && 'status' in (output as object)
          ? String((output as { status: string }).status)
          : ''
      return { name: 'ui_regression', score: got === want ? 1 : 0 }
    },
  ],
  maxConcurrency: 1,
})
