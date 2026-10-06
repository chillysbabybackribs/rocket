import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, ChevronRight, Info, Pause, Play, PanelRightClose, Square } from 'lucide-react'
import { planItemId, type Goal, type GoalAgent, type GoalRound } from '../../../shared/types.ts'
import { agentLabel, pauseGoal, resumeGoal, setGoalPaneOpen, steerGoal, stopGoal, useApp, useItem } from '../store.ts'
import { GoalBrief } from './GoalBrief.tsx'
import { GoalDesignView } from './GoalDesign.tsx'
import { GoalStatusIcon, LineIcon, ProgressRing } from './GoalIcons.tsx'
import { PlanLines } from './PlanDrawer.tsx'
import { goalStatusText } from './Goals.tsx'
import { ProviderGlyph } from './glyphs.tsx'
import { Tabs } from './Tabs.tsx'

// A goal, beside its chat like an artifact, laid out the way Linear lays out an issue: the title
// and what it means, a block of properties, the checklist as sub-items with a progress ring, and
// the rounds as an activity feed. The chat on the left is the conversation; this is its summary.

const STATUS_LABEL: Record<Goal['status'], string> = {
  drafting: 'Drafting',
  confirming: 'Check the plan',
  working: 'Working',
  checking: 'Checking',
  needs_you: 'Needs you',
  paused: 'Paused',
  done: 'Done',
  stopped: 'Stopped'
}

function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

