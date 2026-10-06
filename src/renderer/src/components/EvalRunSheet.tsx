import { useEffect, useMemo, useState } from 'react'
import { providerLabel, type ProviderId } from '../../../shared/types.ts'
import { call } from '../host.ts'
import { runScenarioCell } from '../eval-run.ts'
import { openChat } from '../store.ts'

type Scenario = {
  id: string
  message: string
  openGoal: boolean
  graders: string[]
  trials: number
  matrix: Array<{ provider: ProviderId; model: string | null }>
}

type Phase = 'idle' | 'running' | 'done' | 'error'

type Props = {
  open: boolean
  onClose: () => void
  initialScenarioId?: string
  initialProvider?: ProviderId
  initialTrial?: number
  onFinished?: () => void
}

export function EvalRunSheet({ open, onClose, initialScenarioId, initialProvider, initialTrial, onFinished }: Props) {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [scenarioId, setScenarioId] = useState('')
  const [provider, setProvider] = useState<ProviderId>('claude')
  const [trial, setTrial] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [focusChatId, setFocusChatId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [grade, setGrade] = useState<{ allPass: boolean; rows: Array<{ name: string; pass: boolean; reason?: string }> } | null>(null)

  const scenario = useMemo(() => scenarios.find((row) => row.id === scenarioId) ?? null, [scenarios, scenarioId])

  useEffect(() => {
    if (!open) return
    void call('eval.listScenarios', {}).then((data) => {
      setScenarios(data.scenarios)
      const pick = initialScenarioId && data.scenarios.some((s) => s.id === initialScenarioId)
        ? initialScenarioId
        : data.scenarios[0]?.id ?? ''
      setScenarioId(pick)
    }).catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [open, initialScenarioId])

  useEffect(() => {
    if (!open) return
    if (initialProvider) setProvider(initialProvider)
    if (initialTrial != null) setTrial(initialTrial)
    setPhase('idle')
    setFocusChatId(null)
    setGrade(null)
    setError(null)
  }, [open, initialProvider, initialTrial])

  useEffect(() => {
    if (!scenario?.matrix.some((cell) => cell.provider === provider)) {
      setProvider(scenario?.matrix[0]?.provider ?? initialProvider ?? 'claude')
    }
  }, [scenario, provider, initialProvider])

  const run = async (): Promise<void> => {
    if (!scenario) return
    setError(null)
    setGrade(null)
    setPhase('running')
    try {
      const result = await runScenarioCell({ scenarioId: scenario.id, provider, trial })
      setFocusChatId(result.chatId)
      setGrade({ allPass: result.allPass, rows: result.grades })
      setPhase('done')
      onFinished?.()
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!open) return null

  const statusText = (() => {
    if (phase === 'idle') return 'Run one matrix cell. The eval chat opens in the center column so you can watch the turn live.'
    if (phase === 'running') return `Running · ${providerLabel(provider)} — watch the chat column.`
    if (phase === 'done') return grade?.allPass ? 'All graders passed.' : 'Some graders failed.'
    return error ?? 'Something went wrong.'
  })()

  return (
    <div className="eval-run-sheet" role="dialog" aria-label="Run experiment cell">
      <div className="eval-run-sheet-head">
        <strong>Run cell</strong>
        <button type="button" className="text-button" onClick={onClose}>Close</button>
      </div>
      <p className="eval-status" role="status">{statusText}</p>
      {error && phase === 'error' && <p className="eval-error">{error}</p>}

      <label className="eval-field">
        <span>Scenario</span>
        <select value={scenarioId} disabled={phase === 'running'} onChange={(event) => setScenarioId(event.target.value)}>
          {scenarios.map((row) => <option key={row.id} value={row.id}>{row.id}</option>)}
        </select>
      </label>

      <label className="eval-field">
        <span>Provider</span>
        <select value={provider} disabled={!scenario || phase === 'running'} onChange={(event) => setProvider(event.target.value as ProviderId)}>
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
          onChange={(event) => setTrial(Number(event.target.value))}
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
          onClick={() => void run()}
        >
          {phase === 'running' ? 'Running…' : 'Run'}
        </button>
        {focusChatId && (
          <button type="button" className="text-button" onClick={() => void openChat(focusChatId)}>Focus eval chat</button>
        )}
      </div>

      {grade && (
        <ul className="eval-grades">
          {grade.rows.map((row) => (
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
