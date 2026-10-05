import { useRef } from 'react'
import { Target, X } from 'lucide-react'
import type { Goal } from '../../shared/types.ts'
import { dismissError, setGoalPaneOpen, setGoalWidth, useApp } from './store.ts'
import { BrowserPanel } from './components/BrowserPanel.tsx'
import { Composer } from './components/Composer.tsx'
import { goalStatusText, goalTone } from './components/Goals.tsx'
import { GoalNote, GoalPane } from './components/GoalPane.tsx'
import { NewGoal } from './components/NewGoal.tsx'
import { Rail } from './components/Rail.tsx'
import { Transcript } from './components/Transcript.tsx'

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Still up?'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

const GOAL_MIN = 320
const CHAT_MIN = 300

/**
 * A goal's chat, split like an artifact: the conversation on the left, the goal on the right,
 * with a divider to drag. The note box stands in for the composer while the goal runs; once it
 * has ended, the chat carries on as any other.
 */
function GoalChat({ goal }: { goal: Goal }) {
  const open = useApp((state) => state.goalPaneOpen)
  const width = useApp((state) => state.goalWidth)
  const chatId = useApp((state) => state.activeChatId)
  const split = useRef<HTMLElement>(null)
  const ended = goal.status === 'done' || goal.status === 'stopped'

  const drag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('is-dragging')
    let last = width
    const move = (moved: PointerEvent): void => {
      const box = split.current!.getBoundingClientRect()
      last = Math.round(Math.max(GOAL_MIN, Math.min(box.width - CHAT_MIN, box.right - moved.clientX)))
      setGoalWidth(last, false)
    }
    const up = (): void => {
      handle.classList.remove('is-dragging')
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      setGoalWidth(last, true)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }

  return (
    <main ref={split} className={`chat has-goal${open ? ' is-split' : ''}`} style={{ '--goal-width': `${width}px` } as React.CSSProperties}>
      <div className="goal-chat">
        <div className="goal-chat-head">
          <button type="button" className={`goal-chip-toggle is-${goalTone(goal.status)}`} aria-pressed={open} title={open ? 'Hide the goal' : 'Show the goal'} onClick={() => setGoalPaneOpen(!open)}>
            <Target size={13} aria-hidden />
            <span>Goal · {goalStatusText(goal)}</span>
          </button>
        </div>
        <Transcript />
        <div className="composer-dock">
          {ended ? <Composer key={chatId ?? 'new'} placeholder="Reply…" /> : <GoalNote goal={goal} />}
        </div>
      </div>
      {open && (
        <>
          <div className="goal-divider" role="separator" aria-orientation="vertical" aria-label="Resize the goal" onPointerDown={drag} />
          <GoalPane goal={goal} />
        </>
      )}
    </main>
  )
}

function ChatPane() {
  const chat = useApp((state) => state.chats.find((entry) => entry.id === state.activeChatId) ?? null)
  const chatId = useApp((state) => state.activeChatId)
  const hasTurns = useApp((state) => state.turns.length > 0)
  const goal = useApp((state) => state.goals.find((entry) => entry.chatId === state.activeChatId) ?? null)

  if (goal) return <GoalChat goal={goal} />
  if (!chat || !hasTurns) {
    return (
      <main className="chat is-empty">
        <div className="welcome">
          <h1 className="welcome-title">{greeting()}</h1>
          <Composer key={chatId ?? 'new'} placeholder="How can I help you today?" />
          <p className="welcome-hint">Pick a provider and model for each message. They all share the conversation.</p>
        </div>
      </main>
    )
  }
  return (
    <main className="chat">
      <Transcript />
      <div className="composer-dock">
        <Composer key={chatId ?? 'new'} placeholder="Reply…" />
      </div>
    </main>
  )
}

export function App() {
  const browserOpen = useApp((state) => state.browserOpen)
  const error = useApp((state) => state.error)
  const newGoal = useApp((state) => state.newGoal !== null)
  const split = useApp((state) => state.goalPaneOpen && state.goals.some((goal) => goal.chatId === state.activeChatId))
  return (
    <div className={`app${browserOpen ? ' has-browser' : ''}${split ? ' has-goal' : ''}`}>
      <Rail />
      <ChatPane />
      {browserOpen && <BrowserPanel />}
      {newGoal && <NewGoal />}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={dismissError}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
