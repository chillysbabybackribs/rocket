import {
  app, BrowserWindow, dialog, ipcMain, MessageChannelMain, shell, utilityProcess, type UtilityProcess
} from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BrowserAgentReply, BrowserAgentRequest, BrowserCommand } from '../shared/types.ts'
import { HOST_PORT_MESSAGE } from '../shared/types.ts'
import { readChatLink } from './chat-links.ts'
import { BrowserAgent } from './browser-agent.ts'
import { BrowserPane } from './browser-pane.ts'
import { appendJournal } from '../host/journal.ts'
import { uiTestProfile } from '../host/ui-test.ts'
import { isolateUiTestNetwork } from './ui-test-network.ts'
import { captureUiSnapshot } from './ui-snapshot.ts'
import { liveUiConnection } from './ui-connection.ts'

// Electron's main process does three things and nothing else: it owns the window, it owns the
// embedded browser view, and it forks the agent host and introduces it to the renderer over a
// MessageChannel. Chat traffic never passes through here.

// ROCKET_USER_DATA points the app at another profile folder, so a test run never touches real chats.
const testProfile = uiTestProfile()
if (process.env.ROCKET_USER_DATA) app.setPath('userData', process.env.ROCKET_USER_DATA)
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
app.commandLine.appendSwitch('remote-debugging-port', '0')

let window: BrowserWindow | null = null
let host: UtilityProcess | null = null
let browser: BrowserPane | null = null
let browserAgent: BrowserAgent | null = null
let quitting = false

function startHost(): UtilityProcess {
  const child = utilityProcess.fork(join(import.meta.dirname, 'host.js'), [], {
    serviceName: 'Rocket Agent Host',
    env: { ...process.env, ROCKET_DATA_DIR: app.getPath('userData') },
    stdio: 'inherit'
  })
  // The host's browser tools: one request in, one answer out, the work done here beside the pages.
  child.on('message', (message: BrowserAgentRequest) => {
    if (message?.type !== 'browser') return
    const reply = (answer: { ok: true; result: unknown } | { ok: false; error: string }): void => {
      if (host === child) child.postMessage({ type: 'browserReply', id: message.id, ...answer } satisfies BrowserAgentReply)
    }
    Promise.resolve()
      .then(() => {
        if (message.op.op === 'uiConnection') {
          if (!window) throw new Error('Rocket’s window is closed.')
          return liveUiConnection(window)
        }
        if (message.op.op === 'uiResize') {
          if (!window) throw new Error('Rocket’s window is closed.')
          const { width, height } = message.op
          if (!Number.isInteger(width) || !Number.isInteger(height) || width < 880 || height < 560 || width > 4000 || height > 2400) throw new Error('Use a window size between 880×560 and 4000×2400.')
          window.setSize(width, height)
          return { width, height }
        }
        if (message.op.op === 'uiSnapshot') {
          if (!window) throw new Error('Rocket’s window is closed. Open the app and try again.')
          return captureUiSnapshot(window)
        }
        if (!browserAgent) throw new Error('The browser is not open')
        return browserAgent.handle(message.op)
      })
      .then((result) => reply({ ok: true, result }), (error: unknown) => reply({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  })
  child.on('exit', (code) => {
    if (host !== child) return
    host = null
    if (quitting) return
    console.error(`[main] agent host exited with code ${code}; restarting`)
    appendJournal(join(app.getPath('userData'), 'journal.jsonl'), {
      at: Date.now(), source: 'main', severity: 'error', kind: 'restart', message: `The agent host exited with code ${code} and was restarted`
    })
    host = startHost()
    connectRenderer()
  })
  return child
}

/** Give the renderer a fresh port to the host. Called when the page asks, and after a host restart. */
function connectRenderer(): void {
  if (!window || window.isDestroyed() || !host) return
  const { port1, port2 } = new MessageChannelMain()
  host.postMessage({ type: 'connect' }, [port1])
  window.webContents.postMessage(HOST_PORT_MESSAGE, null, [port2])
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 880,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: '#08090a',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // An ESM preload cannot run in a sandboxed renderer; the page loads only this app's own UI.
      sandbox: false
    }
  })
  browser = new BrowserPane(window)
  browserAgent = new BrowserAgent(browser)
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => {
    window = null
    browser = null
    browserAgent = null
  })
  // The UI never navigates; anything that tries opens in the system browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window?.webContents.getURL()) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))

  // Development hooks for checking the interface from a script. ROCKET_CAPTURE=<file.png> saves
  // a picture of the UI a few seconds after load, ROCKET_CAPTURE_SCRIPT=<file.js> first runs that
  // script in the page (to click through a flow), and ROCKET_CAPTURE_EXIT=1 quits afterwards.
  const capture = process.env.ROCKET_CAPTURE
  if (capture) {
    window.webContents.once('did-finish-load', () => {
      const script = process.env.ROCKET_CAPTURE_SCRIPT
      if (script) {
        setTimeout(() => {
          void readFile(script, 'utf8')
            .then((source) => window?.webContents.executeJavaScript(source, true))
            .catch((error: unknown) => console.error('[main] capture script failed:', error))
        }, 2_000)
      }
      setTimeout(async () => {
        const image = await window?.webContents.capturePage()
        if (image) await writeFile(capture, image.toPNG())
        if (process.env.ROCKET_CAPTURE_EXIT === '1') app.quit()
      }, Number(process.env.ROCKET_CAPTURE_DELAY_MS ?? 4_000))
    })
  }
}

