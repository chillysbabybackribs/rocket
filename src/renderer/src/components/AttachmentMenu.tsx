import { NativeOverlay, anchoredOverlay } from './NativeOverlay.tsx'
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Download, Eye, FolderSearch, MessageSquarePlus, MoreHorizontal, Plus } from 'lucide-react'
import type { Attachment } from '../../../shared/types.ts'
import { call } from '../host.ts'
import { addExistingAttachment, attachmentProblem, draftOf, updateDraft } from '../drafts.ts'
import { MAX_PANES, peekState, useApp, type AppState } from '../store.ts'
import { act } from '../app-map.ts'
import { usePane } from '../pane.ts'

// One menu on every attachment, wherever it is shown (draft, waiting or sent): Preview, Copy to
// chat, Save as and Reveal stored file, as agreed in docs/mockups/attachment-reuse.html. Copying
// appends to the destination's draft and never sends. Native surfaces put menus and notices
// above both the shell and browser without changing the browser page.

type Notice = { id: number; text: string; undo?: () => void }
let notice: Notice | null = null
let noticeTimer: ReturnType<typeof setTimeout> | undefined
const noticeListeners = new Set<() => void>()
export function showNotice(text: string, undo?: () => void): void {
  notice = { id: (notice?.id ?? 0) + 1, text, undo }
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => setNotice(null), undo ? 8000 : 5000)
  for (const notify of noticeListeners) notify()
}
function setNotice(next: Notice | null): void {
  notice = next
  for (const notify of noticeListeners) notify()
}

/** The one notice the attachment menu leaves behind, with Undo after a copy. Mounted once by the app. */
export function AttachmentNotice() {
  const current = useSyncExternalStore(listener => { noticeListeners.add(listener); return () => { noticeListeners.delete(listener) } }, () => notice)
  if (!current) return null
  return (
    <NativeOverlay slot="notice" focus={false} onDismiss={() => setNotice(null)} place={size => ({ x: 20, y: innerHeight - size.height - 20, ...size })}>
      <div className="attachment-notice" role="status">
        <span>{current.text}</span>
        {current.undo && <button type="button" onClick={() => { current.undo?.(); showNotice('Undone. The draft is as it was.') }}>Undo</button>}
      </div>
    </NativeOverlay>
  )
}

type Destination = { key: string; title: string; detail: string; running: boolean }

function when(time: number): string {
  const days = Math.floor((Date.now() - time) / 86_400_000)
  if (days < 1) return 'Today'
  if (days < 2) return 'Yesterday'
  if (days < 7) return new Date(time).toLocaleDateString(undefined, { weekday: 'short' })
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function destinations(state: AppState, pane: number): { open: Destination[]; recent: Destination[] } {
  const title = (chatId: string | null) => state.chats.find(chat => chat.id === chatId)?.title ?? 'New chat'
  const open = state.panes.map((each, index) => ({
    key: each.chatId ?? `new:${each.key}`, title: title(each.chatId),
    detail: index === pane ? 'This chat' : `Pane ${index + 1}`, running: each.chatId !== null && state.running.has(each.chatId)
  }))
  const shown = new Set(state.panes.map(each => each.chatId))
  const recent = state.chats.filter(chat => !shown.has(chat.id)).toSorted((a, b) => b.updatedAt - a.updatedAt)
    .map(chat => ({ key: chat.id, title: chat.title, detail: when(chat.updatedAt), running: state.running.has(chat.id) }))
  return { open, recent }
}

/** Copy into a draft (a menu choice or a drop from another chat), with a brief highlight and Undo. */
export function copyTo(attachment: Attachment, key: string, title: string): void {
  const problem = attachmentProblem(key, attachment)
  if (problem) return showNotice(problem)
  if (draftOf(key).attachments.some(each => each.id === attachment.id)) return showNotice(`${attachment.name} is already in ${title}'s draft.`)
  addExistingAttachment(key, attachment)
  updateDraft(key, { fresh: attachment.id })
  setTimeout(() => { if (draftOf(key).fresh === attachment.id) updateDraft(key, { fresh: null }) }, 1600)
  // Chat titles may already end in an ellipsis; a full stop after it reads as a typo.
  showNotice(`Copied ${attachment.name} to ${title}${title.endsWith('…') ? '' : '.'}`, () => updateDraft(key, { attachments: draftOf(key).attachments.filter(each => each.id !== attachment.id), fresh: null }))
}

async function saveAs(attachment: Attachment): Promise<void> {
  try {
    const path = await window.rocket.saveAttachmentAs(attachment.name)
    if (!path) return
    await call('attachment.export', { id: attachment.id, path })
    showNotice(`Saved ${path.split('/').pop()} to ${path.slice(0, path.lastIndexOf('/')) || '/'}.`)
  } catch (error) {
    showNotice(error instanceof Error ? error.message : 'The file could not be saved. Choose another folder.')
  }
}

async function reveal(attachment: Attachment): Promise<void> {
  try {
    const path = await call('attachment.locate', { id: attachment.id })
    await window.rocket.revealAttachment(path)
    showNotice(`Showing ${attachment.name} in Rocket's attachments folder, stored as ${path.split('/').pop()}.`)
  } catch (error) {
    showNotice(error instanceof Error ? error.message : 'The stored file could not be shown.')
  }
}

/** Arrow keys move between a popover's items; Escape and Tab close it. */
function moveFocus(event: ReactKeyboardEvent<HTMLElement>, close: () => void): void {
  if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close(); return }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-item]')].filter(item => !(item as HTMLButtonElement).disabled)
  const index = items.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLElement)
  items.at(event.key === 'ArrowDown' ? (index + 1) % items.length : index <= 0 ? -1 : index - 1)?.focus()
}

