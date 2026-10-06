import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { setEvalsOpen } from '../store.ts'

/** Braintrust-style eval dashboard (local mock UI) in the chat's side column. */
export function EvalPanel() {
  const [src, setSrc] = useState<string | null>(null)
  const [key, setKey] = useState(0)

  useEffect(() => {
    let alive = true
    void window.rocket.evalPanelUrl().then((url) => {
      if (alive) setSrc(`${url}?v=${Date.now()}`)
    })
    return () => { alive = false }
  }, [key])

  return (
    <aside className="browser eval-panel" aria-label="Evals">
      <div className="browser-frame eval-shell">
        <header className="eval-head">
          <span className="eval-title">Evals</span>
          <span className="eval-head-actions">
            <button
              type="button"
              className="icon-button"
              title="Reload eval data"
              aria-label="Reload eval panel"
              onClick={() => setKey((value) => value + 1)}
            >
              <RefreshCw size={15} />
            </button>
            <button type="button" className="icon-button" aria-label="Close eval panel" onClick={() => setEvalsOpen(false)}>
              <X size={15} />
            </button>
          </span>
        </header>
        <div className="browser-stage eval-stage">
        {src
          ? <iframe key={key} className="eval-frame" title="Rocket eval dashboard" src={src} />
          : <p className="eval-loading">Loading eval panel…</p>}
        </div>
      </div>
    </aside>
  )
}