ipcMain.on('rocket:request-host-port', (event) => {
  if (event.sender === window?.webContents) connectRenderer()
})
ipcMain.on('rocket:window', (event, action: string) => {
  if (event.sender !== window?.webContents || !window) return
  if (action === 'minimize') window.minimize()
  else if (action === 'toggleMaximize') window.isMaximized() ? window.unmaximize() : window.maximize()
  else if (action === 'close') window.close()
})
ipcMain.handle('rocket:pick-folder', async (event, current: string | null) => {
  if (event.sender !== window?.webContents || !window) return null
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose the folder this chat works in',
    defaultPath: current || homedir(),
    properties: ['openDirectory', 'createDirectory']
  })
  return result.canceled ? null : result.filePaths[0] ?? null
})
ipcMain.handle('rocket:chat-link', (event, href: string, cwd: string) => {
  if (event.sender !== window?.webContents) throw new Error('This link cannot be opened from this window.')
  return readChatLink(href, cwd)
})
ipcMain.handle('rocket:eval-panel-url', () => {
  const html = join(app.getAppPath(), 'docs/evals/mock-ui/index.html')
  return pathToFileURL(html).href
})
ipcMain.on('rocket:browser', (event, command: BrowserCommand) => {
  browser?.handle(event.sender, command)
})

// `rocket <path or URL>` opens it inside the app, as a link in the chat would: a page in a
// browser tab, a text file in the artifact panel. A second launch hands its arguments to the
// instance already running and exits; the first launch opens its argument once the page is up.
// The lock is per profile folder, so a test profile never reaches the real window.
function openTargetOf(argv: string[], cwd: string): { href: string; cwd: string } | null {
  const own = new Set(['.', app.getAppPath()])
  const arg = argv.slice(1).findLast((value) => value && !value.startsWith('-') && !own.has(value))
  if (!arg) return null
  return { href: /^(https?|file):/i.test(arg) ? arg : resolve(cwd, arg), cwd }
}

function openInWindow(target: { href: string; cwd: string } | null): void {
  if (!target || !window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.focus()
  window.webContents.send('rocket:open', target)
}

// A launch that loses the lock quits here and must start nothing: `ready` still fires on the
// way out, and a second host in the same profile would fight the first over its files.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv, cwd) => openInWindow(openTargetOf(argv, cwd)))
  app.whenReady().then(() => {
    if (testProfile) isolateUiTestNetwork(process.env.ROCKET_UI_TEST_ORIGIN)
    host = startHost()
    createWindow()
    const first = openTargetOf(process.argv, process.cwd())
    if (first) window?.webContents.once('did-finish-load', () => openInWindow(first))
  })
}

app.on('window-all-closed', () => app.quit())

app.on('before-quit', (event) => {
  if (quitting || !host) return
  // Let the host stop its provider processes before it goes; it exits on its own when done.
  quitting = true
  event.preventDefault()
  const child = host
  const done = (): void => app.quit()
  child.once('exit', done)
  child.postMessage({ type: 'shutdown' })
  setTimeout(() => {
    child.kill()
    done()
  }, 3_000).unref()
})
