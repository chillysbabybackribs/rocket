import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EvalRun, EvalRunCell, ProviderId } from '../shared/types.ts'
import { messageOf } from './json.ts'
import { gradeTurnFile } from './eval-grade.ts'
import { cellDirectory, finishEvalCell, startEvalCell, type EvalCellDeps } from './eval-run-cell.ts'
import type { EvalScenario } from './eval-scenarios.ts'
import { makeWorkspace, workspaceChanges } from './eval-workspace.ts'

// Eval runs from the panel: a scenario's message sent to every provider in its matrix, every
// trial in a fresh copy of the scenario's folder, graded when its turn ends, and saved so the
// panel shows the history after a restart.
//
// Cells are independent, so they run side by side, as eval tools commonly run cases: one lane per
// provider, the providers in parallel and each provider's trials one after another. One cell per
// provider at a time is not only about rate limits: the tool channel gives a tool call to the chat
// its provider is answering, which it only knows while the provider answers exactly one chat
// (Hub.runningChat). So a cell also waits while another turn of its provider, such as the user's
// own chat, is running. A scenario marked `runsAlone` uses the one app window or browser, so its
// cells go one at a time across all providers.
//
// Each run lives in `<root>/<run id>/`: `run.json`, and per cell the exported `turn.json`, the
// `graders.json` the tool scores read, and `folder/` with the copy the turn worked in.

const CELL_TIMEOUT_MS = 15 * 60_000
const PROVIDER_WAIT_MS = 1_000

export function evalRunsRoot(dataDir: string): string {
  return join(dataDir, 'eval-live')
}

export type EvalRunDeps = EvalCellDeps & {
  root: string
  scenarios: () => EvalScenario[]
  emit: (run: EvalRun) => void
  /** A turn of this provider is in flight, in any chat. */
  providerBusy: (provider: ProviderId) => boolean
  timeoutMs?: number
}

export class EvalRuns {
  private readonly runs = new Map<string, EvalRun>()
  private readonly stopping = new Set<string>()

  constructor(private readonly deps: EvalRunDeps) {
    this.load()
  }

