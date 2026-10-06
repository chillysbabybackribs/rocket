import { useCallback, useEffect, useState } from 'react'
import type { HostApi } from '../../../shared/types.ts'
import { go } from '../app-map.ts'
import { call } from '../host.ts'
import { useApp } from '../store.ts'

type PanelData = HostApi['toolLedger.loadPanel'][1]
type ScoresData = HostApi['toolEval.scores'][1]
type CallDetail = HostApi['toolLedger.callDetail'][1]
type CallRow = Record<string, unknown> & {
  id?: string
  tool?: string
  operation?: string
  outcome?: string
  finish?: { error?: { code?: string; message?: string }; artifacts?: string[] }
  review?: { lifecycle?: string; causeCode?: string | null; proposedFix?: string | null; retryCallId?: string | null }
}

const pct = (n: number | null | undefined): string => (n == null ? '—' : `${Math.round(n * 100)}%`)
const score3 = (n: number | null | undefined): string => (n == null ? '—' : n.toFixed(2))
const fmtDate = (ms: number): string => new Date(ms).toLocaleString()

export function EvalToolsPanel() {
  // The section and the refresh count live in the store, where the app map sets and reads them.
  const section = useApp((state) => state.evals.tools.section)
  const refreshKey = useApp((state) => state.evals.refresh)
  const setSection = (next: 'health' | 'scores'): void => { void go('evals.tools', { section: next === 'scores' ? 'evaluate' : 'health' }) }
  const [data, setData] = useState<PanelData | null>(null)
  const [scores, setScores] = useState<ScoresData | null>(null)
  const [scoresError, setScoresError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CallDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setData(await call('toolLedger.loadPanel', {}))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const loadDetail = useCallback(async (callId: string): Promise<void> => {
    setDetail(await call('toolLedger.callDetail', { callId }))
  }, [])

  const loadScores = useCallback(async (): Promise<void> => {
    setScoresError(null)
    try {
      setScores(await call('toolEval.scores', {}))
    } catch (err) {
      setScoresError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => { void load() }, [load, refreshKey])
  useEffect(() => {
    if (section === 'scores') void loadScores()
  }, [section, loadScores, refreshKey])

  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    void loadDetail(selectedId).catch(() => setDetail(null))
  }, [selectedId, loadDetail, refreshKey])

  const setReview = async (params: HostApi['toolLedger.setReview'][0]): Promise<void> => {
    setBusy(true)
    setActionError(null)
    try {
      await call('toolLedger.setReview', params)
      await load()
      if (selectedId) await loadDetail(selectedId)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const openPath = (path: string): void => {
    void window.rocket.openLocalPath(path).catch(err => setActionError(err instanceof Error ? err.message : String(err)))
  }

  if (error) return <p className="eval-error">{error}</p>
  if (!data) return <p className="eval-bt-muted">Loading tool ledger…</p>
  if (!data.available) return <p className="eval-bt-muted">{data.message ?? 'Ledger unavailable.'}</p>

  const policy = data.contextPolicy ?? {}
  const selected = (detail?.calls?.[0] ?? null) as CallRow | null
  const artifacts = selected?.finish?.artifacts ?? []

  const toolsWithScenarios = scores?.tools.filter(row => row.scenarioIds.length > 0) ?? []

  return (
    <div className="eval-tools" aria-label="MCP tool ledger">
      <div className="eval-tools-subtabs" role="tablist" aria-label="Tools views">
        <button type="button" role="tab" aria-selected={section === 'health'} className={`eval-tools-subtab${section === 'health' ? ' is-on' : ''}`} onClick={() => setSection('health')}>Health</button>
        <button type="button" role="tab" aria-selected={section === 'scores'} className={`eval-tools-subtab${section === 'scores' ? ' is-on' : ''}`} onClick={() => setSection('scores')}>Evaluate</button>
      </div>

      {section === 'scores' && (
        <>
          <p className="eval-bt-muted">
            <strong>TES</strong> = {scores ? `${Math.round(scores.weights.wR * 100)}% R + ${Math.round(scores.weights.wP * 100)}% P` : '…'}.
            R = ledger reliability (Wilson 95% LB). P = pass rate on <span className="eval-bt-mono">targetTool</span> scenarios from eval-live runs (real chat cells).
          </p>
          {scoresError && <p className="eval-error">{scoresError}</p>}
          {!scores && !scoresError && <p className="eval-bt-muted">Loading scores…</p>}
          {scores && (
            <>
              <p className="eval-bt-mono eval-bt-muted eval-tools-path">{scores.note}</p>
              <table className="eval-bt-table">
                <thead>
                  <tr><th>Tool</th><th>TES</th><th>R</th><th>P</th><th>Ledger n</th><th>Scenario cells</th><th>Scenarios</th></tr>
                </thead>
                <tbody>
                  {scores.tools.map(row => (
                    <tr key={row.tool}>
                      <td className="eval-bt-mono">{row.tool}</td>
                      <td className="eval-bt-score">{score3(row.tes)}</td>
                      <td>{score3(row.r)}</td>
                      <td>{row.p == null ? '—' : pct(row.p)}</td>
                      <td>{row.ledgerCalls}</td>
                      <td>{row.scenarioCells === 0 ? '—' : `${row.scenarioPasses}/${row.scenarioCells}`}</td>
                      <td className="eval-bt-mono eval-bt-cell-wrap">{row.scenarioIds.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {toolsWithScenarios.length > 0 && (
                <p className="eval-bt-muted">
                  Run scenarios via <strong>Experiments → Run cell</strong> or Playground (same chat UI). Example:{' '}
                  <span className="eval-bt-mono">{toolsWithScenarios[0]?.scenarioIds[0]}</span>.
                </p>
              )}
            </>
          )}
        </>
      )}

      {section === 'health' && (
        <>
      <p className="eval-bt-muted">
        Rocket MCP tool health — same evidence as <span className="eval-bt-mono">rocket_tool_history</span> /
        <span className="eval-bt-mono"> rocket_tool_review</span>. History is <strong>not</strong> injected into chat prompts.
      </p>

      {actionError && <p className="eval-error">{actionError}</p>}

      <div className="eval-bt-summary-cards">
        <div className="eval-bt-metric">
          <div className="eval-bt-metric-label">Prompt injection</div>
          <div className="eval-bt-metric-value">{policy.historyInPrompts === false ? 'Off' : '—'}</div>
        </div>
        <div className="eval-bt-metric">
          <div className="eval-bt-metric-label">Retained calls</div>
          <div className="eval-bt-metric-value">{data.scopes?.reduce((n, s) => n + s.attempts, 0) ?? 0}</div>
        </div>
        <div className="eval-bt-metric">
          <div className="eval-bt-metric-label">Review queue</div>
          <div className="eval-bt-metric-value" aria-label="Review queue count">{data.queue?.length ?? 0}</div>
        </div>
        <div className="eval-bt-metric">
          <div className="eval-bt-metric-label">Registered MCP tools</div>
          <div className="eval-bt-metric-value">{data.registeredTools?.length ?? 0}</div>
        </div>
      </div>

      {data.path && (
        <p className="eval-bt-mono eval-bt-muted eval-tools-path">
          {data.path}
          {data.syncedAt && ` · synced ${fmtDate(Date.parse(data.syncedAt))}`}
        </p>
      )}

      <h2 className="eval-tools-heading">Failure groups</h2>
      {(data.groups?.length ?? 0) === 0
        ? <p className="eval-bt-muted">No grouped failures in the retained ledger.</p>
        : (
          <table className="eval-bt-table">
            <thead>
              <tr><th>Tool</th><th>Operation</th><th>Code</th><th>Count</th><th>Failure rate</th><th>Example</th></tr>
            </thead>
            <tbody>
              {data.groups!.map((g) => (
                <tr key={`${g.tool}-${g.operation}-${g.code}`}>
                  <td className="eval-bt-mono">{g.tool}</td>
                  <td>{g.operation}</td>
                  <td><span className="eval-bt-badge eval-bt-badge-kind">{g.code}</span></td>
                  <td>{g.count}</td>
                  <td>{pct(g.failureRate)}</td>
                  <td>
                    {g.examples[0] && (
                      <button type="button" className="eval-bt-btn eval-bt-btn-ghost" onClick={() => setSelectedId(g.examples[0])}>
                        {g.examples[0].slice(0, 8)}…
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <h2 className="eval-tools-heading">Review queue</h2>
      {(data.queue?.length ?? 0) === 0
        ? <p className="eval-bt-muted">No failures awaiting review (verified items are hidden).</p>
        : (
          <table className="eval-bt-table">
            <thead><tr><th>When</th><th>Tool</th><th>Code</th><th>Lifecycle</th><th /></tr></thead>
            <tbody>
              {data.queue!.map((row) => (
                <tr key={row.callId}>
                  <td className="eval-bt-mono">{fmtDate(row.at)}</td>
                  <td>{row.tool}</td>
                  <td>{row.code ?? '—'}</td>
                  <td>{row.lifecycle}</td>
                  <td>
                    <button type="button" className="eval-bt-btn eval-bt-btn-ghost" onClick={() => setSelectedId(row.callId)}>Detail</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <h2 className="eval-tools-heading">Scopes & description size</h2>
      <table className="eval-bt-table">
        <thead><tr><th>Tool</th><th>Operation</th><th>Attempts</th><th>Success</th><th>Failure</th><th>Desc bytes</th></tr></thead>
        <tbody>
          {(data.scopes ?? []).map((s) => (
            <tr key={JSON.stringify(s.scope)}>
              <td className="eval-bt-mono">{s.scope[0]}</td>
              <td>{s.scope[2] ?? s.scope[1]?.slice(0, 12)}</td>
              <td>{s.attempts}</td>
              <td>{pct(s.successRate)}</td>
              <td>{pct(s.failureRate)}</td>
              <td>{s.descriptionBytes}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="eval-tools-heading">Registered tools</h2>
      <table className="eval-bt-table">
        <thead><tr><th>Name</th><th>Version</th><th>Description bytes</th></tr></thead>
        <tbody>
          {(data.registeredTools ?? []).map((t) => (
            <tr key={t.name}><td className="eval-bt-mono">{t.name}</td><td>{t.version}</td><td>{t.descriptionBytes}</td></tr>
          ))}
        </tbody>
      </table>

      {selectedId && selected && (
        <section className="eval-tools-detail" aria-label="Call detail">
          <div className="eval-tools-detail-head">
            <h2 className="eval-tools-heading">Call {selectedId.slice(0, 8)}…</h2>
            <button type="button" className="eval-bt-btn eval-bt-btn-ghost" onClick={() => setSelectedId(null)}>Close</button>
          </div>
          <dl className="eval-tools-dl">
            <div><dt>Tool</dt><dd className="eval-bt-mono">{String(selected.tool ?? '—')}</dd></div>
            <div><dt>Operation</dt><dd>{String(selected.operation ?? '—')}</dd></div>
            <div><dt>Outcome</dt><dd>{String(selected.outcome ?? '—')}</dd></div>
            <div><dt>Error</dt><dd className="eval-bt-mono">{selected.finish?.error?.code ?? '—'}</dd></div>
            <div><dt>Review</dt><dd>{selected.review?.lifecycle ?? 'unreviewed'}</dd></div>
            {selected.review?.proposedFix && <div><dt>Proposed fix</dt><dd>{selected.review.proposedFix}</dd></div>}
            {selected.review?.retryCallId && <div><dt>Retry call</dt><dd className="eval-bt-mono">{selected.review.retryCallId}</dd></div>}
          </dl>
          {selected.finish?.error?.message && (
            <p className="eval-bt-mono eval-tools-error-msg">{selected.finish.error.message.slice(0, 500)}{selected.finish.error.message.length > 500 ? '…' : ''}</p>
          )}
          {artifacts.length > 0 && (
            <div className="eval-tools-artifacts">
              <span className="eval-tools-heading">Artifacts</span>
              {artifacts.map(path => (
                <button key={path} type="button" className="eval-bt-btn eval-bt-btn-ghost" onClick={() => openPath(path)}>{path.split('/').slice(-2).join('/')}</button>
              ))}
            </div>
          )}
          <div className="eval-tools-actions">
            <button type="button" className="eval-bt-btn" disabled={busy} aria-label="Mark call diagnosed"
              onClick={() => void setReview({ callId: selectedId, lifecycle: 'diagnosed' })}>Mark diagnosed</button>
            <button type="button" className="eval-bt-btn" disabled={busy} aria-label="Mark call regression added"
              onClick={() => void setReview({ callId: selectedId, lifecycle: 'regression_added' })}>Regression added</button>
            <button type="button" className="eval-bt-btn eval-bt-btn-primary" disabled={busy} aria-label="Mark call verified"
              onClick={() => void setReview({ callId: selectedId, lifecycle: 'verified' })}>Mark verified</button>
            {(data.retryCandidates?.length ?? 0) > 0 && (
              <label className="eval-tools-retry">
                Link retry
                <select disabled={busy} defaultValue="" onChange={ev => {
                  const retryCallId = ev.target.value
                  if (retryCallId) void setReview({ callId: selectedId, linkRetry: true, retryCallId })
                }}>
                  <option value="">Choose success…</option>
                  {data.retryCandidates!.map(row => (
                    <option key={row.callId} value={row.callId}>{row.tool} · {row.callId.slice(0, 8)}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="eval-bt-muted eval-tools-foot">Full redacted record lives in the ledger database above; open artifacts locally only.</p>
        </section>
      )}
        </>
      )}
    </div>
  )
}
