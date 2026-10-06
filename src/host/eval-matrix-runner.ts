#!/usr/bin/env node
// Run a matrix manifest: one real provider turn per cell, export + grade.
//   node src/host/eval-matrix-runner.ts .artifacts/evals/<plan>/manifest.json
// Requires --yes (or ROCKET_EVAL_MATRIX_RUN=1) because cells call live providers.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { stopAllProcessGroups } from './process-tree.ts'
import { cellDirectory, runEvalCell } from './eval-run-cell.ts'
import { createEvalRuntime } from './eval-runtime.ts'
import { rocketSourceRoot } from './tools/ui-run.ts'

const root = rocketSourceRoot()
const argv = process.argv.slice(2)
const manifestPath = resolve(argv.find((arg) => !arg.startsWith('-')) ?? '')
const yes = argv.includes('--yes') || process.env.ROCKET_EVAL_MATRIX_RUN === '1'
const dryRun = argv.includes('--dry-run')
const onlyCell = (() => {
  const index = argv.indexOf('--cell')
  return index >= 0 ? Number(argv[index + 1]) : null
})()

if (!manifestPath) {
  console.error('Usage: eval-matrix-runner.ts <manifest.json> [--yes] [--dry-run] [--cell N]')
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  cells: Array<{
    scenarioId: string
    provider: string
    model: string | null
    trial: number
    cwd: string
    message: string
    graders: string[]
  }>
  scenarioFile?: string
}

const runDir = dirname(manifestPath).replace(/-plan$/, '-run')
if (!runDir.endsWith('-run')) {
  console.error('Expected manifest under a *-plan directory (from run-agent-matrix.mjs)')
  process.exit(2)
}
mkdirSync(join(runDir, 'cells'), { recursive: true })

const cells = manifest.cells.filter((_, index) => onlyCell === null || index === onlyCell)
if (!cells.length) {
  console.error('No cells to run')
  process.exit(2)
}

console.log(`Matrix run: ${cells.length} cell(s) → ${runDir}`)
if (dryRun) {
  for (const [index, cell] of cells.entries()) {
    const dir = cellDirectory(runDir, cell.scenarioId, cell.provider as never, cell.model, cell.trial)
    console.log(`  [${index}] ${cell.scenarioId} ${cell.provider} trial ${cell.trial} → ${dir}`)
  }
  process.exit(0)
}

if (!yes) {
  console.error('Refusing to call providers without --yes or ROCKET_EVAL_MATRIX_RUN=1')
  process.exit(2)
}

const scenarioLines = manifest.scenarioFile ? readFileSync(manifest.scenarioFile, 'utf8').split('\n').filter(Boolean) : []
const scenarios = new Map(scenarioLines.map((line) => {
  const row = JSON.parse(line) as { id: string; setup?: { openGoal?: boolean } }
  return [row.id, row] as const
}))

const runtime = await createEvalRuntime({ dataDir: join(runDir, 'profile'), repoRoot: root })
const results: Array<Record<string, unknown>> = []

try {
  for (const [index, cell] of cells.entries()) {
    const cellDir = cellDirectory(runDir, cell.scenarioId, cell.provider as never, cell.model, cell.trial)
    const scenario = scenarios.get(cell.scenarioId)
    console.log(`\n[${index + 1}/${cells.length}] ${cell.scenarioId} · ${cell.provider} trial ${cell.trial}`)
    const outcome = await runEvalCell(
      {
        hub: runtime.hub,
        goals: runtime.goals,
        store: runtime.store,
        evalExport: runtime.evalExport,
        timingForChat: runtime.timingForChat
      },
      {
        cwd: cell.cwd.startsWith('/') ? cell.cwd : join(root, cell.cwd),
        message: cell.message,
        provider: cell.provider as never,
        model: cell.model,
        outDir: cellDir,
        openGoal: scenario?.setup?.openGoal === true,
        scenarioId: cell.scenarioId,
        timeoutMs: Number(process.env.ROCKET_EVAL_CELL_TIMEOUT_MS ?? 600_000)
      }
    )
    const graders = cell.graders?.length ? cell.graders.join(',') : 'turn_completed'
    const gradeScript = join(root, 'scripts/grade-turn.mjs')
    execFileSync(process.execPath, [gradeScript, outcome.turnPath, '--graders', graders, '--out', join(cellDir, 'graders.json')], {
      stdio: 'inherit',
      cwd: root
    })
    const graded = JSON.parse(readFileSync(join(cellDir, 'graders.json'), 'utf8')) as { allPass: boolean }
    results.push({
      index,
      scenarioId: cell.scenarioId,
      provider: cell.provider,
      model: cell.model,
      trial: cell.trial,
      turnId: outcome.turnId,
      turnPath: outcome.turnPath,
      pass: graded.allPass
    })
  }
} finally {
  await runtime.shutdown()
  stopAllProcessGroups()
}

const summary = {
  runDir,
  manifest: manifestPath,
  finishedAt: new Date().toISOString(),
  cellCount: results.length,
  passCount: results.filter((row) => row.pass).length,
  cells: results
}
writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(`\nSummary: ${summary.passCount}/${summary.cellCount} passed → ${join(runDir, 'summary.json')}`)
process.exit(summary.passCount === summary.cellCount ? 0 : 1)
