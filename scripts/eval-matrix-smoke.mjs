#!/usr/bin/env node
// Plan + run matrix-smoke with fixture adapters (no API usage).
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const scenario = join(root, 'docs/evals/scenarios/matrix-smoke.jsonl')

execFileSync(process.execPath, [join(root, 'scripts/run-agent-matrix.mjs'), scenario], { stdio: 'inherit', cwd: root })

const artifacts = join(root, '.artifacts/evals')
const plan = readdirSync(artifacts)
  .filter((name) => name.endsWith('-plan'))
  .map((name) => ({ name, mtime: statSync(join(artifacts, name)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)[0]
if (!plan) throw new Error('No plan directory found')

const manifest = join(artifacts, plan.name, 'manifest.json')
const env = { ...process.env, ROCKET_EVAL_FIXTURE: '1', ROCKET_EVAL_MATRIX_RUN: '1' }
execFileSync(process.execPath, [
  '--experimental-transform-types',
  '--disable-warning=ExperimentalWarning',
  join(root, 'src/host/eval-matrix-runner.ts'),
  manifest,
  '--yes'
], { stdio: 'inherit', cwd: root, env })

execFileSync(process.execPath, [join(root, 'scripts/sync-eval-mock-data.mjs')], { stdio: 'inherit', cwd: root })
console.log('\nOpen the flask panel in Rocket (reload) to see the run in Experiments.')
