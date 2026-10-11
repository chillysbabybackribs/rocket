import { useEffect, useRef, useState } from 'react'
import { RotateCw, X } from 'lucide-react'
import type { PhotocraftState } from '../../../shared/types.ts'
import { setPhotocraftOpen } from '../store.ts'
import { useImagePreviewOpen } from './Attachments.tsx'

// The UI's half of PhotoCraft beside the chat: a header, and an empty box whose position is
// reported to main, which lays PhotoCraft's view (a native surface, src/main/photocraft-pane.ts)
// exactly over it, as the browser does its pages. Nothing is drawn across that box. When the
// build is missing or PhotoCraft stopped, the view is kept out of sight and the box says what to
// do instead.

const send = window.rocket.photocraft.send
const START: PhotocraftState = { status: 'off', message: null, title: null }

const STATUS: Record<PhotocraftState['status'], string> = {
  off: 'Starting',
  loading: 'Loading',
  ready: '',
  missing: 'Not built',
  failed: 'Stopped'
}

export function PhotocraftPanel() {
  const [state, setState] = useState(START)
  const stage = useRef<HTMLDivElement>(null)
  const imagePreview = useImagePreviewOpen()
  // The editor is a native view over the window; while a dialog is open it is hidden, not covered.
  const covered = imagePreview
  const showsView = state.status === 'loading' || state.status === 'ready'

  useEffect(() => {
    const off = window.rocket.photocraft.onState(setState)
    send({ type: 'sync' })
    return off
  }, [])

  useEffect(() => {
    const element = stage.current
    if (!element) return
    const report = (): void => {
      if (covered || !showsView) return send({ type: 'setBounds', bounds: null })
      const box = element.getBoundingClientRect()
      send({ type: 'setBounds', bounds: { x: box.left, y: box.top, width: box.width, height: box.height } })
    }
    const observer = new ResizeObserver(report)
    observer.observe(element)
    window.addEventListener('resize', report)
    report()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
      send({ type: 'setBounds', bounds: null })
    }
  }, [covered, showsView])

  const status = STATUS[state.status]
  return (
    <section className="photocraft" aria-label="PhotoCraft">
      <header className="pc-head">
        <span className="pc-mark" aria-hidden />
        <span className="pc-name">PhotoCraft</span>
        {state.title && <span className="pc-title">{state.title}</span>}
        {status && <span className={`pc-status is-${state.status}`}>{status}</span>}
        <span className="pc-grow" />
        <button type="button" className="icon-button" aria-label="Reload PhotoCraft" title="Reload PhotoCraft" onClick={() => send({ type: 'reload' })}>
          <RotateCw size={14} />
        </button>
        <button type="button" className="icon-button" aria-label="Close PhotoCraft" title="Close PhotoCraft" onClick={() => setPhotocraftOpen(false)}>
          <X size={14} />
        </button>
      </header>
      <div className="pc-stage" ref={stage}>
        {!showsView && state.message && <p className="pc-message" role="status">{state.message}</p>}
      </div>
    </section>
  )
}
