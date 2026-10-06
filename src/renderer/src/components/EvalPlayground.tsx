import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlaskConical, Plus } from 'lucide-react'
import { providerLabel, type ProviderId } from '../../../shared/types.ts'
import { call } from '../host.ts'

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
  onRunCell: (seed: { scenarioId: string; provider: ProviderId; trial?: number; rowId?: string }) => void
}

const TASK_DOTS = ['#fafafa', '#a78bfa', '#60a5fa', '#34d399']

function applyInput(template: string, input: string): string {
  if (template.includes('{{input}}')) return template.replace(/\{\{input\}\}/g, input)
  return `${template}\n\nInput: ${input}`
}

export function EvalPlayground({ datasets, onRunCell }: Props) {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [scenarioId, setScenarioId] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [diffOn, setDiffOn] = useState(false)
  const [compareMode, setCompareMode] = useState<'base' | string>('base')
  const [filter, setFilter] = useState('')
  const [cells, setCells] = useState<Record<string, CellState>>({})

  useEffect(() => {
    void call('eval.listScenarios', {}).then((data) => {
      setScenarios(data.scenarios)
      setScenarioId((prev) => prev || data.scenarios[0]?.id || '')
    })
  }, [])

  const scenario = useMemo(() => scenarios.find((s) => s.id === scenarioId) ?? null, [scenarios, scenarioId])

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

  useEffect(() => {
    if (!datasetId && datasets[0]) setDatasetId(datasets[0].id)
    if (scenario && !datasets.some((d) => d.id === scenario.id)) {
      setDatasetId(datasets[0]?.id ?? scenario.id)
    }
  }, [datasets, datasetId, scenario])

  const filteredRows = useMemo(
    () => rows.filter((r) => r.input.toLowerCase().includes(filter.toLowerCase())),
    [rows, filter]
  )

  const cellKey = (rowId: string, taskId: string): string => `${rowId}::${taskId}`

  const markCell = useCallback((key: string, patch: Partial<CellState>): void => {
    setCells((prev) => ({ ...prev, [key]: { ...prev[key], status: prev[key]?.status ?? 'idle', ...patch } }))
  }, [])

  const runRow = (row: DatasetRow): void => {
    if (!scenario) return
    for (const task of tasks) {
      markCell(cellKey(row.id, task.id), { status: 'running' })
      onRunCell({ scenarioId: scenario.id, provider: task.provider, trial: 0, rowId: row.id })
    }
  }

  const runOne = (row: DatasetRow, task: Task): void => {
    if (!scenario) return
    markCell(cellKey(row.id, task.id), { status: 'running' })
    onRunCell({ scenarioId: scenario.id, provider: task.provider, trial: 0, rowId: row.id })
  }

  const promptTemplate = scenario?.message ?? ''

  return (
    <div className="eval-pg">
      <header className="eval-pg-head">
        <div className="eval-pg-head-left">
          <span className="eval-bt-badge eval-bt-badge-kind">Saved</span>
          <h2 className="eval-pg-title">{scenario?.id ?? 'Playground'}</h2>
        </div>
        <div className="eval-pg-head-actions">
          <label className="eval-pg-select-wrap">
            <span className="eval-pg-select-label">Scenario</span>
            <select
              className="eval-pg-select"
              value={scenarioId}
              onChange={(ev) => { setScenarioId(ev.target.value); setCells({}) }}
            >
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
            </select>
          </label>
          <select className="eval-pg-select" value={compareMode} onChange={(ev) => setCompareMode(ev.target.value)} aria-label="Comparison baseline">
            <option value="base">Comparison → Base</option>
            {tasks.filter((t) => t.role === 'comparison').map((t) => (
              <option key={t.id} value={t.id}>Comparison → {providerLabel(t.provider)}</option>
            ))}
          </select>
          <label className="eval-pg-diff">
            <input type="checkbox" checked={diffOn} onChange={(ev) => setDiffOn(ev.target.checked)} />
            Diff
          </label>
          <button type="button" className="eval-bt-btn" disabled title="Promote to Experiments after a matrix run">
            <FlaskConical size={14} aria-hidden />
            Experiments
          </button>
          <button type="button" className="eval-bt-btn eval-bt-btn-ghost" disabled title="Providers come from scenario matrix">
            Add Provider
          </button>
        </div>
      </header>

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
            <div className="eval-pg-task-section">
              <div className="eval-pg-task-section-label">Messages</div>
              <div className="eval-pg-msg-role">User</div>
              <textarea
                className="eval-pg-prompt"
                readOnly
                value={promptTemplate}
                rows={6}
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
          onChange={(ev) => setFilter(ev.target.value)}
        />
        <button type="button" className="eval-bt-btn eval-bt-btn-ghost" disabled>+ Row</button>
        <button type="button" className="eval-bt-btn eval-bt-btn-ghost" disabled>+ Task</button>
        <button type="button" className="eval-bt-btn eval-bt-btn-ghost" disabled>+ Scorer</button>
        <select className="eval-pg-select" value={datasetId} onChange={(ev) => setDatasetId(ev.target.value)} aria-label="Dataset">
          {datasets.map((d) => <option key={d.id} value={d.id}>Dataset · {d.id} ({d.rows.length})</option>)}
        </select>
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
                  const preview = state?.output ?? (state?.status === 'running' ? 'Running…' : 'This cell has not been run yet.')
                  return (
                    <td
                      key={task.id}
                      className={`eval-pg-cell${state?.status === 'running' ? ' is-running' : ''}${diffOn && task.role === 'comparison' ? ' is-diff' : ''}`}
                      role="button"
                      tabIndex={0}
                      title={applyInput(promptTemplate, row.input).slice(0, 200)}
                      onClick={() => runOne(row, task)}
                      onKeyDown={(ev) => { if (ev.key === 'Enter') runOne(row, task) }}
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
        <button type="button" className="eval-bt-btn eval-bt-btn-primary" disabled={!scenario || tasks.length === 0} onClick={() => filteredRows[0] && runRow(filteredRows[0])}>
          Run row (all tasks)
        </button>
        <span className="eval-bt-muted">Click a cell to run one provider; watch the turn in the chat column.</span>
      </footer>
    </div>
  )
}
