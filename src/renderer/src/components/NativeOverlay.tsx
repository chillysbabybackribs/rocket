import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { OVERLAY_SLOTS, type OverlaySlot } from '../../../shared/overlays.ts'
import type { Bounds } from '../../../shared/types.ts'

type Surface = { window: Window; root: HTMLElement }
const surfaces = new Map<OverlaySlot, Promise<Surface>>()
const documents = new Map<OverlaySlot, Document>()
const owners = new Map<OverlaySlot, () => void>()
let generation = 0

// Same-origin window.open documents keep React state, callbacks, and context in the shell.
// Main adopts their webContents into native views; no remote page gets access to this tree.
function surfaceFor(slot: OverlaySlot): Promise<Surface> {
  const existing = surfaces.get(slot)
  if (existing) return existing
  const promise = (async () => {
    const child = window.open('about:blank', `rocket-overlay-${slot}`)
    if (!child) throw new Error('The overlay could not open. Restart Rocket and try again.')
    const doc = child.document
    documents.set(slot, doc)
    doc.title = `Rocket overlay: ${slot}`
    const base = doc.createElement('base')
    base.href = document.baseURI
    doc.head.append(base)
    const loads: Promise<void>[] = []
    for (const source of document.querySelectorAll('style, link[rel="stylesheet"], meta[http-equiv]')) {
      const copy = source.cloneNode(true) as HTMLElement
      if (source instanceof HTMLLinkElement) {
        ;(copy as HTMLLinkElement).href = source.href
        loads.push(new Promise((resolve, reject) => {
          copy.onload = () => resolve()
          copy.onerror = () => reject(new Error('The overlay stylesheet could not load. Restart Rocket and try again.'))
        }))
      }
      doc.head.append(copy)
    }
    const style = doc.createElement('style')
    style.textContent = `
      html, body { background: transparent !important; margin: 0; overflow: hidden; }
      #overlay-root { width: max-content; }
      body.overlay-modal #overlay-root { width: 100%; height: 100%; }
      body:not(.overlay-modal) #overlay-root > div { padding: 8px; width: max-content; max-width: var(--overlay-window-width); }
      body:not(.overlay-modal) .attachment-menu, body:not(.overlay-modal) .flyout,
      body:not(.overlay-modal) .picker-menu, body:not(.overlay-modal) .composer-history-pop, body:not(.overlay-modal) .attachment-notice {
        position: relative; inset: auto; max-width: calc(var(--overlay-window-width) - 16px);
        max-height: calc(var(--overlay-window-height) - 16px); overflow: auto;
      }
      body:not(.overlay-modal) .picker-menu { display: flex; }
      body.overlay-notice .attachment-notice { max-width: min(560px, calc(var(--overlay-window-width) - 32px)); }
      .picker-models { max-height: min(380px, calc(var(--overlay-window-height) - 32px)); }
      .history-menu { max-height: min(520px, calc(var(--overlay-window-height) - 32px)); }
    `
    doc.head.append(style)
    doc.documentElement.style.setProperty('--overlay-window-width', `${innerWidth}px`)
    doc.documentElement.style.setProperty('--overlay-window-height', `${innerHeight}px`)
    // Keep surface markers separate from component classes such as .flyout.
    doc.body.className = `overlay-${slot}`
    const root = doc.createElement('div')
    root.id = 'overlay-root'
    doc.body.append(root)
    await Promise.all(loads)
    await doc.fonts.ready
    return { window: child, root }
  })()
  surfaces.set(slot, promise)
  return promise
}

export function warmOverlays(): void {
  for (const slot of OVERLAY_SLOTS) void surfaceFor(slot).catch(error => {
    surfaces.delete(slot)
    console.error(error)
  })
}

export function overlayDialogs(): string[] {
  return [...documents].filter(([slot]) => owners.has(slot)).flatMap(([, doc]) =>
    [...doc.querySelectorAll('dialog[open]')].map(element => element.getAttribute('aria-label') ?? 'Dialog'))
}

export type OverlaySize = { width: number; height: number }
export function anchoredOverlay(anchor: HTMLElement | null, size: OverlaySize, above = false, point?: { x: number; y: number } | null): Bounds {
  const box = anchor?.getBoundingClientRect()
  const width = Math.min(size.width, innerWidth)
  const height = Math.min(size.height, innerHeight)
  let x = point?.x ?? box?.left ?? 8
  let y = point?.y ?? (above ? (box?.top ?? height) - height : box?.bottom ?? 0)
  if (y + height > innerHeight && box) y = box.top - height
  if (y < 0 && box) y = box.bottom
  x = Math.max(0, Math.min(x - 8, innerWidth - width))
  y = Math.max(0, Math.min(y, innerHeight - height))
  return { x, y, width, height }
}

