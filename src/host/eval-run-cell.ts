import { mkdirSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { ProviderId } from '../shared/types.ts'
import type { EvalExport } from './eval-export.ts'
import type { GoalRunner } from './goals.ts'
import type { Hub, TurnTiming } from './hub.ts'
import type { Store } from './store.ts'

export type RunEvalCellInput = {
  cwd: string
  message: string
  provider: ProviderId
  model: string | null
  outDir: string
  openGoal?: boolean
  scenarioId?: string
  timeoutMs?: number
  /**
   * Tag the chat for turn export (the CLI matrix). The eval panel's runs export each turn
   * themselves into the cell's folder, so they leave it off.
   */
  tag?: boolean
}

export type RunEvalCellResult = {
  turnId: string
  chatId: string
  turnPath: string
  cellDir: string
}

export type EvalCellDeps = {
  hub: Hub
  goals: GoalRunner
  store: Store
  evalExport: EvalExport
  timingForChat: (chatId: string) => TurnTiming | undefined
}

export function modelSlug(model: string | null): string {
  if (!model) return 'default'
  return model.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'default'
}

export function cellDirectory(
  base: string,
  scenarioId: string,
  provider: ProviderId,
  model: string | null,
  trial: number
): string {
  return resolve(base, 'cells', `${scenarioId}__${provider}__${modelSlug(model)}__trial${trial}`)
}

export type StartedEvalCell = {
  turnId: string
  chatId: string
  cellDir: string
}

export function startEvalCell(deps: EvalCellDeps, input: RunEvalCellInput): StartedEvalCell {
  const cwd = isAbsolute(input.cwd) ? input.cwd : resolve(input.cwd)
  mkdirSync(input.outDir, { recursive: true })
  // The turn is exported to `outDir` by name when it ends (finishEvalCell). Setting the export's
  // shared cell folder here instead would send every later turn, from any chat or a run beside
  // this one, into this cell.
  const tag = input.tag !== false

  if (input.openGoal) {
    const goal = deps.goals.draft({
      cwd,
      text: input.message,
      provider: input.provider,
      model: input.model
    })
    if (tag) deps.evalExport.tagChat(goal.chatId)
    const running = deps.store.turns(goal.chatId).find((turn) => turn.status === 'running')
    if (!running) throw new Error('Goal draft did not start a turn')
    return { chatId: goal.chatId, turnId: running.id, cellDir: input.outDir }
  }

  const chat = deps.hub.createChat(cwd, input.scenarioId ? `[eval] ${input.scenarioId}` : '[eval]')
  if (tag) deps.evalExport.tagChat(chat.id)
  const turnId = deps.hub.send(chat.id, input.provider, input.model, input.message)
  return { chatId: chat.id, turnId, cellDir: input.outDir }
}

export async function finishEvalCell(
  deps: EvalCellDeps,
  started: StartedEvalCell,
  input: Pick<RunEvalCellInput, 'timeoutMs'>
): Promise<RunEvalCellResult> {
  await deps.hub.waitForTurn(started.chatId, { turnId: started.turnId, timeoutMs: input.timeoutMs })
  const timing = deps.timingForChat(started.chatId)
  const turnPath = deps.evalExport.exportTurn(started.turnId, timing ?? null, started.cellDir)
  if (!turnPath) throw new Error('Turn export failed')
  return { turnId: started.turnId, chatId: started.chatId, turnPath, cellDir: started.cellDir }
}

export async function runEvalCell(deps: EvalCellDeps, input: RunEvalCellInput): Promise<RunEvalCellResult> {
  const started = startEvalCell(deps, input)
  return finishEvalCell(deps, started, input)
}
