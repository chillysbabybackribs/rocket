import { PanelRightClose } from 'lucide-react'
import { planItemId, type PlanStep, type Turn } from '../../../shared/types.ts'
import { closePlan, peekItem, useItem } from '../store.ts'

// The plan a model keeps while it works, beside the chat in the goal pane's clothes: the task and
// the plan's lines, nothing else. Done lines dim with a tick, the one under way carries the accent,
// the rest wait hollow. Only the arrow in the corner is chrome; the head line of the turn in the
// chat ("Planning · 2 of 5") is what opens and closes it.

/** The lines of a plan, in the goal pane's list style, with the count of done lines above. */
export function PlanLines({ steps }: { steps: PlanStep[] }) {
  const done = steps.filter((step) => step.status === 'done').length
  return (
    <>
      <h3 className="gp-section-title"><span className="gp-count is-lead">{done} of {steps.length}</span></h3>
      <ul className="gp-lines plan-lines">
        {steps.map((step, index) => (
          <li key={index} className={`gp-line${step.status === 'done' ? ' is-done' : step.status === 'doing' ? ' is-now' : ''}`}>
            <span className="plan-box" aria-hidden />
            <span className="gp-line-text">{step.text}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

/** The user's message that started the turn, as the drawer's title: its first line, kept short. */
function taskOf(turn: Turn, userItemId: string | undefined): string {
  const item = userItemId ? peekItem(userItemId) : undefined
  const text = item?.type === 'user' ? item.text : ''
  const line = text.split('\n').map((part) => part.trim()).find(Boolean) ?? ''
  if (line) return line.length > 140 ? `${line.slice(0, 139)}…` : line
  return turn.goalRole ? 'This round' : 'This turn'
}

export function PlanDrawer({ turn, userItemId }: { turn: Turn; userItemId: string | undefined }) {
  const plan = useItem(planItemId(turn.id))
  if (plan?.type !== 'plan') return null
  return (
    <aside className="goal-pane plan-drawer" aria-label="Plan">
      <div className="gp-bar is-bare">
        <span className="gp-crumbs" />
        <button type="button" className="gp-icon" title="Hide the plan" aria-label="Hide the plan" onClick={closePlan}>
          <PanelRightClose size={15} />
        </button>
      </div>
      <div className="gp-scroll">
        <header className="gp-head">
          <h2 className="gp-title">{taskOf(turn, userItemId)}</h2>
        </header>
        <PlanLines steps={plan.steps} />
      </div>
    </aside>
  )
}
