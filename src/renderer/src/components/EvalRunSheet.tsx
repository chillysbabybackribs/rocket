import { useEffect, useMemo, useState } from 'react'
import { providerLabel, type ProviderId } from '../../../shared/types.ts'
import { act } from '../app-map.ts'
import { call } from '../host.ts'
import type { Scenario } from '../eval-run.ts'
import { openChat, patchRunSheet, useApp } from '../store.ts'

// The Run cell sheet shows the store's `evals.runSheet`; opening, choosing and running go through
// the app map, so a model's `evals.runSheet.run` and the Run button are the same call.

export function EvalRunSheet() {
  const sheet = useApp((state) => state.evals.runSheet)
  const { open, scenarioId, provider, trial, phase, chatId, error, grades } = sheet
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const scenario = useMemo(() => scenarios.find((row) => row.id === scenarioId) ?? null, [scenarios, scenarioId])

  useEffect(() => {
    if (!open) return
    void call('eval.listScenarios', {}).then((data) => setScenarios(data.scenarios))
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
  }, [open])

  if (!open) return null

  const statusText = (() => {
    if (phase === 'idle') return 'Run one matrix cell. The eval chat opens in the center column so you can watch the turn live.'
    if (phase === 'running') return `Running · ${providerLabel(provider)} — watch the chat column.`
    if (phase === 'done') return grades?.every((row) => row.pass) ? 'All graders passed.' : 'Some graders failed.'
    return error ?? 'Something went wrong.'
  })()

  return (
    <div className="eval-run-sheet" role="dialog" aria-label="Run experiment cell">
      <div className="eval-run-sheet-head">
        <strong>Run cell</strong>
        <button type="button" className="text-button" onClick={() => void act('evals.runSheet.close')}>Close</button>
      </div>
      <p className="eval-status" role="status">{statusText}</p>
      {(loadError || (error && phase === 'error')) && <p className="eval-error">{loadError ?? error}</p>}

      <label className="eval-field">
        <span>Scenario</span>
        <select value={scenarioId} disabled={phase === 'running'} onChange={(event) => void act('evals.runSheet.open', { scenario: event.target.value })}>
          {scenarios.map((row) => <option key={row.id} value={row.id}>{row.id}</option>)}
        </select>
      </label>

      <label className="eval-field">
        <span>Provider</span>
        <select value={provider} disabled={!scenario || phase === 'running'} onChange={(event) => patchRunSheet({ provider: event.target.value as ProviderId })}>
          {(scenario?.matrix ?? []).map((cell) => (
            <option key={cell.provider} value={cell.provider}>{providerLabel(cell.provider)}</option>
          ))}
        </select>
      </label>

      <label className="eval-field">
        <span>Trial</span>
        <input
          type="number"
          min={0}
          max={Math.max(0, (scenario?.trials ?? 1) - 1)}
          value={trial}
          disabled={!scenario || phase === 'running'}
          onChange={(event) => patchRunSheet({ trial: Number(event.target.value) })}
        />
      </label>

      {scenario && (
        <details className="eval-prompt">
          <summary>Message</summary>
          <p>{scenario.message}</p>
          {scenario.openGoal && <p className="eval-note">Uses goal draft (openGoal).</p>}
        </details>
      )}

      <div className="eval-run-sheet-actions">
        <button
          type="button"
          className="eval-run"
          disabled={!scenario || phase === 'running'}
          onClick={() => void act('evals.runSheet.run')}
        >
          {phase === 'running' ? 'Running…' : 'Run'}
        </button>
        {chatId && (
          <button type="button" className="text-button" onClick={() => void openChat(chatId)}>Focus eval chat</button>
        )}
      </div>

      {grades && (
        <ul className="eval-grades">
          {grades.map((row) => (
            <li key={row.name} className={row.pass ? 'is-pass' : 'is-fail'}>
              <span>{row.pass ? '✓' : '✗'} {row.name}</span>
              {row.reason && <span className="eval-grade-reason">{row.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
