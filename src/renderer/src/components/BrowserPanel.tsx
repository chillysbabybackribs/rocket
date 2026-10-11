import { useImagePreviewOpen } from './Attachments.tsx'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ArrowLeft, ArrowRight, Lock, RotateCw, Search, X } from 'lucide-react'
import type { BrowserState, BrowserTab, Suggestion } from '../../../shared/types.ts'
import { setReadingSpeed, useApp } from '../store.ts'
import { BrowserTabs } from './BrowserTabs.tsx'
import { ReadingControl, type ReadingActions } from './ReadingControl.tsx'

// The UI's half of the embedded browser: the tab strip, a toolbar, and an empty box whose
// position is reported to main, which lays the active tab's page (a native view) exactly over
// it. Nothing in the UI may be drawn across that box, because the native view always paints on
// top; the address field's dropdown is therefore drawn by main too, in a view above the page.

const send = window.rocket.browser.send
const EMPTY: BrowserState = { tabs: [], activeId: null, readingSpeed: 1 }
const READING: ReadingActions = {
  flip: () => send({ type: 'reading', action: 'flip' }),
  toggle: () => send({ type: 'reading', action: 'toggle' }),
  stop: () => send({ type: 'reading', action: 'stop' }),
  setSpeed: (speed) => setReadingSpeed(speed)
}

/** How Safari shows an address at rest: the site's name alone, with a lock when it is secure. */
function atRest(url: string): { kind: 'secure' | 'insecure' | 'other'; label: string } {
  try {
    const { protocol, hostname } = new URL(url)
    if (protocol === 'https:' || protocol === 'http:') {
      return { kind: protocol === 'https:' ? 'secure' : 'insecure', label: hostname.replace(/^www\./, '') }
    }
  } catch {
    // Not an address the URL parser knows; show it as it is.
  }
  return { kind: 'other', label: url }
}

// The address field, after Safari's. At rest it shows the site's name in the middle; focused, it
// becomes the whole address, selected, ready to be typed over. A line along its bottom edge follows
// the page load. While typing, it fills in the best visited site after the caret, selected, as
// Chrome does: Enter opens it, typing on replaces it, Backspace or Escape takes it back.
function AddressField({ tab }: { tab: BrowserTab | null }) {
  const url = tab?.url ?? ''
  const [text, setText] = useState(url)
  const [editing, setEditing] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selected, setSelected] = useState(-1)
  /** What the user typed, to return to when the selection leaves the dropdown. */
  const typed = useRef('')
  /** Set by focus, so the click that gave focus does not undo the select-all. */
  const justFocused = useRef(false)
  /** The filled-in address on show, or null. Only a keystroke that adds text asks for one. */
  const inline = useRef<string | null>(null)
  const completing = useRef(false)
  const field = useRef<HTMLFormElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setText(url)
  }, [url, editing])
  // Another tab is another address, even mid-edit.
  useEffect(() => setText(url), [tab?.id])

  /**
   * Show `address` after what was typed, the added part selected, and its row highlighted. The
   * text is written at once (flushSync): rows arrive outside React's input events, and a render
   * left for later could land after the next keystroke and select the wrong letters.
   */
  const fillIn = (address: string): void => {
    const value = typed.current + address.slice(typed.current.length)
    inline.current = value
    flushSync(() => {
      setText(value)
      setSelected(0)
    })
    input.current?.setSelectionRange(typed.current.length, value.length)
    send({ type: 'suggestSelect', index: 0 })
  }

  useEffect(() => window.rocket.browser.onSuggestions((list) => {
    setSuggestions(list.items)
    const field = input.current
    const current = list.typed === typed.current && field !== null && document.activeElement === field
    if (current && inline.current && field.value === inline.current) {
      // Already filled in as the user typed on; the new rows lead with it, or no longer offer it.
      if (list.inline) {
        setSelected(0)
        send({ type: 'suggestSelect', index: 0 })
      } else {
        inline.current = null
        setText(typed.current)
        setSelected(-1)
      }
    } else if (current && list.inline && completing.current && field.value === typed.current && field.selectionEnd === field.value.length) fillIn(list.inline)
    // Rows for older text, or a caret moved back into the text, leave the field as it is.
    else setSelected((index) => (index < list.items.length ? index : -1))
  }), [])
  useEffect(() => window.rocket.browser.onFocusAddress(() => {
    input.current?.focus()
    input.current?.select()
  }), [])

  const rest = atRest(url)
  return (
    <form
      ref={field}
      className={`address${editing ? ' is-editing' : ''}`}
      onSubmit={(event) => {
        event.preventDefault()
        send({ type: 'navigate', input: text })
        input.current?.blur()
      }}
    >
      <input
        ref={input}
        className="address-input"
        value={text}
        spellCheck={false}
        aria-label="Address"
        onFocus={(event) => {
          setEditing(true)
          justFocused.current = true
          event.target.select()
        }}
        onMouseUp={(event) => {
          if (justFocused.current) event.preventDefault()
          justFocused.current = false
        }}
        onBlur={() => {
          setEditing(false)
          setSelected(-1)
          inline.current = null
          send({ type: 'suggestHide' })
        }}
        onChange={(event) => {
          justFocused.current = false
          const value = event.target.value
          const shown = inline.current
          const atEnd = event.target.selectionEnd === value.length
          completing.current = atEnd && !(event.nativeEvent as InputEvent).inputType?.startsWith('delete')
          typed.current = value
          inline.current = null
          const box = field.current!.getBoundingClientRect()
          send({ type: 'suggest', text: value, anchor: { x: box.left, y: box.top, width: box.width, height: box.height } })
          // A letter that matches the next one filled in keeps the rest on show without waiting
          // for main's answer, so the field does not flicker with each keystroke.
          if (completing.current && shown && shown.length > value.length && shown.toLowerCase().startsWith(value.toLowerCase())) fillIn(shown)
          else {
            setText(value)
            setSelected(-1)
          }
        }}
        onKeyDown={(event) => {
          justFocused.current = false
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length) {
            // The selection walks the rows and passes through "none", which is the typed text.
            event.preventDefault()
            // A row picked by arrow stays picked when later rows (Google's) arrive.
            inline.current = null
            completing.current = false
            const places = suggestions.length + 1
            const next = (selected + 1 + (event.key === 'ArrowDown' ? 1 : places - 1)) % places - 1
            setSelected(next)
            setText(next < 0 ? typed.current : suggestions[next].value)
            send({ type: 'suggestSelect', index: next })
          } else if (event.key === 'Escape') {
            event.preventDefault()
            if (inline.current && text === inline.current) {
              // The first Escape takes back what was filled in, the next closes the dropdown.
              inline.current = null
              completing.current = false
              setText(typed.current)
              setSelected(-1)
              send({ type: 'suggestSelect', index: -1 })
            } else if (suggestions.length) send({ type: 'suggestHide' })
            else {
              setText(url)
              requestAnimationFrame(() => input.current?.select())
            }
          }
        }}
      />
      {!editing && (
        <div className="address-rest">
          {!url && <Search size={12} />}
          {rest.kind === 'secure' && <Lock size={11} strokeWidth={2.4} />}
          {rest.kind === 'insecure' && <span className="address-warning">Not Secure —</span>}
          <span className="address-label">{url ? rest.label : 'Search or enter website name'}</span>
        </div>
      )}
      <span className={`address-progress${tab?.loading ? ' is-loading' : ''}`} />
    </form>
  )
}

