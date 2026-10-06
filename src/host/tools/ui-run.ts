import { existsSync, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ChildProcess } from 'node:child_process'
import type { UiRunRequest } from '../../shared/types.ts'
import { recordOf, stringOf } from '../json.ts'
import { textResult, type Tool, type ToolContent, type ToolResult } from './registry.ts'

// The supervisor is plain Node on a private display. Keep it outside Electron's bundle so
// Playwright and script workers use their own process, while the host owns their entire tree.
type RunCommand = (command: string, args: string[], options: {
  cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal; onOutput: (data: Buffer) => void; onStart: (child: ChildProcess) => void; cleanupOnExit: boolean
}) => Promise<number>
type Session = {
  directory: string
  controller: AbortController
  child?: ChildProcess
  ready: Promise<void>
  completion: Promise<void>
  pending: Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>
  idle?: NodeJS.Timeout
  busy: boolean
  seq: number
}

const DESCRIPTION = `Interact with an isolated Rocket app using a persistent Playwright-style session for this chat. The first call builds current Rocket source into a private app folder, uses a fresh marked profile and scratch workspace, controlled providers, a local browser fixture and a private Xvfb display. No real model turns are sent. Later calls reuse the session; reset=true closes it and builds fresh source. build=false uses the existing out/ build for a new session. close=true ends the session.
code is the body of an async function. Await every action. page is the app shell:
page.getByRole('button', {name:'Show browser', exact:true}).click(); page.getByRole('textbox', {name:'Message', exact:true}).fill('UI check: plan'); page.locator('.turn').last().innerText().
Locators support getByRole, getByText, getByLabel, getByPlaceholder, getByTestId, locator, filter({hasText}), nth, first, last; actions click, dblclick, fill, press, pressSequentially, hover, check, uncheck, selectOption, scrollIntoViewIfNeeded, waitFor({state:'visible'|'hidden'}); reads count, isVisible, isEnabled, textContent, innerText, inputValue, getAttribute, boundingBox. Use string names/text (not RegExp) in locator options.
page.evaluate(fn,arg) and page.waitForFunction(fn,arg,options) inspect DOM; do not mutate app state to manufacture a passing UI. page.keyboard.press/type, page.title(), page.url() are available.
ui.surface('browser'|'suggestions') returns the same page API for native views; ui.resize(width,height); ui.read() returns visible shell controls and panels; ui.snapshot() returns capture metadata and includes the images in the tool result; ui.request() reads the latest controlled turn; ui.release() completes a held stream or plan; ui.restart() restarts the same profile and build. sleep(ms) and console.log exist.
Choose the scratch working folder using the normal folder button before sending UI check: stream, stop, recover, fail, ask, plan, edit or work. Stream/plan wait for ui.release(); ordinary prompts fail because providers are controlled.
Results include images by default, saved paths, logs, renderer errors and session/build identity. capture=false skips the automatic final image; failures still capture. Timeout closes the session. Idle sessions expire after ten minutes. This operates on the isolated app; rocket_ui_snapshot shows the live app.`

/** Keep tool metadata valid JSON even when several verbose snapshots exceed the text budget. */
export function uiRunResult(response: Record<string, unknown>, directory: string): ToolResult {
  const captures = Array.isArray(response.captures) ? response.captures : []
  const images: ToolContent[] = captures.flatMap(raw => {
    const content = recordOf(raw).content
    return Array.isArray(content) ? content as ToolContent[] : []
  })
  const metadata = { ...response, captures: captures.map(capture => recordOf(recordOf(capture).metadata)) }
  const fullResult = join(directory, `run-${response.id}.json`)
  if (JSON.stringify(metadata).length > 12_000) {
    metadata.captures = metadata.captures.map(capture => ({
      ...capture,
      shell: { ...recordOf(capture.shell), controls: [], controlsTruncated: true, controlsSavedIn: join(stringOf(capture.directory), 'snapshot.json') }
    }))
    Object.assign(metadata, { fullResult })
  }
  if (JSON.stringify(metadata).length > 16_000) {
    Object.assign(metadata, {
      value: { truncated: true, preview: JSON.stringify(response.value ?? null).slice(0, 4000), fullResult },
      logs: [JSON.stringify(response.logs ?? []).slice(0, 2000)],
      errors: [JSON.stringify(response.errors ?? []).slice(0, 2000)],
      fullResult
    })
  }
  return { content: [{ type: 'text', text: JSON.stringify(metadata, null, 2) }, ...images], ...(response.ok ? {} : { isError: true }) }
}

