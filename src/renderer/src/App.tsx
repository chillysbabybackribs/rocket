import { addDraftFiles, addExistingAttachment, ATTACHMENT_DRAG_TYPE, updateDraft } from './drafts.ts'
import './images.css'
import { useEffect, useRef, useState } from 'react'
import { Images, PanelRightOpen, X } from 'lucide-react'
import type { Goal } from '../../shared/types.ts'
import { PaneContext, usePane, usePaneChatId, usePaneView } from './pane.ts'
import { act } from './app-map.ts'
import { dismissError, focusedChatId, paneAt, setGoalPaneOpen, setGoalWidth, useApp } from './store.ts'
import { ArtifactPanel } from './components/ArtifactPanel.tsx'
import { BrowserPanel } from './components/BrowserPanel.tsx'
import { EvalPanel } from './components/EvalPanel.tsx'
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
 * share one width. With the card split into panes there is no room for a side, so `side` is
 * only shown while the chat has the card to itself.
 */
function Split({ side, children }: { side: React.ReactNode; children: React.ReactNode }) {
  const width = useApp((state) => state.goalWidth)
  const alone = useApp((state) => state.panes.length === 1)
  const split = useRef<HTMLDivElement>(null)
  const shown = alone ? side : null

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
    <div ref={split} className={`pane-split${shown ? ' is-split' : ''}`} style={{ '--goal-width': `${width}px` } as React.CSSProperties}>
      <div className="goal-chat">{children}</div>
      {shown && (
        <>
          <div className="goal-divider" role="separator" aria-orientation="vertical" aria-label="Resize the side pane" onPointerDown={drag} />
          {shown}
        </>
      )}
    </div>
  )
}

/**
 * A goal's chat: the goal beside the conversation. The note box stands in for the composer while
 * the goal runs; once it has ended, the chat carries on as any other. A goal's chat has no plan
 * drawer: the round's plan is a section of the goal pane.
 */
