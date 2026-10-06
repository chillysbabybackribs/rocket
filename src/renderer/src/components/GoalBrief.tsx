import { useState } from 'react'
import { X } from 'lucide-react'
import { PROVIDERS, providerLabel, type Goal, type GoalAgent, type ProviderId } from '../../../shared/types.ts'
import { startGoal } from '../store.ts'
import { GoalDesignView } from './GoalDesign.tsx'
import { LineIcon } from './GoalIcons.tsx'

// The brief the worker drafted, for the user to look over before anything starts: the goal in a
// sentence or two, the lines that define done, and at most one question. Everything is editable;
// how it runs is summed up in a line, with the choices under Advanced.

const PAUSE_LEVELS = [80, 90, 95, 100]

export function GoalBrief({ goal, onBack }: { goal: Goal; onBack?: () => void }) {
  const [text, setText] = useState(goal.goal)
  const [concept, setConcept] = useState(goal.design?.concept ?? '')
  const [lines, setLines] = useState(goal.criteria.map(({ text, how }) => ({ text, how })))
  const [answer, setAnswer] = useState<string | null>(goal.question?.answer ?? null)
  const [worker, setWorker] = useState<GoalAgent>(goal.worker)
  const [checker, setChecker] = useState<GoalAgent>(goal.checker)
  const [pauseAt, setPauseAt] = useState(goal.pauseAtPercent)
  const [starting, setStarting] = useState(false)
  const filled = lines.filter((line) => line.text.trim())
  const workerName = providerLabel(worker.provider)
  const checkerName = providerLabel(checker.provider)

  const setLine = (index: number, text: string): void => setLines(lines.map((line, at) => (at === index ? { ...line, text } : line)))
  const start = async (): Promise<void> => {
    setStarting(true)
    await startGoal(goal.id, { goal: text, criteria: filled, ...(goal.design ? { concept } : {}), answer, worker, checker, pauseAtPercent: pauseAt })
    setStarting(false)
  }

  return (
    <div className="goal-brief">
      <section className="brief-section">
        <h3 className="brief-label">Goal</h3>
        <textarea className="brief-edit" rows={3} value={text} aria-label="Goal" onChange={(event) => setText(event.target.value)} />
      </section>

      {goal.design && (
        <section className="brief-section">
          <h3 className="brief-label">Design <span>the idea, and the references it was built from</span></h3>
          <GoalDesignView goal={goal} concept={concept} onConcept={setConcept} />
        </section>
      )}

      <section className="brief-section">
        <h3 className="brief-label">Done when <span>edit any line</span></h3>
        <div className="brief-lines">
          {lines.map((line, index) => (
            <div className="brief-line" key={index}>
              <LineIcon met={null} />
              <textarea
                className="brief-line-text"
                rows={1}
                value={line.text}
                aria-label={`Done when, line ${index + 1}`}
                onChange={(event) => setLine(index, event.target.value)}
              />
              {line.how && <span className="brief-how">{line.how}</span>}
              <button type="button" className="brief-remove" aria-label={`Remove line ${index + 1}`} onClick={() => setLines(lines.filter((_, at) => at !== index))}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="brief-add" onClick={() => setLines([...lines, { text: '', how: '' }])}>+ Add a line</button>
      </section>

      {goal.question && (
        <section className="brief-section">
          <h3 className="brief-label">One question first</h3>
          <div className="brief-question">
            <p>{goal.question.text}</p>
            <div className="goal-chips">
              {[...goal.question.options, `Let ${workerName} decide`].map((option, index) => {
                const value = index === goal.question!.options.length ? null : option
                return (
                  <button key={option} type="button" className={`goal-chip${answer === value ? ' is-picked' : ''}`} aria-pressed={answer === value} onClick={() => setAnswer(value)}>
                    {option}
                  </button>
                )
              })}
            </div>
          </div>
        </section>
      )}

      <section className="brief-section">
        <h3 className="brief-label">How it will run</h3>
        <p className="brief-run">
          <b>{workerName}</b> works and <b>{checkerName}</b> checks{checker.provider === worker.provider ? ' (no other provider is signed in, so it checks its own work)' : ''}.
          No step or time limits: the models decide when it is done. It pauses for you if it gets stuck,
          needs a decision, or a usage window reaches {pauseAt}%.
        </p>
        <details className="brief-advanced">
          <summary>Advanced</summary>
          <div className="brief-grid">
            <label>Works<ProviderSelect value={worker.provider} onChange={(provider) => setWorker({ provider, model: provider === goal.worker.provider ? goal.worker.model : null })} /></label>
            <label>Checks<ProviderSelect value={checker.provider} onChange={(provider) => setChecker({ provider, model: null })} /></label>
            <label>Pause at usage
              <select value={pauseAt} onChange={(event) => setPauseAt(Number(event.target.value))}>
                {PAUSE_LEVELS.map((level) => <option key={level} value={level}>{level === 100 ? 'Only at the limit' : `${level}%`}</option>)}
              </select>
            </label>
          </div>
        </details>
      </section>

      <div className="brief-foot">
        <span className="brief-note">Each round's changes are kept, so nothing is lost if you stop it.</span>
        {onBack && <button type="button" className="goal-button" onClick={onBack}>Close</button>}
        <button type="button" className="goal-button is-primary" disabled={starting || !text.trim() || !filled.length} onClick={() => void start()}>
          Start
        </button>
      </div>
    </div>
  )
}

function ProviderSelect({ value, onChange }: { value: ProviderId; onChange: (provider: ProviderId) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as ProviderId)}>
      {PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
    </select>
  )
}
