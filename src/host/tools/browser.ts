import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { AgentTab, BrowserAgentOp, ProviderId, ReadFocus } from '../../shared/types.ts'
import { messageOf, stringOf } from '../json.ts'
import { textResult, type Tool, type ToolContent, type ToolResult } from './registry.ts'

// The browser tools: three of them. `browser_read` turns a page into text a model can act on;
// `browser_run` runs a script the model writes, so a whole task (go, act, wait, extract) is one
// call rather than one call per click; `browser_screenshot` shows a tab as an image. The pages live in Electron's main process, so everything
// here ends as requests to main (shared/types.ts, BrowserAgentOp).
//
// Which tabs exist is not a tool: it rides at the head of the user's message (`browserContext`),
// so a model starts a turn already knowing what is open.

/** The way to main's browser. */
export type BrowserLink = { request: (op: BrowserAgentOp) => Promise<unknown> }

const RUN_SECONDS = { default: 30, max: 120 }
/** A result longer than this goes to a file, and the model is told where. */
const RESULT_LIMIT = 12_000
const RESULT_PREVIEW = 1_500
const FOCUSES: ReadFocus[] = ['all', 'text', 'elements', 'network']

const here = import.meta.dirname
/** Built, the worker sits beside the host's bundle; under plain Node it is the source file. */
const WORKER = [join(here, 'script-worker.js'), join(here, '..', 'script-worker.js')].find(existsSync) ?? join(here, 'script-worker.ts')

const READ_DESCRIPTION = `Read a web page in Rocket's built-in browser, where the user is signed in to their sites. Returns the page as text with links, its controls with refs (e12) that browser_run can click and fill, and the data requests the page made.
Pass url to go there first, in your own background tab (never the user's). Pass tab (an id such as t3 from the tab list) to read a tab that is already open. Pass neither to read your tab again.
Use this rather than fetching a URL yourself when a page needs the user's login or JavaScript to show its content.`

const RUN_DESCRIPTION = `Run a script in Rocket's built-in browser. One script should do a whole task: go, act, wait, extract, and return the result. Do as much per call as you can.
The script is the body of an async function. It has:
- tab: your background tab, or the one named by the tab argument. tab.goto(url) returns once the page's document is ready, so use waitFor for content that arrives later; tab.read({focus, selector, max}) gives the same text as browser_read; tab.eval(fn, arg) runs fn inside the page and returns its JSON result; tab.click(target); tab.fill(target, value); tab.press('Enter') or 'Control+a'; tab.type(text); tab.waitFor(target or fn, {timeout}); tab.requests(match) lists the tab's network log; tab.body(requestId) gives a response body as text; tab.info(); tab.screenshot() saves a JPEG and gives its path; tab.close().
- browser: browser.open(url) gives a new tab; browser.tab(id); browser.tabs(); browser.fetch(url, {method, headers, body}) requests with the browser's cookies and no CORS, giving {status, body} with body as text and a json() method.
- sleep(ms), console.log.
A target is a ref from browser_read (e12), text=Visible label, or a CSS selector. Clicks and keys are real input events.
Prefer data to UI: when a page loads what you need from a JSON endpoint (browser_read lists them), get it with tab.eval(() => fetch(...).then(r => r.json())) or browser.fetch rather than reading the screen.
A large result is saved to a file and its path returned.`

const SHOT_DESCRIPTION = `See a tab of Rocket's built-in browser as an image. For what text cannot tell you: layout, charts, images, canvas apps, or checking how a page looks. To read a page or find its controls, use browser_read, which is faster and exact.
Pass tab (an id such as t2 from the tab list) for a tab that is already open; without it, your own background tab is captured.`

