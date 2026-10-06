import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { wilsonLowerBound, loadToolEvalScores } from './tool-eval-scores.ts'
import { ToolLedger } from './tool-ledger.ts'
import type { Tool } from './tools/registry.ts'

test('wilson lower bound is conservative for small samples', () => {
  assert.ok(wilsonLowerBound(2, 2)! >= 0.34)
  assert.ok(wilsonLowerBound(1, 10)! < wilsonLowerBound(10, 10)!)
  assert.equal(wilsonLowerBound(0, 0), null)
})

test('loadToolEvalScores combines ledger R and eval-live P for targetTool scenarios', () => {
  const repo = mkdtempSync(join(tmpdir(), 'rocket-tool-eval-'))
  const profile = mkdtempSync(join(tmpdir(), 'rocket-tool-eval-prof-'))
  try {
    mkdirSync(join(repo, 'docs/evals/scenarios/tools'), { recursive: true })
    mkdirSync(join(repo, 'config'), { recursive: true })
    writeFileSync(join(repo, 'config/tool-eval-weights.json'), JSON.stringify({ wR: 0.5, wP: 0.5 }))
    writeFileSync(join(repo, 'docs/evals/scenarios/tools/x.jsonl'), JSON.stringify({
      id: 'probe-scenario', targetTool: 'probe', cwd: '.', message: 'hi', setup: { openGoal: false },
      matrix: { include: [{ provider: 'codex', model: null }] }, graders: ['turn_completed'], trials: 1
    }) + '\n')
    const cellDir = join(profile, 'eval-live', 'run1', 'cells', 'probe-scenario__codex__default__trial0')
    mkdirSync(cellDir, { recursive: true })
    writeFileSync(join(cellDir, 'graders.json'), JSON.stringify({ allPass: true }))

    const ledgerPath = join(profile, 'calls.db')
    const ledger = new ToolLedger(ledgerPath, 'build')
    const tool: Tool = { name: 'probe', description: 'x', inputSchema: { type: 'object' }, run: () => ({ content: [] }) }
    const id = ledger.start('probe', tool, {}, { provider: 'codex', chatId: 'c1' })
    ledger.finish(id, { content: [{ type: 'text', text: 'ok' }] })

    const scores = loadToolEvalScores(ledger, [tool], repo, profile)
    const row = scores.tools.find(t => t.tool === 'probe')
    assert.ok(row)
    assert.equal(row!.scenarioCells, 1)
    assert.equal(row!.p, 1)
    assert.ok(row!.r != null)
    assert.ok(row!.tes != null)
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(profile, { recursive: true, force: true })
  }
})
