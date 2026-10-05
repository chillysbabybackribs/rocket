// What the address field's text means, and how hidden browser views are kept out of sight.

import type { BrowserWindow, Rectangle, WebContentsView } from 'electron'

/** Default home page for new tabs and when the last tab is closed. */
export const NEW_TAB_URL = 'https://www.google.com/'

/** A tab with no real page yet (empty address field, title "New Tab"). */
export function isBlankTabUrl(url: string): boolean {
  return !url || url === 'about:blank'
}

/** Home or blank tabs: omit from reopen-closed and browsing history. */
export function isNewTabUrl(url: string): boolean {
  // Google's home page may come back with tracking parameters added; a search has a path.
  return isBlankTabUrl(url) || url.replace(/[?#].*$/, '') === NEW_TAB_URL
}

/** Whether typed text is an address rather than words to search for. */
export function isAddress(input: string): boolean {
  const text = input.trim()
  if (/^(https?|file|about):/i.test(text)) return true
  if (/^localhost(:\d+)?(\/|$)/i.test(text) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text)) return true
  return !/\s/.test(text) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)
}

/** A typed address or a search: bare words go to a search engine, hosts get a scheme. */
export function toUrl(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  if (/^(https?|file|about):/i.test(text)) return text
  if (!isAddress(text)) return `https://www.google.com/search?q=${encodeURIComponent(text)}`
  return /^(localhost|\d{1,3}(\.\d{1,3}){3})(:|\/|$)/i.test(text) ? `http://${text}` : `https://${text}`
}

/** An address as people read it: no scheme, no www, no trailing slash. */
export function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')
}

// A browser view is a native surface: it cannot be covered, only hidden or moved. There are two
// ways to take one off screen:
// - 'invisible', the default, uses setVisible(false). Chromium then treats the page as a
//   background tab and stops drawing it: an animating page goes from 60 frames a second to none.
// - 'park' moves it almost entirely outside the window, with one pixel left inside so Chromium
//   keeps the surface mapped. The page does not know it is hidden and keeps rendering. The
//   reference build used this because it saw views stay blank after setVisible(false); that has
//   not shown on Electron 44, and ROCKET_BROWSER_HIDE=park brings it back if it ever does.
// Either way a view is added to the window once and never removed and re-added.
const INVISIBLE = process.env.ROCKET_BROWSER_HIDE !== 'park'

export function conceal(window: BrowserWindow, view: WebContentsView): void {
  if (INVISIBLE) {
    view.setVisible(false)
    return
  }
  const [width, height] = window.getContentSize()
  const size = view.getBounds()
  view.setBounds({ x: width - 1, y: height - 1, width: size.width, height: size.height })
}

export function reveal(view: WebContentsView, bounds: Rectangle): void {
  view.setBounds(bounds)
  if (INVISIBLE) view.setVisible(true)
}
