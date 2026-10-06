import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { EvalRun, ProviderId } from '../shared/types.ts'
import { EvalExport } from './eval-export.ts'
import { EvalRuns } from './eval-runs.ts'
import type { EvalScenario } from './eval-scenarios.ts'
import { GoalRunner } from './goals.ts'
import { Hub } from './hub.ts'
import type { ProviderAdapter, RunRequest, RunResult, TurnSink } from './providers/provider.ts'
import { unavailableUsage } from './providers/provider.ts'
import { Store } from './store.ts'

/** Answers when told to; Claude's answer edits README.md in the folder it was given. */
class HeldAdapter implements ProviderAdapter {
  readonly pending: Array<{ request: RunRequest; finish: (result: RunResult) => void }> = []
  constructor(readonly id: ProviderId, private readonly onRun: () => void) {}

  run(request: RunRequest, sink: TurnSink): Promise<RunResult> {
    this.onRun()
    sink.session(`s-${request.chatId}`)
    if (this.id === 'claude') writeFileSync(join(request.cwd, 'README.md'), '# Fixture\nedited\n')
    sink.item({ type: 'assistant', id: `${request.turnId}:a`, turnId: request.turnId, text: 'Done.', streaming: false })
    return new Promise((finish) => { this.pending.push({ request, finish }) })
  }

  answer(): void { this.pending.shift()?.finish({ status: 'completed' }) }
  async prepare(): Promise<void> {}
  async stop(): Promise<void> {}
  forget(): void {}
  async usage() { return unavailableUsage(this.id, 'test') }
  async models() { return [] }
  shutdown(): void {}
}

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.ok(check(), 'timed out waiting')
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'rocket-eval-runs-'))
  const fixture = join(dir, 'fixture')
  mkdirSync(fixture)
  writeFileSync(join(fixture, 'README.md'), '# Fixture\n')
  const store = new Store(':memory:')
  let running = 0
  let most = 0
  const adapters = Object.fromEntries((['claude', 'codex', 'cursor', 'antigravity'] as const).map((id) => [id, new HeldAdapter(id, () => { running++; most = Math.max(most, running) })])) as Record<ProviderId, HeldAdapter>
  const hub = new Hub(store, adapters, (event) => { if (event.type === 'turn' && event.turn.status !== 'running') running-- })
  const goals = new GoalRunner(store, hub, () => {})
  const scenario: EvalScenario = {
    id: 'readme', file: 'test.jsonl', cwd: fixture, message: 'Change no files.', openGoal: false,
    graders: ['turn_completed', 'files_unchanged'], trials: 2, runsAlone: false,
    matrix: [{ provider: 'claude', model: null }, { provider: 'codex', model: null }]
  }
  const emitted: EvalRun[] = []
  const deps = {
    hub, goals, store,
    evalExport: new EvalExport(dir, dir, () => store, () => undefined),
    timingForChat: () => undefined,
    root: join(dir, 'eval-live'),
    scenarios: () => [scenario],
    emit: (run: EvalRun) => emitted.push(run),
    providerBusy: (provider: ProviderId) => hub.working().some((turn) => turn.provider === provider),
    timeoutMs: 5_000
  }
  return { dir, store, hub, adapters, deps, scenario, emitted, most: () => most }
}

test('a run puts providers side by side, each provider\'s trials in turn, and grades each copy', async () => {
  const { dir, store, adapters, deps, emitted, most } = setup()
  try {
    const runs = new EvalRuns(deps)
    const run = runs.start({ scenarioId: 'readme' })
    assert.equal(run.cells.length, 4)
    await until(() => adapters.claude.pending.length === 1 && adapters.codex.pending.length === 1)
    assert.equal(most(), 2, 'both providers run at once')
    assert.ok(runs.holds(adapters.claude.pending[0]!.request.cwd), 'the turn works in a copy under the eval root')
    assert.notEqual(adapters.claude.pending[0]!.request.cwd, deps.scenarios()[0]!.cwd)

    adapters.claude.answer()
    adapters.codex.answer()
    await until(() => adapters.claude.pending.length === 1 && adapters.codex.pending.length === 1 && runs.list()[0]!.cells.filter((cell) => cell.status === 'done').length === 2)
    adapters.claude.answer()
    adapters.codex.answer()
    await until(() => runs.list()[0]!.status === 'done')
    assert.equal(most(), 2, 'never two trials of one provider at once')

    const done = runs.list()[0]!
    const claude = done.cells.filter((cell) => cell.provider === 'claude')
    const codex = done.cells.filter((cell) => cell.provider === 'codex')
    assert.ok(claude.every((cell) => cell.pass === false && cell.files[0]?.path === 'README.md'))
    assert.ok(claude[0]!.grades.some((grade) => grade.name === 'files_unchanged' && grade.reason === 'changed README.md'))
    assert.ok(codex.every((cell) => cell.pass === true && cell.files.length === 0))
    assert.ok(emitted.length > 4)

    // Saved: a fresh runner in the same profile lists it.
    assert.equal(new EvalRuns(deps).list('readme')[0]!.id, done.id)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a cell waits while its provider is answering another chat, and a stopped run starts nothing more', async () => {
  const { dir, store, hub, adapters, deps } = setup()
  try {
    const mine = hub.createChat(dir, 'mine')
    hub.send(mine.id, 'claude', null, 'my own work')
    await until(() => adapters.claude.pending.length === 1)

    const runs = new EvalRuns(deps)
    const run = runs.start({ scenarioId: 'readme', message: 'Edited message.' })
    assert.equal(run.edited, true)
    await until(() => adapters.codex.pending.length === 1)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(adapters.claude.pending.length, 1, 'Claude\'s eval cell waits for the user\'s turn')
    assert.equal(adapters.codex.pending[0]!.request.text.includes('Edited message.'), true)

    await runs.stop(run.id)
    adapters.claude.answer()
    adapters.codex.answer()
    await until(() => runs.list()[0]!.status === 'stopped')
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    assert.equal(adapters.claude.pending.length, 0, 'no eval cell started after the stop')
    assert.ok(runs.list()[0]!.cells.every((cell) => cell.status === 'stopped'))
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
