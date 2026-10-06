import {
  app, clipboard, Menu, session, WebContentsView,
  type BrowserWindow, type ContextMenuParams, type Event, type Input, type MenuItemConstructorOptions,
  type Rectangle, type WebContents
} from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentTab, Bounds, BrowserCommand, BrowserState, BrowserTab } from '../shared/types.ts'
import { Suggestions } from './browser-suggest.ts'
import { BROWSER_PARTITION, conceal, isBlankTabUrl, isNewTabUrl, NEW_TAB_URL, reveal, toUrl } from './browser-url.ts'

// The embedded browser: a strip of tabs, each a WebContentsView laid over the region of the
// window the UI reserves for the page. A view is a native surface, so it paints above every DOM
// layer; the UI is laid out so that nothing it draws ever needs to overlap that region, and the
// one thing that must (the address field's dropdown) is a view of its own.
//
// Only the active tab's view is on screen. The others are concealed (see browser-url.ts), and a
// tab restored from the last session has no view at all until it is first selected, as in
// Chromium.

const PARTITION = BROWSER_PARTITION
const REOPEN_LIMIT = 25
const FAVICON_LIMIT = 64_000

type Tab = {
  id: string
  /** The short name models know the tab by. */
  ref: string
  /** Opened by a model for its own work. */
  agent: boolean
  /** Null until the tab is first shown. */
  view: WebContentsView | null
  url: string
  title: string
  favicon: string | null
  faviconUrl: string | null
  pinned: boolean
}

type SavedTab = Pick<Tab, 'url' | 'title' | 'favicon' | 'pinned'>
type ClosedTab = SavedTab & { index: number }
type NewTab = Partial<SavedTab> & { index?: number; view?: WebContentsView; agent?: boolean }

/** A tab as the browser tools hold it. */
export type TabHandle = { id: string; contents: WebContents }

export class BrowserPane {
  private readonly suggestions: Suggestions
  private readonly sessionFile = join(app.getPath('userData'), 'browser-tabs.json')
  private tabs: Tab[] = []
  private activeId: string | null = null
  private closed: ClosedTab[] = []
  private restored = false
  /** Where the UI wants the page; null while the browser is hidden. */
  private bounds: Rectangle | null = null
  private size = { width: 800, height: 600 }
  /** Whether keyboard focus is in the browser's toolbar, in the UI's page. */
  private chromeFocused = false
  private publishQueued = false
  private saveTimer: NodeJS.Timeout | null = null
  private disposed = false
  private refSeq = 0

  constructor(private readonly window: BrowserWindow) {
    this.suggestions = new Suggestions(window)
    window.on('resize', () => {
      for (const tab of this.tabs) {
        if (tab.view && !(this.bounds && tab.id === this.activeId)) conceal(window, tab.view)
      }
    })
    window.on('close', () => {
      this.save()
      this.disposed = true
      this.suggestions.dispose()
      for (const tab of this.tabs) tab.view?.webContents.close()
    })
    // Tab shortcuts typed while focus is in the toolbar rather than in a page.
    window.webContents.on('before-input-event', (event, input) => {
      if (this.chromeFocused && this.bounds) this.onKey(event, input)
    })
  }

  handle(sender: WebContents, command: BrowserCommand): void {
    if (this.suggestions.owns(sender)) {
      if (command.type === 'suggestPick') this.navigate(String(command.value))
      return
    }
    if (sender !== this.window.webContents) return
    switch (command.type) {
      case 'setBounds': this.setBounds(command.bounds); break
      case 'sync': this.restore(); this.publish(); break
      case 'chromeFocus': this.chromeFocused = command.focused === true; break
      case 'newTab': this.restore(); this.newTab(command.url); break
      case 'closeTab': this.closeTab(this.find(command.id)); break
      case 'activateTab': this.activate(this.find(command.id), true); break
      case 'moveTab': this.moveTab(this.find(command.id), Number(command.index)); break
      case 'muteTab': this.mute(this.find(command.id), command.muted === true); break
      case 'tabMenu': this.tabMenu(this.find(command.id)); break
      case 'navigate': this.navigate(String(command.input ?? '')); break
      case 'back': this.active?.view?.webContents.navigationHistory.goBack(); break
      case 'forward': this.active?.view?.webContents.navigationHistory.goForward(); break
      case 'reload': this.active?.view?.webContents.reload(); break
      case 'stop': this.active?.view?.webContents.stop(); break
      case 'suggest': this.suggestions.query(String(command.text ?? ''), command.anchor); break
      case 'suggestSelect': this.suggestions.select(Number(command.index)); break
      case 'suggestHide': this.suggestions.hide(); break
    }
  }

