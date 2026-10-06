import { WebContentsView, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions, type Rectangle, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  chipBounds, doneLabel, FILL_CHIP_HEIGHT,
  type FillChipAction, type FillChipState, type FillField, type FillSource, type FillTarget, type FillVariant,
  type HostToMainFill, type MainToHostFill
} from '../shared/fill.ts'
import type { ProviderId } from '../shared/types.ts'
import { FILL_LIB, FILL_WORLD, type FieldRect, type Probe } from './fill-page.ts'
import { conceal, reveal } from './browser-url.ts'

// "Fill with Rocket", main's half (fill-page.ts runs in the page; the host's half is
// src/host/fill.ts; the design is docs/mockups/fill-with-rocket.html). Right-click a text field,
// or anywhere in a form, and the model last used writes the answer into the page. This finds the
// fields, asks the host for a fill and writes the answer in. The chip that says what is going on
// is a small view of its own laid over the page, as the address field's dropdown is, so the page
// never moves; its background is transparent, so its dropdowns can hang over the page below it.
// One fill at a time: starting another stops the last.

/** How often the chip follows its field while it is up. */
const FOLLOW_MS = 80

type Session = {
  /** The host's id for the fill in flight; a new one for each go. */
  run: string
  contents: WebContents
  target: FillTarget
  variant: FillVariant
  instructions: string | null
  provider: ProviderId | null
  state: FillChipState
  /** What the fields held before the last fill went in, for Undo. */
  before: Record<string, string> | null
  chatId: string | null
  alternative: ProviderId | null
  /** Taller while a dropdown in the chip is open. */
  height: number
  /** When the fill went in; a click in the page after it means the user has moved on. */
  doneAt: number
}

export type PageFillHost = {
  /** Send to the agent host. */
  send: (message: MainToHostFill) => void
  /** Where a tab's page is in the window, or null when it is not the one on screen. */
  pageBounds: (contents: WebContents) => Rectangle | null
  /** A tab's page by the name models know it by. */
  tabRef: (contents: WebContents) => string | null
  openTab: (url: string) => void
  /** The tab strip shows which tab is being filled. */
  changed: () => void
}

export class PageFill {
  private view: WebContentsView | null = null
  private loaded = false
  private session: Session | null = null
  private model: string | null = null
  private follow: NodeJS.Timeout | null = null
  private shownAt: Rectangle | null = null

  constructor(private readonly window: BrowserWindow, private readonly host: PageFillHost) {
    window.on('resize', () => this.place())
  }

  owns(sender: WebContents): boolean {
    return sender === this.view?.webContents
  }

  /** The tab being filled, for the tab strip. */
  filling(contents: WebContents | undefined): boolean {
    return Boolean(contents && this.session?.contents === contents && this.session.state.phase === 'working')
  }

  /** The right-click menu's items for a page, ahead of the rest; none when there is nothing to fill there. */
  async menuItems(contents: WebContents, params: ContextMenuParams): Promise<MenuItemConstructorOptions[]> {
    // Only the page's own frame: a field in an embedded frame is in a document this cannot reach.
    if (params.frame && params.frame.frameTreeNodeId !== contents.mainFrame.frameTreeNodeId) return []
    const zoom = contents.getZoomFactor() || 1
    const probe = await this.call<Probe>(contents, `probe(${params.x / zoom}, ${params.y / zoom})`)
    if (!probe || (!probe.field && !probe.form)) return []
    const named = this.model ? ` · ${this.model}` : ''
    const items: MenuItemConstructorOptions[] = []
    const target = (mode: 'field' | 'form'): Omit<FillTarget, 'fields'> => ({
      tab: this.host.tabRef(contents) ?? '', url: contents.getURL(), title: contents.getTitle(), mode,
      skipped: mode === 'form' ? probe.skipped : [], context: probe.context
    })
    if (probe.field) {
      items.push(
        { label: `Fill with Rocket${named}`, click: () => void this.begin(contents, target('field'), null) },
        { label: 'Fill with instructions…', click: () => void this.begin(contents, target('field'), 'ask') }
      )
    }
    if (probe.form && probe.form.length > 1) {
      items.push({ label: `Fill this form with Rocket (${probe.form.length} fields)`, click: () => void this.begin(contents, target('form'), null) })
    }
    if (items.length) items.push({ type: 'separator' })
    return items
  }

