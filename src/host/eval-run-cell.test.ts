import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { EvalExport } from './eval-export.ts'
import { runEvalCell } from './eval-run-cell.ts'
import { GoalRunner } from './goals.ts'
import { Hub } from './hub.ts'
import type { ProviderAdapter, RunRequest, RunResult, TurnSink } from './providers/provider.ts'
import { unavailableUsage } from './providers/provider.ts'
import { Store } from './store.ts'

class QuickAdapter implements ProviderAdapter {
  readonly id = 'claude' as const
  private finish: ((result: RunResult) => void) | null = null

  run(_request: RunRequest, sink: TurnSink): Promise<RunResult> {
    sink.session('s1')
    sink.item({ type: 'assistant', id: 'a', turnId: _request.turnId, text: 'done', streaming: false })
    return new Promise((resolve) => { this.finish = resolve })
  }

  complete(): void { this.finish?.({ status: 'completed' }) }
  async prepare(): Promise<void> {}
  async stop(): Promise<void> {}
  forget(): void {}
  async usage() { return unavailableUsage('claude', 'test') }
  async models() { return [] }
  shutdown(): void {}
}

test('runEvalCell exports a completed turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rocket-eval-cell-'))
  const store = new Store(':memory:')
  const adapter = new QuickAdapter()
  const adapters = { claude: adapter, codex: adapter, cursor: adapter, antigravity: adapter }
  const hub = new Hub(store, adapters, () => {})
  const goals = new GoalRunner(store, hub, () => {})
  const evalExport = new EvalExport(dir, dir, () => store, () => undefined)
  const cellDir = join(dir, 'cell')
  const pending = runEvalCell(
    { hub, goals, store, evalExport, timingForChat: () => undefined },
    { cwd: dir, message: 'hello eval', provider: 'claude', model: null, outDir: cellDir, timeoutMs: 5_000 }
  )
  adapter.complete()
  const result = await pending
  assert.ok(readFileSync(result.turnPath, 'utf8').includes('hello eval'))
  store.close()
  rmSync(dir, { recursive: true, force: true })
})