export function rocketSourceRoot(): string {
  const candidates = [process.env.ROCKET_UI_SOURCE_ROOT, resolve(import.meta.dirname, '../..'), resolve(import.meta.dirname, '../../..')]
  const root = candidates.find(candidate => candidate && existsSync(join(candidate, 'scripts/ui-runner.mjs')))
  return root ?? resolve(import.meta.dirname, '../..')
}

export class UiRunManager {
  private readonly sessions = new Map<string, Session>()
  private readonly active = new Set<string>()
  private readonly cancelledStarts = new Set<string>()
  private stopping = false

  constructor(private readonly root: string, private readonly output = join(root, '.artifacts/ui-run')) {}

  tools(): Tool[] {
    return [{
      name: 'rocket_ui_run', description: DESCRIPTION,
      inputSchema: {
        type: 'object', properties: {
          code: { type: 'string', description: 'Body of an async function using page, ui, sleep and console.' },
          reset: { type: 'boolean', description: 'Discard the session and start fresh, rebuilding by default.' },
          build: { type: 'boolean', description: 'Build current source for a new session. Default true; false uses existing out/.' },
          close: { type: 'boolean', description: 'Close this chat’s isolated session.' },
          capture: { type: 'boolean', description: 'Include a final snapshot. Default true; failures always capture.' },
          timeout: { type: 'number', minimum: 1, maximum: 120, description: 'Script timeout in seconds, default 30. Initial build/startup has its own deadline.' }
        }, additionalProperties: false
      },
      run: (args, context) => this.run(args, context.chatId)
    }]
  }

  async run(args: Record<string, unknown>, chatId: string | null): Promise<ToolResult> {
    if (chatId && this.active.has(chatId) && !args.close) return { ...textResult('This chat already has a UI script running. Wait for it to finish before making another call.'), isError: true }
    if (!args.close && chatId) this.active.add(chatId)
    try { return await this.execute(args, chatId) }
    catch (error) {
      if (chatId) await this.close(chatId)
      return { ...textResult(error instanceof Error ? error.message : String(error)), isError: true }
    } finally { if (!args.close && chatId) this.active.delete(chatId) }
  }

  private async execute(args: Record<string, unknown>, chatId: string | null): Promise<ToolResult> {
    if (!chatId) return { ...textResult('This call has no chat identity. Run rocket_ui_run from a Rocket chat.'), isError: true }
    if (this.stopping) return { ...textResult('Rocket is closing. Restart the app before inspecting its UI.'), isError: true }
    if (args.close && (args.reset || stringOf(args.code).trim())) return { ...textResult('Use close by itself, or run a script without close.'), isError: true }
    if (!args.close && !stringOf(args.code).trim()) return { ...textResult('Provide code to run in the isolated app, or close=true to end the session.'), isError: true }
    if (args.timeout !== undefined && (typeof args.timeout !== 'number' || !Number.isFinite(args.timeout) || args.timeout < 1 || args.timeout > 120)) return { ...textResult('Use a script timeout between 1 and 120 seconds.'), isError: true }
    if (this.sessions.get(chatId)?.busy && !args.close) return { ...textResult('This chat already has a UI script running. Wait for it to finish before making another call.'), isError: true }
    if (args.close) {
      if (this.active.has(chatId) && !this.sessions.has(chatId)) this.cancelledStarts.add(chatId)
      await this.close(chatId)
      return textResult('The isolated UI session is closed. Captures and traces remain in .artifacts/ui-run/.')
    }
    if (args.reset) await this.close(chatId)
    if (!this.sessions.has(chatId)) {
      const reserved = new Set([...this.sessions.keys(), ...this.active])
      if (reserved.size > 4) return { ...textResult('Four isolated UI sessions are open. Close an unused session before starting another.'), isError: true }
      await this.start(chatId, args.build !== false)
    }
    const session = this.sessions.get(chatId)!
    session.busy = true
    clearTimeout(session.idle)
    try {
      await session.ready
      const response = await this.request(session, { code: stringOf(args.code), timeout: typeof args.timeout === 'number' ? args.timeout : 30, capture: args.capture !== false }, (Number(args.timeout) || 30) * 1000 + 20_000)
      if (recordOf(response.session).open === false) await this.close(chatId)
      return uiRunResult(response, session.directory)
    } catch (error) {
      await this.close(chatId)
      return { ...textResult(`${error instanceof Error ? error.message : String(error)}\nRunner log: ${join(session.directory, 'runner.log')}`), isError: true }
    } finally {
      session.busy = false
      if (this.sessions.get(chatId) === session) {
        session.idle = setTimeout(() => { void this.close(chatId) }, 10 * 60_000)
        session.idle.unref()
      }
    }
  }

