#!/usr/bin/env node
// Expand scenario JSONL into a run plan (cells × trials). Execution hooks up to host eval RPC or manual dogfood.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const scenarioPath = process.argv[2] ?? join(root, 'docs/evals/scenarios/goal-draft-minimal.jsonl')
const lines = readFileSync(scenarioPath, 'utf8').split('\n').filter(Boolean)
const scenarios = lines.map((line, index) => {
  try { return JSON.parse(line) }
  catch { throw new Error(`Invalid JSONL at ${scenarioPath}:${index + 1}`) }
})

const cells = []
for (const scenario of scenarios) {
  const trials = scenario.trials ?? 1
  for (const cell of scenario.matrix?.include ?? []) {
    for (let trial = 0; trial < trials; trial++) {
      cells.push({
        scenarioId: scenario.id,
        provider: cell.provider,
        model: cell.model,
        trial,
        cwd: join(root, scenario.cwd),
        message: scenario.message,
        graders: scenario.graders ?? [],
      })
    }
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const out = join(root, '.artifacts/evals', `${stamp}-plan`)
mkdirSync(out, { recursive: true })
const manifest = {
  createdAt: new Date().toISOString(),
  scenarioFile: scenarioPath,
  scenarioCount: scenarios.length,
  cellCount: cells.length,
  cells,
  note: 'Run each cell in the live app (pick provider/model, send message), then grade with scripts/grade-turn.mjs when turn export exists.',
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`Matrix plan: ${cells.length} cells → ${out}/manifest.json`)
for (const cell of cells) {
  console.log(`  [trial ${cell.trial}] ${cell.scenarioId} · ${cell.provider}${cell.model ? ` (${cell.model})` : ''}`)
}