  /** Newest first. */
  list(scenarioId?: string): EvalRun[] {
    return [...this.runs.values()]
      .filter((run) => !scenarioId || run.scenarioId === scenarioId)
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  /** The folder every eval run's copies live under, to keep their chats out of the chat list. */
  holds(cwd: string): boolean {
    return cwd.startsWith(this.deps.root + '/')
  }

  start(input: { scenarioId: string; message?: string }): EvalRun {
    const scenario = this.deps.scenarios().find((entry) => entry.id === input.scenarioId)
    if (!scenario) throw new Error(`There is no scenario "${input.scenarioId}". Add it under docs/evals/scenarios, or pick one from the list.`)
    const message = input.message?.trim() || scenario.message
    if (!message) throw new Error(`Scenario ${scenario.id} has no message. Write one before running it.`)
    const startedAt = Date.now()
    const run: EvalRun = {
      id: `${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}-${scenario.id}`,
      scenarioId: scenario.id,
      message,
      edited: message !== scenario.message,
      graders: scenario.graders,
      startedAt,
      endedAt: null,
      status: 'running',
      cells: scenario.matrix.flatMap((entry) => Array.from({ length: Math.max(1, scenario.trials) }, (_, trial): EvalRunCell => ({
        provider: entry.provider, model: entry.model, trial, status: 'queued', chatId: null, startedAt: null, endedAt: null,
        pass: null, grades: [], files: [], patch: '', error: null
      })))
    }
    this.runs.set(run.id, run)
    this.changed(run)
    void this.execute(run, scenario)
    return run
  }

  async stop(runId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (!run) throw new Error('That eval run no longer exists.')
    if (run.status !== 'running') return
    this.stopping.add(runId)
    for (const cell of run.cells) if (cell.status === 'queued') cell.status = 'stopped'
    this.changed(run)
    await Promise.all(run.cells.filter((cell) => cell.status === 'running' && cell.chatId).map((cell) => this.deps.hub.stop(cell.chatId!)))
  }

  private async execute(run: EvalRun, scenario: EvalScenario): Promise<void> {
    const lanes = new Map<ProviderId, EvalRunCell[]>()
    for (const cell of run.cells) lanes.set(cell.provider, [...lanes.get(cell.provider) ?? [], cell])
    const runLane = async (cells: EvalRunCell[]): Promise<void> => {
      for (const cell of cells) if (!this.stopping.has(run.id)) await this.runCell(run, scenario, cell)
    }
    if (scenario.runsAlone) for (const cells of lanes.values()) await runLane(cells)
    else await Promise.all([...lanes.values()].map(runLane))
    run.status = this.stopping.delete(run.id) ? 'stopped' : 'done'
    run.endedAt = Date.now()
    this.changed(run)
  }

  private async runCell(run: EvalRun, scenario: EvalScenario, cell: EvalRunCell): Promise<void> {
    while (this.deps.providerBusy(cell.provider)) {
      if (this.stopping.has(run.id)) return
      await new Promise((resolve) => setTimeout(resolve, PROVIDER_WAIT_MS))
    }
    if (this.stopping.has(run.id)) return
    cell.status = 'running'
    cell.startedAt = Date.now()
    this.changed(run)
    try {
      const dir = cellDirectory(join(this.deps.root, run.id), scenario.id, cell.provider, cell.model, cell.trial)
      mkdirSync(dir, { recursive: true })
      const workspace = makeWorkspace(scenario.cwd, join(dir, 'folder'))
      const started = startEvalCell(this.deps, {
        cwd: workspace.work,
        message: run.message,
        provider: cell.provider,
        model: cell.model,
        outDir: dir,
        openGoal: scenario.openGoal,
        scenarioId: scenario.id,
        tag: false
      })
      cell.chatId = started.chatId
      this.changed(run)
      const finished = await finishEvalCell(this.deps, started, { timeoutMs: this.deps.timeoutMs ?? CELL_TIMEOUT_MS })
      if (this.stopping.has(run.id)) {
        cell.status = 'stopped'
        return
      }
      const changes = workspaceChanges(workspace)
      const summary = gradeTurnFile(finished.turnPath, run.graders, { files: changes.files })
      writeFileSync(join(dir, 'graders.json'), JSON.stringify({ ...summary, turnPath: finished.turnPath }, null, 2))
      cell.files = changes.files
      cell.patch = changes.patch
      cell.grades = Object.entries(summary.graders).map(([name, row]) => ({
        name, pass: row.pass, ...(typeof row.metadata?.reason === 'string' ? { reason: row.metadata.reason } : {})
      }))
      cell.pass = summary.allPass
      cell.status = 'done'
    } catch (error) {
      cell.status = this.stopping.has(run.id) ? 'stopped' : 'error'
      cell.error = messageOf(error)
    } finally {
      cell.endedAt = Date.now()
      this.changed(run)
    }
  }

  private changed(run: EvalRun): void {
    const dir = join(this.deps.root, run.id)
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2))
    } catch {
      // The run still shows in the panel; only its history after a restart is lost.
    }
    this.deps.emit(structuredClone(run))
  }

  /** Read saved runs. One the app closed in the middle of is stopped where it was. */
  private load(): void {
    if (!existsSync(this.deps.root)) return
    for (const name of readdirSync(this.deps.root)) {
      const path = join(this.deps.root, name, 'run.json')
      if (!existsSync(path)) continue
      try {
        const run = JSON.parse(readFileSync(path, 'utf8')) as EvalRun
        if (!run.id || !Array.isArray(run.cells)) continue
        if (run.status === 'running') {
          run.status = 'stopped'
          run.endedAt ??= Date.now()
          for (const cell of run.cells) {
            if (cell.status !== 'queued' && cell.status !== 'running') continue
            cell.status = 'stopped'
            cell.error = 'The app closed while this cell was waiting or running.'
          }
          writeFileSync(path, JSON.stringify(run, null, 2))
        }
        this.runs.set(run.id, run)
      } catch {
        // A damaged run file is left on disk and out of the list.
      }
    }
  }
}