  // ── For the browser tools (browser-agent.ts) ─────────────────────────

  agentTabs(): AgentTab[] {
    // A model may ask before the user has ever opened the browser panel.
    this.restore()
    return this.tabs.map((tab) => ({
      id: tab.ref,
      url: isBlankTabUrl(tab.url) ? '' : tab.url,
      title: isBlankTabUrl(tab.url) ? 'New Tab' : tab.title,
      active: tab.id === this.activeId,
      loading: tab.view?.webContents.isLoading() ?? false,
      agent: tab.agent
    }))
  }

  /** A tab by the name models know it by, with its page loaded. */
  agentTab(ref: string): TabHandle | null {
    this.restore()
    const tab = this.tabs.find((entry) => entry.ref === ref)
    return tab ? { id: tab.ref, contents: (tab.view ?? this.load(tab)).webContents } : null
  }

  agentActive(): TabHandle | null {
    this.restore()
    return this.active ? this.agentTab(this.active.ref) : null
  }

  /** A tab for a model to work in. The strip switches to it so the user can follow along. */
  agentOpen(): TabHandle {
    this.restore()
    const tab = this.createTab({ url: 'about:blank', agent: true })
    this.activate(tab, false)
    const view = tab.view ?? this.load(tab)
    return { id: tab.ref, contents: view.webContents }
  }

  /** Show an agent tab the model is using without moving keyboard focus into the page. */
  agentShow(ref: string): void {
    this.restore()
    const tab = this.tabs.find((entry) => entry.ref === ref)
    if (!tab?.agent || tab.id === this.activeId) return
    this.activate(tab, false)
  }

  agentClose(ref: string): void {
    this.closeTab(this.tabs.find((entry) => entry.ref === ref) ?? null)
  }

  // ── Tabs ────────────────────────────────────────────────────────────

  private get active(): Tab | null {
    return this.find(this.activeId)
  }

  private find(id: string | null): Tab | null {
    return this.tabs.find((tab) => tab.id === id) ?? null
  }

  private get pinnedCount(): number {
    return this.tabs.filter((tab) => tab.pinned).length
  }

  /** Bring back the last session's tabs, or start with one new tab. Runs once, when the browser is first shown. */
  private restore(): void {
    if (this.restored) return
    this.restored = true
    let saved: { active?: number; tabs?: SavedTab[] } = {}
    try {
      saved = JSON.parse(readFileSync(this.sessionFile, 'utf8')) as typeof saved
    } catch {
      // No session yet.
    }
    const tabs = (Array.isArray(saved.tabs) ? saved.tabs : []).filter((tab) => typeof tab?.url === 'string')
    for (const tab of tabs) this.createTab(tab)
    this.activate(this.tabs[saved.active ?? 0] ?? this.tabs[0] ?? this.createTab({}), false)
  }

  private createTab(from: NewTab): Tab {
    const tab: Tab = {
      id: randomUUID(),
      ref: `t${++this.refSeq}`,
      agent: from.agent === true,
      view: null,
      url: from.url ?? NEW_TAB_URL,
      title: from.title ?? '',
      favicon: from.favicon ?? null,
      faviconUrl: null,
      pinned: from.pinned === true
    }
    const pinned = this.pinnedCount
    const index = Math.min(Math.max(from.index ?? this.tabs.length, tab.pinned ? 0 : pinned), tab.pinned ? pinned : this.tabs.length)
    this.tabs.splice(index, 0, tab)
    if (from.view) this.adopt(tab, from.view)
    this.publish()
    return tab
  }

