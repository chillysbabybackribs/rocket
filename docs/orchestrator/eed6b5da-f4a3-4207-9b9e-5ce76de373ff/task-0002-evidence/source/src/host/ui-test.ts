import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { PROVIDERS, planItemId, type ModelInfo, type PlanStep, type ProviderId, type UsageSnapshot } from '../shared/types.ts'
import type { ProviderAdapter, RunRequest, RunResult, TurnSink } from './providers/provider.ts'
import { attachmentInput } from './providers/images.ts'
import { DEMO_TURNS, runDemoTurn } from './ui-demo.ts'
import { recordOf, stringOf } from './json.ts'

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

/** The controlled reply to a message with attachments, counting images and files apart. */
function received(attachments: NonNullable<RunRequest['attachments']>): string {
  const files = attachments.filter(each => each.kind === 'file').length
  const images = attachments.length - files
  return `Received ${[images ? `${images} image(s)` : '', files ? `${files} file(s)` : ''].filter(Boolean).join(' and ')}.`
}

export class UiTestAdapter implements ProviderAdapter {
  private readonly active = new Map<string, AbortController>()
  private readonly steered = new Map<string, Array<{ text: string; taken: () => void }>>()

  constructor(readonly id: ProviderId, private readonly profile: string) {}

  async run(request: RunRequest, sink: TurnSink): Promise<RunResult> {
    const controller = new AbortController()
    this.active.set(request.chatId, controller)
    let command = request.text.includes('<rocket-orchestration>') ? 'UI check: stream' : request.text.trim().split('\n').at(-1)
    try {
      sink.session(request.sessionId ?? `ui-${this.id}-${request.chatId}`)
      sink.model(request.model ?? 'ui-default')
      writeFileSync(join(this.profile, 'ui-request.json'), JSON.stringify({
        turnId: request.turnId, provider: this.id, model: request.model,
        sessionId: request.sessionId, cwd: request.cwd, handoffTurns: request.handoff?.turns ?? 0,
        attachments: request.attachments?.map(each => ({ id: each.id, kind: each.kind ?? 'image', name: each.name, path: each.path })) ?? [],
        // What a real adapter would put in the message for these attachments.
        input: attachmentInput(request.text, request.attachments).text
      }))
      if (command === 'UI check: orchestra-shell') {
        await this.orchestra(request, sink)
        command = 'UI check: stream'
      }
      if (command === 'UI check: fail') return { status: 'failed', error: 'Controlled UI test failure.' }
      if (request.text.includes('<rocket-fill>')) return await this.fill(request, sink, controller.signal)
      const demo = DEMO_TURNS[command ?? '']
      if (demo) return await runDemoTurn(demo, this.id, this.profile, request, sink, controller.signal)
      if (command === 'UI check: work') return this.work(request.turnId, sink, controller.signal)
      if (command === 'UI check: ask') return this.ask(request.turnId, sink)
      if (command === 'UI check: cite') return this.cite(request.turnId, sink)
      if (command === 'UI check: edit') return this.edit(request.turnId, request.cwd, sink)
      if (command === 'UI check: plan') return this.plan(request.turnId, sink, controller.signal)
      if (command === 'UI check: good evening') {
        sink.item({ type: 'assistant', id: `${request.turnId}:reply`, turnId: request.turnId, text: 'Good evening.', streaming: false })
        return { status: 'completed' }
      }
      if (request.attachments?.length && !['UI check: stream', 'UI check: stop', 'UI check: recover'].includes(command ?? '')) {
        sink.item({ type: 'assistant', id: `${request.turnId}:images`, turnId: request.turnId, text: received(request.attachments), streaming: false })
        return { status: 'completed' }
      }
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
      if (request.text.includes('Assignment: UI shell worker')) {
        const report = request.text.match(/Write your report to (.+?)\. Keep isolated evidence/)?.[1]
        if (!report || !resolve(report).startsWith(resolve(request.cwd) + '/')) throw new Error('Fixture report must stay in the isolated workspace.')
        writeFileSync(report, '# Controlled worker report\n\nObserved controlled streaming and completion. No external model was called.\n')
      }
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

  /** Call the real host tool from a controlled leader, retaining failures as evidence. */
  private async orchestra(request: RunRequest, sink: TurnSink): Promise<void> {
    const channel = recordOf(JSON.parse(readFileSync(join(this.profile, 'tool-channel.json'), 'utf8')))
    const url = `http://127.0.0.1:${channel.port}/mcp/${stringOf(channel.secret)}/${this.id}/${request.chatId}`
    const results: unknown[] = []
    const call = async (args: Record<string, unknown>): Promise<void> => {
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: results.length + 1, method: 'tools/call', params: { name: 'orchestrator', arguments: args } })
      })
      if (!response.ok) throw new Error(`Controlled orchestration tool returned HTTP ${response.status}.`)
      const body = recordOf(await response.json())
      if (body.error || !body.result) throw new Error('Controlled orchestration tool returned an invalid RPC response.')
      const result = recordOf(body.result)
      results.push(result)
      sink.item({ type: 'tool', id: `${request.turnId}:orchestra-${results.length}`, turnId: request.turnId,
        kind: 'mcp', label: `rocket · orchestrator ${JSON.stringify(args)}`, output: JSON.stringify(result),
        status: result.isError ? 'failed' : 'done' })
      if (result.isError && args.provider !== 'codex') throw new Error(JSON.stringify(result))
    }
    await call({ action: 'start', task: 'UI shell fixture: observe eight controlled workers.' })
    for (const provider of ['claude', 'cursor', 'antigravity', 'codex']) {
      await call({ action: 'dispatch', provider, task: `UI shell worker ${provider}` })
    }
    writeFileSync(join(this.profile, 'ui-orchestra.json'), JSON.stringify({ chatId: request.chatId, turnId: request.turnId, results }))
  }

  /** Providers that steer for real take words into a running turn here too; the others make them wait. */
  async steer(chatId: string, text: string, taken: () => void): Promise<boolean> {
    if (!this.active.has(chatId) || !PROVIDERS.some((entry) => entry.id === this.id && entry.steers)) return false
    this.steered.set(chatId, [...this.steered.get(chatId) ?? [], { text, taken }])
    return true
  }

  /**
   * A fill (src/host/fill.ts): a page read, a source opened, a moment's work, then a fill block
   * that names each field it filled. A field labelled as an email is left for the user, and a
   * page that says "UI check: hold" keeps the fill working until it is stopped.
   */
  private async fill(request: RunRequest, sink: TurnSink, signal: AbortSignal): Promise<RunResult> {
    const { turnId, text } = request
    sink.item({ type: 'tool', id: `${turnId}:read`, turnId, kind: 'mcp', label: 'rocket · browser_read {"tab":"t1"}', output: '', status: 'done' })
    sink.item({ type: 'tool', id: `${turnId}:web`, turnId, kind: 'web', label: 'https://wiki.example/rules', output: '', status: 'done' })
    const hold = text.includes('UI check: hold')
    const until = Date.now() + (hold ? 60_000 : 1_500)
    while (Date.now() < until) await delay(25, undefined, { signal })
    const how = text.includes('<user-messages>') ? 'In your voice' : text.includes('Make it shorter') ? 'Shorter' : 'Filled'
    const fields = [...text.matchAll(/^- (f\d+) · "([^"]*)"/gm)].map((match) => ({ id: match[1]!, label: match[2]! }))
    const values = Object.fromEntries(fields.filter((field) => !/email/i.test(field.label)).map((field) => [field.id, `${how} by ${this.id}: ${field.label}\nSecond line.`]))
    const left = Object.fromEntries(fields.filter((field) => /email/i.test(field.label)).map((field) => [field.id, 'needs your email']))
    sink.item({ type: 'assistant', id: `${turnId}:reply`, turnId, streaming: false, text: `Read the page.\n\`\`\`rocket-fill\n${JSON.stringify({ fields: values, left })}\n\`\`\`` })
    return { status: 'completed' }
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

  /**
   * A turn that keeps a plan, as Claude Code's TodoWrite does: the whole list each time, replaced
   * in place as steps finish. It holds at two of five until the test has seen the drawer open.
   */
  private async plan(turnId: string, sink: TurnSink, signal: AbortSignal): Promise<RunResult> {
    const lines = [
      'Read the existing API and its storage',
      'Add register and login with scrypt-hashed passwords',
      'Scope the notes routes to the logged-in user',
      'Write an isolation test: two users, each sees only their own',
      'Document the endpoints in the README'
    ]
    const plan = (done: number, doing: boolean): void => {
      const steps: PlanStep[] = lines.map((text, index) => ({ text, status: index < done ? 'done' : doing && index === done ? 'doing' : 'todo' }))
      sink.item({ type: 'plan', id: planItemId(turnId), turnId, steps })
    }
    plan(0, true)
    sink.item({ type: 'tool', id: `${turnId}:tool1`, turnId, kind: 'read', label: 'server.js', output: '', status: 'done' })
    plan(2, true)
    sink.item({ type: 'assistant', id: `${turnId}:say`, turnId, text: 'Plain Node with no dependencies. Keeping that: scrypt-hashed passwords, bearer-token sessions, and notes scoped to the logged-in user.', streaming: false })
    sink.item({ type: 'tool', id: `${turnId}:tool2`, turnId, kind: 'edit', label: 'server.js', output: '', status: 'running' })
    const release = join(this.profile, `ui-release-${turnId}`)
    const deadline = Date.now() + 60_000
    while (!existsSync(release)) {
      if (Date.now() > deadline) throw new Error('The UI test did not release the controlled response.')
      await delay(25, undefined, { signal })
    }
    sink.item({ type: 'tool', id: `${turnId}:tool2`, turnId, kind: 'edit', label: 'server.js', output: '', status: 'done' })
    plan(5, false)
    sink.item({ type: 'assistant', id: `${turnId}:reply`, turnId, text: '**Done.** Login is built, tested and documented; each user sees only their own notes.', streaming: false })
    return { status: 'completed' }
  }

  /**
   * A research turn: a search (a query, never a source), one page fetched with the provider's
   * own tool, and a reply that cites that page and one the turn never opened, so the marks on
   * the reply's links can be seen.
   */
  private cite(turnId: string, sink: TurnSink): RunResult {
    sink.item({ type: 'tool', id: `${turnId}:search`, turnId, kind: 'web', label: 'notes app login best practice', output: '', status: 'done' })
    sink.item({ type: 'tool', id: `${turnId}:fetch`, turnId, kind: 'web', label: 'https://docs.example.com/auth/sessions', output: '', status: 'done' })
    sink.item({
      type: 'assistant', id: `${turnId}:reply`, turnId, streaming: false,
      text: 'Sessions should be bearer tokens with a server-side store, per [the auth docs](https://docs.example.com/auth/sessions/). The cookie advice is reported by [a blog post](https://blog.example.org/cookies-vs-tokens) I could not open, so it is not verified.'
    })
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
