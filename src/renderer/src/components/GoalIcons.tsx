import type { GoalStatus } from '../../../shared/types.ts'

// Status marks after Linear's: a circle that fills as work moves on. A dashed ring is not started,
// a half disc is under way, a three-quarter disc is being checked, a full disc with a tick is done.
// Drawn at 14px on a 14px grid so every stroke lands on a pixel.

const TONE: Record<GoalStatus, string> = {
  drafting: 'var(--text-3)',
  confirming: 'var(--warn)',
  working: 'var(--warn)',
  checking: 'var(--ok)',
  needs_you: '#f2994a',
  paused: 'var(--text-3)',
  done: 'var(--accent)',
  stopped: 'var(--text-4)'
}

/** A pie slice from twelve o'clock, `fraction` of the way round, inside a ring of radius 6. */
function slice(fraction: number): string {
  const angle = fraction * 2 * Math.PI
  const x = 7 + 3.5 * Math.sin(angle)
  const y = 7 - 3.5 * Math.cos(angle)
  return `M7 7 L7 3.5 A3.5 3.5 0 ${fraction > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`
}

export function GoalStatusIcon({ status, size = 14 }: { status: GoalStatus; size?: number }) {
  const color = TONE[status]
  const ring = <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.5" />
  let inner: React.ReactNode = null
  if (status === 'drafting') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="status-icon">
        <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="1.6 1.6" />
      </svg>
    )
  }
  if (status === 'working') inner = <path d={slice(0.5)} fill={color} />
  if (status === 'checking') inner = <path d={slice(0.75)} fill={color} />
  if (status === 'paused') inner = <path d="M5.5 4.75v4.5M8.5 4.75v4.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  if (status === 'needs_you') inner = <path d="M7 4v3.5M7 9.6v.1" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
  if (status === 'done' || status === 'stopped') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="status-icon">
        <circle cx="7" cy="7" r="7" fill={color} />
        {status === 'done'
          ? <path d="M4.3 7.2l1.8 1.8 3.6-3.8" fill="none" stroke="var(--canvas)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          : <path d="M5 5l4 4M9 5l-4 4" stroke="var(--canvas)" strokeWidth="1.5" strokeLinecap="round" />}
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className={`status-icon${status === 'working' || status === 'checking' ? ' is-live' : ''}`}>
      {ring}
      {inner}
    </svg>
  )
}

/** One line of the checklist: open ring, accent disc with a tick when met, red ring with a cross when not. */
export function LineIcon({ met }: { met: boolean | null }) {
  if (met === true) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-label="Met" className="status-icon">
        <circle cx="7" cy="7" r="7" fill="var(--accent)" />
        <path d="M4.3 7.2l1.8 1.8 3.6-3.8" fill="none" stroke="var(--canvas)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (met === false) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-label="Not met yet" className="status-icon">
        <circle cx="7" cy="7" r="6" fill="none" stroke="var(--high)" strokeWidth="1.5" />
        <path d="M5.2 5.2l3.6 3.6M8.8 5.2l-3.6 3.6" stroke="var(--high)" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-label="Not checked yet" className="status-icon">
      <circle cx="7" cy="7" r="6" fill="none" stroke="var(--text-4)" strokeWidth="1.5" />
    </svg>
  )
}

/** How much of the checklist is met, as a small ring. */
export function ProgressRing({ done, total, size = 14 }: { done: number; total: number; size?: number }) {
  const radius = 5.25
  const length = 2 * Math.PI * radius
  const share = total ? done / total : 0
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="status-icon">
      <circle cx="7" cy="7" r={radius} fill="none" stroke="var(--line-strong)" strokeWidth="1.75" />
      <circle
        cx="7" cy="7" r={radius} fill="none" stroke={share === 1 ? 'var(--accent)' : 'var(--ok)'} strokeWidth="1.75"
        strokeLinecap="round" strokeDasharray={`${share * length} ${length}`} transform="rotate(-90 7 7)"
      />
    </svg>
  )
}