  /** From the host. */
  onHost(message: HostToMainFill): void {
    if (message.type === 'fillModel') {
      this.model = message.label
      return
    }
    const session = this.session
    if (!session || ('id' in message && message.id !== session.run)) return
    switch (message.type) {
      case 'fillChat':
        session.chatId = message.chatId
        if (session.state.phase === 'working') this.show({ ...session.state, model: message.model })
        break
      case 'fillStep':
        if (session.state.phase === 'working') this.show({ ...session.state, step: message.step, sources: message.sources })
        break
      case 'fillDone':
        void this.land(session, message.values, message.left, message.sources)
        break
      case 'fillFailed':
        session.alternative = message.alternative?.provider ?? null
        void this.call(session.contents, 'mark("none")')
        this.show({ phase: 'failed', message: message.error, alternative: message.alternative ? `Fill with ${message.alternative.label}` : null })
        break
      case 'fillEnded':
        break
    }
  }

  /** The host went away mid-fill; nothing will answer the one in flight. */
  hostGone(): void {
    const session = this.session
    if (session?.state.phase !== 'working') return
    void this.call(session.contents, 'mark("none")')
    this.show({ phase: 'failed', message: 'Rocket\'s agent host restarted, so this fill was lost and the field is unchanged. Try again.', alternative: null })
  }