  private async start(chatId: string, build: boolean): Promise<void> {
    if (!existsSync(join(this.root, 'scripts/ui-runner.mjs'))) throw new Error('Rocket’s UI runner source is missing. Run this tool from a development installation of Rocket.')
    const module = await import(pathToFileURL(join(this.root, 'scripts/ui-process.mjs')).href) as { runCommand: RunCommand }
    await mkdir(this.output, { recursive: true })
    const directory = await mkdtemp(join(this.output, `${new Date().toISOString().replace(/[:.]/g, '-')}-`))
    if (this.stopping || this.cancelledStarts.delete(chatId)) throw new Error('The isolated UI session was closed before startup.')
    let readyResolve!: () => void, readyReject!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
    // Startup errors may arrive before run() starts awaiting this promise.
    void ready.catch(() => {})
    const session: Session = { directory, controller: new AbortController(), ready, completion: Promise.resolve(), pending: new Map(), busy: true, seq: 0 }
    this.sessions.set(chatId, session)
    const log = createWriteStream(join(directory, 'runner.log'))
    const timer = setTimeout(() => { readyReject(new Error('The isolated UI build or startup timed out.')); session.controller.abort() }, 180_000)
    const fail = (error: Error): void => {
      clearTimeout(timer)
      readyReject(error)
      for (const pending of session.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
      session.pending.clear()
    }
    let buffer = ''
    session.completion = module.runCommand('xvfb-run', ['-a', '--server-args=-screen 0 2560x1600x24', process.execPath, join(this.root, 'scripts/ui-runner.mjs'), this.root, directory, build ? 'build' : 'existing'], {
      cwd: this.root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, signal: session.controller.signal, onOutput: () => {}, cleanupOnExit: true,
      onStart: child => {
        session.child = child
        child.stdin?.on('error', error => fail(error))
        child.stderr?.on('data', data => log.write(data))
        child.stdout?.on('data', data => {
          buffer += String(data)
          let end: number
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
            try {
              const message = recordOf(JSON.parse(line))
              if (message.type === 'ready') { clearTimeout(timer); readyResolve() }
              else if (message.type === 'startupError') fail(new Error(stringOf(message.error)))
              else {
                const id = Number(message.id), pending = session.pending.get(id)
                if (pending) { session.pending.delete(id); clearTimeout(pending.timer); pending.resolve(message) }
              }
            } catch { log.write(`${line}\n`) }
          }
        })
      }
    }).then(status => { fail(new Error(`The isolated UI runner exited (${status}).`)) }, error => { fail(error) }).finally(() => log.end())
  }

  private request(session: Session, params: Omit<UiRunRequest, 'id'>, timeout: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = ++session.seq
      const timer = setTimeout(() => { session.pending.delete(id); reject(new Error('The isolated UI runner did not answer in time.')) }, timeout)
      session.pending.set(id, { resolve, reject, timer })
      session.child?.stdin?.write(`${JSON.stringify({ id, ...params })}\n`)
    })
  }

  async close(chatId: string): Promise<void> {
    const session = this.sessions.get(chatId)
    if (!session) return
    this.sessions.delete(chatId)
    clearTimeout(session.idle)
    if (session.child?.stdin?.writable && !session.busy) {
      await this.request(session, { close: true }, 10_000).catch(() => {})
    }
    session.controller.abort()
    await session.completion
  }

  async shutdown(): Promise<void> {
    this.stopping = true
    await Promise.all([...this.sessions.keys()].map(chatId => this.close(chatId)))
  }
}