export function browserTools(link: BrowserLink, resultsDir: string): Tool[] {
  return [
    {
      name: 'browser_read',
      description: READ_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Go here first.' },
          tab: { type: 'string', description: 'A tab id such as t3. Default: your own tab.' },
          focus: { type: 'string', enum: FOCUSES, description: 'all (default): text, controls and data requests, each kept short. text: more of the text. elements: every link and control. network: every request.' },
          selector: { type: 'string', description: 'Read only inside this element: a CSS selector, a ref, or text=…' },
          max: { type: 'number', description: 'Most characters of text (or most elements or requests) to return.' }
        },
        additionalProperties: false
      },
      run: async (args, context) => textResult(String(await link.request({
        op: 'read',
        chat: context.chatId,
        tab: stringOf(args.tab) || null,
        url: stringOf(args.url) || null,
        focus: FOCUSES.find((focus) => focus === args.focus) ?? 'all',
        selector: stringOf(args.selector) || null,
        max: typeof args.max === 'number' && args.max > 0 ? Math.round(args.max) : null
      })))
    },
    {
      name: 'browser_run',
      description: RUN_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The script: the body of an async function. Return the result.' },
          tab: { type: 'string', description: 'The tab `tab` starts as, such as t3. Default: your own tab.' },
          timeout: { type: 'number', description: `Seconds before the script is stopped. Default ${RUN_SECONDS.default}, at most ${RUN_SECONDS.max}.` }
        },
        required: ['code'],
        additionalProperties: false
      },
      run: (args, context) => runScript(link, resultsDir, {
        code: stringOf(args.code),
        tab: stringOf(args.tab) || null,
        chat: context.chatId,
        seconds: Math.min(Math.max(typeof args.timeout === 'number' ? args.timeout : RUN_SECONDS.default, 1), RUN_SECONDS.max)
      })
    },
    {
      name: 'browser_screenshot',
      description: SHOT_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          tab: { type: 'string', description: 'A tab id such as t2. Default: your own tab.' }
        },
        additionalProperties: false
      },
      run: async (args, context) => screenshotResult(await link.request({
        op: 'screenshot',
        chat: context.chatId,
        tab: stringOf(args.tab) || null
      }))
    }
  ]
}

function screenshotResult(raw: unknown): ToolResult {
  const shot = raw as { base64?: string; mimeType?: string; id?: string; title?: string; url?: string }
  if (!shot.base64) return { ...textResult('The screenshot could not be taken.'), isError: true }
  const label = shot.id ? `${shot.id}: ${shot.title || '(untitled)'} · ${shot.url || '(blank)'}` : 'browser tab'
  const content: ToolContent[] = [
    { type: 'text', text: `Screenshot of ${label}.` },
    { type: 'image', data: shot.base64, mimeType: shot.mimeType ?? 'image/png' }
  ]
  return { content }
}

type WorkerMessage =
  | { type: 'call'; id: number; op: Record<string, unknown> & { op: string } }
  | { type: 'log'; line: string }
  | { type: 'done'; ok: true; value: unknown }
  | { type: 'done'; ok: false; error: string }

