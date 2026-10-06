import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { PROVIDERS, type ModelInfo, type ProviderId, type UsageSnapshot } from '../shared/types.ts'
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
  private readonly steered = new Map<string, Array<{ text: string; taken: () => void }>>()

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
      if (command === 'UI check: work') return this.work(request.turnId, sink, controller.signal)
      if (command === 'UI check: ask') return this.ask(request.turnId, sink)
      if (command === 'UI check: edit') return this.edit(request.turnId, request.cwd, sink)
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
      const steered = this.steered.get(request.chatId) ?? []
      if (steered.length) {
        // The release is the fixture's next step, where a real model would read the words.
        for (const steer of steered) steer.taken()
        sink.item({ type: 'tool', id: `${turnId}:after`, turnId, kind: 'edit', label: 'UI fixture, as asked', output: '', status: 'done' })
        sink.item({ type: 'assistant', id: `${turnId}:reply-after`, turnId, text: 'Carried on with the words added mid-turn.', streaming: false })
      }
      return { status: 'completed' }
    } catch (error) {
      if (controller.signal.aborted) return { status: 'interrupted' }
      throw error
    } finally {
      this.active.delete(request.chatId)
      this.steered.delete(request.chatId)
    }
  }

  /** Providers that steer for real take words into a running turn here too; the others make them wait. */
  async steer(chatId: string, text: string, taken: () => void): Promise<boolean> {
    if (!this.active.has(chatId) || !PROVIDERS.some((entry) => entry.id === this.id && entry.steers)) return false
    this.steered.set(chatId, [...this.steered.get(chatId) ?? [], { text, taken }])
    return true
  }

  /** A turn that really changes files in the chat's folder, so what the app records of a turn's changes can be seen. */
  private edit(turnId: string, cwd: string, sink: TurnSink): RunResult {
    const notes = join(cwd, 'notes.md')
    const before = existsSync(notes) ? readFileSync(notes, 'utf8') : ''
    writeFileSync(notes, `${before.replace('plain notes', 'notes with login')}\nEach person sees only their own notes.\n`)
    writeFileSync(join(cwd, 'auth.js'), "export function authOf(req) {\n  return req.headers.authorization ?? null\n}\n")
    sink.item({ type: 'tool', id: `${turnId}:tool`, turnId, kind: 'edit', label: `${notes}, ${join(cwd, 'auth.js')}`, output: '', status: 'done' })
    sink.item({ type: 'assistant', id: `${turnId}:reply`, turnId, text: 'Added a login check and noted it in the README.', streaming: false })
    return { status: 'completed' }
  }

  /** A turn that asks the user something, as the ask_user tool would, and carries on to a reply. */
  private ask(turnId: string, sink: TurnSink): RunResult {
    sink.item({ type: 'tool', id: `${turnId}:tool`, turnId, kind: 'read', label: 'package.json', output: '', status: 'done' })
    sink.item({
      type: 'question',
      id: `${turnId}:question`,
      turnId,
      text: 'Which database should the new service use?',
      options: [
        { label: 'Postgres', detail: 'What the other two services use, so one set of migrations and backups; one more thing to run locally.' },
        { label: 'SQLite', detail: 'Nothing to install and a single file to back up; sharing it between machines is harder.' },
        { label: 'Keep it in memory for now', detail: 'Fastest to build; nothing survives a restart, so the decision comes back later.' }
      ],
      recommended: 0,
      answer: null
    })
    const id = `${turnId}:reply`
    sink.item({ type: 'assistant', id, turnId, text: 'I have scaffolded the service and its tests; the storage layer is behind one interface, so the database can be wired in once you choose. Going with Postgres unless you pick otherwise.', streaming: false })
    return { status: 'completed' }
  }

  /**
   * A longer turn for watching the transcript by eye: words, tool calls, more words and a long
   * thought, paced like a model's, over about twenty seconds. It needs no release file.
   */
  private async work(turnId: string, sink: TurnSink, signal: AbortSignal): Promise<RunResult> {
    let n = 0
    const pause = (ms: number): Promise<void> => delay(ms, undefined, { signal })
    const say = async (text: string): Promise<void> => {
      const id = `${turnId}:say${n++}`
      sink.item({ type: 'assistant', id, turnId, text: '', streaming: true })
      for (const word of text.split(' ')) {
        sink.delta(id, `${word} `)
        await pause(40)
      }
      sink.item({ type: 'assistant', id, turnId, text, streaming: false })
    }
    const think = async (text: string): Promise<void> => {
      const id = `${turnId}:think${n++}`
      sink.item({ type: 'reasoning', id, turnId, text: '', streaming: true })
      for (const word of text.split(' ')) {
        sink.delta(id, `${word} `)
        await pause(30)
      }
      sink.item({ type: 'reasoning', id, turnId, text, streaming: false })
    }
    const tool = async (label: string): Promise<void> => {
      const id = `${turnId}:tool${n++}`
      sink.item({ type: 'tool', id, turnId, kind: 'command', label, output: '', status: 'running' })
      await pause(900)
      sink.item({ type: 'tool', id, turnId, kind: 'command', label, output: `Output of ${label}.`, status: 'done' })
    }
    await think('Reading the request. The user wants the transcript checked by eye, so this turn should look like a real one: a few sentences, some tool calls, and a thought long enough to need scrolling.')
    await say('Starting the check. First I will look at the current state of the code.')
    await tool('cat src/host/hub.ts')
    await tool('cat src/host/store.ts')
    await say('The code is clean. Reading the renderer next, the transcript component and its styles.')
    await think('The transcript shows one turn at a time. Its head carries the clock. Under it come the latest words, a summary of the steps so far, the live thought and the current tool. Each of these replaces the one before it in the same place, so the page does not grow while the turn works. The thought window grows with its text to seven lines and then scrolls, following the newest lines until the reader scrolls back. That is the behaviour under test here, and this thought is long enough to fill the window and go past it, so the fade at its top and the scrolling can both be seen. A reader who scrolls up stays where they are while more arrives, and the window follows the newest lines again once they return to the end. After the reply starts the window folds away, and the thought can be read again by opening the summary of the steps.')
    await tool('sed -n 1,80p src/renderer/src/components/Transcript.tsx')
    await tool('sed -n 500,640p src/renderer/src/styles.css')
    await tool('npm test')
    await say('Now the styles: the live window and the summary line.')
    await tool('npm run typecheck')
    await say('**Done.** The transcript keeps one shape while a turn works, and the finished turn folds its steps into one summary.')
    return { status: 'completed' }
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
