import { useEffect, useMemo, useState } from 'react'
import { providerLabel, type ProviderId } from '../../../shared/types.ts'
import { call } from '../host.ts'
import { openChat, useApp, viewOf } from '../store.ts'

type Scenario = {
  id: string
  message: string
  openGoal: boolean
  graders: string[]
  trials: number
  matrix: Array<{ provider: ProviderId; model: string | null }>
}

type ActiveRun = {
  chatId: string
  turnId: string
  cellDir: string
  graders: string[]
  provider: ProviderId
}

type Phase = 'idle' | 'running' | 'grading' | 'done' | 'error'

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
  const [active, setActive] = useState<ActiveRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [grade, setGrade] = useState<{ allPass: boolean; rows: Array<{ name: string; pass: boolean; reason?: string }> } | null>(null)

  const scenario = useMemo(() => scenarios.find((row) => row.id === scenarioId) ?? null, [scenarios, scenarioId])
  const turn = useApp((state) => (active ? viewOf(state, active.chatId).turns.find((row) => row.id === active.turnId) ?? null : null))
  const running = useApp((state) => (active ? state.running.has(active.chatId) : false))

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
    setActive(null)
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
      const started = await call('eval.startScenarioCell', {
        scenarioId: scenario.id,
        provider,
        model: scenario.matrix.find((cell) => cell.provider === provider)?.model ?? null,
        trial,
        timeoutMs: 600_000
      })
      setActive({
        chatId: started.chatId,
        turnId: started.turnId,
        cellDir: started.cellDir,
        graders: started.graders,
        provider: started.provider
      })
      await openChat(started.chatId)
      setPhase('grading')
      const finished = await call('eval.finishScenarioCell', {
        chatId: started.chatId,
        turnId: started.turnId,
        cellDir: started.cellDir,
        graders: started.graders,
        timeoutMs: 600_000
      })
      setGrade({
        allPass: finished.graders.allPass,
        rows: Object.entries(finished.graders.graders).map(([name, row]) => ({
          name,
          pass: row.pass,
          reason: typeof row.metadata?.reason === 'string' ? row.metadata.reason : undefined
        }))
      })
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
    if (phase === 'running') return 'Starting turn…'
    if (phase === 'grading' && running) return `Turn in flight · ${providerLabel(active?.provider ?? provider)}`
    if (phase === 'grading' && turn?.status === 'running') return 'Waiting for provider…'
    if (phase === 'grading') return 'Exporting and grading…'
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
        <select value={scenarioId} disabled={phase === 'running' || phase === 'grading'} onChange={(event) => setScenarioId(event.target.value)}>
          {scenarios.map((row) => <option key={row.id} value={row.id}>{row.id}</option>)}
        </select>
      </label>

      <label className="eval-field">
        <span>Provider</span>
        <select value={provider} disabled={!scenario || phase === 'running' || phase === 'grading'} onChange={(event) => setProvider(event.target.value as ProviderId)}>
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
          disabled={!scenario || phase === 'running' || phase === 'grading'}
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
          disabled={!scenario || phase === 'running' || phase === 'grading'}
          onClick={() => void run()}
        >
          {phase === 'running' || phase === 'grading' ? 'Running…' : 'Run'}
        </button>
        {active && (
          <button type="button" className="text-button" onClick={() => void openChat(active.chatId)}>Focus eval chat</button>
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
