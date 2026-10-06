import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { closeArtifact, undoTurn, useApp, viewOf } from '../store.ts'
import { ChatMarkdown } from './ChatMarkdown.tsx'
import { parsePatch } from '../../../shared/patch.ts'
import { ChangesView, Counts } from './ChangesView.tsx'
import { FileMark, fileMeta } from './Attachments.tsx'

// The panel beside the chat: a file a link opened (Markdown rendered, anything else as source
// with a highlighted line), an attached PDF or text file, or what a turn changed, as a diff.

/**
 * Undo in the panel's header: offered as a quiet button; undone, a word in its place; not
 * possible, a grey note saying why, so the user knows what to look at. Never while the chat is
 * answering. The question itself is a strip under the header (`UndoConfirm`).
 */
function UndoControl({ undo, undone, running, asking, onAsk }: { undo: { offered: boolean; reason: string | null }; undone: boolean; running: boolean; asking: boolean; onAsk: () => void }) {
  if (undone) return <span className="undo-note is-done">Undone</span>
  if (running) return <span className="undo-note">Undo waits for the turn</span>
  if (!undo.offered) return <span className="undo-note" title={undo.reason ?? undefined}>Undo not offered: {undo.reason}</span>
  if (asking) return <span className="undo-note">Undo this turn</span>
  return <button type="button" className="text-button" onClick={onAsk}>Undo this turn</button>
}

/** One question, with the files named, and nothing happens until Undo. */
function UndoConfirm({ chatId, turnId, paths, onDone }: { chatId: string; turnId: string; paths: string[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const named = paths.length <= 3 ? paths : [...paths.slice(0, 2), `${paths.length - 2} more files`]
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`
  return (
    <div className="undo-confirm" role="alertdialog" aria-label="Undo this turn">
      <span>Put <b>{list}</b> back as they were before this turn? The turn's reply and steps stay in the chat.</span>
      <span className="undo-actions">
        <button type="button" className="gp-button" disabled={busy} onClick={onDone}>Keep</button>
        <button type="button" className="gp-button is-danger" disabled={busy} onClick={async () => { setBusy(true); await undoTurn(chatId, turnId); setBusy(false); onDone() }}>Undo</button>
      </span>
    </div>
  )
}

export function ArtifactPanel() {
  const artifact = useApp((state) => state.artifact)
  const turn = useApp((state) => (artifact?.kind === 'changes' ? viewOf(state, artifact.chatId).turns.find((entry) => entry.id === artifact.turnId) ?? null : null))
  const running = useApp((state) => (artifact?.kind === 'changes' ? state.running.has(artifact.chatId) : false))
  const selected = useRef<HTMLSpanElement>(null)
  const [asking, setAsking] = useState(false)
  useEffect(() => { selected.current?.scrollIntoView({ block: 'center' }) }, [artifact])
  useEffect(() => { setAsking(false) }, [artifact?.kind === 'changes' ? artifact.turnId : null])
  if (!artifact) return null
  if (artifact.kind === 'changes') {
    const changes = turn?.changes
    const undone = changes?.undone === true
    const paths = parsePatch(artifact.patch.patch).map((file) => file.path)
    return (
      <section className={`artifact${undone ? ' is-undone' : ''}`} aria-label="Turn changes">
        <header className="artifact-head">
          <span>
            Changes
            {changes && <span className="artifact-sub">this turn · {changes.files} {changes.files === 1 ? 'file' : 'files'} · <Counts added={changes.added} removed={changes.removed} /></span>}
          </span>
          <span className="artifact-actions">
            <UndoControl undo={artifact.patch.undo} undone={undone} running={running} asking={asking} onAsk={() => setAsking(true)} />
            <button type="button" className="icon-button" aria-label="Close artifact" onClick={closeArtifact}><X size={15} /></button>
          </span>
        </header>
        {asking && !undone && <UndoConfirm chatId={artifact.chatId} turnId={artifact.turnId} paths={paths} onDone={() => setAsking(false)} />}
        {undone && <p className="undo-strip">These changes were undone. The diff is kept for the record; the files are as they were before the turn.</p>}
        <ChangesView patch={artifact.patch} />
      </section>
    )
  }
  if (artifact.kind === 'attachment') {
    const { attachment: file, preview, error } = artifact
    const scanned = file.format === 'pdf' && !file.chars
    return (
      <section className="artifact" aria-label="File preview">
        <header className="artifact-head">
          <span className="attachment-title" title={file.name}><FileMark file={file} small /><span>{file.name}</span></span>
          <button type="button" className="icon-button" aria-label="Close artifact" onClick={closeArtifact}><X size={15} /></button>
        </header>
        <div className="artifact-path">{fileMeta(file)} · {error ? 'Preview unavailable' : 'Preview'}</div>
        <div className="artifact-content attachment-preview">
          {error ? <div className="attachment-error" role="alert">{error}</div>
            : !preview ? <p className="attachment-loading">Loading preview…</p>
            : preview.type === 'text' ? <pre className="artifact-source attachment-text">{preview.text}</pre>
            : preview.pages.map((page, index) => <img key={index} className="attachment-page" src={page} alt={`Page ${index + 1} of ${file.name}`} />)}
          {scanned && !error && <p className="attachment-note">No text could be read from this PDF; it may be scanned. Models are given the file to open with their own tools.</p>}
        </div>
        <div className="attachment-foot">
          {preview?.truncated ? (preview.type === 'pdf' ? `Showing the first ${preview.pages.length} of ${file.pages} pages · ` : 'Showing the start of the file · ') : ''}
          Original file retained · text is never executed
        </div>
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
