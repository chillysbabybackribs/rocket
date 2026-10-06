import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { parsePatch } from '../../../shared/patch.ts'
import { providerLabel } from '../../../shared/types.ts'
import { go } from '../app-map.ts'
import { cellOf, duration, shownRun } from '../eval-run.ts'
import { ShownChatContext } from '../pane.ts'
import { loadEvalChat, useApp } from '../store.ts'
import { Transcript } from './Transcript.tsx'

// One cell of a run: why it passed or failed, what it changed in its copy of the folder, and its
// turn in the same transcript the chat column draws, read-only and kept live while it runs.

export function EvalRunView() {
  const shown = useApp((state) => state.evals.cell)
  const run = useApp(shownRun)
  const cell = shown ? cellOf(run, shown.provider, shown.trial) : null
  const chatId = cell?.chatId ?? null
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    setLoadError(null)
    if (chatId) loadEvalChat(chatId).catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)))
  }, [chatId])
  const files = useMemo(() => parsePatch(cell?.patch ?? ''), [cell?.patch])
  if (!run || !cell || !shown) return <p className="ev-muted">That run is no longer saved. Go back to the scenario to pick another.</p>

  const failed = cell.status === 'error' || (cell.status === 'done' && !cell.pass)
  const title = `${providerLabel(cell.provider)} · ${cell.model ?? 'default model'} · trial ${cell.trial + 1}`
  return (
    <>
      <nav className="ev-crumb" aria-label="Breadcrumb">
        <button type="button" onClick={() => void go('evals.scenario', { id: run.scenarioId, run: run.id })}><ChevronLeft size={12} aria-hidden />{run.scenarioId}</button>
        <ChevronRight size={12} aria-hidden />
        <b>{providerLabel(cell.provider)} · trial {cell.trial + 1}</b>
      </nav>
      <div className="ev-title-row">
        <h1 className="ev-title ev-title-icon">
          {cell.status === 'done' && cell.pass ? <Check size={16} className="ev-ok" aria-hidden /> : failed ? <X size={16} className="ev-bad" aria-hidden /> : cell.status === 'running' ? <span className="ev-spin" aria-hidden /> : null}
          {title}
        </h1>
      </div>

      <div className="ev-detail">
        <div className="ev-side">
          <section className="ev-box" aria-label="Graders">
            <h3>Graders</h3>
            {cell.grades.length === 0 && <p className="ev-faint ev-small">{cell.status === 'done' ? 'No graders.' : 'Graded when the turn ends.'}</p>}
            {cell.grades.map((grade) => (
              <div key={grade.name} className="ev-grade">
                {grade.pass ? <Check size={14} className="ev-ok" aria-hidden /> : <X size={14} className="ev-bad" aria-hidden />}
                <div>{grade.name}{grade.reason && <div className="ev-why">{grade.reason}</div>}</div>
              </div>
            ))}
          </section>
          <section className="ev-box" aria-label="Turn">
            <h3>Turn</h3>
            <dl className="ev-kv">
              <dt>Status</dt><dd>{cell.status}</dd>
              <dt>Time</dt><dd>{duration(cell.startedAt && cell.endedAt ? cell.endedAt - cell.startedAt : null)}</dd>
            </dl>
            {cell.error && <p className="eval-error ev-small">{cell.error}</p>}
          </section>
          <section className="ev-box" aria-label="Files changed">
            <h3>Files changed</h3>
            {cell.status !== 'done' ? <p className="ev-faint ev-small">Compared with the original when the turn ends.</p>
              : files.length === 0 ? <p className="ev-faint ev-small">None.</p>
                : files.map((file) => (
                  <div key={file.path} className="ev-file">
                    <div className="ev-file-head"><span className="ev-mono">{file.path}</span><span className="ev-spacer" /><span className="ev-mono"><span className="ev-add">+{file.added}</span> <span className="ev-del">−{file.removed}</span></span></div>
                    <div className="ev-diff">
                      {file.hunks.flatMap((hunk) => hunk.lines).slice(0, 80).map((line, index) => (
                        <span key={index} className={line.type === '+' ? 'ev-add' : line.type === '-' ? 'ev-del' : undefined}>{line.type === '+' ? '+ ' : line.type === '-' ? '− ' : '  '}{line.text}</span>
                      ))}
                    </div>
                  </div>
                ))}
          </section>
        </div>
        <div className="ev-transcript">
          {loadError ? <p className="eval-error">{loadError}</p>
            : chatId
              ? <ShownChatContext.Provider value={chatId}><Transcript /></ShownChatContext.Provider>
              : <p className="ev-muted">{cell.status === 'queued' ? 'Waiting for its turn: one cell per provider runs at a time.' : 'This cell never started.'}</p>}
        </div>
      </div>
    </>
  )
}
