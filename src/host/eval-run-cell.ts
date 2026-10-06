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

export async function runEvalCell(deps: EvalCellDeps, input: RunEvalCellInput): Promise<RunEvalCellResult> {
  const cwd = isAbsolute(input.cwd) ? input.cwd : resolve(input.cwd)
  mkdirSync(input.outDir, { recursive: true })
  deps.evalExport.setCellDir(input.outDir)

  let chatId: string
  let turnId: string

  if (input.openGoal) {
    const goal = deps.goals.draft({
      cwd,
      text: input.message,
      provider: input.provider,
      model: input.model
    })
    chatId = goal.chatId
    deps.evalExport.tagChat(chatId)
    const running = deps.store.turns(chatId).find((turn) => turn.status === 'running')
    if (!running) throw new Error('Goal draft did not start a turn')
    turnId = running.id
  } else {
    const chat = deps.hub.createChat(cwd, input.scenarioId ? `[eval] ${input.scenarioId}` : '[eval]')
    chatId = chat.id
    deps.evalExport.tagChat(chatId)
    turnId = deps.hub.send(chatId, input.provider, input.model, input.message)
  }

  await deps.hub.waitForTurn(chatId, { turnId, timeoutMs: input.timeoutMs })

  const timing = deps.timingForChat(chatId)
  const turnPath = deps.evalExport.exportTurn(turnId, timing ?? null, input.outDir)
  if (!turnPath) throw new Error('Turn export failed')

  return { turnId, chatId, turnPath, cellDir: input.outDir }
}