function ago(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function shortPath(path: string): string {
  const home = window.rocket.homeDir
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const end = flat.search(/[.!?](\s|$)/)
  const sentence = end === -1 ? flat : flat.slice(0, end + 1)
  return sentence.length > 160 ? `${sentence.slice(0, 159)}…` : sentence
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

function Agent({ agent }: { agent: GoalAgent }) {
  return (
    <span className="gp-agent">
      <span className="gp-avatar"><ProviderGlyph provider={agent.provider} size={11} /></span>
      {agentLabel(agent)}
      {agent.model && <span className="gp-faint">{agent.model}</span>}
    </span>
  )
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="gp-prop">
      <span className="gp-prop-label">{label}</span>
      <span className="gp-prop-value">{children}</span>
    </div>
  )
}

/** A round as two events in the feed: the worker's turn, then the checker's verdict. */
function RoundEvents({ goal, round, now }: { goal: Goal; round: GoalRound; now: number }) {
  const [open, setOpen] = useState(false)
  const last = goal.rounds.at(-1) === round
  const working = last && goal.status === 'working'
  const checking = last && goal.status === 'checking'
  const checked = round.findings !== null
  const met = round.verdicts.filter((verdict) => verdict.met).length
  const all = met === goal.criteria.length
  return (
    <>
      <li className="gp-event">
        <span className="gp-avatar"><ProviderGlyph provider={goal.worker.provider} size={11} /></span>
        <div className="gp-event-body">
          <div className="gp-event-line">
            <b>{agentLabel(goal.worker)}</b>
            <span className={working ? 'shimmer' : ''}>{working ? `is working on round ${round.n}` : `worked on round ${round.n}`}</span>
            <span className="gp-event-time">{ago(round.startedAt, now)}</span>
          </div>
          {round.summary && !working && <p className="gp-event-text">{round.summary}</p>}
          {round.files.length > 0 && (
            <div className="gp-files">
              {round.files.map((file) => <span key={file} className="gp-file">{file}</span>)}
            </div>
          )}
        </div>
      </li>
      {(checked || checking) && (
        <li className="gp-event">
          <span className="gp-avatar"><ProviderGlyph provider={goal.checker.provider} size={11} /></span>
          <div className="gp-event-body">
            <div className="gp-event-line">
              <b>{agentLabel(goal.checker)}</b>
              {checking
                ? <span className="shimmer">is checking every line</span>
                : <span>checked: <span className={all ? 'gp-met' : 'gp-unmet'}>{met} of {goal.criteria.length} met</span></span>}
              {round.endedAt && checked && <span className="gp-event-time">{ago(round.endedAt, now)}</span>}
            </div>
            {checked && round.findings && <p className="gp-event-text">{firstSentence(round.findings)}</p>}
            {checked && round.verdicts.length > 0 && (
              <button type="button" className="gp-disclose" aria-expanded={open} onClick={() => setOpen(!open)}>
                <ChevronRight size={12} className={`tool-chevron${open ? ' is-open' : ''}`} /> Evidence
              </button>
            )}
            {open && (
              <ul className="gp-evidence">
                {round.verdicts.map((verdict) => (
                  <li key={verdict.line}>
                    <LineIcon met={verdict.met} />
                    <span>
                      <span className="gp-evidence-line">{goal.criteria[verdict.line - 1]?.text ?? `Line ${verdict.line}`}</span>
                      {verdict.evidence && <span className="gp-evidence-text">{verdict.evidence}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      )}
    </>
  )
}

/**
 * The plan the worker keeps in the round under way, in the same list style as the checklist. A
 * goal's chat has no plan drawer of its own; this is where its plan shows. Once the round has
 * ended the section stays until the next work turn begins.
 */
function RoundPlan({ goal }: { goal: Goal }) {
  const workTurnId = useApp((state) => state.turns.findLast((turn) => turn.goalRole === 'work')?.id ?? null)
  const plan = useItem(workTurnId ? planItemId(workTurnId) : '')
  if (plan?.type !== 'plan' || goal.status === 'done' || goal.status === 'stopped') return null
  return (
    <section className="gp-section gp-round-plan">
      <PlanLines steps={plan.steps} title="This round's plan" />
    </section>
  )
}

export function GoalPane({ goal }: { goal: Goal }) {
  const live = goal.status === 'working' || goal.status === 'checking' || goal.status === 'drafting'
  const now = useNow(true)
  const ended = goal.status === 'done' || goal.status === 'stopped'
  const started = goal.rounds[0]?.startedAt ?? null
  const finished = ended ? goal.rounds.at(-1)?.endedAt ?? goal.updatedAt : now
  const pausing = live && goal.reason !== null
  const waiting = goal.status === 'paused' || goal.status === 'needs_you' || pausing
  const met = goal.criteria.filter((line) => line.met).length
  const planned = goal.status !== 'drafting' && goal.status !== 'confirming'

  return (
    <aside className="goal-pane" aria-label="Goal">
      <div className="gp-bar">
        <GoalStatusIcon status={goal.status} />
        <span className="gp-crumbs">
          <span>Goal</span>
          <ChevronRight size={12} aria-hidden />
          <span className="gp-crumb-current">{goal.status === 'confirming' ? 'Plan' : goal.status === 'drafting' ? 'Drafting' : goal.rounds.length ? `Round ${goal.rounds.at(-1)!.n}` : STATUS_LABEL[goal.status]}</span>
        </span>
        {!ended && goal.status !== 'confirming' && goal.status !== 'drafting' && (
          waiting
            ? <button type="button" className="gp-button is-primary" onClick={() => resumeGoal(goal.id)}><Play size={11} fill="currentColor" /> {pausing ? 'Keep going' : 'Resume'}</button>
            : <button type="button" className="gp-icon" title="Pause after this turn" aria-label="Pause after this turn" onClick={() => pauseGoal(goal.id)}><Pause size={14} /></button>
        )}
        {!ended && (
          <button type="button" className="gp-icon is-danger" title="Stop the goal" aria-label="Stop the goal" onClick={() => { if (window.confirm('Stop this goal? The work so far is kept.')) stopGoal(goal.id) }}>
            <Square size={11} />
          </button>
        )}
        <button type="button" className="gp-icon" title="Hide (the goal keeps running)" aria-label="Hide the goal" onClick={() => setGoalPaneOpen(false)}>
          <PanelRightClose size={15} />
        </button>
      </div>

      <div className="gp-scroll">
        <header className="gp-head">
          <h2 className="gp-title">{goal.title}</h2>
          {goal.goal && goal.status !== 'confirming' && <p className="gp-description">{goal.goal}</p>}
          <p className="gp-request">“{goal.request}”</p>
        </header>

        {goal.reason && waiting && (
          <div className={`gp-callout${goal.status === 'needs_you' ? ' is-ask' : ''}`} role="status">
            <GoalStatusIcon status={goal.status === 'needs_you' ? 'needs_you' : 'paused'} />
            <span>{goal.reason}</span>
          </div>
        )}

        <div className="gp-props">
          <Property label="Status"><GoalStatusIcon status={goal.status} /> {STATUS_LABEL[goal.status]}{goal.rounds.length > 0 && <span className="gp-faint">· round {goal.rounds.at(-1)!.n}</span>}</Property>
          <Property label="Works"><Agent agent={goal.worker} /></Property>
          <Property label="Checks"><Agent agent={goal.checker} /></Property>
          {goal.criteria.length > 0 && planned && (
            <Property label="Progress"><ProgressRing done={met} total={goal.criteria.length} /> {met} of {goal.criteria.length} lines met</Property>
          )}
          {started && <Property label="Time">{duration(finished - started)}</Property>}
          <Property label="Folder"><span className="gp-mono" title={goal.cwd}>{shortPath(goal.cwd)}</span></Property>
        </div>

        {goal.status === 'drafting' && (
          <p className="gp-drafting"><span className="shimmer">{agentLabel(goal.worker)} is reading the folder and drafting the plan…</span></p>
        )}

        {goal.status === 'confirming' && (
          <section className="gp-section">
            <GoalBrief key={goal.id} goal={goal} />
          </section>
        )}

        {goal.design && planned && (
          <section className="gp-section">
            <h3 className="gp-section-title">Design</h3>
            <GoalDesignView goal={goal} />
          </section>
        )}

        {goal.criteria.length > 0 && planned && (
          <section className="gp-section">
            <h3 className="gp-section-title">
              Done when
              <span className="gp-count"><ProgressRing done={met} total={goal.criteria.length} size={12} /> {met}/{goal.criteria.length}</span>
            </h3>
            <ul className="gp-lines">
              {goal.criteria.map((line, index) => (
                <li key={index} className="gp-line">
                  <LineIcon met={line.met} />
                  <span className="gp-line-text">{line.text}</span>
                  <span className="gp-line-meta">{line.met === true && line.metInRound ? `R${line.metInRound}` : line.how}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <RoundPlan goal={goal} />

        {goal.rounds.length > 0 && (
          <section className="gp-section">
            <h3 className="gp-section-title">Activity</h3>
            <ol className="gp-feed">
              {goal.rounds.map((round) => <RoundEvents key={round.workTurnId} goal={goal} round={round} now={now} />)}
              {goal.status === 'done' && (
                <li className="gp-event">
                  <span className="gp-avatar is-done"><GoalStatusIcon status="done" size={12} /></span>
                  <div className="gp-event-body"><div className="gp-event-line"><b>Goal done</b><span>every line met</span></div></div>
                </li>
              )}
            </ol>
          </section>
        )}

        {planned && !ended && (
          <p className="gp-footnote">
            <Info size={12} aria-hidden />
            No step or time limits. Rocket pauses only if the same gap comes back, a decision needs you, or usage reaches {goal.pauseAtPercent}%.
          </p>
        )}
      </div>
    </aside>
  )
}

/** The goal chat's composer: the open chats' tabs, then a note for the worker's next round. */
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
      <Tabs />
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
          <span className="goal-note-hint">
            {asking ? 'Your answer carries the goal on.' : goal.steer.length ? `${goal.steer.length} note${goal.steer.length === 1 ? '' : 's'} waiting for the next round` : `Goal · ${goalStatusText(goal)}`}
          </span>
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
