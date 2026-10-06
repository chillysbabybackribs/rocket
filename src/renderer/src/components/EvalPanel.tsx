import { EvalDashboard } from './EvalDashboard.tsx'

/** Braintrust-style eval dashboard beside the chat (Experiments, Datasets, live Run cell). */
export function EvalPanel() {
  return (
    <aside className="eval-panel" aria-label="Evals">
      <EvalDashboard />
    </aside>
  )
}
