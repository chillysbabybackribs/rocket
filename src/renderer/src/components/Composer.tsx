import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Folder, Square } from 'lucide-react'
import { PROVIDERS, providerLabel } from '../../../shared/types.ts'
import { chooseFolder, prepare, send, setProvider, stop, useApp } from '../store.ts'
import { ModelPicker } from './ModelPicker.tsx'
import { Tabs } from './Tabs.tsx'

const MAX_HEIGHT = 260

/** What was typed but not sent, per tab ('' is the new chat), so switching tabs loses nothing. */
const drafts = new Map<string, string>()

function shortPath(path: string): string {
  const home = window.rocket.homeDir
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

export function Composer({ placeholder }: { placeholder: string }) {
  const chatId = useApp((state) => state.activeChatId)
  const busy = useApp((state) => (state.activeChatId ? state.running.has(state.activeChatId) : false))
  const cwd = useApp((state) => state.chats.find((chat) => chat.id === state.activeChatId)?.cwd ?? state.defaultCwd)
  const ready = useApp((state) => state.ready)
  const provider = useApp((state) => state.provider)
  const model = useApp((state) => state.modelChoice[state.provider]?.id ?? null)
  const answering = useApp((state) => state.turns.findLast((turn) => turn.status === 'running')?.provider ?? null)
  const restored = useApp((state) => state.restored)
  const [text, setText] = useState(() => drafts.get(chatId ?? '') ?? '')
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

  useEffect(() => { input.current?.focus() }, [chatId])

  // Whatever would answer the next message starts warming up as soon as it is known, and again
  // once a turn ends.
  useEffect(() => {
    if (ready && !busy) prepare()
  }, [ready, busy, chatId, provider, model, cwd])

  useEffect(() => {
    if (text) drafts.set(chatId ?? '', text)
    else drafts.delete(chatId ?? '')
  }, [chatId, text])

  // Ctrl/⌘ + 1–4 picks the provider for the next message from anywhere in the window.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      const choice = PROVIDERS[Number(event.key) - 1]
      if (!choice) return
      event.preventDefault()
      setProvider(choice.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = (): void => {
    const message = text.trim()
    if (!message) return
    setText('')
    void send(message)
  }

  const hint = !busy || !text.trim() ? null : steers ? 'adds to this turn' : `sends when ${waitsFor ?? 'the turn'} finishes`

  return (
    <div className="composer-group">
      <Tabs />
      <div className="composer">
        <textarea
          ref={input}
          className="composer-input"
          rows={1}
          value={text}
          placeholder={steers ? 'Add to this turn…' : waitsFor ? `Message to send when ${waitsFor} finishes…` : placeholder}
          aria-label="Message"
          onChange={(event) => {
            // The first keystroke of a message: a provider retired for idleness is back by the send.
            if (!text) prepare()
            setText(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            } else if (event.key === 'Escape' && busy && !event.nativeEvent.isComposing) {
              event.preventDefault()
              stop()
            }
          }}
        />
        <div className="composer-bar">
          <button
            type="button"
            className="composer-folder"
            title={`Working folder: ${cwd}. Click to change.`}
            disabled={busy}
            onClick={() => void chooseFolder()}
          >
            <Folder size={14} />
            <span>{shortPath(cwd)}</span>
          </button>
          <div className="composer-right">
            <ModelPicker onClose={() => input.current?.focus()} />
            {busy && (
              <button type="button" className="send is-stop" aria-label="Stop" title="Stop (Esc)" onClick={stop}>
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
