import { test as base, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

type Request = { turnId: string; provider: string; model: string | null; sessionId: string | null; cwd: string; handoffTurns: number }
type Rocket = {
  app: ElectronApplication
  page: Page
  profile: string
  workspace: string
  origin: string
  surface: (kind: 'browser' | 'suggestions') => Promise<Page>
  request: () => Promise<Request>
  release: () => Promise<void>
  capture: (name: string) => Promise<void>
}

export const test = base.extend<{ rocket: Rocket }>({
  rocket: async ({}, use, info) => {
    const profile = info.outputPath('profile')
    const workspace = info.outputPath('workspace')
    await mkdir(profile, { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFile(join(profile, 'ui-test-profile'), 'rocket-ui-check-v1')
    const server = createServer((request, response) => {
      if (request.url === '/favicon.ico') { response.writeHead(204).end(); return }
      const second = request.url === '/two'
      response.setHeader('Content-Type', 'text/html')
      response.end(`<!doctype html><title>UI page ${second ? 'two' : 'one'}</title>
        <style>body{font:20px system-ui;padding:24px;background:#eef3ff;color:#17264a}input,button{font:inherit;padding:8px}a{display:block;margin:24px 0}</style>
        <h1>Rocket browser check</h1><p>Local test page ${second ? 'two' : 'one'}</p>
        <a href="${second ? '/one' : '/two'}">Next page</a>
        <label>Test input <input aria-label="Test input"></label>
        <button onclick="document.getElementById('result').textContent='Clicked successfully'">Test button</button><p id="result">Ready</p>`)
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('The local fixture server did not start.')
    const origin = `http://127.0.0.1:${address.port}`
    await writeFile(join(profile, 'browser-tabs.json'), JSON.stringify({ active: 0, tabs: [{ url: `${origin}/one`, title: 'UI page one', favicon: null, pinned: false }] }))
    const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    const noSandbox = env.ROCKET_NO_SANDBOX === '1'
    // Never inherit the parent app's profile, capture script, provider mode or Electron binary.
    for (const name of Object.keys(env)) {
      if (/^(ROCKET_|ELECTRON_|__NV_PRIME_RENDER_OFFLOAD$|__GLX_VENDOR_LIBRARY_NAME$|__VK_LAYER_NV_optimus$)/.test(name)) delete env[name]
    }
    Object.assign(env, { NODE_ENV: 'test', ROCKET_UI_TEST: '1', ROCKET_USER_DATA: profile, ROCKET_AUTO_COMMIT: '0', ROCKET_SELF_CHECK: '1' })
    const errors: string[] = []
    const logs: string[] = []
    let app: ElectronApplication | undefined
    let tracing = false
    try {
      app = await _electron.launch({
        executablePath: createRequire(import.meta.url)('electron') as string,
        args: [resolve('.'), ...(noSandbox ? ['--no-sandbox'] : [])],
        cwd: resolve('.'), env, timeout: 30_000
      })
      const application = app
      application.process().stdout?.on('data', data => logs.push(String(data)))
      application.process().stderr?.on('data', data => logs.push(String(data)))
      application.context().setDefaultTimeout(10_000)
      const watch = (page: Page): void => {
        page.on('pageerror', error => errors.push(`${page.url()}: ${error.message}`))
        page.on('crash', () => errors.push(`Renderer crashed: ${page.url()}`))
        page.on('console', message => {
          logs.push(`[${message.type()}] ${page.url()}: ${message.text()}\n`)
          if (message.type() === 'error') errors.push(`${page.url()}: ${message.text()}`)
        })
      }
      for (const page of application.context().pages()) watch(page)
      application.context().on('page', watch)
      await application.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
      tracing = true
      const page = await application.firstWindow()
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
      await application.evaluate(({ BrowserWindow, dialog, session }, { origin, workspace }) => {
        BrowserWindow.getAllWindows()[0].setTitle('Rocket — UI check')
        // Exercise the folder button and its IPC response without automating an OS file picker.
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] })
        // New tabs normally open Google. Keep every test page local and cancel external HTTP.
        session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, done) => {
          if (details.url.startsWith(`${origin}/`)) done({})
          else if (details.url === 'https://www.google.com/') done({ redirectURL: `${origin}/one` })
          else done({ cancel: true })
        })
      }, { origin, workspace })
      const surface = async (kind: 'browser' | 'suggestions'): Promise<Page> => {
        const matches = (candidate: Page): boolean => kind === 'browser'
          ? candidate.url().startsWith(origin)
          : candidate.url().endsWith('/suggest.html')
        await expect.poll(() => application.context().pages().some(matches)).toBe(true)
        return application.context().pages().find(matches)!
      }
      const request = async (): Promise<Request> => JSON.parse(await readFile(join(profile, 'ui-request.json'), 'utf8')) as Request
      const capture = async (name: string): Promise<void> => {
        const shell = info.outputPath(`${name}-shell.png`)
        await page.screenshot({ path: shell })
        await info.attach(`${name}: app shell`, { path: shell, contentType: 'image/png' })
        const views = await application.evaluate(({ BrowserWindow, WebContentsView }) => BrowserWindow.getAllWindows()[0].contentView.children
          .filter(view => view instanceof WebContentsView && view.getVisible())
          .map(view => ({ url: (view as InstanceType<typeof WebContentsView>).webContents.getURL(), bounds: view.getBounds() })))
        await info.attach(`${name}: native view layout`, { body: JSON.stringify(views, null, 2), contentType: 'application/json' })
        for (const [index, view] of views.entries()) {
          const target = application.context().pages().find(candidate => candidate.url() === view.url)
          if (!target || target === page) continue
          const path = info.outputPath(`${name}-view-${index}.png`)
          await target.screenshot({ path })
          await info.attach(`${name}: ${view.url}`, { path, contentType: 'image/png' })
        }
        // CDP screenshots omit sibling native views. On this Linux app, X11 can capture the
        // actual composed window; other environments still retain each surface and its bounds.
        try {
          if (!process.env.DISPLAY) throw new Error('No X11 display is available.')
          const id = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0))
          const path = info.outputPath(`${name}-window.png`)
          await promisify(execFile)('import', ['-window', String(id), path], { timeout: 5_000 })
          await info.attach(`${name}: full window`, { path, contentType: 'image/png' })
        } catch (error) {
          await info.attach(`${name}: full-window capture unavailable`, { body: String(error), contentType: 'text/plain' })
        }
      }
      try {
        await use({ app: application, page, profile, workspace, origin, surface, request,
          release: async () => { await writeFile(join(profile, `ui-release-${(await request()).turnId}`), '') }, capture })
      } finally {
        if (info.status !== info.expectedStatus && !page.isClosed()) {
          await capture('failure').catch(error => logs.push(`Failure capture: ${String(error)}\n`))
        }
      }
    } finally {
      if (app) {
        if (tracing) {
          const path = info.outputPath('trace.zip')
          await app.context().tracing.stop({ path }).then(() => info.attach('Trace', { path, contentType: 'application/zip' })).catch(error => logs.push(String(error)))
        }
        await app.close().catch(error => { errors.push(`Closing test app: ${String(error)}`); app?.process().kill('SIGKILL') })
      }
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await info.attach('App log', { body: logs.join(''), contentType: 'text/plain' })
      const journal = await readFile(join(profile, 'journal.jsonl'), 'utf8').catch(() => '')
      await info.attach('Journal', { body: journal || '(empty)', contentType: 'text/plain' })
      expect(errors, 'No renderer errors, crashes, or shutdown failures').toEqual([])
    }
  }
})

export { expect }