export function BrowserPanel() {
  const imagePreview = useImagePreviewOpen()
  const [state, setState] = useState(EMPTY)
  const stage = useRef<HTMLDivElement>(null)
  const active = state.tabs.find((tab) => tab.id === state.activeId) ?? null
  const readingSpeed = useApp((app) => app.readingSpeed)

  useEffect(() => {
    // The app's preference is the speed; main's saved one may be older, from before a file was read.
    send({ type: 'readingSpeed', speed: readingSpeed })
    const off = window.rocket.browser.onState((next) => {
      setState(next)
      setReadingSpeed(next.readingSpeed, true)
    })
    send({ type: 'sync' })
    return off
  }, [])

  // The page is a native view over the window; while a dialog is open it is hidden, not covered.
  const covered = imagePreview
  useEffect(() => {
    const element = stage.current
    if (!element) return
    const report = (): void => {
      if (covered) return send({ type: 'setBounds', bounds: null })
      const box = element.getBoundingClientRect()
      send({ type: 'setBounds', bounds: { x: box.left, y: box.top, width: box.width, height: box.height } })
    }
    const observer = new ResizeObserver(report)
    observer.observe(element)
    window.addEventListener('resize', report)
    report()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
      send({ type: 'setBounds', bounds: null })
      send({ type: 'chromeFocus', focused: false })
    }
  }, [covered])

  return (
    <section
      className="browser"
      aria-label="Browser"
      onFocus={() => send({ type: 'chromeFocus', focused: true })}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) send({ type: 'chromeFocus', focused: false })
      }}
    >
      <BrowserTabs tabs={state.tabs} activeId={state.activeId} />
      <div className="browser-frame">
        <div className={`browser-bar${active?.reading ? ' is-reading' : ''}`}>
          <div className="browser-nav">
            <button type="button" className="icon-button" aria-label="Back" disabled={!active?.canGoBack} onClick={() => send({ type: 'back' })}>
              <ArrowLeft size={15} />
            </button>
            <button type="button" className="icon-button" aria-label="Forward" disabled={!active?.canGoForward} onClick={() => send({ type: 'forward' })}>
              <ArrowRight size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={active?.loading ? 'Stop loading' : 'Reload'}
              disabled={!active?.url}
              onClick={() => send({ type: active?.loading ? 'stop' : 'reload' })}
            >
              {active?.loading ? <X size={15} /> : <RotateCw size={14} />}
            </button>
          </div>
          <AddressField tab={active} />
          <div className="browser-tools">
            <ReadingControl reading={active?.reading ?? null} speed={readingSpeed} disabled={!active?.url} actions={READING} />
          </div>
        </div>
        <div className="browser-stage" ref={stage} />
      </div>
    </section>
  )
}
