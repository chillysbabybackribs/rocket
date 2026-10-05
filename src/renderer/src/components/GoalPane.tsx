import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Pause, Play, Square, Target, X } from 'lucide-react'
import type { Goal, GoalRound } from '../../../shared/types.ts'
import { agentLabel, pauseGoal, resumeGoal, setGoalPaneOpen, steerGoal, stopGoal } from '../store.ts'
import { GoalBrief } from './GoalBrief.tsx'
import { goalStatusText, goalTone } from './Goals.tsx'

// A goal, beside its chat like an artifact: what it is, the lines that define done and where
// each stands, the rounds of work and checks with the checker's evidence, and when Rocket will
// stop to ask. The chat on the left is the conversation itself; this is its summary.

function elapsed(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

function useNow(live: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [live])
  return now
}

function Round({ goal, round, open, onToggle }: { goal: Goal; round: GoalRound; open: boolean; onToggle: () => void }) {
  const last = goal.rounds.at(-1) === round
  const working = last && goal.status === 'working'
  const checking = last && goal.status === 'checking'
  const met = round.verdicts.filter((verdict) => verdict.met).length
  const checked = round.findings !== null
  const tone = working || checking ? 'run' : !checked ? 'idle' : met === goal.criteria.length ? 'ok' : 'fail'
  const worker = agentLabel(goal.worker)
  const checker = agentLabel(goal.checker)
  return (
    <div className={`goal-round${open ? ' is-open' : ''}`}>
      <span className={`goal-dot is-${tone}`} aria-hidden />
      <button type="button" className="goal-round-top" aria-expanded={open} onClick={onToggle}>
        <span className="goal-round-n">Round {round.n}</span>
        <span className={`goal-round-title${working || checking ? ' shimmer' : ''}`}>
          {working ? `${worker} is working…` : checking ? `${checker} is checking…` : round.summary ? firstSentence(round.summary) : 'Stopped before it finished'}
        </span>
        {checked && <span className={`goal-verdict is-${met === goal.criteria.length ? 'ok' : 'part'}`}>{met} of {goal.criteria.length}</span>}
      </button>
      {checked && round.findings && <p className="goal-round-line"><b>{checker}</b>{firstSentence(round.findings)}</p>}
      {open && (
        <div className="goal-round-details">
          {round.summary && <p className="goal-round-said"><b>{worker}</b> {round.summary}</p>}
          {round.verdicts.length > 0 && (
            <div className="goal-evidence">
              {round.verdicts.map((verdict) => (
                <div className="goal-evidence-row" key={verdict.line}>
                  <span className={`goal-dot is-${verdict.met ? 'ok' : 'fail'}`} aria-hidden />
                  <span><b>{goal.criteria[verdict.line - 1]?.text ?? `Line ${verdict.line}`}</b>{verdict.evidence && <span className="goal-evidence-text">{verdict.evidence}</span>}</span>
                </div>
              ))}
            </div>
          )}
          {round.findings && <p className="goal-round-said"><b>{checker} found</b> {round.findings}</p>}
          {round.files.length > 0 && (
            <div className="goal-files">
              {round.files.map((file) => <span key={file} className="goal-file">{file}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const end = flat.search(/[.!?](\s|$)/)
  const sentence = end === -1 ? flat : flat.slice(0, end + 1)
  return sentence.length > 140 ? `${sentence.slice(0, 139)}…` : sentence
}

export function GoalPane({ goal }: { goal: Goal }) {
  const live = goal.status === 'working' || goal.status === 'checking' || goal.status === 'drafting'
  const now = useNow(live)
  const [openRound, setOpenRound] = useState<number | null>(null)
  const ended = goal.status === 'done' || goal.status === 'stopped'
  const started = goal.rounds[0]?.startedAt ?? null
  const finished = ended ? goal.rounds.at(-1)?.endedAt ?? goal.updatedAt : now
  const pausing = live && goal.reason !== null
  const worker = agentLabel(goal.worker)
  const checker = agentLabel(goal.checker)

  return (
    <aside className="goal-pane" aria-label="Goal">
      <div className="goal-pane-top">
        <span className="goal-pane-label"><Target size={13} aria-hidden /> Goal</span>
        <span className="goal-pane-space" />
        {!ended && goal.status !== 'confirming' && (
          goal.status === 'paused' || goal.status === 'needs_you' || pausing
            ? <button type="button" className="goal-button" onClick={() => resumeGoal(goal.id)}><Play size={12} /> {pausing ? 'Keep going' : 'Resume'}</button>
            : <button type="button" className="goal-button" onClick={() => pauseGoal(goal.id)}><Pause size={12} /> Pause</button>
        )}
        {!ended && (
          <button type="button" className="goal-button is-danger" onClick={() => { if (window.confirm('Stop this goal? The work so far is kept.')) stopGoal(goal.id) }}>
            <Square size={10} fill="currentColor" /> Stop
          </button>
        )}
        <button type="button" className="icon-button" aria-label="Hide the goal (it keeps running)" title="Hide (the goal keeps running)" onClick={() => setGoalPaneOpen(false)}>
          <X size={14} />
        </button>
      </div>

      <div className="goal-pane-scroll">
        <header className="goal-head">
          <div className="goal-head-meta">
            <span className={`goal-pill is-${goalTone(goal.status)}`}><span className={`goal-dot is-${goalTone(goal.status)}`} aria-hidden />{goalStatusText(goal)}</span>
            {started && <span>{elapsed(finished - started)}</span>}
          </div>
          <h2 className="goal-title">{goal.title}</h2>
          {goal.goal && goal.status !== 'confirming' && <p className="goal-text">{goal.goal}</p>}
          <p className="goal-said">You wrote: “{goal.request}”</p>
          {goal.status !== 'drafting' && goal.status !== 'confirming' && (
            <div className="goal-agents">
              <span className="goal-pill"><b>{worker}</b> works</span>
              <span className="goal-pill"><b>{checker}</b> checks</span>
            </div>
          )}
        </header>

        {goal.reason && (goal.status === 'needs_you' || goal.status === 'paused' || pausing) && (
          <div className={`goal-banner${goal.status === 'needs_you' ? ' is-ask' : ''}`} role="status">{goal.reason}</div>
        )}

        {goal.status === 'drafting' && (
          <p className="goal-drafting"><span className="shimmer">{worker} is reading the folder and drafting the goal…</span></p>
        )}

        {goal.status === 'confirming' && <div className="goal-section"><GoalBrief goal={goal} /></div>}

        {goal.criteria.length > 0 && goal.status !== 'confirming' && (
          <section className="goal-section">
            <h3 className="goal-section-title">Done when <span>{goal.criteria.filter((line) => line.met).length} of {goal.criteria.length} met · {checker} checks each line</span></h3>
            {goal.criteria.map((line, index) => (
              <div className="goal-line" key={index}>
                <span className={`goal-check${line.met === true ? ' is-ok' : line.met === false ? ' is-fail' : ''}`} aria-label={line.met === true ? 'Met' : line.met === false ? 'Not met' : 'Not checked yet'}>
                  {line.met === true ? <Check size={10} strokeWidth={3} /> : line.met === false ? <X size={10} strokeWidth={3} /> : null}
                </span>
                <span className="goal-line-text">{line.text}</span>
                <span className="goal-line-by">{line.met === true ? `round ${line.metInRound}` : line.met === false ? 'being fixed' : line.how}</span>
              </div>
            ))}
          </section>
        )}

        {goal.rounds.length > 0 && (
          <section className="goal-section">
            <h3 className="goal-section-title">Rounds <span>{worker} works until it is done, then {checker} checks</span></h3>
            <div className="goal-rounds">
              {goal.rounds.map((round) => (
                <Round key={round.workTurnId} goal={goal} round={round} open={openRound === round.n} onToggle={() => setOpenRound(openRound === round.n ? null : round.n)} />
              ))}
            </div>
          </section>
        )}

        {goal.status !== 'drafting' && goal.status !== 'confirming' && !ended && (
          <section className="goal-section">
            <h3 className="goal-section-title">Left to the models</h3>
            <div className="goal-guard">
              Rocket pauses and asks you if the same gap comes back without progress, a decision only you can make comes up,
              or a usage window reaches {goal.pauseAtPercent}%.
            </div>
          </section>
        )}
      </div>
    </aside>
  )
}

/** The goal chat's composer: a note for the worker's next round, not a message of its own. */
export function GoalNote({ goal }: { goal: Goal }) {
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = input.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`
  }, [text])
  const asking = goal.status === 'needs_you'
  const worker = agentLabel(goal.worker)
  const submit = async (): Promise<void> => {
    if (!text.trim()) return
    if (await steerGoal(goal.id, text)) setText('')
  }
  return (
    <div className="composer-group">
      <div className="composer">
        <textarea
          ref={input}
          className="composer-input"
          rows={1}
          value={text}
          aria-label="Note for the goal"
          placeholder={asking ? `Answer ${worker}…` : `Add a note for ${worker}. It reads it at the start of the next round…`}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <div className="composer-bar">
          <span className="goal-note-hint">{asking ? 'Your answer carries the goal on.' : goal.steer.length ? `${goal.steer.length} note${goal.steer.length === 1 ? '' : 's'} waiting for the next round` : 'Enter to add'}</span>
          <div className="composer-right">
            <button type="button" className="send" aria-label="Add note" title="Add note" disabled={!text.trim()} onClick={() => void submit()}>
              <ArrowUp size={17} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
