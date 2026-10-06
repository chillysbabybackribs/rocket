import type { ProviderId } from '../shared/types.ts'
import type { ProviderAdapter, RunRequest, RunResult, TurnSink } from './providers/provider.ts'
import { unavailableUsage } from './providers/provider.ts'

/** Instant completed turns — matrix plumbing without live providers or UI-test profile. */
function fixtureAdapter(id: ProviderId): ProviderAdapter {
  return {
    id,
    async run(request: RunRequest, sink: TurnSink): Promise<RunResult> {
      sink.session(`eval-${id}`)
      sink.model(request.model ?? 'eval-fixture')
      sink.item({
        type: 'assistant',
        id: `${request.turnId}:reply`,
        turnId: request.turnId,
        text: `Eval fixture (${id}): received the scenario message.`,
        streaming: false
      })
      return { status: 'completed' }
    },
    async prepare(): Promise<void> {},
    async stop(): Promise<void> {},
    forget(): void {},
    async usage() { return unavailableUsage(id, 'eval-fixture') },
    async models() { return [] },
    shutdown(): void {}
  }
}

export function evalFixtureAdapters(): Record<ProviderId, ProviderAdapter> {
  return {
    claude: fixtureAdapter('claude'),
    codex: fixtureAdapter('codex'),
    cursor: fixtureAdapter('cursor'),
    antigravity: fixtureAdapter('antigravity')
  }
}