async function runScript(
  link: BrowserLink, resultsDir: string, run: { code: string; tab: string | null; chat: string | null; seconds: number }
): Promise<ToolResult> {
  if (!run.code.trim()) return { ...textResult('There is no script to run.'), isError: true }
  const logs: string[] = []
  let touchedTab = false
  const worker = new Worker(WORKER, { workerData: { code: run.code, tab: run.tab } })
  const outcome = await new Promise<{ ok: true; value: unknown } | { ok: false; error: string }>((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: `The script was stopped after ${run.seconds}s. Do less per call, or pass a longer timeout.` }), run.seconds * 1_000)
    const settle = (result: { ok: true; value: unknown } | { ok: false; error: string }): void => {
      clearTimeout(timer)
      resolve(result)
    }
    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'log') logs.push(message.line)
      else if (message.type === 'done') settle(message)
      else {
        const forTab = 'tab' in message.op
        touchedTab ||= forTab || message.op.op === 'open'
        // The worker names tabs; which chat is asking is added here.
        const op = { ...message.op, ...(forTab || message.op.op === 'open' ? { chat: run.chat } : {}) } as BrowserAgentOp
        link.request(op).then(
          // A script has no use for image bytes; it gets a file it can name in what it returns.
          (result) => worker.postMessage({ id: message.id, ok: true, result: op.op === 'screenshot' ? saveShot(result, resultsDir, run.chat) : result }),
          (error: unknown) => worker.postMessage({ id: message.id, ok: false, error: messageOf(error) })
        )
      }
    })
    worker.on('error', (error) => settle({ ok: false, error: messageOf(error) }))
    worker.on('exit', () => settle({ ok: false, error: 'The script ended without a result.' }))
  })
  void worker.terminate()

  const parts: string[] = []
  if (logs.length) parts.push(logs.join('\n'))
  if (!outcome.ok) parts.push(`Error: ${outcome.error}`)
  else if (outcome.value !== undefined) parts.push(typeof outcome.value === 'string' ? outcome.value : JSON.stringify(outcome.value))
  else if (!logs.length) parts.push('(The script returned nothing.)')
  let text = parts.join('\n')
  if (text.length > RESULT_LIMIT) text = spill(text, resultsDir, run.chat, outcome.ok && typeof outcome.value !== 'string' && !logs.length)
  // Where the script left the tab, so the next step does not need a call to find out.
  if (touchedTab) {
    const where = await link.request({ op: 'info', chat: run.chat, tab: run.tab }).catch(() => null) as Pick<AgentTab, 'id' | 'url' | 'title'> | null
    if (where) text += `\n\n[tab ${where.id}: ${where.title || '(untitled)'} · ${where.url || '(blank)'}]`
  }
  return { ...textResult(text), isError: !outcome.ok }
}

function saveShot(raw: unknown, resultsDir: string, chat: string | null): { path: string } {
  const shot = raw as { base64: string }
  const dir = join(resultsDir, chat ?? 'shared')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `shot-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`)
  writeFileSync(path, Buffer.from(shot.base64, 'base64'))
  return { path }
}

/** Put an oversized result in a file and return the start of it with the path. */
function spill(text: string, resultsDir: string, chat: string | null, json: boolean): string {
  try {
    const dir = join(resultsDir, chat ?? 'shared')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.${json ? 'json' : 'txt'}`)
    writeFileSync(file, text)
    return `${text.slice(0, RESULT_PREVIEW)}\n[… the full result is ${text.length} characters, saved to ${file}]`
  } catch {
    return `${text.slice(0, RESULT_LIMIT)}\n[… cut at ${RESULT_LIMIT} of ${text.length} characters; return less]`
  }
}

/**
 * What is open in the browser, as a few lines for the head of a user's message. Null when the
 * provider's session for that chat was last told the same thing, or there is nothing to tell.
 * A `fresh` session has been told nothing, whatever the one before it was.
 */
export function browserContext(link: BrowserLink): (chatId: string, provider: ProviderId, fresh: boolean) => Promise<string | null> {
  const told = new Map<string, string>()
  const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
  return async (chatId, provider, fresh) => {
    // A turn never waits on this: a browser that is slow to answer is simply not described.
    const tabs = await Promise.race([
      link.request({ op: 'tabs' }).catch(() => null) as Promise<AgentTab[] | null>,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 400))
    ])
    const open = (tabs ?? []).filter((tab) => tab.url).slice(0, 12)
    const lines = open.map((tab) => `${tab.active ? '*' : '-'} ${tab.id}${tab.agent ? ' (yours)' : ''}  ${clip(tab.title || '(untitled)', 60)}  ${clip(tab.url, 140)}`).join('\n')
    const key = `${chatId}:${provider}`
    if (!fresh && told.get(key) === lines) return null
    told.set(key, lines)
    if (!lines) return null
    return `<browser>\nTabs open in Rocket's built-in browser (* is the one the user is looking at):\n${lines}\n</browser>`
  }
}
