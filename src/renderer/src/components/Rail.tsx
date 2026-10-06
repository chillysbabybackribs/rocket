import { useEffect, useRef, useState } from 'react'
import { FlaskConical, Globe, PanelLeftClose, PanelLeftOpen, RefreshCw } from 'lucide-react'
import { PROVIDERS, providerLabel, type ProviderId, type UsageSnapshot, type UsageWindow } from '../../../shared/types.ts'
import { refreshUsage, setBrowserOpen, setEvalsOpen, setRailOpen, useApp } from '../store.ts'
import { ProviderGlyph } from './glyphs.tsx'
import { Goals, UNDER_WAY } from './Goals.tsx'
import { History } from './History.tsx'

// The left edge of the window: window controls, the usage notch, and the global actions (goals,
// chat history, the browser). The notch is the app's signature: a black tab growing out of the
// window edge with one ring per provider, each showing how much of that subscription's nearest
// limit is used. The rail folds to a strip to give the chat its width; the strip keeps a dot per
// provider and peeks the whole rail over the chat while the pointer rests on it.

const RING = 42
const STROKE = 3.5
const RADIUS = (RING - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Green while there is room, yellow past half, red when the limit is close. */
function levelOf(percent: number): 'ok' | 'warn' | 'high' {
  return percent >= 70 ? 'high' : percent >= 45 ? 'warn' : 'ok'
}

function resetText(resetsAt: number | null, now: number): string {
  if (!resetsAt) return ''
  const minutes = Math.round((resetsAt - now) / 60_000)
  if (minutes <= 0) return 'Resetting now'
  if (minutes < 60) return `Resets in ${minutes} min`
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return `Resets in ${hours} h${rest ? ` ${rest} min` : ''}`
  }
  const date = new Date(resetsAt)
  const day = date.toLocaleDateString(undefined, { weekday: 'short' })
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `Resets ${day} ${time}`
}

/** A window control's mark, drawn on the light's own 12px grid so it sits dead centre. */
function LightGlyph({ d }: { d: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d={d} />
    </svg>
  )
}

