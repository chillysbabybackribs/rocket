import { useCallback, useEffect, useState } from 'react'
import type { HostApi } from '../../../shared/types.ts'
import { call } from '../host.ts'

type PanelData = HostApi['toolLedger.loadPanel'][1]
type CallDetail = HostApi['toolLedger.callDetail'][1]

const pct = (n: number | null | undefined): string => (n == null ? '—' : `${Math.round(n * 100)}%`)
const fmtDate = (ms: number): string => new Date(ms).toLocaleString()

export function EvalToolsPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<PanelData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CallDetail | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setData(await call('toolLedger.loadPanel', {}))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => { void load() }, [load, refreshKey])

  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    void call('toolLedger.callDetail', { callId: selectedId }).then(setDetail).catch(() => setDetail(null))
  }, [selectedId])

  if (error) return <p className="eval-error">{error}</p>
  if (!data) return <p className="eval-bt-muted">Loading tool ledger…</p>
  if (!data.available) return <p className="eval-bt-muted">{data.message ?? 'Ledger unavailable.'}</p>

  const policy = data.contextPolicy ?? {}

  return (
    <div className="eval-tools">
      <p className="eval-bt-muted">
        Rocket MCP tool health for agents — same data as <span className="eval-bt-mono">rocket_tool_history</span>.
        History is <strong>not</strong> injected into chat prompts.
      </p>

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
          <div className="eval-bt-metric-value">{data.queue?.length ?? 0}</div>
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
        ? <p className="eval-bt-muted">No grouped failures in the current window.</p>
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

      {selectedId && detail?.calls?.[0] && (
        <section className="eval-tools-detail" aria-label="Call detail">
          <div className="eval-tools-detail-head">
            <h2 className="eval-tools-heading">Call {selectedId.slice(0, 8)}…</h2>
            <button type="button" className="eval-bt-btn eval-bt-btn-ghost" onClick={() => setSelectedId(null)}>Close</button>
          </div>
          <pre className="eval-bt-mono eval-tools-pre">{JSON.stringify(detail.calls[0], null, 2)}</pre>
        </section>
      )}
    </div>
  )
}