  private newTab(url?: string, index?: number): void {
    this.activate(this.createTab({ url, index }), false)
    if (!url) this.focusAddress()
  }

  private activate(tab: Tab | null, focusPage: boolean): void {
    if (!tab) return
    const previous = this.active
    this.activeId = tab.id
    const view = tab.view ?? this.load(tab)
    // The new page goes up before the old one comes down, so the stage is never empty.
    this.place()
    if (previous && previous !== tab && previous.view) conceal(this.window, previous.view)
    this.suggestions.hide()
    if (focusPage) view.webContents.focus()
    this.publish()
  }

  private closeTab(tab: Tab | null): void {
    if (!tab) return
    const index = this.tabs.indexOf(tab)
    if (!isNewTabUrl(tab.url)) {
      this.closed.push({ url: tab.url, title: tab.title, favicon: tab.favicon, pinned: tab.pinned, index })
      if (this.closed.length > REOPEN_LIMIT) this.closed.shift()
    }
    this.tabs.splice(index, 1)
    if (this.activeId === tab.id) {
      this.activeId = null
      // The tab to the right takes over, or the one to the left of the last; closing the only
      // tab leaves a new one, since the browser has no window of its own to close.
      this.activate(this.tabs[index] ?? this.tabs[index - 1] ?? this.createTab({}), true)
    }
    if (tab.view) {
      this.window.contentView.removeChildView(tab.view)
      tab.view.webContents.close()
    }
    this.publish()
  }

  private reopenClosed(): void {
    const tab = this.closed.pop()
    if (tab) this.activate(this.createTab(tab), true)
  }

  private moveTab(tab: Tab | null, index: number): void {
    if (!tab || !Number.isInteger(index)) return
    this.tabs.splice(this.tabs.indexOf(tab), 1)
    const pinned = this.pinnedCount
    this.tabs.splice(Math.min(Math.max(index, tab.pinned ? 0 : pinned), tab.pinned ? pinned : this.tabs.length), 0, tab)
    this.publish()
  }

  private pin(tab: Tab, pinned: boolean): void {
    this.tabs.splice(this.tabs.indexOf(tab), 1)
    tab.pinned = pinned
    // Pinning puts the tab after the other pinned ones; unpinning puts it first among the rest.
    this.tabs.splice(this.pinnedCount - (pinned ? 1 : 0), 0, tab)
    this.publish()
  }

  private mute(tab: Tab | null, muted: boolean): void {
    tab?.view?.webContents.setAudioMuted(muted)
    this.publish()
  }

  private step(by: number): void {
    const index = this.tabs.findIndex((tab) => tab.id === this.activeId)
    this.activate(this.tabs[(index + by + this.tabs.length) % this.tabs.length] ?? null, true)
  }

  // ── Views ───────────────────────────────────────────────────────────

  private setBounds(bounds: Bounds | null): void {
    if (!bounds || !(bounds.width >= 2) || !(bounds.height >= 2)) {
      this.bounds = null
      this.suggestions.hide()
    } else {
      this.size = { width: Math.round(bounds.width), height: Math.round(bounds.height) }
      this.bounds = { x: Math.round(bounds.x), y: Math.round(bounds.y), ...this.size }
      this.restore()
    }
    this.place()
  }

  /** Put the active tab's page where the UI wants it, or out of sight while the browser is hidden. */
  private place(): void {
    const view = this.active?.view
    if (!view) return
    if (this.bounds) reveal(view, this.bounds)
    else conceal(this.window, view)
  }

