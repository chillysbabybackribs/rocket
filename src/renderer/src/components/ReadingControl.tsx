import '../reading.css'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronsDown, X } from 'lucide-react'
import type { BrowserTab } from '../../../shared/types.ts'
import { nudgeSpeed, READING_SLIDER_MAX, READING_SNAPS, snapSpeed, speedLabel, speedToSlider, timeLeftLabel } from '../../../shared/reading.ts'

// Hands-free reading, at the right of the browser's toolbar (docs/mockups/reading-scroll.html).
// At rest it is one button; reading, it opens into a pill: play/pause inside a ring that fills as
// the page goes by, a speed slider, the speed with the time the rest of the page takes, and stop.
// It stays in the toolbar, so it never covers or moves the page. The scrolling itself is main's
// (src/main/reading-scroll.ts); this only shows its state and sends what the user asks for.

const send = window.rocket.browser.send
/** The ring's circumference, for a radius of 12. */
const RING = 2 * Math.PI * 12

export function ReadingControl({ tab, speed }: { tab: BrowserTab | null; speed: number }) {
  // The slider shows where it was put until main's answer comes back. Shown at the old speed in
  // between, it would hand that back in the `change` event that ends a drag or a key press.
  const [pending, setPending] = useState<number | null>(null)
  useEffect(() => setPending(null), [speed])
  /** Wheel travel not yet spent: a trackpad sends many small deltas, a wheel notch one large one. */
  const wheel = useRef(0)
  const reading = tab?.reading ?? null
  if (!reading) {
    return (
      <button
        type="button"
        className="icon-button"
        aria-label="Read hands-free"
        title="Read hands-free (Alt+S)"
        disabled={!tab?.url}
        onClick={() => send({ type: 'reading', action: 'flip' })}
      >
        <ChevronsDown size={16} />
      </button>
    )
  }

  const play = reading.state === 'running'
    ? { label: 'Pause', hint: 'Pause (Space)' }
    : reading.state === 'end' ? { label: 'Read from the top', hint: 'Read from the top' } : { label: 'Carry on', hint: 'Carry on (Space)' }
  const value = pending ?? speedToSlider(speed)
  const setSpeed = (next: number): void => send({ type: 'readingSpeed', speed: next })
  return (
    <div
      className={`reading is-${reading.state}`}
      // Scrolling over the control sets the speed, a step a notch.
      onWheel={(event) => {
        wheel.current += event.deltaY
        if (Math.abs(wheel.current) < 50) return
        setSpeed(nudgeSpeed(speed, wheel.current < 0 ? 1 : -1))
        wheel.current = 0
      }}
    >
      <button type="button" className="reading-ring" aria-label={play.label} title={play.hint} onClick={() => send({ type: 'reading', action: 'toggle' })}>
        <svg className="reading-dial" width="26" height="26" viewBox="0 0 26 26" fill="none" strokeWidth="2">
          <circle className="reading-groove" cx="13" cy="13" r="12" />
          <circle className="reading-done" cx="13" cy="13" r="12" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING * (1 - reading.progress)} />
        </svg>
        <span className="reading-face" />
        <Glyph state={reading.state} />
      </button>
      <div className="reading-slider" title="Speed (Alt+↑ ↓, or scroll over it)">
        <div className="reading-ticks">
          {READING_SNAPS.map((round) => (
            <i key={round} className={round <= speed ? 'is-under' : ''} style={{ left: `${speedToSlider(round) / (READING_SLIDER_MAX / 100)}%` }} />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={READING_SLIDER_MAX}
          step={1}
          value={value}
          aria-label="Reading speed"
          aria-valuetext={`${speedLabel(speed)}, ${timeLeftLabel(reading.secondsLeft)}`}
          style={{ '--fill': `${value / (READING_SLIDER_MAX / 100)}%` } as CSSProperties}
          onChange={(event) => {
            const at = Number(event.currentTarget.value)
            setPending(at)
            setSpeed(snapSpeed(at))
          }}
          // Let go near a round speed, the thumb lands on it.
          onPointerUp={() => requestAnimationFrame(() => setPending(null))}
        />
      </div>
      <div className="reading-readout" title="Double-click for 1×" onDoubleClick={() => setSpeed(1)}>
        <span className="reading-speed">{speedLabel(speed)}</span>
        <span className="reading-left">{reading.state === 'end' ? 'Done' : timeLeftLabel(reading.secondsLeft)}</span>
      </div>
      <span className="reading-sep" />
      <button type="button" className="reading-stop" aria-label="Stop reading" title="Stop (Esc)" onClick={() => send({ type: 'reading', action: 'stop' })}>
        <X size={12} strokeWidth={2.4} />
      </button>
    </div>
  )
}

function Glyph({ state }: { state: 'running' | 'paused' | 'end' }) {
  if (state === 'running') {
    return (
      <svg className="reading-glyph" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <rect x="5" y="3" width="5" height="18" rx="1.5" /><rect x="14" y="3" width="5" height="18" rx="1.5" />
      </svg>
    )
  }
  if (state === 'end') {
    return (
      <svg className="reading-glyph" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
      </svg>
    )
  }
  return (
    <svg className="reading-glyph" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 3.8v16.4a1 1 0 0 0 1.5.86l13-8.2a1 1 0 0 0 0-1.72l-13-8.2A1 1 0 0 0 7 3.8Z" />
    </svg>
  )
}
