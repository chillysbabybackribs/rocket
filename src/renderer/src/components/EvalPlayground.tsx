import { useEffect, useMemo, useState } from 'react'
import { FlaskConical, Play, Plus, RefreshCw, X } from 'lucide-react'
import { providerLabel } from '../../../shared/types.ts'
import { act, go } from '../app-map.ts'
import { call } from '../host.ts'
import { cellKey, playgroundRows, playgroundTasks, visibleRows, type Dataset, type Scenario } from '../eval-run.ts'
import { patchPlayground, useApp } from '../store.ts'

// The playground is a view of the store's `evals.playground`: what it shows and what is running
// come from there, and every button goes through the app map, so rocket_ui_act runs the same
// code as a click and rocket_ui_where sees the same cells.

const TASK_DOTS = ['#fafafa', '#a78bfa', '#60a5fa', '#34d399']

export function EvalPlayground({ datasets }: { datasets: Dataset[] }) {
  const { scenarioId, datasetId, diff: diffOn, compare: compareMode, filter, cells, busy, error: runError } = useApp((state) => state.evals.playground)
  const [scenarios, setScenarios] = useState<Scenario[]>([])

  useEffect(() => {
    void call('eval.listScenarios', {}).then((data) => {
      setScenarios(data.scenarios)
      if (!scenarioId && data.scenarios[0]) patchPlayground({ scenarioId: data.scenarios[0].id })
    })
  }, [scenarioId])

  const scenario = useMemo(() => scenarios.find((s) => s.id === scenarioId) ?? null, [scenarios, scenarioId])

  useEffect(() => {
    if (!scenario) return
    if (datasets.some((d) => d.id === scenario.id)) { if (datasetId !== scenario.id) patchPlayground({ datasetId: scenario.id }) }
    else if (!datasetId && datasets[0]) patchPlayground({ datasetId: datasets[0].id })
  }, [scenario, datasets, datasetId])

  const tasks = useMemo(() => playgroundTasks(scenario), [scenario])
  const rows = useMemo(() => playgroundRows(datasets, datasetId, scenario), [datasets, datasetId, scenario])
  const filteredRows = useMemo(() => visibleRows(rows, filter), [rows, filter])

  const promptTemplate = scenario?.message ?? ''
  const canRun = Boolean(scenario && tasks.length > 0 && filteredRows.length > 0 && !busy)

  return (
    <div className="eval-pg">
      <header className="eval-pg-head">
        <div className="eval-pg-head-left">
          <span className="eval-bt-badge eval-bt-badge-kind">Saved</span>
          <h2 className="eval-pg-title">{scenario?.id ?? 'Playground'}</h2>
        </div>
        <div className="eval-pg-head-actions">
          <span className="eval-pg-panel-actions">
            <button type="button" className="icon-button" title="Sync dashboard" aria-label="Sync dashboard" disabled={busy} onClick={() => void act('evals.sync')}>
              <RefreshCw size={15} />
            </button>
            <button type="button" className="icon-button" aria-label="Close eval panel" onClick={() => void go('chat')}>
              <X size={15} />
            </button>
          </span>
          <button type="button" className="eval-bt-btn eval-bt-btn-primary eval-pg-run-main" disabled={!canRun} onClick={() => void act('evals.playgrounds.run')}>
            <Play size={14} aria-hidden fill="currentColor" />
            {busy ? 'Running…' : 'Run'}
          </button>
          <button type="button" className="eval-bt-btn" disabled title="Promote to Experiments after a matrix run">
            <FlaskConical size={14} aria-hidden />
            Experiments
          </button>
        </div>
      </header>

      <div className="eval-pg-subhead">
        <label className="eval-pg-field">
          <span className="eval-pg-field-label">Scenario</span>
          <select
            className="eval-pg-select"
            aria-label="Scenario"
            value={scenarioId}
            disabled={busy}
            onChange={(ev) => void go('evals.playgrounds', { scenario: ev.target.value })}
          >
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
          </select>
        </label>
        <label className="eval-pg-field">
          <span className="eval-pg-field-label">Compare</span>
          <select
            className="eval-pg-select eval-pg-select-wide"
            value={compareMode}
            disabled={busy}
            onChange={(ev) => void go('evals.playgrounds', { compare: ev.target.value })}
            aria-label="Comparison baseline"
          >
            <option value="base">Comparison → Base</option>
            {tasks.filter((t) => t.role === 'comparison').map((t) => (
              <option key={t.id} value={t.id}>Comparison → {providerLabel(t.provider)}</option>
            ))}
          </select>
        </label>
        <div className="eval-pg-field">
          <span className="eval-pg-field-label">Diff</span>
          <div className="eval-pg-control">
            <label className="eval-pg-diff">
              <input type="checkbox" checked={diffOn} disabled={busy} onChange={(ev) => void go('evals.playgrounds', { diff: ev.target.checked })} />
              <span>On</span>
            </label>
          </div>
        </div>
      </div>

      {runError && <p className="eval-pg-run-error" role="alert">{runError}</p>}

      <div className="eval-pg-tasks" role="region" aria-label="Task definitions">
        {tasks.map((task, index) => (
          <article key={task.id} className="eval-pg-task" style={{ '--task-dot': TASK_DOTS[index % TASK_DOTS.length] } as React.CSSProperties}>
            <div className="eval-pg-task-head">
              <span className="eval-pg-task-dot" aria-hidden />
              <span>{task.label}</span>
            </div>
            <div className="eval-pg-task-section">
              <div className="eval-pg-task-section-label">Model</div>
              <button type="button" className="eval-pg-model-pick">
                {providerLabel(task.provider)}
                {task.model ? ` · ${task.model}` : ' · default'}
              </button>
            </div>
            <div className="eval-pg-task-section eval-pg-task-section--messages">
              <div className="eval-pg-task-section-label">Messages</div>
              <div className="eval-pg-msg-role">User</div>
              <textarea
                className="eval-pg-prompt"
                readOnly
                value={promptTemplate}
                aria-label={`Prompt for ${task.label}`}
              />
              <div className="eval-pg-prompt-chips">
                <span className="eval-pg-chip">Mustache</span>
                <span className="eval-pg-chip">Text output</span>
              </div>
            </div>
            <footer className="eval-pg-task-foot">
              <span className="eval-bt-muted">Scenario JSONL</span>
              <span className="eval-pg-draft">Draft</span>
            </footer>
          </article>
        ))}
        <button type="button" className="eval-pg-add-task" disabled title="Add columns via scenario matrix in JSONL">
          <Plus size={18} />
        </button>
      </div>

      <div className="eval-pg-grid-toolbar">
        <span className="eval-pg-chip is-active">All rows view</span>
        <span className="eval-pg-chip">Grid</span>
        <input
          type="search"
          className="eval-bt-filter"
          placeholder="Add filter…"
          value={filter}
          disabled={busy}
          onChange={(ev) => patchPlayground({ filter: ev.target.value })}
        />
        <button type="button" className="eval-bt-btn eval-bt-btn-ghost" disabled>+ Row</button>
        <button type="button" className="eval-bt-btn eval-bt-btn-ghost" disabled>+ Task</button>
        <button type="button" className="eval-bt-btn eval-bt-btn-ghost" disabled>+ Scorer</button>
        <label className="eval-pg-field eval-pg-field-inline">
          <span className="eval-pg-field-label">Dataset</span>
          <select className="eval-pg-select eval-pg-select-wide" value={datasetId} disabled={busy} onChange={(ev) => void go('evals.playgrounds', { dataset: ev.target.value })} aria-label="Dataset">
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.id} ({d.rows.length})</option>)}
          </select>
        </label>
        <button type="button" className="eval-bt-btn eval-bt-btn-ghost" disabled>Display</button>
      </div>

      <div className="eval-pg-grid-wrap">
        <table className="eval-pg-grid">
          <thead>
            <tr>
              <th className="eval-pg-col-idx">#</th>
              <th>Input</th>
              {tasks.map((task) => (
                <th key={task.id}>
                  <div className="eval-pg-col-task">
                    <span className="eval-bt-mono">{providerLabel(task.provider)}</span>
                    <span className={`eval-pg-role eval-pg-role-${task.role}`}>{task.role === 'base' ? 'Base' : 'Comparison'}</span>
                    {task.role === 'comparison' && diffOn && (
                      <span className="eval-pg-tie">Tie · No significant difference</span>
                    )}
                  </div>
                </th>
              ))}
              {(scenario?.graders ?? []).map((g) => (
                <th key={g}><span className="eval-pg-scorer">% {g}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, index) => (
              <tr key={row.id}>
                <td className="eval-pg-col-idx">{index + 1}</td>
                <td className="eval-pg-input">{row.input}</td>
                {tasks.map((task) => {
                  const state = cells[cellKey(row.id, task.id)]
                  const preview = state?.output
                    ?? (state?.status === 'running' ? 'Running…'
                      : state?.status === 'error' ? 'Run failed'
                        : 'This cell has not been run yet.')
                  const runCell = (): void => { if (!busy) void act('evals.playgrounds.run', { row: index + 1, provider: task.provider }) }
                  return (
                    <td
                      key={task.id}
                      className={`eval-pg-cell${state?.status === 'running' ? ' is-running' : ''}${state?.status === 'done' ? (state.pass ? ' is-pass' : ' is-fail') : ''}${state?.status === 'error' ? ' is-fail' : ''}${diffOn && task.role === 'comparison' ? ' is-diff' : ''}`}
                      role="button"
                      tabIndex={busy ? -1 : 0}
                      title="Click to run this cell"
                      aria-label={`Run ${providerLabel(task.provider)} for row ${index + 1}`}
                      onClick={runCell}
                      onKeyDown={(ev) => { if (ev.key === 'Enter') runCell() }}
                    >
                      {preview}
                    </td>
                  )
                })}
                {(scenario?.graders ?? []).map((g) => (
                  <td key={g} className="eval-pg-scorer-cell">—</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="eval-pg-foot">
        <button
          type="button"
          className="eval-bt-btn"
          disabled={!canRun}
          onClick={() => void act('evals.playgrounds.run', { row: 1 })}
        >
          Run row (all tasks)
        </button>
        <span className="eval-bt-muted">Run runs every visible row × task. Click a cell for one provider.</span>
      </footer>
    </div>
  )
}
