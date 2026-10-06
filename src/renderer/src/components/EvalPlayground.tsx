import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlaskConical, Play, Plus, RefreshCw, X } from 'lucide-react'
import { providerLabel, type ProviderId } from '../../../shared/types.ts'
import { call } from '../host.ts'
import { runScenarioCell } from '../eval-run.ts'

type Scenario = {
  id: string
  message: string
  openGoal: boolean
  graders: string[]
  matrix: Array<{ provider: ProviderId; model: string | null }>
}

type DatasetRow = { id: string; input: string; expected: string; tags: string[] }

type Task = {
  id: string
  role: 'base' | 'comparison'
  provider: ProviderId
  model: string | null
  label: string
}

type CellState = {
  status: 'idle' | 'running' | 'done' | 'error'
  output?: string
  pass?: boolean
}

type Props = {
  datasets: Array<{ id: string; rows: DatasetRow[] }>
  onFinished?: () => void
  onRefresh?: () => void
  onClose?: () => void
}

const TASK_DOTS = ['#fafafa', '#a78bfa', '#60a5fa', '#34d399']

export function EvalPlayground({ datasets, onFinished, onRefresh, onClose }: Props) {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [scenarioId, setScenarioId] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [diffOn, setDiffOn] = useState(false)
  const [compareMode, setCompareMode] = useState<'base' | string>('base')
  const [filter, setFilter] = useState('')
  const [cells, setCells] = useState<Record<string, CellState>>({})
  const [busy, setBusy] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  useEffect(() => {
    void call('eval.listScenarios', {}).then((data) => {
      setScenarios(data.scenarios)
      setScenarioId((prev) => prev || data.scenarios[0]?.id || '')
    })
  }, [])

  const scenario = useMemo(() => scenarios.find((s) => s.id === scenarioId) ?? null, [scenarios, scenarioId])

  useEffect(() => {
    if (!scenario) return
    if (datasets.some((d) => d.id === scenario.id)) setDatasetId(scenario.id)
    else if (!datasetId && datasets[0]) setDatasetId(datasets[0].id)
  }, [scenario, datasets, datasetId])

  const tasks: Task[] = useMemo(() => {
    if (!scenario) return []
    return scenario.matrix.map((cell, index) => ({
      id: `${cell.provider}-${index}`,
      role: index === 0 ? 'base' : 'comparison',
      provider: cell.provider,
      model: cell.model,
      label: index === 0 ? 'Base task' : 'Comparison task'
    }))
  }, [scenario])

  const rows = useMemo((): DatasetRow[] => {
    const ds = datasets.find((d) => d.id === datasetId)
    if (ds?.rows.length) return ds.rows
    if (scenario) {
      return [{ id: '0', input: '(default scenario run)', expected: scenario.graders.join(', '), tags: ['scenario'] }]
    }
    return []
  }, [datasets, datasetId, scenario])

  const filteredRows = useMemo(
    () => rows.filter((r) => r.input.toLowerCase().includes(filter.toLowerCase())),
    [rows, filter]
  )

  const cellKey = (rowId: string, taskId: string): string => `${rowId}::${taskId}`

  const markCell = useCallback((key: string, patch: Partial<CellState>): void => {
    setCells((prev) => ({ ...prev, [key]: { ...prev[key], status: prev[key]?.status ?? 'idle', ...patch } }))
  }, [])

  const executeCell = useCallback(async (row: DatasetRow, task: Task): Promise<void> => {
    if (!scenario) return
    const key = cellKey(row.id, task.id)
    markCell(key, { status: 'running', output: undefined })
    setRunError(null)
    try {
      const result = await runScenarioCell({
        scenarioId: scenario.id,
        provider: task.provider,
        trial: 0
      })
      markCell(key, { status: 'done', output: result.summary, pass: result.allPass })
      onFinished?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      markCell(key, { status: 'error', output: message.slice(0, 120) })
      setRunError(message)
    }
  }, [scenario, markCell, onFinished])

  const runOne = (row: DatasetRow, task: Task): void => {
    if (busy || !scenario) return
    setBusy(true)
    void executeCell(row, task).finally(() => setBusy(false))
  }

  const runRow = async (row: DatasetRow): Promise<void> => {
    if (!scenario || tasks.length === 0) return
    setBusy(true)
    setRunError(null)
    try {
      for (const task of tasks) {
        await executeCell(row, task)
      }
    } finally {
      setBusy(false)
    }
  }

  const runAll = async (): Promise<void> => {
    if (!scenario || filteredRows.length === 0) return
    setBusy(true)
    setRunError(null)
    try {
      for (const row of filteredRows) {
        for (const task of tasks) {
          await executeCell(row, task)
        }
      }
    } finally {
      setBusy(false)
    }
  }

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
            <button type="button" className="icon-button" title="Sync dashboard" aria-label="Sync dashboard" disabled={busy} onClick={() => onRefresh?.()}>
              <RefreshCw size={15} />
            </button>
            <button type="button" className="icon-button" aria-label="Close eval panel" onClick={() => onClose?.()}>
              <X size={15} />
            </button>
          </span>
          <button type="button" className="eval-bt-btn eval-bt-btn-primary eval-pg-run-main" disabled={!canRun} onClick={() => void runAll()}>
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
            onChange={(ev) => { setScenarioId(ev.target.value); setCells({}) }}
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
            onChange={(ev) => setCompareMode(ev.target.value)}
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
              <input type="checkbox" checked={diffOn} disabled={busy} onChange={(ev) => setDiffOn(ev.target.checked)} />
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
          onChange={(ev) => setFilter(ev.target.value)}
        />
        <button type="button" className="eval-bt-btn eval-bt-btn-ghost" disabled>+ Row</button>
        <button type="button" className="eval-bt-btn eval-bt-btn-ghost" disabled>+ Task</button>
        <button type="button" className="eval-bt-btn eval-bt-btn-ghost" disabled>+ Scorer</button>
        <label className="eval-pg-field eval-pg-field-inline">
          <span className="eval-pg-field-label">Dataset</span>
          <select className="eval-pg-select eval-pg-select-wide" value={datasetId} disabled={busy} onChange={(ev) => setDatasetId(ev.target.value)} aria-label="Dataset">
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
                  const key = cellKey(row.id, task.id)
                  const state = cells[key]
                  const preview = state?.output
                    ?? (state?.status === 'running' ? 'Running…'
                      : state?.status === 'error' ? 'Run failed'
                        : 'This cell has not been run yet.')
                  return (
                    <td
                      key={task.id}
                      className={`eval-pg-cell${state?.status === 'running' ? ' is-running' : ''}${state?.status === 'done' ? (state.pass ? ' is-pass' : ' is-fail') : ''}${state?.status === 'error' ? ' is-fail' : ''}${diffOn && task.role === 'comparison' ? ' is-diff' : ''}`}
                      role="button"
                      tabIndex={busy ? -1 : 0}
                      title="Click to run this cell"
                      aria-label={`Run ${providerLabel(task.provider)} for row ${index + 1}`}
                      onClick={() => runOne(row, task)}
                      onKeyDown={(ev) => { if (ev.key === 'Enter' && !busy) runOne(row, task) }}
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
          disabled={!canRun || filteredRows.length === 0}
          onClick={() => void runRow(filteredRows[0]!)}
        >
          Run row (all tasks)
        </button>
        <span className="eval-bt-muted">Run runs every visible row × task. Click a cell for one provider.</span>
      </footer>
    </div>
  )
}