function Picker({ attachment, pane, onBack, onDone }: { attachment: Attachment; pane: number; onBack: () => void; onDone: () => void }) {
  const [query, setQuery] = useState('')
  // Read once: the picker lives for a moment, and a stable list keeps keyboard focus in place.
  const [lists] = useState(() => destinations(peekState(), pane))
  const full = useApp(state => state.panes.length >= MAX_PANES)
  const match = (each: Destination) => each.title.toLowerCase().includes(query.trim().toLowerCase())
  const open = lists.open.filter(match)
  const recent = lists.recent.filter(match).slice(0, query ? 20 : 6)
  const row = (each: Destination) => (
    <button key={each.key} type="button" className="attachment-chat" data-item onClick={() => { copyTo(attachment, each.key, each.title); onDone() }}>
      <i className={`attachment-chat-dot${each.running ? ' is-running' : ''}`} /><span>{each.title}</span><small>{each.detail}</small>
    </button>
  )
  return (
    <>
      <div className="attachment-picker-head">
        <button type="button" className="attachment-back" aria-label="Back" onClick={onBack}><ChevronLeft size={15} /></button>
        <b>Copy {attachment.name} to…</b>
      </div>
      <input className="attachment-search" data-item autoFocus placeholder="Search chats" aria-label="Search chats" value={query} onChange={event => setQuery(event.target.value)} />
      <button type="button" className="attachment-chat" data-item disabled={full} title={full ? 'Four chats is the most for now; close one first.' : undefined} onClick={async () => {
        onDone()
        await act('pane.add', { after: pane })
        const state = peekState()
        const added = state.panes[state.focused]
        if (added && !added.chatId) copyTo(attachment, `new:${added.key}`, 'the new chat')
      }}>
        <Plus size={15} /><span>New chat</span><small>{full ? 'Four chats open' : 'Opens beside this one'}</small>
      </button>
      {open.length > 0 && <div className="attachment-menu-label">Open</div>}
      {open.map(row)}
      {recent.length > 0 && <div className="attachment-menu-label">Recent</div>}
      {recent.map(row)}
      {!open.length && !recent.length && <div className="attachment-menu-empty">No chat matches “{query}”.</div>}
      <div className="attachment-picker-foot">Adds to the chat's draft. Nothing is sent.</div>
    </>
  )
}

/** A bounded native popover can cross the chat/browser boundary without moving either. */
function Popover({ anchor, point, label, children, onClose }: { anchor: HTMLElement | null; point: { x: number; y: number } | null; label: string; children: ReactNode; onClose: () => void }) {
  return (
    <NativeOverlay anchor={anchor} place={size => anchoredOverlay(anchor, size, false, point)} onDismiss={onClose}>
        <div className={`attachment-menu${label === 'Copy to chat' ? ' is-picker' : ''}`} role="menu" aria-label={label} onKeyDown={event => moveFocus(event, onClose)}>
          {children}
        </div>
    </NativeOverlay>
  )
}

/**
 * The ⋯ button an attachment shows on hover or focus, and the menu it opens. `point` opens it at
 * the pointer for a right-click; `openSignal` lets the tile open it from the keyboard.
 */
export function AttachmentMenu({ attachment, onPreview, className, request }: { attachment: Attachment; onPreview: () => void; className: string; request: { point: { x: number; y: number } | null; at: number } | null }) {
  const pane = usePane()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState<{ point: { x: number; y: number } | null; picker: boolean } | null>(null)
  useEffect(() => { if (request) setOpen({ point: request.point, picker: false }) }, [request])
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (open && !open.picker) first.current?.focus({ preventScroll: true }) }, [open])
  const close = (): void => { setOpen(null); trigger.current?.focus({ preventScroll: true }) }
  const run = (action: () => void): void => { setOpen(null); action() }
  return (
    <>
      <button ref={trigger} type="button" className={`attachment-more ${className}`} aria-label={`More for ${attachment.name}`} aria-haspopup="menu" aria-expanded={open !== null}
        onClick={event => { event.stopPropagation(); setOpen(open ? null : { point: null, picker: false }) }}>
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <Popover anchor={trigger.current} point={open.point} label={open.picker ? 'Copy to chat' : attachment.name} onClose={close}>
          {open.picker
            ? <Picker attachment={attachment} pane={pane} onBack={() => setOpen({ ...open, picker: false })} onDone={() => setOpen(null)} />
            : <>
                <button ref={first} type="button" role="menuitem" data-item className="attachment-menu-item" onClick={() => run(onPreview)}><Eye size={15} />Preview</button>
                <div className="attachment-menu-sep" />
                <button type="button" role="menuitem" data-item aria-haspopup="true" className="attachment-menu-item" onClick={() => setOpen({ ...open, picker: true })}>
                  <MessageSquarePlus size={15} />Copy to chat<ChevronRight size={14} className="attachment-menu-chev" />
                </button>
                <button type="button" role="menuitem" data-item className="attachment-menu-item" onClick={() => run(() => void saveAs(attachment))}><Download size={15} />Save as…</button>
                <button type="button" role="menuitem" data-item className="attachment-menu-item" onClick={() => run(() => void reveal(attachment))}><FolderSearch size={15} />Reveal stored file</button>
              </>}
        </Popover>
      )}
    </>
  )
}