export function NativeOverlay({ slot = 'menu', children, place, anchor, focus = true, onDismiss }: {
  slot?: OverlaySlot
  children: ReactNode
  place?: (size: OverlaySize) => Bounds
  anchor?: HTMLElement | null
  focus?: boolean
  onDismiss: () => void
}) {
  const [surface, setSurface] = useState<Surface | null>(null)
  const [id] = useState(() => ++generation)
  const props = useRef({ place, onDismiss, focus, anchor })
  props.current = { place, onDismiss, focus, anchor }
  const update = useRef<() => void>(() => {})

  useEffect(() => {
    let active = true
    owners.get(slot)?.()
    const dismiss = () => props.current.onDismiss()
    owners.set(slot, dismiss)
    void surfaceFor(slot).then(async next => {
      if (!active) return
      await window.rocket.overlay.send({ type: 'prepare', slot, generation: id })
      if (active) setSurface(next)
    }).catch(error => {
      console.error(error)
      if (active) dismiss()
    })
    return () => {
      active = false
      if (owners.get(slot) === dismiss) owners.delete(slot)
      void window.rocket.overlay.send({ type: 'hide', slot, generation: id })
    }
  }, [slot, id])

  useLayoutEffect(() => {
    if (!surface) return
    const doc = surface.window.document
    let active = true
    let scheduled = false
    let presented = false
    const send = () => {
      if (!active) return
      doc.documentElement.style.setProperty('--overlay-window-width', `${innerWidth}px`)
      doc.documentElement.style.setProperty('--overlay-window-height', `${innerHeight}px`)
      const rect = surface.root.getBoundingClientRect()
      const bounds = slot === 'modal' ? { x: 0, y: 0, width: innerWidth, height: innerHeight }
        : props.current.place?.({ width: rect.width, height: rect.height }) ?? anchoredOverlay(props.current.anchor ?? null, rect)
      if (!presented && props.current.focus && (!doc.activeElement || doc.activeElement === doc.body)) {
        surface.root.querySelector<HTMLElement>('[autofocus], [role=menuitem], [role=menuitemradio], button, input')?.focus({ preventScroll: true })
      }
      presented = true
      void window.rocket.overlay.send({ type: 'present', slot, generation: id, bounds, focus: props.current.focus })
    }
    // Use the visible shell's frame clock: a hidden overlay may not get animation frames.
    const schedule = () => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => requestAnimationFrame(() => { scheduled = false; send() }))
    }
    update.current = schedule
    const observer = new ResizeObserver(schedule)
    observer.observe(surface.root)
    const outside = (event: PointerEvent) => {
      if (slot !== 'modal' && slot !== 'notice' && !props.current.anchor?.contains(event.target as Node)) props.current.onDismiss()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); props.current.onDismiss() }
    }
    const navigate = (event: KeyboardEvent) => {
      if (slot !== 'menu' || event.defaultPrevented) return
      if (event.key === 'Tab') { event.preventDefault(); props.current.onDismiss(); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      if (['INPUT', 'TEXTAREA'].includes((event.target as Element)?.tagName)) return
      const items = [...surface.root.querySelectorAll<HTMLElement>('[role=menuitem], [role=menuitemradio], [data-item]')]
        .filter(item => !item.hasAttribute('disabled') && item.getClientRects().length > 0)
      if (!items.length) return
      event.preventDefault()
      const current = items.indexOf(doc.activeElement as HTMLElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length
      items[next].focus({ preventScroll: true })
    }
    const off = window.rocket.overlay.onDismiss(event => {
      if (event.slot === slot && event.generation === id) props.current.onDismiss()
    })
    doc.addEventListener('keydown', key, true)
    doc.addEventListener('keydown', navigate)
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      active = false
      observer.disconnect()
      off()
      doc.removeEventListener('keydown', key, true)
      doc.removeEventListener('keydown', navigate)
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', schedule)
      update.current = () => {}
    }
  }, [surface, slot, id])
  useLayoutEffect(() => { update.current() })

  return surface ? createPortal(
    <div onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>{children}</div>,
    surface.root
  ) : null
}