  /** What the chip's page asks for. */
  command(action: FillChipAction): void {
    const session = this.session
    if (!session) return
    switch (action.action) {
      case 'start':
        session.instructions = action.instructions.trim() || null
        void this.go(session)
        break
      case 'cancel':
      case 'close':
        this.end()
        break
      case 'stop':
        this.host.send({ type: 'fillStop', id: session.run })
        this.end()
        break
      case 'undo':
        void this.undo(session)
        break
      case 'again':
        session.variant = action.variant
        session.instructions = null
        void this.go(session)
        break
      case 'instructions':
        session.variant = 'fill'
        this.show({ phase: 'ask', model: this.model ?? '' })
        break
      case 'retry':
        void this.go(session)
        break
      case 'alternative':
        if (session.alternative) session.provider = session.alternative
        void this.go(session)
        break
      case 'openSource':
        if (/^https?:\/\//i.test(action.url)) this.host.openTab(action.url)
        break
      case 'size':
        session.height = Math.max(FILL_CHIP_HEIGHT, Math.min(Math.round(action.height), 600))
        this.place()
        break
    }
  }

  /** Esc in the page: stops a fill in flight there, or cancels asking. True when it did. */
  escape(contents: WebContents): boolean {
    const session = this.session
    if (session?.contents !== contents) return false
    if (session.state.phase === 'working') this.command({ action: 'stop' })
    else if (session.state.phase === 'ask') this.end()
    else return false
    return true
  }

  /** A page that navigates or closes takes its fields with it. */
  forget(contents: WebContents): void {
    if (this.session?.contents !== contents) return
    if (this.session.state.phase === 'working') this.host.send({ type: 'fillStop', id: this.session.run })
    this.end(false)
  }

  /** Keep the chip above a tab's view that was just added to the window. */
  raise(): void {
    if (this.view) this.window.contentView.addChildView(this.view)
  }

  /** Put the chip by its field, or out of sight when that tab is not on screen. */
  place(): void {
    void this.follow_()
  }

  dispose(): void {
    if (this.follow) clearInterval(this.follow)
    this.view?.webContents.close()
  }

  // ── Fills ───────────────────────────────────────────────────────────

  private async begin(contents: WebContents, base: Omit<FillTarget, 'fields'>, phase: 'ask' | null): Promise<void> {
    const fields = await this.call<FillField[]>(contents, `choose(${JSON.stringify(base.mode)})`)
    if (!fields?.length) return
    if (this.session?.state.phase === 'working') this.host.send({ type: 'fillStop', id: this.session.run })
    this.session = {
      run: '', contents, target: { ...base, fields }, variant: 'fill', instructions: null, provider: null,
      state: { phase: 'ask', model: this.model ?? '' }, before: null, chatId: null, alternative: null, height: FILL_CHIP_HEIGHT, doneAt: 0
    }
    if (phase === 'ask') {
      void this.call(contents, 'mark("working")')
      this.show({ phase: 'ask', model: this.model ?? '' })
      this.view?.webContents.focus()
    } else {
      await this.go(this.session)
    }
  }

  /** Ask the host for a fill of what the fields hold now. */
  private async go(session: Session): Promise<void> {
    const values = await this.call<Record<string, string>>(session.contents, 'values()')
    if (this.session !== session) return
    if (values) session.target = { ...session.target, fields: session.target.fields.map((field) => ({ ...field, value: values[field.id] ?? field.value })) }
    session.run = randomUUID()
    session.chatId = null
    void this.call(session.contents, 'mark("working")')
    this.show({ phase: 'working', model: this.model ?? '', step: 'Starting', startedAt: Date.now(), sources: [] })
    this.host.send({ type: 'fillStart', id: session.run, target: session.target, variant: session.variant, instructions: session.instructions, provider: session.provider })
    session.contents.focus()
  }

  private async land(session: Session, values: Record<string, string>, left: Record<string, string>, sources: FillSource[]): Promise<void> {
    const before = await this.call<Record<string, string>>(session.contents, `apply(${JSON.stringify(values)})`)
    if (this.session !== session) return
    if (!before) {
      this.show({ phase: 'failed', message: 'The field is no longer on the page, so nothing was filled.', alternative: null })
      return
    }
    // A rework's undo goes back to the fill it reworked, which is what the fields held before it.
    session.before = before
    const filled = Object.keys(values)
    const unfilled = Object.fromEntries(session.target.fields.filter((field) => !filled.includes(field.id)).map((field) => [field.id, left[field.id] ?? 'left for you']))
    void this.call(session.contents, `mark("done", ${JSON.stringify(Object.keys(unfilled))})`)
    const { label, warn, detail } = doneLabel(session.variant, session.target.fields, filled, unfilled)
    session.doneAt = Date.now()
    this.show({ phase: 'done', label, warn, detail, sources })
  }

  private async undo(session: Session): Promise<void> {
    if (session.before) await this.call(session.contents, `apply(${JSON.stringify(session.before)})`)
    this.end()
  }

  /** Close the chip and let the fields go. */
  private end(unmark = true): void {
    const session = this.session
    this.session = null
    if (session && unmark) void this.call(session.contents, 'release()')
    this.hide()
    this.host.changed()
  }

  // ── The chip ────────────────────────────────────────────────────────

  private show(state: FillChipState): void {
    const session = this.session
    if (!session) return
    session.state = state
    const view = this.ensureView()
    if (this.loaded) view.webContents.send('rocket:fill-chip', state)
    this.follow ??= setInterval(() => void this.follow_(), FOLLOW_MS)
    void this.follow_()
    this.host.changed()
  }

  private hide(): void {
    if (this.follow) clearInterval(this.follow)
    this.follow = null
    this.shownAt = null
    if (this.view) conceal(this.window, this.view)
  }

  /** Move the chip to its field; close it once the user has taken over a finished fill. */
  private async follow_(): Promise<void> {
    const session = this.session
    const view = this.view
    if (!session || !view) return
    const page = this.host.pageBounds(session.contents)
    const rect = page ? await this.call<FieldRect>(session.contents, 'rect()') : null
    if (this.session !== session) return
    if (!page || !rect) {
      if (this.shownAt) conceal(this.window, view)
      this.shownAt = null
      return
    }
    if (!rect.connected) {
      if (session.state.phase === 'working') this.host.send({ type: 'fillStop', id: session.run })
      this.end(false)
      return
    }
    // Typing in a filled field, or clicking elsewhere in the page, is the user taking over.
    if (session.state.phase === 'done' && (rect.edited || rect.awayAt > session.doneAt)) {
      this.end()
      return
    }
    const bounds = chipBounds(page, rect, session.contents.getZoomFactor() || 1, session.height)
    if (this.shownAt && sameRect(this.shownAt, bounds)) return
    this.shownAt = bounds
    reveal(view, bounds)
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view
    const view = new WebContentsView({
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        // As for the window: an ESM preload cannot run sandboxed, and this loads only the app's own page.
        sandbox: false
      }
    })
    // Transparent, so the room around the chip (its shadow, a dropdown's) shows the page through.
    view.setBackgroundColor('#00000000')
    this.view = view
    this.window.contentView.addChildView(view)
    conceal(this.window, view)
    view.webContents.on('did-finish-load', () => {
      this.loaded = true
      if (this.session) view.webContents.send('rocket:fill-chip', this.session.state)
    })
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && this.session) {
        event.preventDefault()
        this.command({ action: this.session.state.phase === 'working' ? 'stop' : 'close' })
      }
    })
    if (process.env.ELECTRON_RENDERER_URL) void view.webContents.loadURL(`${process.env.ELECTRON_RENDERER_URL}/fill.html`)
    else void view.webContents.loadFile(join(import.meta.dirname, '../renderer/fill.html'))
    return view
  }

  private async call<T>(contents: WebContents, expression: string): Promise<T | null> {
    if (contents.isDestroyed()) return null
    try {
      return await contents.executeJavaScriptInIsolatedWorld(FILL_WORLD, [{ code: `${FILL_LIB};globalThis.__rocketFill.${expression}` }]) as T
    } catch {
      // A page between documents, or gone.
      return null
    }
  }
}

function sameRect(a: Rectangle, b: Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
