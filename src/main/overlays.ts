import { WebContentsView, webContents, type BrowserWindow, type WebContents, type WindowOpenHandlerResponse } from 'electron'
import { isOverlaySlot, type OverlayCommand, type OverlaySlot } from '../shared/overlays.ts'
import { registerLayer, raiseLayers } from './native-layers.ts'

type Surface = { view: WebContentsView; generation: number; retired: number; previous: WebContents | null }

// The trusted shell opens same-origin documents and portals its React controls into them.
// Electron's documented createWindow hook adopts those documents into native sibling views.
// Browser pages cannot request these surfaces or send their placement commands.
export class Overlays {
  private surfaces = new Map<OverlaySlot, Surface>()

  constructor(private window: BrowserWindow) {
    window.on('closed', () => {
      for (const { view } of this.surfaces.values()) if (!view.webContents.isDestroyed()) view.webContents.close()
      this.surfaces.clear()
    })
    window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (!mainFrame || inPlace) return
      for (const { view } of this.surfaces.values()) if (!view.webContents.isDestroyed()) view.webContents.close()
      this.surfaces.clear()
    })
  }

  open(url: string, frameName: string): WindowOpenHandlerResponse | null {
    const slot = frameName.replace(/^rocket-overlay-/, '')
    if (!frameName.startsWith('rocket-overlay-')) return null
    if (url !== 'about:blank' || !isOverlaySlot(slot) || this.surfaces.has(slot)) return { action: 'deny' }
    return {
      action: 'allow',
      createWindow: options => {
        const view = new WebContentsView({
          webContents: (options as { webContents?: WebContents }).webContents,
          webPreferences: { ...options.webPreferences, focusOnNavigation: false }
        })
        view.setBackgroundColor('#00000000')
        view.setVisible(false)
        const [width, height] = this.window.getContentSize()
        view.setBounds({ x: 0, y: 0, width, height })
        registerLayer(this.window, view, slot === 'notice' ? 60 : slot === 'modal' ? 50 : slot === 'menu' ? 40 : 30, slot)
        const surface: Surface = { view, generation: 0, retired: 0, previous: null }
        this.surfaces.set(slot, surface)
        view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        view.webContents.on('will-navigate', event => event.preventDefault())
        view.webContents.once('destroyed', () => {
          if (this.surfaces.get(slot) === surface) this.surfaces.delete(slot)
        })
        return view.webContents
      }
    }
  }

  watchPage(contents: WebContents): void {
    contents.on('before-mouse-event', (_event, input) => {
      if (input.type === 'mouseDown' || input.type === 'mouseWheel') this.dismissPopovers()
    })
  }

  private dismissPopovers(): void {
    for (const [slot, surface] of this.surfaces) {
      if (slot === 'modal' || slot === 'notice' || !surface.view.getVisible()) continue
      surface.retired = surface.generation
      surface.view.setVisible(false)
      this.window.webContents.send('rocket:overlay-dismiss', { slot, generation: surface.generation })
    }
  }

  handle(sender: WebContents, command: OverlayCommand): void {
    if (sender !== this.window.webContents || !command || !isOverlaySlot(command.slot)) return
    const surface = this.surfaces.get(command.slot)
    if (!surface || surface.view.webContents.isDestroyed() || !Number.isSafeInteger(command.generation) || command.generation <= 0) return
    if (command.generation < surface.generation) return
    if (command.type === 'hide') {
      surface.retired = Math.max(surface.retired, command.generation)
      const focused = webContents.getFocusedWebContents() === surface.view.webContents
      surface.view.setVisible(false)
      if (focused && surface.previous && !surface.previous.isDestroyed()) surface.previous.focus()
      return
    }
    if (command.generation <= surface.retired) return
    if (command.type === 'prepare') {
      surface.view.setVisible(false)
      const previous = webContents.getFocusedWebContents()
      const previousOverlay = [...this.surfaces.values()].find(entry => entry.view.webContents === previous)
      surface.previous = previousOverlay ? previousOverlay.previous ?? this.window.webContents : previous
      surface.generation = command.generation
      return
    }
    if (command.type !== 'present') return
    if (command.generation !== surface.generation) return
    const b = command.bounds
    if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0) return
    const fresh = surface.generation !== command.generation || !surface.view.getVisible()
    surface.generation = command.generation
    if (command.slot === 'modal') this.dismissPopovers()
    const zoom = this.window.webContents.getZoomFactor()
    const [width, height] = this.window.getContentSize()
    surface.view.webContents.setZoomFactor(zoom)
    const x = Math.max(0, Math.min(width - 1, Math.round(b.x * zoom)))
    const y = Math.max(0, Math.min(height - 1, Math.round(b.y * zoom)))
    surface.view.setBounds(command.slot === 'modal' ? { x: 0, y: 0, width, height } : {
      x, y, width: Math.max(1, Math.min(width - x, Math.ceil(b.width * zoom))),
      height: Math.max(1, Math.min(height - y, Math.ceil(b.height * zoom)))
    })
    raiseLayers(this.window)
    surface.view.setVisible(true)
    if (fresh && command.focus) surface.view.webContents.focus()
  }
}
