/**
 * Braintrust remote eval: runs Rocket UI regression cases from the rocket-ui-regression dataset.
 * Dev server: npm run eval:ui:dev  (then Experiments → Task → Remote eval → localhost:8300)
 *
 * Builds and unit-tests once per process, then runs Playwright with --grep per row (~1–3 min each).
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Eval, initDataset } from 'braintrust'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT = 'My Project'
const DATASET = 'rocket-ui-regression'

let prepared = false
let prepareMs = 0

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
  return null
}

function scenarioOf(input: unknown, grep: string): string {
  const row = recordOf(input)
  const name = row.scenario ?? row.input
  if (typeof name === 'string' && name.trim()) return name.trim()
  return grep
}

function runNpm(args: string[], env: NodeJS.ProcessEnv = process.env): SpawnSyncReturns<string> {
  return spawnSync('npm', args, {
    cwd: root,
    encoding: 'utf8',
    env,
    timeout: 30 * 60 * 1000,
  })
}

function ensurePrepared(): { ok: boolean; logTail: string } {
  if (prepared) return { ok: true, logTail: '' }
  const started = Date.now()
  let result = runNpm(['run', 'build'])
  if (result.status !== 0) {
    const log = `${result.stdout ?? ''}${result.stderr ?? ''}`
    return { ok: false, logTail: log.slice(-6000) }
  }
  result = runNpm(['test'])
  prepareMs = Date.now() - started
  if (result.status !== 0) {
    const log = `${result.stdout ?? ''}${result.stderr ?? ''}`
    return { ok: false, logTail: log.slice(-6000) }
  }
  prepared = true
  return { ok: true, logTail: '' }
}

Eval(PROJECT, {
  data: initDataset(PROJECT, { dataset: DATASET }),
  task: async (input) => {
    const grep = grepOf(input)
    if (!grep) {
      return {
        status: 'skip' as const,
        reason: 'Row has no playwright_grep (remove legacy dataset rows from before the CSV cleanup).',
        input,
      }
    }
    const scenario = scenarioOf(input, grep)
    const prep = ensurePrepared()
    if (!prep.ok) {
      return {
        status: 'fail' as const,
        scenario,
        playwright_grep: grep,
        exitCode: 1,
        phase: 'prepare',
        prepareMs,
        logTail: prep.logTail,
      }
    }
    const started = Date.now()
    const result = runNpm(['run', 'check:ui', '--', `--grep=${grep}`], {
      ...process.env,
      ROCKET_UI_SKIP_BUILD: '1',
      ROCKET_UI_SKIP_UNIT: '1',
    })
    const exitCode = result.status ?? 1
    const log = `${result.stdout ?? ''}${result.stderr ?? ''}`
    return {
      status: exitCode === 0 ? ('pass' as const) : ('fail' as const),
      scenario,
      playwright_grep: grep,
      exitCode,
      prepareMs,
      playwrightMs: Date.now() - started,
      durationMs: prepareMs + (Date.now() - started),
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