function GoalChat({ goal }: { goal: Goal }) {
  const open = useApp((state) => state.goalPaneOpen)
  const alone = useApp((state) => state.panes.length === 1)
  const chatId = usePaneChatId()
  const ended = goal.status === 'done' || goal.status === 'stopped'
  return (
    <Split side={open ? <GoalPane goal={goal} /> : null}>
      {(!open || !alone) && (
        <div className="goal-chat-head">
          <button
            type="button"
            className="goal-chip-toggle"
            title={alone ? 'Show the goal' : 'Close the other chats to see the goal'}
            disabled={!alone}
            onClick={() => setGoalPaneOpen(true)}
          >
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

/** One pane of the chat card: a whole chat, or the new-chat screen. */
function ChatPane() {
  const pane = usePane()
  const chatId = usePaneChatId()
  const paneKey = useApp(state => paneAt(state, pane).key)
  const draftKey = chatId ?? `new:${paneKey}`
  const [dropping, setDropping] = useState(false)
  const chat = useApp((state) => state.chats.find((entry) => entry.id === chatId) ?? null)
  const hasTurns = usePaneView((view) => view.turns.length > 0)
  const goal = useApp((state) => state.goals.find((entry) => entry.chatId === chatId) ?? null)
  // The turn whose plan is open beside the chat, with the message that started it for the title.
  const planTurn = usePaneView((view) => view.turns.find((turn) => turn.id === view.planTurnId) ?? null)
  const planUserId = usePaneView((view) => (view.planTurnId ? view.turnItems[view.planTurnId]?.[0] : undefined))
  const focused = useApp((state) => state.focused === pane)
  const empty = !goal && (!chat || !hasTurns)
  const focus = (): void => { void act('pane.focus', { pane }) }

  let body: React.ReactNode
  if (goal) {
    body = <GoalChat goal={goal} />
  } else if (empty) {
    body = (
      <div className="welcome">
        <h1 className="welcome-title">{greeting()}</h1>
        <Composer key={chatId ?? 'new'} placeholder="How can I help you today?" />
        <p className="welcome-hint">Pick a provider and model for each message. They all share the conversation.</p>
      </div>
    )
  } else {
    const composer = (
      <div className="composer-dock">
        <Composer key={chatId ?? 'new'} placeholder="Reply…" />
      </div>
    )
    body = planTurn
      ? (
        <Split side={<PlanDrawer turn={planTurn} userItemId={planUserId} />}>
          <Transcript />
          {composer}
        </Split>
      )
      : (
        <>
          <Transcript />
          {composer}
        </>
      )
  }
  return (
    <section data-pane-index={usePane()} className={`pane${empty ? ' is-empty' : ''}${focused ? ' is-focused' : ''}`} aria-label={chat?.title ?? 'New chat'} onPointerDownCapture={focus} onFocusCapture={focus}
      onDragOver={event => {
        if (event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes(ATTACHMENT_DRAG_TYPE)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDropping(true)
        }
      }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false) }}
      onDrop={event => {
        if (!event.dataTransfer.types.includes('Files') && !event.dataTransfer.types.includes(ATTACHMENT_DRAG_TYPE)) return
        event.preventDefault()
        setDropping(false)
        if (goal && goal.status !== 'done' && goal.status !== 'stopped') return
        focus()
        const existing = event.dataTransfer.getData(ATTACHMENT_DRAG_TYPE)
        if (existing) {
          try { addExistingAttachment(draftKey, JSON.parse(existing)) } catch { updateDraft(draftKey, { error: 'This attachment could not be added. Choose the file again.' }) }
        } else addDraftFiles(draftKey, Array.from(event.dataTransfer.files))
      }}>
      {body}
      {dropping && <div className="image-drop-target"><Images size={30} /><strong>{goal && goal.status !== 'done' && goal.status !== 'stopped' ? 'Use a regular chat for attachments' : 'Add files to this chat'}</strong><span>{chat?.title ?? 'New chat'}</span><small>Release to attach · send when you’re ready</small></div>}
    </section>
  )
}

/**
 * The chat card: one to four panes. Two stand side by side; three are two above one across the
 * bottom; four are quadrants. Each pane keeps its key, so adding or closing one leaves the others
 * as they were.
 */
function ChatCard() {
  const panes = useApp((state) => state.panes)
  return (
    <main className={`chat panes-${panes.length}`}>
      {panes.map((pane, index) => (
        <PaneContext.Provider key={pane.key} value={index}>
          <ChatPane />
        </PaneContext.Provider>
      ))}
    </main>
  )
}

export function App() {
  useEffect(() => {
    // Files dropped outside a chat must not navigate the Electron shell away from the app.
    const preventNavigation = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files') || event.dataTransfer?.types.includes(ATTACHMENT_DRAG_TYPE)) event.preventDefault()
    }
    window.addEventListener('dragover', preventNavigation)
    window.addEventListener('drop', preventNavigation)
    return () => {
      window.removeEventListener('dragover', preventNavigation)
      window.removeEventListener('drop', preventNavigation)
    }
  }, [])
  const artifact = useApp((state) => state.artifact)
  const browserOpen = useApp((state) => state.browserOpen)
  const evalsOpen = useApp((state) => state.evalsOpen)
  const railOpen = useApp((state) => state.railOpen)
  const error = useApp((state) => state.error)
  const newGoal = useApp((state) => state.newGoal !== null)
  // The side of the only pane, when it has one: the card then takes the larger share beside the browser.
  const split = useApp((state) => {
    if (state.panes.length !== 1) return false
    const chatId = focusedChatId(state)
    return state.goals.some((goal) => goal.chatId === chatId) ? state.goalPaneOpen : (chatId !== null && state.views[chatId]?.planTurnId != null)
  })
  return (
    <div className={`app${evalsOpen ? ' has-evals' : ''}${browserOpen || artifact ? ' has-browser' : ''}${split ? ' has-goal' : ''}${railOpen ? '' : ' rail-folded'}`}>
      <Rail />
      <ChatCard />
      {artifact ? <ArtifactPanel /> : evalsOpen ? <EvalPanel /> : browserOpen && <BrowserPanel />}
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