  private load(tab: Tab): WebContentsView {
    const view = new WebContentsView({
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.adopt(tab, view)
    void view.webContents.loadURL(tab.url).catch(() => {})
    return view
  }

  /** Make a view this tab's page: put it in the window, out of sight, and follow what it does. */
  private adopt(tab: Tab, view: WebContentsView): void {
    tab.view = view
    view.setBorderRadius(8)
    view.setBackgroundColor('#ffffff')
    this.window.contentView.addChildView(view)
    // The dropdown's view stays the top one. (Inserting the tab beneath it by index instead
    // leaves the tab's page unpainted.)
    this.suggestions.raise()
    view.setBounds({ x: 0, y: 0, ...this.size })
    conceal(this.window, view)

    const contents = view.webContents
    const history = this.suggestions.history
    const changed = (): void => {
      tab.url = contents.getURL() || tab.url
      tab.title = contents.getTitle()
      this.publish()
    }
    contents.on('did-start-loading', changed)
    contents.on('did-stop-loading', changed)
    contents.on('audio-state-changed', changed)
    contents.on('did-navigate', (_event, url) => {
      // A new site starts without an icon; within a site the old one stays until replaced.
      if (origin(url) !== origin(tab.url)) tab.favicon = tab.faviconUrl = null
      changed()
      history.visit(url, contents.getTitle())
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      changed()
      if (isMainFrame) history.visit(url, contents.getTitle())
    })
    contents.on('page-title-updated', (_event, title) => {
      changed()
      history.setTitle(contents.getURL(), title)
    })
    contents.on('page-favicon-updated', (_event, urls) => {
      if (urls[0]) void this.loadFavicon(tab, urls[0])
    })
    contents.on('before-input-event', (event, input) => this.onKey(event, input))
    contents.on('context-menu', (_event, params) => this.pageMenu(tab, params))
    // A page that closes itself (window.close()) closes its tab.
    contents.on('destroyed', () => {
      tab.view = null
      if (this.tabs.includes(tab) && !this.disposed) this.closeTab(tab)
    })
    // A link that wants a new window gets a new tab next to this one. Chromium makes the page
    // itself and hands it over, so the opener relationship (window.opener, postMessage) holds.
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (!/^(https?:|about:blank)/i.test(url)) return { action: 'deny' }
      return {
        action: 'allow',
        createWindow: (options) => {
          const opened = this.createTab({
            url,
            index: this.tabs.indexOf(tab) + 1,
            view: new WebContentsView({ webContents: (options as { webContents?: WebContents }).webContents, webPreferences: options.webPreferences })
          })
          if (disposition !== 'background-tab') this.activate(opened, true)
          return opened.view!.webContents
        }
      }
    })
  }

  private async loadFavicon(tab: Tab, url: string): Promise<void> {
    if (tab.faviconUrl === url) return
    tab.faviconUrl = url
    try {
      let icon = url
      // "data:," is how a page says it has no icon.
      if (url.startsWith('data:') && url.length < 32) icon = ''
      else if (!url.startsWith('data:')) {
        // Fetched with the browser's own session, so it comes with the site's cookies and the
        // UI's page never has to load anything from the network.
        const response = await session.fromPartition(PARTITION).fetch(url)
        const bytes = Buffer.from(await response.arrayBuffer())
        if (!response.ok || !bytes.length) return
        const type = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/x-icon'
        icon = `data:${type};base64,${bytes.toString('base64')}`
      }
      if (tab.faviconUrl !== url || icon.length > FAVICON_LIMIT) return
      tab.favicon = icon || null
      this.publish()
    } catch {
      // No icon; the tab keeps the default one.
    }
  }

  private navigate(input: string): void {
    const tab = this.active
    const url = toUrl(input)
    this.suggestions.hide()
    if (!tab || !url) return
    tab.url = url
    const view = tab.view ?? this.load(tab)
    void view.webContents.loadURL(url).catch(() => {})
    view.webContents.focus()
  }

  private focusAddress(): void {
    // The state goes first, so the address field already shows this tab when it takes focus.
    this.flush()
    this.window.webContents.focus()
    this.window.webContents.send('rocket:browser-focus-address')
  }

  // ── Keyboard and menus ──────────────────────────────────────────────

