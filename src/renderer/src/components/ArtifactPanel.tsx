import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { closeArtifact, useApp } from '../store.ts'
import { ChatMarkdown } from './ChatMarkdown.tsx'
import { ChangesView, Counts } from './ChangesView.tsx'

// The panel beside the chat: a file a link opened (Markdown rendered, anything else as source
// with a highlighted line), or what a turn changed, as a diff.

export function ArtifactPanel() {
  const artifact = useApp((state) => state.artifact)
  const turn = useApp((state) => (artifact?.kind === 'changes' ? state.turns.find((entry) => entry.id === artifact.turnId) ?? null : null))
  const selected = useRef<HTMLSpanElement>(null)
  useEffect(() => { selected.current?.scrollIntoView({ block: 'center' }) }, [artifact])
  if (!artifact) return null
  if (artifact.kind === 'changes') {
    const changes = turn?.changes
    return (
      <section className="artifact" aria-label="Turn changes">
        <header className="artifact-head">
          <span>
            Changes
            {changes && <span className="artifact-sub">this turn · {changes.files} {changes.files === 1 ? 'file' : 'files'} · <Counts added={changes.added} removed={changes.removed} /></span>}
          </span>
          <button type="button" className="icon-button" aria-label="Close artifact" onClick={closeArtifact}><X size={15} /></button>
        </header>
        <ChangesView patch={artifact.patch} />
      </section>
    )
  }
  const cwd = artifact.path.slice(0, artifact.path.lastIndexOf('/')) || '/'
  return (
    <section className="artifact" aria-label="Artifact preview">
      <header className="artifact-head">
        <span title={artifact.path}>{artifact.path.split('/').pop()}</span>
        <button type="button" className="icon-button" aria-label="Close artifact" onClick={closeArtifact}><X size={15} /></button>
      </header>
      <div className="artifact-path">{artifact.path}</div>
      <div className="artifact-content">
        {artifact.markdown && !artifact.line ? <div className="prose"><ChatMarkdown text={artifact.text} cwd={cwd} /></div> : (
          <pre className="artifact-source"><code>{artifact.text.split('\n').map((line, index) => (
            <span key={index} ref={index + 1 === artifact.line ? selected : undefined} className={index + 1 === artifact.line ? 'is-selected' : ''}>
              <span className="artifact-line" aria-hidden="true">{index + 1}</span>{line}
            </span>
          ))}</code></pre>
        )}
      </div>
    </section>
  )
}
