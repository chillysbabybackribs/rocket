/** How close to an edge counts as "there" for pinning and jump buttons. */
export const EDGE_TOLERANCE = 80

export function distanceFromBottom(element: HTMLElement): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight
}

export function distanceFromTop(element: HTMLElement): number {
  return element.scrollTop
}

export function isAtBottom(element: HTMLElement, tolerance = EDGE_TOLERANCE): boolean {
  return distanceFromBottom(element) <= tolerance
}

export function isAtTop(element: HTMLElement, tolerance = EDGE_TOLERANCE): boolean {
  return distanceFromTop(element) <= tolerance
}

/** Scroll the transcript to its end; repeat across frames and content resizes. */
export function scrollToBottom(element: HTMLElement, anchor?: HTMLElement | null): void {
  element.scrollTop = element.scrollHeight
  anchor?.scrollIntoView({ block: 'end', behavior: 'instant' })
  element.scrollTop = element.scrollHeight
}

/** Run `scrollToBottom` on the next frames so layout and content-visibility can catch up. */
export function scrollToBottomSoon(element: HTMLElement, anchor?: HTMLElement | null): void {
  scrollToBottom(element, anchor)
  requestAnimationFrame(() => {
    scrollToBottom(element, anchor)
    requestAnimationFrame(() => scrollToBottom(element, anchor))
  })
}

export function scrollToTop(element: HTMLElement): void {
  element.scrollTop = 0
}

export function scrollToTopSoon(element: HTMLElement): void {
  scrollToTop(element)
  requestAnimationFrame(() => {
    scrollToTop(element)
    requestAnimationFrame(() => scrollToTop(element))
  })
}

/** While `active`, keep the bottom in view whenever the scroller or anchor grows. */
export function followBottom(
  element: HTMLElement,
  anchor: HTMLElement | null | undefined,
  active: () => boolean,
  ms = 2_500
): () => void {
  const snap = (): void => {
    if (active()) scrollToBottom(element, anchor)
  }
  snap()
  scrollToBottomSoon(element, anchor)
  const observer = new ResizeObserver(snap)
  observer.observe(element)
  if (anchor) observer.observe(anchor)
  const parent = anchor?.parentElement
  if (parent && parent !== element) observer.observe(parent)
  const stop = window.setTimeout(() => observer.disconnect(), ms)
  return () => {
    observer.disconnect()
    window.clearTimeout(stop)
  }
}
