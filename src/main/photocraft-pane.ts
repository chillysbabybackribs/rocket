import { dialog, protocol, session, WebContentsView, type BrowserWindow, type Rectangle, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import type { Bounds, PhotocraftCommand, PhotocraftOp, PhotocraftState } from '../shared/types.ts'
import { conceal, reveal } from './browser-url.ts'
import { photocraftWebDir, staticFile } from './photocraft-files.ts'

// PhotoCraft beside the chat. Its web build (the PhotoCraft fork's apps/photocraft-web, built
// with Trunk) runs in a view of its own, laid over the region the UI reserves for it the way a
// browser tab is (browser-pane.ts). Loaded with `?control`, the page offers window.photocraft:
// the desktop app's control protocol without TCP, and a file store standing in for the disk
// (docs/photocraft-in-rocket-plan.md). The host's PhotoCraft tools reach it through here.
//
// The build is served from the privileged photocraft:// scheme rather than file: so the page is
// a secure context (WebGPU needs one) and carries the cross-origin isolation headers that
// WebAssembly threads need. Files cross through one-time URLs on the same scheme: the page
// fetches a file the host named and posts back what PhotoCraft saved, so a large PSD never
// travels as script text.
//
// The view is never hidden outright while PhotoCraft is closed: it is concealed like a background
// browser tab, so the page keeps drawing frames, and the control bridge only answers while it
// does.

const SCHEME = 'photocraft'
const ORIGIN = `${SCHEME}://app`
const PARTITION = 'persist:photocraft'
const START_URL = `${ORIGIN}/index.html?control`
const BRIDGE_TIMEOUT_MS = 90_000
const DEFAULT_SIZE = { width: 1280, height: 800 }

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2'
}

// Cross-origin isolation, so SharedArrayBuffer (WebAssembly threads) is available to a build
// that uses it; the current build runs the same either way.
const HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-cache'
}

/** Must run before the app is ready: Chromium fixes a scheme's privileges at startup. */
export function registerPhotocraftScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }
  ])
}

export class PhotocraftPane {
  private view: WebContentsView | null = null
  private bounds: Rectangle | null = null
  private size = DEFAULT_SIZE
  private state: PhotocraftState = { status: 'off', message: null, title: null }
  private ready: Promise<void> | null = null
  /** Files the page may fetch once, by token. */
  private readonly incoming = new Map<string, Buffer>()
  /** Where a file the page posts under a token is written. */
  private readonly outgoing = new Map<string, string>()
  private readonly root = photocraftWebDir()

  constructor(private readonly window: BrowserWindow) {
    const { protocol: pages } = session.fromPartition(PARTITION)
    // A window made again (after the last one closed) brings a pane of its own.
    if (pages.isProtocolHandled(SCHEME)) pages.unhandle(SCHEME)
    pages.handle(SCHEME, (request) => this.serve(request))
  }

  /** The panel's commands, from the renderer. */
  handle(sender: WebContents, command: PhotocraftCommand): void {
    if (sender !== this.window.webContents) return
    switch (command.type) {
      case 'setBounds': this.setBounds(command.bounds); break
      case 'sync': this.ensure(); this.publish(); break
      case 'reload': this.reload(); break
    }
  }

  /** The host's PhotoCraft tools. */
  async agent(op: PhotocraftOp): Promise<unknown> {
    if (op.call === 'status') return this.state
    if (op.call === 'show') {
      this.ensure()
      this.window.webContents.send('rocket:photocraft-show')
      return { shown: true }
    }
    const contents = await this.bridge()
    if (op.call === 'capture') {
      const image = await contents.capturePage()
      if (image.isEmpty()) throw new Error('PhotoCraft has not drawn anything yet. Open its panel and try again.')
      return { base64: image.toPNG().toString('base64'), mime: 'image/png', ...image.getSize() }
    }
    if (op.call === 'control') {
      const reply = await contents.executeJavaScript(`window.photocraft.call(${JSON.stringify(op.method)}, ${JSON.stringify(JSON.stringify(op.params ?? {}))})`, true) as string
      return JSON.parse(reply) as unknown
    }
    if (op.call === 'load') {
      const token = randomUUID()
      this.incoming.set(token, await readFile(op.file))
      try {
        const bytes = await contents.executeJavaScript(`fetch(${JSON.stringify(`${ORIGIN}/__in/${token}`)})
          .then((response) => { if (!response.ok) throw new Error('status ' + response.status); return response.arrayBuffer() })
          .then((buffer) => { window.photocraft.put(${JSON.stringify(op.path)}, new Uint8Array(buffer)); return buffer.byteLength })`, true) as number
        return { path: op.path, bytes }
      } finally {
        this.incoming.delete(token)
      }
    }
    const token = randomUUID()
    this.outgoing.set(token, op.file)
    try {
      const bytes = await contents.executeJavaScript(`(async () => {
        const bytes = window.photocraft.take(${JSON.stringify(op.path)})
        if (!bytes) return -1
        const response = await fetch(${JSON.stringify(`${ORIGIN}/__out/${token}`)}, { method: 'POST', body: bytes })
        return response.ok ? bytes.length : -2
      })()`, true) as number
      if (bytes === -1) throw new Error(`PhotoCraft saved nothing under ${op.path}. Save the document with app.save first.`)
      if (bytes === -2) throw new Error(`Rocket could not write ${op.file}. Check that the folder can be written to.`)
      return { file: op.file, bytes }
    } finally {
      this.outgoing.delete(token)
    }
  }