  /** Chromium's tab and navigation shortcuts. */
  private onKey(event: Event, input: Input): void {
    if (input.type !== 'keyDown') return
    const run = this.shortcut(input)
    if (!run) return
    event.preventDefault()
    run()
  }

  private shortcut(input: Input): (() => void) | null {
    const key = input.key.toLowerCase()
    const contents = this.active?.view?.webContents
    if (input.control && !input.alt && !input.meta) {
      if (input.shift) {
        if (key === 't') return () => this.reopenClosed()
        if (key === 'tab') return () => this.step(-1)
        if (key === 'r') return () => contents?.reloadIgnoringCache()
        if (key === 'i') return () => contents?.openDevTools({ mode: 'detach' })
        if (key === '+') return () => this.zoom(1)
        return null
      }
      if (key === 't') return () => this.newTab()
      if (key === 'w' || key === 'f4') return () => this.closeTab(this.active)
      if (key === 'tab' || key === 'pagedown') return () => this.step(1)
      if (key === 'pageup') return () => this.step(-1)
      if (key === 'l') return () => this.focusAddress()
      if (key === 'r') return () => contents?.reload()
      if (key === '=' || key === '+') return () => this.zoom(1)
      if (key === '-') return () => this.zoom(-1)
      if (key === '0') return () => contents?.setZoomLevel(0)
      if (/^[1-8]$/.test(key)) return () => this.activate(this.tabs[Number(key) - 1] ?? null, true)
      if (key === '9') return () => this.activate(this.tabs.at(-1) ?? null, true)
      return null
    }
    if (input.alt && !input.control && !input.meta && !input.shift) {
      if (key === 'arrowleft') return () => contents?.navigationHistory.goBack()
      if (key === 'arrowright') return () => contents?.navigationHistory.goForward()
      if (key === 'd') return () => this.focusAddress()
      return null
    }
    if (!input.alt && !input.control && !input.meta) {
      if (key === 'f5') return () => contents?.reload()
      if (key === 'f6') return () => this.focusAddress()
      if (key === 'f12') return () => contents?.openDevTools({ mode: 'detach' })
    }
    return null
  }

  private zoom(by: number): void {
    const contents = this.active?.view?.webContents
    contents?.setZoomLevel(Math.min(Math.max(contents.getZoomLevel() + by * 0.5, -3), 4))
  }

  private tabMenu(tab: Tab | null): void {
    if (!tab) return
    const index = this.tabs.indexOf(tab)
    const contents = tab.view?.webContents
    const muted = contents?.isAudioMuted() ?? false
    Menu.buildFromTemplate([
      { label: 'New tab to the right', click: () => this.newTab(undefined, index + 1) },
      { type: 'separator' },
      { label: 'Reload', click: () => (tab.view ?? this.load(tab)).webContents.reload() },
      { label: 'Duplicate', click: () => this.activate(this.createTab({ url: tab.url, title: tab.title, favicon: tab.favicon, index: index + 1 }), true) },
      { label: tab.pinned ? 'Unpin' : 'Pin', click: () => this.pin(tab, !tab.pinned) },
      { label: muted ? 'Unmute site' : 'Mute site', enabled: Boolean(contents), click: () => this.mute(tab, !muted) },
      { type: 'separator' },
      { label: 'Close', click: () => this.closeTab(tab) },
      {
        label: 'Close other tabs',
        enabled: this.tabs.some((other) => other !== tab && !other.pinned),
        click: () => { for (const other of [...this.tabs]) if (other !== tab && !other.pinned) this.closeTab(other) }
      },
      {
        label: 'Close tabs to the right',
        enabled: this.tabs.slice(index + 1).some((other) => !other.pinned),
        click: () => { for (const other of this.tabs.slice(this.tabs.indexOf(tab) + 1)) if (!other.pinned) this.closeTab(other) }
      },
      { type: 'separator' },
      { label: 'Reopen closed tab', enabled: this.closed.length > 0, click: () => this.reopenClosed() }
    ]).popup({ window: this.window })
  }

