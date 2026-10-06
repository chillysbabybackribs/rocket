#!/usr/bin/env node
// Run the same cases as evals/rocket-ui-regression.eval.ts locally (no Braintrust API).
// Usage: npm run eval:ui:local
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const csv = readFileSync(join(root, 'docs/evals/rocket-ui-regression.csv'), 'utf8')
const rows = []
for (const line of csv.split('\n').slice(1)) {
  if (!line.trim()) continue
  const match = line.match(/^"(.*)"\s*,\s*"(.*)"$/)
  if (!match) continue
  rows.push(JSON.parse(match[1].replace(/""/g, '"')))
}

function runNpm(args, env = process.env) {
  const started = Date.now()
  const result = spawnSync('npm', args, { cwd: root, encoding: 'utf8', env, timeout: 30 * 60 * 1000 })
  return { ms: Date.now() - started, status: result.status ?? 1, log: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

console.log(`Rocket UI eval (local): ${rows.length} cases\n`)
const prepStarted = Date.now()
let prep = runNpm(['run', 'build'])
if (prep.status !== 0) {
  console.error('Prepare failed at build')
  process.exit(1)
}
prep = runNpm(['test'])
const prepareMs = Date.now() - prepStarted
if (prep.status !== 0) {
  console.error('Prepare failed at unit tests')
  process.exit(1)
}
console.log(`Prepare (build + unit): ${(prepareMs / 1000).toFixed(1)}s\n`)

const grepEnv = { ...process.env, ROCKET_UI_SKIP_BUILD: '1', ROCKET_UI_SKIP_UNIT: '1' }
let failed = 0
for (const row of rows) {
  const grep = row.playwright_grep
  const label = row.scenario ?? grep
  process.stdout.write(`→ ${label} … `)
  const run = runNpm(['run', 'check:ui', '--', `--grep=${grep}`], grepEnv)
  const ok = run.status === 0
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} (${(run.ms / 1000).toFixed(1)}s)`)
  if (!ok) console.log(run.log.slice(-1200))
}

const totalSec = (prepareMs / 1000) + rows.length * 20 // rough
console.log(`\nDone: ${rows.length - failed}/${rows.length} passed.`)
console.log(`Typical full Braintrust run: ~${(prepareMs / 1000).toFixed(0)}s prepare + ~15–90s per case (ui-run/recovery slowest).`)
process.exit(failed ? 1 : 0)
