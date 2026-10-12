import { addDraftFiles, ATTACHMENT_DRAG_TYPE, updateDraft } from './drafts.ts'
import './images.css'
import './library.css'
import { useEffect, useRef, useState } from 'react'
import { Images, X } from 'lucide-react'
import { act } from './app-map.ts'
import { PaneContext, usePane, usePaneChatId, usePaneView } from './pane.ts'
import { dismissError, focusedChatId, paneAt, setBrowserWidth, setSideWidth, useApp } from './store.ts'
import { ArtifactPanel } from './components/ArtifactPanel.tsx'
import { AttachmentNotice, copyTo } from './components/AttachmentMenu.tsx'
import { BrowserPanel } from './components/BrowserPanel.tsx'
import { LibraryPanel } from './components/LibraryPanel.tsx'
import { Composer } from './components/Composer.tsx'
import { PlanDrawer } from './components/PlanDrawer.tsx'
import { TitleStrip } from './components/TitleStrip.tsx'
import { Transcript } from './components/Transcript.tsx'

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Still up?'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

const SIDE_MIN = 320
const CHAT_MIN = 300

/** The chat with a side panel (plan drawer), split with a draggable divider. */
function Split({ side, children }: { side: React.ReactNode; children: React.ReactNode }) {
  const width = useApp((state) => state.sideWidth)
  const alone = useApp((state) => state.panes.length === 1)
  const split = useRef<HTMLDivElement>(null)
  const shown = alone ? side : null

  const drag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('is-dragging')
    let last = width
    const move = (moved: PointerEvent): void => {
      const box = split.current!.getBoundingClientRect()
      last = Math.round(Math.max(SIDE_MIN, Math.min(box.width - CHAT_MIN, box.right - moved.clientX)))
      setSideWidth(last, false)
    }
    const up = (): void => {
      handle.classList.remove('is-dragging')
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      setSideWidth(last, true)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }

  return (
    <div ref={split} className={`pane-split${shown ? ' is-split' : ''}`} style={{ '--side-width': `${width}px` } as React.CSSProperties}>
      <div className="goal-chat">{children}</div>
      {shown && (
        <>
          <div className="goal-divider" role="separator" aria-orientation="vertical" aria-label="Resize the side pane" onPointerDown={drag} />
          {shown}
        </>
      )}
    </div>
  )
}

const CHAT_PANEL_MIN = 380
const CHAT_PANEL_SIDE_MIN = 640
const BROWSER_PANEL_MIN = 360
const APP_GAP = 8

function AppDivider({ appRef }: { appRef: React.RefObject<HTMLDivElement | null> }) {
  const browserWidth = useApp((state) => state.browserWidth)
  const hasSide = useApp((state) => {
    if (state.panes.length !== 1) return false
    const chatId = focusedChatId(state)
    return chatId !== null && state.views[chatId]?.planTurnId != null
  })
  const drag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('is-dragging')
    document.body.classList.add('is-resizing')

    const appEl = appRef.current
    const appBox = appEl ? appEl.getBoundingClientRect() : { width: window.innerWidth, right: window.innerWidth }
    const chatMin = hasSide ? CHAT_PANEL_SIDE_MIN : CHAT_PANEL_MIN
    const sideMin = BROWSER_PANEL_MIN
    const totalAvailable = appBox.width - APP_GAP * 2 - APP_GAP
    const maxSide = Math.max(sideMin, totalAvailable - chatMin)

    let last = browserWidth ?? Math.round(appBox.right - APP_GAP - event.clientX - APP_GAP / 2)

    const move = (moved: PointerEvent): void => {
      const target = appBox.right - APP_GAP - moved.clientX - Math.round(APP_GAP / 2)
      last = Math.round(Math.max(sideMin, Math.min(maxSide, target)))
      setBrowserWidth(last, false)
    }

    const up = (ended: PointerEvent): void => {
      handle.classList.remove('is-dragging')
      document.body.classList.remove('is-resizing')
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      try {
        handle.releasePointerCapture(ended.pointerId)
      } catch {
        // Pointer capture may have already ended
      }
      setBrowserWidth(last, true)
    }

    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  const reset = (): void => {
    setBrowserWidth(null, true)
  }

  return (
    <div
      className="app-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat and browser panes"
      title="Drag to resize · Double-click to reset"
      tabIndex={0}
      onPointerDown={drag}
      onDoubleClick={reset}
      onKeyDown={(event) => {
        const appEl = appRef.current
        const appBox = appEl ? appEl.getBoundingClientRect() : { width: window.innerWidth, right: window.innerWidth }
        const chatMin = hasSide ? CHAT_PANEL_SIDE_MIN : CHAT_PANEL_MIN
        const sideMin = BROWSER_PANEL_MIN
        const totalAvailable = appBox.width - APP_GAP * 2 - APP_GAP
        const maxSide = Math.max(sideMin, totalAvailable - chatMin)
        const current = browserWidth ?? (event.currentTarget.nextElementSibling ? Math.round(event.currentTarget.nextElementSibling.getBoundingClientRect().width) : Math.round(totalAvailable * 0.5))

        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          const next = Math.round(Math.max(sideMin, Math.min(maxSide, current + 20)))
          setBrowserWidth(next, true)
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          const next = Math.round(Math.max(sideMin, Math.min(maxSide, current - 20)))
          setBrowserWidth(next, true)
        } else if (event.key === 'Home' || event.key === 'Enter') {
          event.preventDefault()
          reset()
        }
      }}
    />
  )
}

