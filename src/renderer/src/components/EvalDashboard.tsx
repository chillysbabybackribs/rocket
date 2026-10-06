import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Beaker,
  Database,
  FlaskConical,
  Home,
  LayoutGrid,
  List,
  RefreshCw,
  Sparkles,
  Star,
  X
} from 'lucide-react'
import type { HostApi, ProviderId } from '../../../shared/types.ts'
import { call } from '../host.ts'
import { setEvalsOpen } from '../store.ts'
import { EvalPlayground } from './EvalPlayground.tsx'
import { EvalRunSheet } from './EvalRunSheet.tsx'

type DashboardData = HostApi['eval.loadDashboard'][1]
type Experiment = DashboardData['experiments'][number]
type Dataset = DashboardData['datasets'][number]

type NavView =
  | 'overview'
  | 'logs'
  | 'playgrounds'
  | 'experiments'
  | 'experiment-detail'
  | 'datasets'
  | 'dataset-detail'
  | 'scorers'

type LayoutMode = 'list' | 'grid' | 'summary' | 'summary-table'

const pct = (n: number): string => `${Math.round(n * 100)}%`
const fmtDate = (iso: string): string => (iso ? new Date(iso).toLocaleString() : '—')

export function EvalDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<NavView>('experiments')
  const [layout, setLayout] = useState<LayoutMode>('list')
  const [expFilter, setExpFilter] = useState('')
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null)
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [runOpen, setRunOpen] = useState(false)
  const [runSeed, setRunSeed] = useState<{ scenarioId?: string; provider?: ProviderId; trial?: number }>({})

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null)
    try {
      setData(await call('eval.loadDashboard', {}))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const experiments = data?.experiments ?? []
  const datasets = data?.datasets ?? []
  const filteredExperiments = useMemo(
    () => experiments.filter((e) => e.name.toLowerCase().includes(expFilter.toLowerCase())),
    [experiments, expFilter]
  )
  const selectedExperiment = experiments.find((e) => e.id === selectedExperimentId) ?? null
  const selectedDataset = datasets.find((d) => d.id === selectedDatasetId) ?? null

  const openRun = (seed: { scenarioId?: string; provider?: ProviderId; trial?: number } = {}): void => {
    setRunSeed(seed)
    setRunOpen(true)
  }

  const nav = (next: NavView): void => {
    setView(next)
    if (next === 'experiments' || next === 'datasets') {
      setSelectedExperimentId(null)
      setSelectedDatasetId(null)
    }
  }

  const pageTitle = ((): string => {
    if (view === 'experiment-detail') return selectedExperiment?.name ?? 'Experiment'
    if (view === 'dataset-detail') return selectedDataset?.id ?? 'Dataset'
    const titles: Record<NavView, string> = {
      overview: 'Overview',
      logs: 'Logs',
      playgrounds: 'Playgrounds',
      experiments: 'Experiments',
      'experiment-detail': 'Experiment',
      datasets: 'Datasets',
      'dataset-detail': 'Dataset',
      scorers: 'Scorers'
    }
    return titles[view]
  })()

  const toggleCompare = (id: string, checked: boolean): void => {
    setCompareIds((prev) => {
      if (!checked) return prev.filter((x) => x !== id)
      if (prev.length >= 2) return [id]
      return [...prev, id]
    })
  }

  const renderExperiments = (): React.ReactNode => {
    const rows = filteredExperiments
    if (layout === 'summary') {
      const avgPass = rows.length ? rows.reduce((s, e) => s + e.passRate, 0) / rows.length : 0
      return (
        <div className="eval-bt-summary-cards">
          <div className="eval-bt-metric"><div className="eval-bt-metric-label">Experiments</div><div className="eval-bt-metric-value">{rows.length}</div></div>
          <div className="eval-bt-metric"><div className="eval-bt-metric-label">Avg pass rate</div><div className="eval-bt-metric-value eval-bt-score-good">{pct(avgPass)}</div></div>
          <div className="eval-bt-metric"><div className="eval-bt-metric-label">Matrix runs</div><div className="eval-bt-metric-value">{rows.filter((e) => e.kind === 'matrix').length}</div></div>
          <div className="eval-bt-metric"><div className="eval-bt-metric-label">Harness runs</div><div className="eval-bt-metric-value">{rows.filter((e) => e.kind === 'harness').length}</div></div>
        </div>
      )
    }
    if (layout === 'summary-table') {
      const scoreKeys = [...new Set(rows.flatMap((e) => Object.keys(e.scores ?? {})))]
      return (
        <table className="eval-bt-table eval-bt-summary-table">
          <thead>
            <tr><th>Metric</th>{rows.map((e) => <th key={e.id}>{e.name}</th>)}</tr>
          </thead>
          <tbody>
            <tr><td>Pass rate</td>{rows.map((e) => <td key={e.id} className="eval-bt-score eval-bt-score-good">{pct(e.passRate)}</td>)}</tr>
            <tr><td>Cells</td>{rows.map((e) => <td key={e.id}>{e.passCount}/{e.cellCount}</td>)}</tr>
            {scoreKeys.map((k) => (
              <tr key={k}>
                <td>{k}</td>
                {rows.map((e) => <td key={e.id}>{e.scores?.[k] != null ? pct(e.scores[k]) : '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    if (layout === 'grid') {
      return (
        <div className="eval-bt-grid">
          {rows.map((e) => (
            <article
              key={e.id}
              className="eval-bt-card eval-bt-clickable"
              role="button"
              tabIndex={0}
              onClick={() => { setSelectedExperimentId(e.id); setView('experiment-detail') }}
              onKeyDown={(ev) => { if (ev.key === 'Enter') { setSelectedExperimentId(e.id); setView('experiment-detail') } }}
            >
              <h3>{e.name}</h3>
              <span className="eval-bt-badge eval-bt-badge-kind">{e.kind}</span>
              <p className={`eval-bt-score eval-bt-score-${e.passRate >= 0.8 ? 'good' : 'bad'}`} style={{ margin: '12px 0 4px', fontSize: 22, fontWeight: 600 }}>{pct(e.passRate)}</p>
              <p className="eval-bt-mono">{e.passCount}/{e.cellCount} cells · {fmtDate(e.createdAt)}</p>
            </article>
          ))}
        </div>
      )
    }
    return (
      <table className="eval-bt-table">
        <thead>
          <tr>
            <th aria-label="Compare" />
            <th>Name</th>
            <th>Dataset</th>
            <th>Pass rate</th>
            <th>Cells</th>
            <th>Created</th>
            <th>Kind</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr
              key={e.id}
              className="eval-bt-clickable"
              onClick={() => { setSelectedExperimentId(e.id); setView('experiment-detail') }}
            >
              <td onClick={(ev) => ev.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={compareIds.includes(e.id)}
                  onChange={(ev) => toggleCompare(e.id, ev.target.checked)}
                  aria-label={`Compare ${e.name}`}
                />
              </td>
              <td>{e.name}</td>
              <td><span className="eval-bt-mono">{e.datasetId}</span></td>
              <td className={`eval-bt-score eval-bt-score-${e.passRate >= 0.8 ? 'good' : 'bad'}`}>{pct(e.passRate)}</td>
              <td>{e.passCount}/{e.cellCount}</td>
              <td>{fmtDate(e.createdAt)}</td>
              <td><span className="eval-bt-badge eval-bt-badge-kind">{e.kind}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  const renderCompare = (): React.ReactNode => {
    if (compareIds.length !== 2) return null
    const a = experiments.find((e) => e.id === compareIds[0])
    const b = experiments.find((e) => e.id === compareIds[1])
    if (!a || !b) return null
    return (
      <>
        <h2 className="eval-bt-subhead">Compare: {a.name} vs {b.name}</h2>
        <table className="eval-bt-table">
          <thead><tr><th>Metric</th><th>{a.name}</th><th>{b.name}</th><th>Δ</th></tr></thead>
          <tbody>
            <tr>
              <td>Pass rate</td>
              <td className="eval-bt-score-good">{pct(a.passRate)}</td>
              <td className="eval-bt-score-good">{pct(b.passRate)}</td>
              <td className={b.passRate >= a.passRate ? 'eval-bt-score-good' : 'eval-bt-score-bad'}>{pct(b.passRate - a.passRate)}</td>
            </tr>
            <tr><td>Cells passed</td><td>{a.passCount}/{a.cellCount}</td><td>{b.passCount}/{b.cellCount}</td><td>—</td></tr>
          </tbody>
        </table>
      </>
    )
  }

  const renderExperimentDetail = (exp: Experiment): React.ReactNode => (
    <>
      <nav className="eval-bt-breadcrumb">
        <button type="button" onClick={() => nav('experiments')}>Experiments</button>
        <span>/</span>
        <span>{exp.name}</span>
      </nav>
      {exp.sourcePath && <p className="eval-bt-mono">Source: {exp.sourcePath}</p>}
      <table className="eval-bt-table">
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Provider</th>
            <th>Model</th>
            <th>Trial</th>
            <th>Result</th>
            <th>Graders</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(exp.cells ?? []).map((c, i) => (
            <tr key={`${c.scenarioId}-${c.provider}-${c.trial}-${i}`}>
              <td>{c.scenarioId}</td>
              <td>{c.provider}</td>
              <td className="eval-bt-mono">{c.model ?? 'default'}</td>
              <td>{c.trial}</td>
              <td><span className={`eval-bt-badge eval-bt-badge-${c.pass ? 'pass' : 'fail'}`}>{c.pass ? 'pass' : 'fail'}</span></td>
              <td className="eval-bt-mono">
                {Object.entries(c.graders ?? {}).map(([k, v]) => `${k}:${v}`).join(', ') || '—'}
              </td>
              <td>
                <button
                  type="button"
                  className="eval-bt-btn eval-bt-btn-ghost"
                  onClick={() => openRun({ scenarioId: c.scenarioId, provider: c.provider as ProviderId, trial: c.trial })}
                >
                  Re-run
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )

  const renderDatasets = (): React.ReactNode => (
    <table className="eval-bt-table">
      <thead><tr><th>Name</th><th>Rows</th><th>Description</th></tr></thead>
      <tbody>
        {datasets.map((d) => (
          <tr
            key={d.id}
            className="eval-bt-clickable"
            onClick={() => { setSelectedDatasetId(d.id); setView('dataset-detail') }}
          >
            <td>{d.id}</td>
            <td>{d.rows.length}</td>
            <td className="eval-bt-mono">{d.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  const renderDatasetDetail = (ds: Dataset): React.ReactNode => (
    <>
      <nav className="eval-bt-breadcrumb">
        <button type="button" onClick={() => nav('datasets')}>Datasets</button>
        <span>/</span>
        <span>{ds.id}</span>
      </nav>
      <p>{ds.description}</p>
      <table className="eval-bt-table">
        <thead><tr><th>Input</th><th>Expected</th><th>Tags</th><th /></tr></thead>
        <tbody>
          {ds.rows.map((r) => (
            <tr key={r.id}>
              <td className="eval-bt-mono eval-bt-cell-wrap">{r.input}</td>
              <td className="eval-bt-mono eval-bt-cell-wrap">{r.expected}</td>
              <td>{(r.tags ?? []).map((t) => <span key={t} className="eval-bt-badge eval-bt-badge-kind">{t}</span>)}</td>
              <td>
                <button type="button" className="eval-bt-btn eval-bt-btn-ghost" onClick={() => openRun({ scenarioId: ds.id })}>Run row</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )

  const renderPlaceholder = (name: string): React.ReactNode => (
    <p className="eval-bt-muted">
      {name} mirrors Braintrust’s project nav. Use <strong>Experiments</strong> and <strong>Datasets</strong> for Rocket matrix and harness artifacts.
    </p>
  )

  let content: React.ReactNode
  if (!data && !loadError) content = <p className="eval-bt-muted">Loading eval dashboard…</p>
  else if (loadError) content = <p className="eval-error">{loadError}</p>
  else if (view === 'experiments') content = <>{renderExperiments()}{renderCompare()}</>
  else if (view === 'experiment-detail' && selectedExperiment) content = renderExperimentDetail(selectedExperiment)
  else if (view === 'datasets') content = renderDatasets()
  else if (view === 'dataset-detail' && selectedDataset) content = renderDatasetDetail(selectedDataset)
  else if (view === 'playgrounds') content = (
    <EvalPlayground
      datasets={datasets}
      onRunCell={(seed) => openRun({ scenarioId: seed.scenarioId, provider: seed.provider, trial: seed.trial })}
    />
  )
  else content = renderPlaceholder(pageTitle)

  const showExpToolbar = view === 'experiments' || view === 'experiment-detail'
  const showPlaygroundChrome = view === 'playgrounds'

  return (
    <div className="eval-bt-root">
      <aside className="eval-bt-sidebar" aria-label="Eval project navigation">
        <div className="eval-bt-org">{data?.org ?? 'rocketv1'}</div>
        <div className="eval-bt-project-select" aria-label="Project">{data?.project ?? 'Rocket Evals'}</div>

        <div className="eval-bt-nav-label">Monitor</div>
        <button type="button" className={`eval-bt-nav${view === 'overview' ? ' is-active' : ''}`} onClick={() => nav('overview')}><Home size={16} />Overview</button>
        <button type="button" className={`eval-bt-nav${view === 'logs' ? ' is-active' : ''}`} onClick={() => nav('logs')}><List size={16} />Logs</button>

        <div className="eval-bt-nav-label">Evaluate</div>
        <button type="button" className={`eval-bt-nav${view === 'playgrounds' ? ' is-active' : ''}`} onClick={() => nav('playgrounds')}><LayoutGrid size={16} />Playgrounds</button>
        <button type="button" className={`eval-bt-nav${view === 'experiments' || view === 'experiment-detail' ? ' is-active' : ''}`} onClick={() => nav('experiments')}><FlaskConical size={16} />Experiments</button>
        <button type="button" className={`eval-bt-nav${view === 'datasets' || view === 'dataset-detail' ? ' is-active' : ''}`} onClick={() => nav('datasets')}><Database size={16} />Datasets</button>
        <button type="button" className={`eval-bt-nav${view === 'scorers' ? ' is-active' : ''}`} onClick={() => nav('scorers')}><Star size={16} />Scorers</button>

        <div className="eval-bt-sidebar-foot">
          <div className="eval-bt-plan-card">
            <strong>Local evals</strong>
            Synced from repo scenarios and <span className="eval-bt-mono">.artifacts/evals</span>.
            {data?.syncedAt && <span className="eval-bt-mono eval-bt-sync"> · {fmtDate(data.syncedAt)}</span>}
          </div>
        </div>
      </aside>

      <div className="eval-bt-main">
        <header className={`eval-bt-topbar${showPlaygroundChrome ? ' is-compact' : ''}`}>
          <div>
            {!showPlaygroundChrome && <h1 className="eval-bt-page-title">{pageTitle}</h1>}
          </div>
          <div className="eval-bt-topbar-actions">
            <button type="button" className="icon-button" title="Refresh dashboard" aria-label="Refresh dashboard" onClick={() => void load()}>
              <RefreshCw size={15} />
            </button>
            <button type="button" className="icon-button" aria-label="Close eval panel" onClick={() => setEvalsOpen(false)}>
              <X size={15} />
            </button>
            <button type="button" className="eval-bt-btn" onClick={() => void load()}>Sync</button>
            <button type="button" className="eval-bt-btn eval-bt-btn-primary" onClick={() => openRun()}>
              <Beaker size={14} aria-hidden />
              Run cell
            </button>
          </div>
        </header>

        {showExpToolbar && (
          <div className="eval-bt-toolbar">
            <div className="eval-bt-chips" role="group" aria-label="Layout">
              {(['list', 'grid', 'summary', 'summary-table'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`eval-bt-chip${layout === mode ? ' is-active' : ''}`}
                  onClick={() => setLayout(mode)}
                >
                  {mode === 'summary-table' ? 'Summary table' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
            <input
              type="search"
              className="eval-bt-filter"
              placeholder="Filter experiments…"
              value={expFilter}
              onChange={(ev) => setExpFilter(ev.target.value)}
            />
            <button type="button" className="eval-bt-btn" disabled={compareIds.length !== 2} onClick={() => setView('experiments')}>Compare</button>
            {compareIds.length > 0 && (
              <button type="button" className="eval-bt-btn eval-bt-btn-ghost" onClick={() => setCompareIds([])}>Clear compare</button>
            )}
          </div>
        )}

        {compareIds.length > 0 && view === 'experiments' && (
          <div className="eval-bt-compare-banner">
            <Sparkles size={14} aria-hidden />
            <span>{compareIds.length === 2 ? 'Comparing 2 experiments' : `Selected ${compareIds.length}/2 for compare`}</span>
          </div>
        )}

        <div className={`eval-bt-content${showPlaygroundChrome ? ' is-flush' : ''}`}>
          {content}
        </div>

        <EvalRunSheet
          open={runOpen}
          onClose={() => setRunOpen(false)}
          initialScenarioId={runSeed.scenarioId}
          initialProvider={runSeed.provider}
          initialTrial={runSeed.trial}
          onFinished={() => void load()}
        />
      </div>
    </div>
  )
}
