import { Plus } from 'lucide-react'
import type { Goal, GoalStatus } from '../../../shared/types.ts'
import { act } from '../app-map.ts'
import { focusedChatId, openNewGoal, useApp } from '../store.ts'
import { GoalStatusIcon } from './GoalIcons.tsx'

// The Goals menu, opened from the toolbar's Goals section: the ones under way first, then the
// finished ones, and "New goal". The toolbar keeps it inside the chat card, clear of the browser.

export const UNDER_WAY: GoalStatus[] = ['drafting', 'confirming', 'working', 'checking', 'needs_you', 'paused']

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

export function GoalsMenu({ onPick }: { onPick: () => void }) {
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
                  void act('chat.open', { chatId: goal.chatId })
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
