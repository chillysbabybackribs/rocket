import { useEffect, useRef, useState } from 'react'
import { Plus, Target } from 'lucide-react'
import type { Goal, GoalStatus } from '../../../shared/types.ts'
import { focusedChatId, openChat, openNewGoal, useApp } from '../store.ts'
import { GoalStatusIcon } from './GoalIcons.tsx'

// Goals, from the rail: the ones under way first, then the finished ones, and "New goal". Like
// the history menu, it grows to the right over the chat column and never reaches the browser.

const UNDER_WAY: GoalStatus[] = ['drafting', 'confirming', 'working', 'checking', 'needs_you', 'paused']

export function goalStatusText(goal: Goal): string {
  const round = goal.rounds.at(-1)?.n ?? 0
  switch (goal.status) {
    case 'drafting': return 'drafting'
    case 'confirming': return 'check the plan'
    case 'working': return `round ${round}`
    case 'checking': return `checking round ${round}`
    case 'needs_you': return 'needs you'
    case 'paused': return 'paused'
    case 'done': return `done · ${round} ${round === 1 ? 'round' : 'rounds'}`
    case 'stopped': return 'stopped'
  }
}

function GoalsMenu({ onPick }: { onPick: () => void }) {
  const goals = useApp((state) => state.goals)
  const activeChatId = useApp(focusedChatId)
  const groups = [
    { label: 'Under way', goals: goals.filter((goal) => UNDER_WAY.includes(goal.status)) },
    { label: 'Finished', goals: goals.filter((goal) => !UNDER_WAY.includes(goal.status)) }
  ].filter((group) => group.goals.length)

  return (
    <div className="history-menu goals-menu" role="menu" aria-label="Goals">
      {goals.length === 0 && <p className="history-empty">Describe something you want done end to end, and the models work on it until it is.</p>}
      {groups.map((group) => (
        <section key={group.label}>
          <h2 className="history-heading">{group.label}</h2>
          {group.goals.map((goal) => (
            <div key={goal.id} className={`chat-row${goal.chatId === activeChatId ? ' is-active' : ''}`}>
              <button
                type="button"
                role="menuitem"
                className="chat-row-main"
                onClick={() => {
                  void openChat(goal.chatId)
                  onPick()
                }}
              >
                <GoalStatusIcon status={goal.status} />
                <span className="chat-row-title">{goal.title}</span>
                <span className="goal-row-status">{goalStatusText(goal)}</span>
              </button>
            </div>
          ))}
        </section>
      ))}
      <div className="goals-menu-foot">
        <button type="button" role="menuitem" className="chat-row-main" onClick={() => { openNewGoal(); onPick() }}>
          <Plus size={14} aria-hidden />
          <span className="chat-row-title">New goal…</span>
        </button>
      </div>
    </div>
  )
}

export function Goals() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const waiting = useApp((state) => state.goals.filter((goal) => UNDER_WAY.includes(goal.status)).length)
  const asking = useApp((state) => state.goals.some((goal) => goal.status === 'needs_you' || goal.status === 'confirming'))

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className="history" ref={root}>
      <button
        type="button"
        className={`rail-button${open ? ' is-on' : ''}`}
        title="Goals"
        aria-label={waiting ? `Goals, ${waiting} under way` : 'Goals'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Target size={17} />
        {waiting > 0 && <span className={`rail-badge${asking ? ' is-asking' : ''}`}>{waiting}</span>}
      </button>
      {open && <GoalsMenu onPick={() => setOpen(false)} />}
    </div>
  )
}