  dispose(): void {
    this.view?.webContents.close()
    this.view = null
  }

  // ── The page ────────────────────────────────────────────────────────

  private async serve(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.host !== 'app') return new Response('Not found', { status: 404 })
    const [, route, token] = url.pathname.split('/')
    if (route === '__in' && token) {
      const bytes = this.incoming.get(token)
      this.incoming.delete(token)
      return bytes ? new Response(new Uint8Array(bytes), { headers: { ...HEADERS, 'Content-Type': 'application/octet-stream' } }) : new Response('Gone', { status: 410 })
    }
    if (route === '__out' && token) {
      const file = this.outgoing.get(token)
      this.outgoing.delete(token)
      if (!file || request.method !== 'POST') return new Response('Gone', { status: 410 })
      try {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, Buffer.from(await request.arrayBuffer()))
        return new Response(null, { status: 204, headers: HEADERS })
      } catch {
        return new Response('Not written', { status: 500 })
      }
    }
    const file = staticFile(this.root, url.pathname)
    if (!file) return new Response('Not found', { status: 404 })
    try {
      return new Response(new Uint8Array(await readFile(file)), { headers: { ...HEADERS, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  }

  /** Make the view and load PhotoCraft, once. */
  private ensure(): void {
    if (this.view) return
    if (!existsSync(join(this.root, 'index.html'))) {
      this.setState({ status: 'missing', message: `PhotoCraft's web build is not in ${this.root}. Build it with \`trunk build --release\` in apps/photocraft-web of the PhotoCraft fork, or set ROCKET_PHOTOCRAFT_WEB to the folder that holds its index.html, then reload.`, title: null })
      return
    }
    const view = new WebContentsView({
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, backgroundThrottling: false }
    })
    this.view = view
    view.setBackgroundColor('#262626')
    this.window.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, ...this.size })
    const contents = view.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => { if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault() })
    // PhotoCraft asks before a reload would drop unsaved documents; the browser's prompt is ours to show.
    contents.on('will-prevent-unload', (event) => {
      const choice = dialog.showMessageBoxSync(this.window, {
        type: 'warning', buttons: ['Reload', 'Cancel'], defaultId: 1, cancelId: 1,
        message: 'Reload PhotoCraft?', detail: 'Its open documents have unsaved changes, which reloading discards.'
      })
      if (choice === 0) event.preventDefault()
    })
    contents.on('did-start-loading', () => {
      this.ready = null
      this.setState({ status: 'loading', message: null, title: null })
    })
    contents.on('did-fail-load', (_event, code, description, url, mainFrame) => {
      if (mainFrame && code !== -3) this.setState({ status: 'failed', message: `PhotoCraft did not load (${description} at ${url}). Reload it from the panel.`, title: null })
    })
    contents.on('render-process-gone', (_event, details) => {
      this.ready = null
      this.setState({ status: 'failed', message: `PhotoCraft stopped (${details.reason}). Reload it from the panel; unsaved changes are lost.`, title: null })
    })
    this.place()
    void contents.loadURL(START_URL)
  }

  private reload(): void {
    if (!this.view) return this.ensure()
    this.view.webContents.reload()
  }

  /** The page once window.photocraft is there: the WebAssembly takes seconds to start. */
  private async bridge(): Promise<WebContents> {
    this.ensure()
    const view = this.view
    if (!view) throw new Error(this.state.message ?? 'PhotoCraft is not available.')
    this.ready ??= this.waitForBridge(view.webContents)
    await this.ready
    return view.webContents
  }

  private async waitForBridge(contents: WebContents): Promise<void> {
    const deadline = Date.now() + BRIDGE_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (contents.isDestroyed()) throw new Error('PhotoCraft was closed. Open it again from the toolbar.')
      if (!contents.isLoading()) {
        const up = await contents.executeJavaScript('typeof window.photocraft === "object"').catch(() => false) as boolean
        if (up) {
          this.setState({ status: 'ready', message: null, title: this.state.title })
          return
        }
      }
      await new Promise((done) => setTimeout(done, 250))
    }
    this.ready = null
    throw new Error('PhotoCraft did not start in time. Reload it from the panel and try again.')
  }

  // ── Placement ───────────────────────────────────────────────────────

  private setBounds(bounds: Bounds | null): void {
    if (!bounds || !(bounds.width >= 2) || !(bounds.height >= 2)) this.bounds = null
    else {
      this.size = { width: Math.round(bounds.width), height: Math.round(bounds.height) }
      this.bounds = { x: Math.round(bounds.x), y: Math.round(bounds.y), ...this.size }
    }
    this.place()
  }

  private place(): void {
    const view = this.view
    if (!view) return
    if (this.bounds) reveal(view, this.bounds)
    else {
      // Concealed at the panel's last size, so PhotoCraft lays itself out as it will be seen.
      view.setBounds({ ...view.getBounds(), ...this.size })
      conceal(this.window, view)
    }
  }

  private setState(state: PhotocraftState): void {
    this.state = state
    this.publish()
  }

  private publish(): void {
    if (!this.window.isDestroyed()) this.window.webContents.send('rocket:photocraft-state', this.state)
  }
}