function ChatPane() {
  const pane = usePane()
  const chatId = usePaneChatId()
  const paneKey = useApp(state => paneAt(state, pane).key)
  const draftKey = chatId ?? `new:${paneKey}`
  const [dropping, setDropping] = useState<false | 'copy' | 'files'>(false)
  const chat = useApp((state) => state.chats.find((entry) => entry.id === chatId) ?? null)
  const hasTurns = usePaneView((view) => view.turns.length > 0)
  const planTurn = usePaneView((view) => view.turns.find((turn) => turn.id === view.planTurnId) ?? null)
  const planUserId = usePaneView((view) => (view.planTurnId ? view.turnItems[view.planTurnId]?.[0] : undefined))
  const focused = useApp((state) => state.focused === pane)
  const empty = !chat || !hasTurns
  const focus = (): void => { void act('pane.focus', { pane }) }

  let body: React.ReactNode
  if (empty) {
    body = (
      <div className="welcome">
        <h1 className="welcome-title">{greeting()}</h1>
        <Composer key={chatId ?? 'new'} placeholder="How can I help you today?" />
        <p className="welcome-hint">Pick a provider and model for each message. They all share the conversation.</p>
      </div>
    )
  } else {
    const composer = (
      <div className="composer-dock">
        <Composer key={chatId ?? 'new'} placeholder="Reply…" />
      </div>
    )
    body = planTurn
      ? (
        <Split side={<PlanDrawer turn={planTurn} userItemId={planUserId} />}>
          <Transcript />
          {composer}
        </Split>
      )
      : (
        <>
          <Transcript />
          {composer}
        </>
      )
  }
  return (
    <section data-pane-index={usePane()} className={`pane${empty ? ' is-empty' : ''}${focused ? ' is-focused' : ''}`} aria-label={chat?.title ?? 'New chat'} onPointerDownCapture={focus} onFocusCapture={focus}
      onDragOver={event => {
        if (event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes(ATTACHMENT_DRAG_TYPE)) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDropping(event.dataTransfer.types.includes(ATTACHMENT_DRAG_TYPE) ? 'copy' : 'files')
        }
      }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false) }}
      onDrop={event => {
        if (!event.dataTransfer.types.includes('Files') && !event.dataTransfer.types.includes(ATTACHMENT_DRAG_TYPE)) return
        event.preventDefault()
        setDropping(false)
        focus()
        const existing = event.dataTransfer.getData(ATTACHMENT_DRAG_TYPE)
        if (existing) {
          try { copyTo(JSON.parse(existing), draftKey, chat?.title ?? 'the new chat') } catch { updateDraft(draftKey, { error: 'This attachment could not be added. Choose the file again.' }) }
        } else addDraftFiles(draftKey, Array.from(event.dataTransfer.files))
      }}>
      {body}
      {dropping && (
        <div className="image-drop-target">
          <Images size={30} />
          <strong>{dropping === 'copy' ? `Copy to ${chat?.title ?? 'this new chat'}` : 'Add files to this chat'}</strong>
          <span>{dropping === 'copy' ? 'Adds the attachment to this chat’s draft' : chat?.title ?? 'New chat'}</span>
          <small>{dropping === 'copy' ? 'Release to copy · nothing is sent' : 'Release to attach · send when you’re ready'}</small>
        </div>
      )}
    </section>
  )
}

function ChatCard() {
  const panes = useApp((state) => state.panes)
  return (
    <main className={`chat panes-${panes.length}`}>
      {panes.map((pane, index) => (
        <PaneContext.Provider key={pane.key} value={index}>
          <ChatPane />
        </PaneContext.Provider>
      ))}
    </main>
  )
}

export function App() {
  const appRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const preventNavigation = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files') || event.dataTransfer?.types.includes(ATTACHMENT_DRAG_TYPE)) event.preventDefault()
    }
    window.addEventListener('dragover', preventNavigation)
    window.addEventListener('drop', preventNavigation)
    return () => {
      window.removeEventListener('dragover', preventNavigation)
      window.removeEventListener('drop', preventNavigation)
    }
  }, [])
  const artifact = useApp((state) => state.artifact)
  const browserOpen = useApp((state) => state.browserOpen)
  const libraryOpen = useApp((state) => state.libraryOpen)
  const browserWidth = useApp((state) => state.browserWidth)
  const error = useApp((state) => state.error)
  const split = useApp((state) => {
    if (state.panes.length !== 1) return false
    const chatId = focusedChatId(state)
    return chatId !== null && state.views[chatId]?.planTurnId != null
  })
  const sidePanel = artifact ? <ArtifactPanel /> : libraryOpen ? <LibraryPanel /> : browserOpen ? <BrowserPanel /> : null
  const style = (browserWidth != null ? { '--browser-width': `${browserWidth}px` } : undefined) as React.CSSProperties | undefined

  return (
    <div ref={appRef} className={`app${libraryOpen && !artifact ? ' has-library' : ''}${browserOpen || artifact ? ' has-browser' : ''}${split ? ' has-side' : ''}`} style={style}>
      <TitleStrip />
      <ChatCard />
      {sidePanel && <AppDivider appRef={appRef} />}
      {sidePanel}
      <AttachmentNotice />
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={dismissError}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