  private pageMenu(tab: Tab, params: ContextMenuParams): void {
    const contents = tab.view?.webContents
    if (!contents) return
    const beside = this.tabs.indexOf(tab) + 1
    const items: MenuItemConstructorOptions[] = []
    const selection = params.selectionText.trim()
    if (params.linkURL) {
      items.push(
        { label: 'Open link in new tab', click: () => void this.load(this.createTab({ url: params.linkURL, index: beside })) },
        { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' }
      )
    }
    if (params.mediaType === 'image') {
      items.push(
        { label: 'Open image in new tab', click: () => this.newTab(params.srcURL, beside) },
        { label: 'Copy image', click: () => contents.copyImageAt(params.x, params.y) },
        { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) },
        { type: 'separator' }
      )
    }
    if (params.isEditable) {
      items.push(
        { label: 'Cut', enabled: params.editFlags.canCut, click: () => contents.cut() },
        { label: 'Copy', enabled: params.editFlags.canCopy, click: () => contents.copy() },
        { label: 'Paste', enabled: params.editFlags.canPaste, click: () => contents.paste() },
        { label: 'Select all', enabled: params.editFlags.canSelectAll, click: () => contents.selectAll() },
        { type: 'separator' }
      )
    } else if (selection) {
      const shown = selection.length > 30 ? `${selection.slice(0, 30)}…` : selection
      items.push(
        { label: 'Copy', click: () => contents.copy() },
        { label: `Search Google for “${shown}”`, click: () => this.newTab(`https://www.google.com/search?q=${encodeURIComponent(selection)}`, beside) },
        { type: 'separator' }
      )
    }
    if (!items.length) {
      items.push(
        { label: 'Back', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
        { label: 'Forward', enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() },
        { label: 'Reload', click: () => contents.reload() },
        { type: 'separator' }
      )
    }
    items.push({ label: 'Inspect', click: () => contents.inspectElement(params.x, params.y) })
    Menu.buildFromTemplate(items).popup({ window: this.window })
  }

  // ── State ───────────────────────────────────────────────────────────

  private snapshot(tab: Tab): BrowserTab {
    const contents = tab.view?.webContents
    const blank = isBlankTabUrl(tab.url)
    return {
      id: tab.id,
      url: blank ? '' : tab.url,
      title: blank ? 'New Tab' : tab.title || tab.url,
      favicon: blank ? null : tab.favicon,
      loading: contents?.isLoading() ?? false,
      canGoBack: contents?.navigationHistory.canGoBack() ?? false,
      canGoForward: contents?.navigationHistory.canGoForward() ?? false,
      pinned: tab.pinned,
      audible: contents?.isCurrentlyAudible() ?? false,
      muted: contents?.isAudioMuted() ?? false,
      agent: tab.agent
    }
  }

  /** Tell the UI what changed. Coalesced, because one navigation raises several events at once. */
  private publish(): void {
    if (this.publishQueued) return
    this.publishQueued = true
    setImmediate(() => this.flush())
  }

  private flush(): void {
    this.publishQueued = false
    if (this.disposed || this.window.isDestroyed() || !this.restored) return
    const state: BrowserState = { tabs: this.tabs.map((tab) => this.snapshot(tab)), activeId: this.activeId }
    this.window.webContents.send('rocket:browser-state', state)
    this.saveTimer ??= setTimeout(() => this.save(), 1_000)
  }

  private save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (!this.restored) return
    // A model's working tabs are not part of the user's session.
    const kept = this.tabs.filter((tab) => !tab.agent)
    const tabs: SavedTab[] = kept.map(({ url, title, favicon, pinned }) => ({ url, title, favicon, pinned }))
    try {
      writeFileSync(this.sessionFile, JSON.stringify({ active: Math.max(0, kept.findIndex((tab) => tab.id === this.activeId)), tabs }))
    } catch {
      // The session is a convenience; the browser works without it.
    }
  }
}

function origin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}
