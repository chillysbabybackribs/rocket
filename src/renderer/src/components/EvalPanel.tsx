import { useEffect } from 'react'
import { ChevronRight, RefreshCw, X } from 'lucide-react'
import { providerLabel } from '../../../shared/types.ts'
import { act, go } from '../app-map.ts'
import { runsOf, tally, when, type ProviderTally } from '../eval-run.ts'
import { loadEvals, useApp } from '../store.ts'
import { EvalRunView } from './EvalRunView.tsx'
import { EvalScenario } from './EvalScenario.tsx'
import { EvalToolsPanel } from './EvalToolsPanel.tsx'

// The eval panel beside the chat: scenarios, each run on every provider in its matrix with real
// turns, and the tool ledger. Every control goes through the app map, so a model's rocket_ui_go
// and rocket_ui_act do what a click does. See docs/mockups/evals.html for the agreed design.

export function EvalPanel() {
  const view = useApp((state) => state.evals.view)
  const loaded = useApp((state) => state.evals.loaded)
  useEffect(() => { if (!loaded) void loadEvals() }, [loaded])
  const tools = view === 'tools'
  return (
    <aside className="eval-panel" aria-label="Evals">
      <header className="ev-head">
        <div className="ev-tabs" role="tablist" aria-label="Eval views">
          <button type="button" role="tab" aria-selected={!tools} data-nav="evals.scenarios" className={`ev-tab${tools ? '' : ' is-active'}`} onClick={() => void go('evals.scenarios')}>Scenarios</button>
          <button type="button" role="tab" aria-selected={tools} data-nav="evals.tools" className={`ev-tab${tools ? ' is-active' : ''}`} onClick={() => void go('evals.tools')}>Tool health</button>
        </div>
        <span className="ev-spacer" />
        {tools
          ? <button type="button" className="icon-button" title="Refresh ledger" aria-label="Refresh ledger" onClick={() => void act('evals.tools.refresh')}><RefreshCw size={14} /></button>
          : <button type="button" className="icon-button" title="Reload scenarios and runs" aria-label="Reload scenarios and runs" onClick={() => void act('evals.sync')}><RefreshCw size={14} /></button>}
        <button type="button" className="icon-button" title="Close evals" aria-label="Close eval panel" onClick={() => void go('chat')}><X size={15} /></button>
      </header>
      <div className="ev-body">
        {tools ? <EvalToolsPanel /> : view === 'scenario' ? <EvalScenario /> : view === 'run' ? <EvalRunView /> : <ScenarioList />}
      </div>
    </aside>
  )
}

function ScenarioList() {
  const scenarios = useApp((state) => state.evals.scenarios)
  const runs = useApp((state) => state.evals.runs)
  const loaded = useApp((state) => state.evals.loaded)
  const error = useApp((state) => state.evals.error)
  if (error) return <p className="eval-error" role="alert">{error}</p>
  if (!loaded) return <p className="ev-muted">Reading scenarios…</p>
  return (
    <>
      <div className="ev-title-row">
        <h1 className="ev-title">Scenarios</h1>
        <span className="ev-muted">{scenarios.length} in <span className="ev-mono">docs/evals/scenarios</span></span>
      </div>
      {scenarios.length === 0
        ? <p className="ev-muted">There are no scenarios yet. Add one as a line of JSON in a <span className="ev-mono">.jsonl</span> file under docs/evals/scenarios.</p>
        : (
          <>
            <h2 className="ev-h2">Latest run, passed of trials per provider</h2>
            <div className="ev-list">
              {scenarios.map((scenario) => {
                const latest = runsOf(runs, scenario.id)[0]
                return (
                  <button key={scenario.id} type="button" className="ev-list-row" aria-label={`Open scenario ${scenario.id}`} onClick={() => void go('evals.scenario', { id: scenario.id })}>
                    <span className="ev-list-main">
                      <span className="ev-list-name">{scenario.id}</span>
                      <span className="ev-list-msg">{scenario.message}</span>
                    </span>
                    <span className="ev-chips">
                      {latest ? tally(latest).map((row) => <ProviderChip key={row.provider} row={row} />) : <span className="ev-muted">Never run</span>}
                    </span>
                    <span className="ev-list-when">{latest ? (latest.status === 'running' ? 'running' : when(latest.startedAt)) : '—'}</span>
                    <ChevronRight size={14} className="ev-faint" aria-hidden />
                  </button>
                )
              })}
            </div>
          </>
        )}
    </>
  )
}

function ProviderChip({ row }: { row: ProviderTally }) {
  const tone = row.running || row.finished < row.total ? 'is-pending' : row.passed === row.total ? 'is-pass' : row.passed === 0 ? 'is-fail' : 'is-mixed'
  return (
    <span className={`ev-chip ${tone}`}>
      <i aria-hidden />{providerLabel(row.provider)}
      <span className="ev-mono">{row.running && row.finished === 0 ? '…' : `${row.passed}/${row.total}`}</span>
    </span>
  )
}
