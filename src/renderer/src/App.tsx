import { useRef } from 'react'
import { PanelRightOpen, X } from 'lucide-react'
import type { Goal } from '../../shared/types.ts'
import { dismissError, setGoalPaneOpen, setGoalWidth, useApp } from './store.ts'
import { ArtifactPanel } from './components/ArtifactPanel.tsx'
import { BrowserPanel } from './components/BrowserPanel.tsx'
import { Composer } from './components/Composer.tsx'
import { GoalStatusIcon } from './components/GoalIcons.tsx'
import { goalStatusText } from './components/Goals.tsx'
import { GoalNote, GoalPane } from './components/GoalPane.tsx'
import { NewGoal } from './components/NewGoal.tsx'
import { PlanDrawer } from './components/PlanDrawer.tsx'
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
 * A chat with something beside it, split like an artifact: the conversation on the left, `side`
 * on the right, with a divider to drag. The goal pane and the plan drawer both live here and
 * share one width.
 */
function Split({ side, children }: { side: React.ReactNode; children: React.ReactNode }) {
  const width = useApp((state) => state.goalWidth)
  const split = useRef<HTMLElement>(null)

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
    <main ref={split} className={`chat has-goal${side ? ' is-split' : ''}`} style={{ '--goal-width': `${width}px` } as React.CSSProperties}>
      <div className="goal-chat">{children}</div>
      {side && (
        <>
          <div className="goal-divider" role="separator" aria-orientation="vertical" aria-label="Resize the side pane" onPointerDown={drag} />
          {side}
        </>
      )}
    </main>
  )
}

/**
 * A goal's chat: the goal beside the conversation. The note box stands in for the composer while
 * the goal runs; once it has ended, the chat carries on as any other. A goal's chat has no plan
 * drawer: the round's plan is a section of the goal pane.
 */
function GoalChat({ goal }: { goal: Goal }) {
  const open = useApp((state) => state.goalPaneOpen)
  const chatId = useApp((state) => state.activeChatId)
  const ended = goal.status === 'done' || goal.status === 'stopped'
  return (
    <Split side={open ? <GoalPane goal={goal} /> : null}>
      {!open && (
        <div className="goal-chat-head">
          <button type="button" className="goal-chip-toggle" title="Show the goal" onClick={() => setGoalPaneOpen(true)}>
            <GoalStatusIcon status={goal.status} size={12} />
            <span>{goal.title}</span>
            <span className="goal-chip-status">{goalStatusText(goal)}</span>
            <PanelRightOpen size={13} aria-hidden />
          </button>
        </div>
      )}
      <Transcript />
      <div className="composer-dock">
        {ended ? <Composer key={chatId ?? 'new'} placeholder="Reply…" /> : <GoalNote goal={goal} />}
      </div>
    </Split>
  )
}

function ChatPane() {
  const chat = useApp((state) => state.chats.find((entry) => entry.id === state.activeChatId) ?? null)
  const chatId = useApp((state) => state.activeChatId)
  const hasTurns = useApp((state) => state.turns.length > 0)
  const goal = useApp((state) => state.goals.find((entry) => entry.chatId === state.activeChatId) ?? null)
  // The turn whose plan is open beside the chat, with the message that started it for the title.
  const planTurn = useApp((state) => state.turns.find((turn) => turn.id === state.planTurnId) ?? null)
  const planUserId = useApp((state) => (state.planTurnId ? state.turnItems[state.planTurnId]?.[0] : undefined))

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
  const composer = (
    <div className="composer-dock">
      <Composer key={chatId ?? 'new'} placeholder="Reply…" />
    </div>
  )
  if (planTurn) {
    return (
      <Split side={<PlanDrawer turn={planTurn} userItemId={planUserId} />}>
        <Transcript />
        {composer}
      </Split>
    )
  }
  return (
    <main className="chat">
      <Transcript />
      {composer}
    </main>
  )
}

export function App() {
  const artifact = useApp((state) => state.artifact)
  const browserOpen = useApp((state) => state.browserOpen)
  const error = useApp((state) => state.error)
  const newGoal = useApp((state) => state.newGoal !== null)
  const split = useApp((state) => (state.goals.some((goal) => goal.chatId === state.activeChatId) ? state.goalPaneOpen : state.planTurnId !== null))
  return (
    <div className={`app${browserOpen || artifact ? ' has-browser' : ''}${split ? ' has-goal' : ''}`}>
      <Rail />
      <ChatPane />
      {artifact ? <ArtifactPanel /> : browserOpen && <BrowserPanel />}
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
