import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Folder, MessageSquarePlus, Square } from 'lucide-react'
import { PROVIDERS, providerLabel } from '../../../shared/types.ts'
import { usePane, usePaneChatId, usePaneView } from '../pane.ts'
import { MAX_PANES, addPane, chooseFolder, cwdOf, paneAt, prepare, send, setProvider, stop, useApp } from '../store.ts'
import { ModelPicker } from './ModelPicker.tsx'
import { Tabs } from './Tabs.tsx'

const MAX_HEIGHT = 260

/** What was typed but not sent, per chat (a pane's key for its new chat), so switching tabs loses nothing. */
const drafts = new Map<string, string>()

function shortPath(path: string): string {
  const home = window.rocket.homeDir
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

export function Composer({ placeholder }: { placeholder: string }) {
  const pane = usePane()
  const chatId = usePaneChatId()
  const paneKey = useApp((state) => paneAt(state, pane).key)
  const focused = useApp((state) => state.focused === pane)
  const paneCount = useApp((state) => state.panes.length)
  const busy = useApp((state) => (chatId ? state.running.has(chatId) : false))
  const cwd = useApp((state) => cwdOf(state, pane))
  const ready = useApp((state) => state.ready)
  const provider = useApp((state) => paneAt(state, pane).provider)
  const model = useApp((state) => { const current = paneAt(state, pane); return current.modelChoice[current.provider]?.id ?? null })
  const answering = usePaneView((view) => view.turns.findLast((turn) => turn.status === 'running')?.provider ?? null)
  const restored = useApp((state) => paneAt(state, pane).restored)
  const draftKey = chatId ?? `new:${paneKey}`
  const [text, setText] = useState(() => drafts.get(draftKey) ?? '')
  const input = useRef<HTMLTextAreaElement>(null)
  // While a turn runs, a message joins it when the provider picked is the one answering and can
  // take it; otherwise it waits for the turn to end. The host decides; this is what the box says.
  const steers = busy && answering === provider && PROVIDERS.some((entry) => entry.id === provider && entry.steers)
  const waitsFor = busy && !steers && answering ? providerLabel(answering) : null

  // A waiting message taken back lands in front of whatever is being typed.
  useEffect(() => {
    if (!restored) return
    setText((current) => (current.trim() ? `${restored.text}\n\n${current}` : restored.text))
    input.current?.focus()
  }, [restored])

  useLayoutEffect(() => {
    const element = input.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`
  }, [text])

  // The keyboard follows the focused pane, and only that one: four composers must not fight over it.
  useEffect(() => { if (focused) input.current?.focus() }, [chatId, focused])

  // Whatever would answer the next message starts warming up as soon as it is known, and again
  // once a turn ends.
  useEffect(() => {
    if (ready && !busy) prepare(pane)
  }, [ready, busy, pane, chatId, provider, model, cwd])

  useEffect(() => {
    if (text) drafts.set(draftKey, text)
    else drafts.delete(draftKey)
  }, [draftKey, text])

  // Ctrl/⌘ + 1–4 picks the provider for the next message from anywhere in the window, in the
  // focused pane.
  useEffect(() => {
    if (!focused) return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      const choice = PROVIDERS[Number(event.key) - 1]
      if (!choice) return
      event.preventDefault()
      setProvider(pane, choice.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, pane])

  const submit = (): void => {
    const message = text.trim()
    if (!message) return
    setText('')
    void send(pane, message)
  }

  const hint = !busy || !text.trim() ? null : steers ? 'adds to this turn' : `sends when ${waitsFor ?? 'the turn'} finishes`
  const full = paneCount >= MAX_PANES

  return (
    <div className="composer-group">
      <Tabs />
      <div className="composer">
        <button
          type="button"
          className="composer-add-chat"
          aria-label="Add a chat beside this one"
          title={full ? 'Four chats is the most for now' : 'Add a chat beside this one'}
          disabled={full}
          onClick={() => addPane(pane)}
        >
          <MessageSquarePlus size={16} />
        </button>
        <textarea
          ref={input}
          className="composer-input"
          rows={1}
          value={text}
          placeholder={steers ? 'Add to this turn…' : waitsFor ? `Message to send when ${waitsFor} finishes…` : placeholder}
          aria-label="Message"
          onChange={(event) => {
            // The first keystroke of a message: a provider retired for idleness is back by the send.
            if (!text) prepare(pane)
            setText(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            } else if (event.key === 'Escape' && busy && !event.nativeEvent.isComposing) {
              event.preventDefault()
              stop(pane)
            }
          }}
        />
        <div className="composer-bar">
          <button
            type="button"
            className="composer-folder"
            title={`Working folder: ${cwd}. Click to change.`}
            disabled={busy}
            onClick={() => void chooseFolder(pane)}
          >
            <Folder size={14} />
            <span>{shortPath(cwd)}</span>
          </button>
          <div className="composer-right">
            <ModelPicker onClose={() => input.current?.focus()} />
            {busy && (
              <button type="button" className="send is-stop" aria-label="Stop" title="Stop (Esc)" onClick={() => stop(pane)}>
                <Square size={11} fill="currentColor" />
              </button>
            )}
            <button
              type="button"
              className="send"
              aria-label={steers ? 'Add to this turn' : busy ? 'Send when the turn ends' : 'Send'}
              title={steers ? 'Add to this turn' : busy ? 'Send when the turn ends' : 'Send'}
              disabled={!text.trim()}
              onClick={submit}
            >
              <ArrowUp size={17} strokeWidth={2.4} />
            </button>
          </div>
        </div>
        {hint && <div className="composer-hint"><kbd>Enter</kbd> {hint} · <kbd>Esc</kbd> stops</div>}
      </div>
    </div>
  )
}
