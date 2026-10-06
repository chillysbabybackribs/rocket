#!/usr/bin/env node
// Merge matrix summary.json files into docs/evals/mock-ui/live-data.json for the mock UI.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mockDir = join(root, 'docs/evals/mock-ui')
const artifacts = join(root, '.artifacts/evals')
const base = JSON.parse(readFileSync(join(mockDir, 'sample-data.json'), 'utf8'))

const experiments = [...base.experiments]

if (existsSync(artifacts)) {
  for (const name of readdirSync(artifacts)) {
    const runDir = join(artifacts, name)
    if (!statSync(runDir).isDirectory()) continue
    const summaryPath = join(runDir, 'summary.json')
    if (!existsSync(summaryPath)) continue
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
    const passCount = summary.passCount ?? summary.cells?.filter((c) => c.pass).length ?? 0
    const cellCount = summary.cellCount ?? summary.cells?.length ?? 0
    experiments.unshift({
      id: `exp-${name}`,
      name: name.replace(/-run$/, ''),
      createdAt: summary.finishedAt ?? summary.createdAt ?? new Date().toISOString(),
      datasetId: 'goal-draft-minimal',
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
        turnPath: cell.turnPath,
        graders: {}
      })),
      sourcePath: summaryPath
    })
  }
}

const out = { ...base, experiments, syncedAt: new Date().toISOString() }
writeFileSync(join(mockDir, 'live-data.json'), JSON.stringify(out, null, 2))
console.log(`Wrote ${experiments.length} experiment(s) → docs/evals/mock-ui/live-data.json`)
