import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ModelInfo, ProviderId, UsageSnapshot } from '../shared/types.ts'
import type { ProviderAdapter, RunRequest, RunResult, TurnSink } from './providers/provider.ts'

// UI tests replace only the provider boundary. The real host, store, ports and renderer still
// run. A marked, separate profile is required so test responses cannot enter normal chats.
export function uiTestProfile(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.ROCKET_UI_TEST !== '1') return null
  const profile = env.ROCKET_USER_DATA
  if (!profile || !isAbsolute(profile)
    || (env.ROCKET_DATA_DIR && resolve(env.ROCKET_DATA_DIR) !== resolve(profile))
    || !existsSync(join(profile, 'ui-test-profile'))
    || readFileSync(join(profile, 'ui-test-profile'), 'utf8') !== 'rocket-ui-check-v1') {
    throw new Error('UI testing requires a marked, isolated profile. Use npm run check:ui.')
  }
  return profile
}

export class UiTestAdapter implements ProviderAdapter {
  private readonly active = new Map<string, AbortController>()

  constructor(readonly id: ProviderId, private readonly profile: string) {}

  async run(request: RunRequest, sink: TurnSink): Promise<RunResult> {
    const controller = new AbortController()
    this.active.set(request.chatId, controller)
    const command = request.text.trim().split('\n').at(-1)
    try {
      sink.session(request.sessionId ?? `ui-${this.id}-${request.chatId}`)
      sink.model(request.model ?? 'ui-default')
      writeFileSync(join(this.profile, 'ui-request.json'), JSON.stringify({
        turnId: request.turnId, provider: this.id, model: request.model,
        sessionId: request.sessionId, cwd: request.cwd, handoffTurns: request.handoff?.turns ?? 0
      }))
      if (command === 'UI check: fail') return { status: 'failed', error: 'Controlled UI test failure.' }
      if (!['UI check: stream', 'UI check: stop', 'UI check: recover'].includes(command ?? '')) {
        return { status: 'failed', error: 'This isolated window uses UI test responses only.' }
      }
      const turnId = request.turnId
      sink.item({ type: 'reasoning', id: `${turnId}:thought`, turnId, text: 'Checking the controlled response.', streaming: false })
      sink.item({ type: 'tool', id: `${turnId}:tool`, turnId, kind: 'read', label: 'UI fixture', output: 'Fixture output is available.', status: 'done' })
      const id = `${turnId}:reply`
      sink.item({ type: 'assistant', id, turnId, text: '', streaming: true })
      sink.delta(id, `Streaming from ${this.id}.`)
      // The test releases this turn only after it has observed the partial response. No sleep
      // duration can accidentally make a streaming assertion inspect an already finished turn.
      const release = join(this.profile, `ui-release-${turnId}`)
      const deadline = Date.now() + 60_000
      while (!existsSync(release)) {
        if (Date.now() > deadline) throw new Error('The UI test did not release the controlled response.')
        await delay(25, undefined, { signal: controller.signal })
      }
      if (controller.signal.aborted) return { status: 'interrupted' }
      sink.delta(id, '\n\n**Complete.** The controlled response finished.')
      return { status: 'completed' }
    } catch (error) {
      if (controller.signal.aborted) return { status: 'interrupted' }
      throw error
    } finally {
      this.active.delete(request.chatId)
    }
  }

  async prepare(): Promise<void> {}
  async stop(chatId: string): Promise<void> { this.active.get(chatId)?.abort() }
  forget(chatId: string): void { this.active.get(chatId)?.abort() }
  shutdown(): void { for (const controller of this.active.values()) controller.abort() }

  async models(): Promise<ModelInfo[]> {
    return [
      { id: 'ui-default', label: 'UI default', description: 'Controlled test response', isDefault: true },
      { id: 'ui-alternate', label: 'UI alternate', description: 'Controlled alternate model', isDefault: false }
    ]
  }

  async usage(): Promise<UsageSnapshot> {
    return {
      provider: this.id, account: 'UI test', plan: 'Fixture', note: null, unavailable: null,
      windows: [{ label: 'Test window', percent: 25, resetsAt: null }], updatedAt: Date.now()
    }
  }
}
