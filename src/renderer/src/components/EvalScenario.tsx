import { useEffect, useState } from 'react'
import { Check, ChevronRight, Folder, Play, Square, X } from 'lucide-react'
import { providerLabel, type EvalRun, type EvalRunCell, type EvalScenarioInfo } from '../../../shared/types.ts'
import { act, go } from '../app-map.ts'
import { cellOf, duration, median, runsOf, shownRun, tally, when } from '../eval-run.ts'
import { patchEvals, useApp } from '../store.ts'

// One scenario: its message, editable for the next run; its graders; the provider × trial grid of
// the run shown, filling in live; and the runs before it. A cell opens that run's detail.

export function EvalScenario() {
  const scenarioId = useApp((state) => state.evals.scenarioId)
  const scenario = useApp((state) => state.evals.scenarios.find((entry) => entry.id === scenarioId) ?? null)
  const runs = useApp((state) => state.evals.runs)
  const drafts = useApp((state) => state.evals.drafts)
  const run = useApp(shownRun)
  if (!scenario) return <p className="ev-muted">That scenario is no longer in docs/evals/scenarios. Go back to the list to pick another.</p>

  const history = runsOf(runs, scenario.id)
  const going = history.find((entry) => entry.status === 'running') ?? null
  const draft = drafts[scenario.id] ?? scenario.message
  const edited = draft !== scenario.message
  const previous = run ? history[history.indexOf(run) + 1] ?? null : null
  const turns = scenario.matrix.length * Math.max(1, scenario.trials)
  const setDraft = (text: string | null): void => {
    const next = { ...drafts }
    if (text === null || text === scenario.message) delete next[scenario.id]
    else next[scenario.id] = text
    patchEvals({ drafts: next })
  }

  return (
    <>
      <nav className="ev-crumb" aria-label="Breadcrumb">
        <button type="button" onClick={() => void go('evals.scenarios')}>Scenarios</button>
        <ChevronRight size={12} aria-hidden />
        <b>{scenario.id}</b>
      </nav>
      <div className="ev-title-row">
        <h1 className="ev-title">{scenario.id}</h1>
        <span className="ev-spacer" />
        <span className="ev-faint ev-small">{turns} {turns === 1 ? 'turn' : 'turns'} · spends subscription usage</span>
        {going && <button type="button" className="ev-btn" onClick={() => void act('evals.run.stop')}><Square size={11} aria-hidden />Stop</button>}
        <button type="button" className="ev-btn is-primary" disabled={Boolean(going) || !draft.trim()} onClick={() => void act('evals.run.start')}>
          <Play size={12} aria-hidden fill="currentColor" />{going ? 'Running…' : 'Run all'}
        </button>
      </div>
      <div className="ev-meta">
        <span><Folder size={13} aria-hidden />Fresh copy of <span className="ev-mono">{shortPath(scenario.cwd)}</span> per run</span>
        <span>{scenario.trials} {scenario.trials === 1 ? 'trial' : 'trials'}</span>
        <span>{scenario.runsAlone ? 'One cell at a time (uses the app window)' : 'Providers side by side'}</span>
        {scenario.openGoal && <span>Starts as a goal draft</span>}
      </div>

      <h2 className="ev-h2">Message</h2>
      <div className="ev-message">
        <textarea aria-label="Scenario message" value={draft} disabled={Boolean(going)} onChange={(event) => setDraft(event.target.value)} />
        <div className="ev-message-foot">
          {edited ? <span className="ev-edited">Edited: the next run uses this; the scenario file is unchanged</span> : <span className="ev-faint">From {scenario.file}</span>}
          <span className="ev-spacer" />
          {edited && <button type="button" className="ev-link" onClick={() => setDraft(null)}>Revert</button>}
        </div>
      </div>

      <h2 className="ev-h2">Graders</h2>
      <div className="ev-graders">
        {scenario.graders.map((grader) => <span key={grader} className="ev-grader">{grader}</span>)}
      </div>

      <h2 className="ev-h2">
        {run ? <>{run === history[0] ? 'Latest run' : 'Run'} <span className="ev-faint ev-normal">· {when(run.startedAt)} · {runStatus(run)}{run.edited ? ' · edited message' : ''}</span></> : 'Not run yet'}
      </h2>
      <Grid scenario={scenario} run={run} previous={previous} />
      {run?.edited && <p className="ev-faint ev-small ev-used">Message used: {run.message}</p>}

      {history.length > 1 && (
        <>
          <h2 className="ev-h2">All runs</h2>
          <div className="ev-runs">
            {history.map((entry) => (
              <button key={entry.id} type="button" className={`ev-run-row${entry === run ? ' is-shown' : ''}`} onClick={() => void go('evals.scenario', { id: scenario.id, run: entry.id })}>
                <span>{when(entry.startedAt)} {entry.status !== 'done' && <span className="ev-tag">{entry.status}</span>}</span>
                <span className="ev-bars">
                  {tally(entry).map((row) => (
                    <span key={row.provider} className="ev-bar" title={`${providerLabel(row.provider)}: ${row.passed} of ${row.total} passed`}>
                      {providerLabel(row.provider).slice(0, 2)}<span><b style={{ width: `${(row.passed / row.total) * 100}%` }} /></span>
                    </span>
                  ))}
                </span>
                <span className="ev-mono">{entry.cells.filter((cell) => cell.pass).length}/{entry.cells.length}</span>
                <span className="ev-faint">{entry.edited ? 'edited message' : 'file message'}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function Grid({ scenario, run, previous }: { scenario: EvalScenarioInfo; run: EvalRun | null; previous: EvalRun | null }) {
  const now = useNow(Boolean(run?.cells.some((cell) => cell.status === 'running')))
  const trials = Array.from({ length: Math.max(1, scenario.trials) }, (_, trial) => trial)
  const rows = run ? tally(run) : scenario.matrix.map((entry) => ({ provider: entry.provider, model: entry.model, passed: 0, total: trials.length, finished: 0, running: false, times: [] }))
  const before = previous ? new Map(tally(previous).map((row) => [row.provider, row])) : null
  return (
    <table className="ev-grid">
      <thead>
        <tr>
          <th>Provider</th>
          {trials.map((trial) => <th key={trial} className="ev-grid-trial">Trial {trial + 1}</th>)}
          <th>Passed</th>
          <th>Median time</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const was = before?.get(row.provider)
          const time = median(row.times)
          const wasTime = was ? median(was.times) : null
          return (
            <tr key={row.provider}>
              <td className="ev-grid-provider">
                <div className={`ev-provider is-${row.provider}`}><i aria-hidden />{providerLabel(row.provider)}</div>
                <div className="ev-faint ev-small">{row.model ?? 'default model'}</div>
              </td>
              {trials.map((trial) => (
                <td key={trial}>{run ? <Cell run={run} cell={cellOf(run, row.provider, trial)} graders={run.graders} now={now} /> : <div className="ev-cell is-empty">Not run yet</div>}</td>
              ))}
              <td className="ev-stat">
                {run && row.finished > 0 ? <div className={row.passed === row.total ? 'ev-ok' : row.passed === 0 ? 'ev-bad' : 'ev-warn'}>{row.passed}/{row.total}</div> : <div className="ev-faint">—</div>}
                {was && <div className="ev-faint ev-small">was {was.passed}/{was.total}</div>}
              </td>
              <td className="ev-stat">
                {duration(time)}
                {time !== null && wasTime !== null && <span className={`ev-delta ${time <= wasTime ? 'ev-ok' : 'ev-bad'}`}>{time <= wasTime ? '−' : '+'}{duration(Math.abs(time - wasTime))}</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Cell({ run, cell, graders, now }: { run: EvalRun; cell: EvalRunCell | null; graders: string[]; now: number }) {
  if (!cell) return <div className="ev-cell is-empty">—</div>
  const open = (): void => { void go('evals.run', { run: run.id, provider: cell.provider, trial: cell.trial }) }
  const label = `${providerLabel(cell.provider)} trial ${cell.trial + 1}`
  if (cell.status === 'queued') return <div className="ev-cell is-queued" aria-label={`${label}: queued`}>Queued</div>
  const elapsed = cell.startedAt ? (cell.endedAt ?? now) - cell.startedAt : null
  const head = cell.status === 'running' ? <><span className="ev-spin" aria-hidden />Running</>
    : cell.status === 'done' ? (cell.pass ? <><Check size={13} className="ev-ok" aria-hidden />Pass</> : <><X size={13} className="ev-bad" aria-hidden />Fail</>)
      : cell.status === 'error' ? <><X size={13} className="ev-bad" aria-hidden />Error</> : <>Stopped</>
  return (
    <button type="button" className={`ev-cell is-${cell.status}${cell.status === 'done' ? (cell.pass ? ' is-pass' : ' is-fail') : ''}`} aria-label={`Open ${label}`} onClick={open}>
      <span className="ev-cell-top">{head}<span className="ev-spacer" /><span className="ev-mono">{duration(elapsed)}</span></span>
      {cell.status === 'done' && (
        <span className="ev-dots">
          {graders.map((name) => {
            const grade = cell.grades.find((entry) => entry.name === name)
            return <i key={name} className={grade?.pass ? 'is-pass' : 'is-fail'} title={`${name}: ${grade?.pass ? 'passed' : grade?.reason ?? 'failed'}`} />
          })}
        </span>
      )}
      {cell.status === 'error' && <span className="ev-cell-note">{cell.error}</span>}
    </button>
  )
}

function runStatus(run: EvalRun): string {
  if (run.status === 'stopped') return 'stopped'
  if (run.status === 'done') return `${run.cells.filter((cell) => cell.pass).length} of ${run.cells.length} passed`
  return `${run.cells.filter((cell) => cell.status !== 'queued' && cell.status !== 'running').length} of ${run.cells.length} done`
}

function shortPath(path: string): string {
  return path.split('/').slice(-3).join('/')
}

/** The time, ticking once a second while something is running, for the cells' clocks. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ticking])
  return ticking ? now : Date.now()
}
