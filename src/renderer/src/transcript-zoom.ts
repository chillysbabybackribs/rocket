// Ctrl + wheel zooms the chat transcript, smoothly and in every pane at once.
//
// The wheel moves a target; each frame eases the shown zoom toward it in log space, so a notch in
// and a notch out take the same time and feel the same. The zoom is CSS `zoom` on each
// transcript's content, so text reflows to the pane rather than spilling out of it. Every frame
// keeps the line under the pointer where it was (the middle of the view in the other panes), and
// a transcript resting at the bottom stays at the bottom. One level is shared and kept across
// restarts: it is a reading size, not a per-chat setting.

const STORAGE_KEY = 'rocket.transcriptZoom'
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2.5
/** Zoom grows by e^(RATE · pixels) per pixel of wheel: a mouse notch (100 px) is about 16 %. */
const RATE = 0.0015
/** The easing's time constant in ms: most of the way there in a tenth of a second. */
const EASE_MS = 70

/** A wheel event's travel in pixels, whatever unit the device reports it in. */
export function wheelPixels(delta: number, mode: number): number {
  return mode === 1 ? delta * 16 : mode === 2 ? delta * 400 : delta
}

/** Where the zoom heads after `pixels` of wheel, a negative delta (wheel up) zooming in. */
export function zoomTarget(target: number, pixels: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, target * Math.exp(-pixels * RATE)))
}

/** One frame's step from `shown` toward `target`, `ms` after the last; lands exactly when near. */
export function easeZoom(shown: number, target: number, ms: number): number {
  const gap = Math.log(target / shown)
  if (Math.abs(gap) < 0.0015) return target
  return shown * Math.exp(gap * (1 - Math.exp(-ms / EASE_MS)))
}

type View = { scroller: HTMLElement; content: HTMLElement; pinned: () => boolean }

const views = new Set<View>()
let shown = read()
let target = shown
let pointer: { view: View; x: number; y: number } | null = null
let frame = 0
let last = 0

function read(): number {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY))
    return saved >= ZOOM_MIN && saved <= ZOOM_MAX ? saved : 1
  } catch {
    return 1
  }
}

function apply(view: View): void {
  view.content.style.zoom = String(shown)
  view.content.style.setProperty('--chat-zoom', String(shown))
}

/** Takes the transcript's place before a zoom step; the function it returns puts it back after. */
function hold(view: View): () => void {
  const { scroller } = view
  if (view.pinned()) return () => { scroller.scrollTop = scroller.scrollHeight }
  const box = scroller.getBoundingClientRect()
  const x = pointer?.view === view ? pointer.x : box.left + box.width / 2
  const y = pointer?.view === view ? pointer.y : box.top + box.height / 2
  // The block under the point and how far down it the point is: blocks reflow as they grow, so
  // the block is a truer anchor than the scroll offset.
  let hit = document.elementFromPoint(x, y)
  while (hit && hit !== view.content && view.content.contains(hit) && getComputedStyle(hit).display.startsWith('inline')) hit = hit.parentElement
  if (hit && hit !== view.content && view.content.contains(hit)) {
    const before = hit.getBoundingClientRect()
    const along = before.height ? (y - before.top) / before.height : 0
    return () => {
      const after = hit.getBoundingClientRect()
      scroller.scrollTop += after.top + along * after.height - y
    }
  }
  const from = shown
  const at = scroller.scrollTop + y - box.top
  return () => { scroller.scrollTop = at * (shown / from) - (y - box.top) }
}

function step(now: number): void {
  const ms = last ? Math.min(now - last, 50) : 16
  last = now
  const restores = [...views].map(hold)
  shown = easeZoom(shown, target, ms)
  for (const view of views) apply(view)
  for (const restore of restores) restore()
  if (shown !== target) {
    frame = requestAnimationFrame(step)
    return
  }
  frame = 0
  last = 0
  try {
    localStorage.setItem(STORAGE_KEY, String(shown))
  } catch {
    // The level is a convenience; it resets to 100 % without storage.
  }
}

/** Zooms every transcript by a wheel event over `view`'s scroller. */
function onWheel(view: View, event: WheelEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
  event.preventDefault()
  pointer = { view, x: event.clientX, y: event.clientY }
  target = zoomTarget(target, wheelPixels(event.deltaY, event.deltaMode))
  if (!frame && shown !== target) frame = requestAnimationFrame(step)
}

/** Lets a transcript zoom with Ctrl + wheel and follow the shared level; returns its removal. */
export function attachZoom(scroller: HTMLElement, content: HTMLElement, pinned: () => boolean): () => void {
  const view: View = { scroller, content, pinned }
  views.add(view)
  apply(view)
  const listener = (event: WheelEvent): void => onWheel(view, event)
  // Not passive: the wheel's own scroll is cancelled while it zooms.
  scroller.addEventListener('wheel', listener, { passive: false })
  return () => {
    views.delete(view)
    if (pointer?.view === view) pointer = null
    scroller.removeEventListener('wheel', listener)
  }
}