function Ring({ provider, usage }: { provider: ProviderId; usage: UsageSnapshot | undefined }) {
  const lead: UsageWindow | undefined = usage?.windows[0]
  const percent = lead?.percent ?? 0
  return (
    <>
      <span className="ring">
        <svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} aria-hidden>
          <circle className="ring-track" cx={RING / 2} cy={RING / 2} r={RADIUS} strokeWidth={STROKE} />
          {lead && (
            <circle
              className={`ring-value level-${levelOf(percent)}`}
              cx={RING / 2}
              cy={RING / 2}
              r={RADIUS}
              strokeWidth={STROKE}
              strokeDasharray={`${(Math.max(percent, 1.5) / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            />
          )}
        </svg>
        <span className="ring-glyph"><ProviderGlyph provider={provider} size={17} /></span>
      </span>
      <span className="ring-percent">{lead ? `${percent}%` : usage ? '–' : '···'}</span>
    </>
  )
}

function Flyout({ provider, usage, top, keepOpen, hide }: {
  provider: ProviderId
  usage: UsageSnapshot | undefined
  top: number
  keepOpen: () => void
  hide: () => void
}) {
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async (): Promise<void> => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refreshUsage(provider, true)
    } finally {
      setRefreshing(false)
    }
  }
  const now = Date.now()
  const detail = [usage?.plan, usage?.account].filter(Boolean).join(' · ')
  return (
    <div className="flyout" style={{ top }} role="group" aria-label={`${providerLabel(provider)} usage`}
      onMouseEnter={keepOpen} onMouseLeave={hide} onFocus={keepOpen} onBlur={hide}>
      <div className="flyout-title">
        <ProviderGlyph provider={provider} size={18} />
        <span>{providerLabel(provider)} Usage</span>
        <button
          type="button"
          className={`flyout-refresh${refreshing ? ' is-refreshing' : ''}`}
          aria-label={`Refresh ${providerLabel(provider)} usage`}
          aria-disabled={refreshing}
          title={refreshing ? 'Refreshing usage…' : 'Refresh usage'}
          onClick={refresh}
        >
          <RefreshCw size={14} aria-hidden />
        </button>
      </div>
      {!usage && <p className="flyout-empty">Reading usage…</p>}
      {usage?.windows.map((window) => (
        <div className="flyout-window" key={window.label}>
          <div className="flyout-row">
            <span>{window.label}</span>
            <span className="flyout-reset">{resetText(window.resetsAt, now)}</span>
          </div>
          <div className="flyout-bar">
            <div className={`flyout-fill level-${levelOf(window.percent)}`} style={{ width: `${Math.max(window.percent, 1.5)}%` }} />
          </div>
          <div className="flyout-used">{window.percent}% Used</div>
        </div>
      ))}
      {usage && usage.windows.length === 0 && <p className="flyout-empty">{usage.unavailable ?? 'No usage reported.'}</p>}
      {usage?.note && <p className="flyout-note">{usage.note}</p>}
      {detail && <p className="flyout-note">{detail}</p>}
    </div>
  )
}

function UsageNotch() {
  const usage = useApp((state) => state.usage)
  const [hovered, setHovered] = useState<{ provider: ProviderId; top: number } | null>(null)
  const closeTimer = useRef<number | null>(null)

  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current) }, [])

  const keepOpen = (): void => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
  }
  const show = (provider: ProviderId, element: HTMLElement): void => {
    keepOpen()
    const box = element.getBoundingClientRect()
    setHovered({ provider, top: box.top + box.height / 2 })
    // The host reuses a reading younger than a minute, so hovering is cheap.
    refreshUsage(provider)
  }
  const hide = (): void => {
    keepOpen()
    closeTimer.current = window.setTimeout(() => setHovered(null), 120)
  }

  return (
    <div className="notch" aria-label="Subscription usage">
      {PROVIDERS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className="notch-item"
          aria-label={`${label} usage${usage[id]?.windows[0] ? `: ${usage[id]!.windows[0]!.percent}% used` : ''}`}
          onMouseEnter={(event) => show(id, event.currentTarget)}
          onMouseLeave={hide}
          onFocus={(event) => show(id, event.currentTarget)}
          onBlur={hide}
          onClick={() => refreshUsage(id, true)}
        >
          <Ring provider={id} usage={usage[id]} />
        </button>
      ))}
      {hovered && <Flyout key={hovered.provider} provider={hovered.provider} usage={usage[hovered.provider]} top={hovered.top} keepOpen={keepOpen} hide={hide} />}
    </div>
  )
}

function Traffic() {
  return (
    <div className="traffic" role="group" aria-label="Window controls">
      <button type="button" className="light light-close" aria-label="Close window" onClick={() => window.rocket.window.close()}>
        <LightGlyph d="M4 4l4 4M8 4l-4 4" />
      </button>
      <button type="button" className="light light-min" aria-label="Minimize window" onClick={() => window.rocket.window.minimize()}>
        <LightGlyph d="M3.5 6h5" />
      </button>
      <button type="button" className="light light-max" aria-label="Zoom window" onClick={() => window.rocket.window.toggleMaximize()}>
        <LightGlyph d="M3.5 6h5M6 3.5v5" />
      </button>
    </div>
  )
}

/** The notch and the actions: the rail's body, whether it stands in its column or peeks over the chat. */
function RailBody({ open }: { open: boolean }) {
  const browserOpen = useApp((state) => state.browserOpen && !state.artifact && !state.evalsOpen)
  const evalsOpen = useApp((state) => state.evalsOpen && !state.artifact)
  return (
    <>
      <div className="rail-middle">
        <UsageNotch />
      </div>
      <div className="rail-actions">
        <Goals />
        <History />
        <button
          type="button"
          className={`rail-button${evalsOpen ? ' is-on' : ''}`}
          title={evalsOpen ? 'Hide evals' : 'Show evals'}
          aria-label={evalsOpen ? 'Hide evals' : 'Show evals'}
          aria-pressed={evalsOpen}
          data-nav="evals"
          onClick={() => setEvalsOpen(!evalsOpen)}
        >
          <FlaskConical size={17} />
        </button>
        <button
          type="button"
          className={`rail-button${browserOpen ? ' is-on' : ''}`}
          title={browserOpen ? 'Hide browser' : 'Show browser'}
          aria-label={browserOpen ? 'Hide browser' : 'Show browser'}
          aria-pressed={browserOpen}
          data-nav="browser"
          onClick={() => setBrowserOpen(!browserOpen)}
        >
          <Globe size={17} />
        </button>
        <button
          type="button"
          className="rail-button rail-fold"
          title={open ? 'Hide the rail' : 'Show the rail'}
          aria-label={open ? 'Hide the rail' : 'Show the rail'}
          aria-pressed={!open}
          onClick={() => setRailOpen(!open)}
        >
          {open ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </div>
    </>
  )
}

/**
 * The rail folded: a strip with a dot per provider in its usage colour and the goals count, so
 * the glance survives the fold. Resting the pointer on it slides the whole rail out over the chat;
 * it goes back when the pointer leaves. Menus and flyouts are children of the rail, so being in
 * one counts as being on the rail.
 */
function FoldedRail() {
  const usage = useApp((state) => state.usage)
  const waiting = useApp((state) => state.goals.filter((goal) => UNDER_WAY.includes(goal.status)).length)
  const asking = useApp((state) => state.goals.some((goal) => goal.status === 'needs_you' || goal.status === 'confirming'))
  const [peek, setPeek] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  const show = (): void => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    setPeek(true)
  }
  const hide = (): void => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPeek(false), 220)
  }
  const summary = PROVIDERS.map(({ id, label }) => {
    const lead = usage[id]?.windows[0]
    return `${label} ${lead ? `${lead.percent}%` : '–'}`
  }).join(', ')
  return (
    <aside className="rail is-folded" onMouseEnter={show} onMouseLeave={hide}>
      <Traffic />
      <div className="rail-middle">
        <div className="rail-dots" role="img" aria-label={`Usage: ${summary}`} title={`Usage: ${summary}`}>
          {PROVIDERS.map(({ id }) => {
            const lead = usage[id]?.windows[0]
            return <span key={id} className={`rail-dot${lead ? ` level-${levelOf(lead.percent)}` : ''}`} />
          })}
        </div>
      </div>
      <div className="rail-actions">
        {waiting > 0 && <span className={`rail-count${asking ? ' is-asking' : ''}`} title={`${waiting} ${waiting === 1 ? 'goal' : 'goals'} under way`}>{waiting}</span>}
        <button type="button" className="rail-button rail-fold" title="Show the rail" aria-label="Show the rail" aria-pressed onClick={() => setRailOpen(true)}>
          <PanelLeftOpen size={14} />
        </button>
      </div>
      {peek && (
        <div className="rail-peek" aria-label="Rail">
          <Traffic />
          <RailBody open={false} />
        </div>
      )}
    </aside>
  )
}

export function Rail() {
  const open = useApp((state) => state.railOpen)
  if (!open) return <FoldedRail />
  return (
    <aside className="rail">
      <Traffic />
      <RailBody open />
    </aside>
  )
}
