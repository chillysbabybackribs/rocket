import { call } from './host.ts'
import { openChat } from './store.ts'
import type { ProviderId } from '../../shared/types.ts'

export type ScenarioCellResult = {
  allPass: boolean
  chatId: string
  grades: Array<{ name: string; pass: boolean; reason?: string }>
  /** Short text for playground grid cells */
  summary: string
}

/** Start a scenario cell, open the eval chat, wait for finish + graders. */
export async function runScenarioCell(input: {
  scenarioId: string
  provider: ProviderId
  trial?: number
}): Promise<ScenarioCellResult> {
  const { scenarios } = await call('eval.listScenarios', {})
  const scenario = scenarios.find((row) => row.id === input.scenarioId)
  if (!scenario) throw new Error(`Unknown scenario: ${input.scenarioId}`)
  const trial = input.trial ?? 0
  const started = await call('eval.startScenarioCell', {
    scenarioId: scenario.id,
    provider: input.provider,
    model: scenario.matrix.find((cell) => cell.provider === input.provider)?.model ?? null,
    trial,
    timeoutMs: 600_000
  })
  await openChat(started.chatId)
  const finished = await call('eval.finishScenarioCell', {
    chatId: started.chatId,
    turnId: started.turnId,
    cellDir: started.cellDir,
    graders: started.graders,
    timeoutMs: 600_000
  })
  const grades = Object.entries(finished.graders.graders).map(([name, row]) => ({
    name,
    pass: row.pass,
    reason: typeof row.metadata?.reason === 'string' ? row.metadata.reason : undefined
  }))
  const summary = finished.graders.allPass
    ? `Pass (${grades.filter((g) => g.pass).length}/${grades.length} graders)`
    : `Fail (${grades.filter((g) => g.pass).length}/${grades.length} graders)`
  return { allPass: finished.graders.allPass, chatId: started.chatId, grades, summary }
}
