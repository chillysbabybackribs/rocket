import type { BrowserWindow, WebContentsView } from 'electron'
import type { OverlaySlot } from '../shared/overlays.ts'

// Native siblings have their own stacking order, independent of the shell's CSS.
// Only raise overlays: the active browser surface is never detached or concealed here.
const layers = new WeakMap<BrowserWindow, Map<WebContentsView, number>>()
const kinds = new WeakMap<WebContentsView, OverlaySlot | 'suggestions' | 'fill'>()

export function registerLayer(window: BrowserWindow, view: WebContentsView, order: number, kind: OverlaySlot | 'suggestions' | 'fill'): void {
  let entries = layers.get(window)
  if (!entries) layers.set(window, entries = new Map())
  entries.set(view, order)
  kinds.set(view, kind)
  window.contentView.addChildView(view)
  view.webContents.once('destroyed', () => entries!.delete(view))
  raiseLayers(window)
}

export function nativeSurfaceKind(view: WebContentsView): OverlaySlot | 'suggestions' | 'fill' | 'browser' {
  return kinds.get(view) ?? 'browser'
}

export function raiseLayers(window: BrowserWindow): void {
  const entries = [...(layers.get(window) ?? [])].sort((a, b) => a[1] - b[1])
  const views = entries.map(([view]) => view).filter(view => !view.webContents.isDestroyed())
  if (!views.length) return
  const top = window.contentView.children.slice(-views.length)
  if (views.every((view, index) => top[index] === view)) return
  for (const view of views) window.contentView.addChildView(view)
}
