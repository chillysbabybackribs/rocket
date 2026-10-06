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
  const [text, setText] = useState(() => drafts.get(chatId ?? '') ?? '')
  const input = useRef<HTMLTextAreaElement>(null)

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
    if (!message || busy) return
    setText('')
    void send(message)
  }

  return (
    <div className="composer-group">
      <Tabs />
      <div className="composer">
        <textarea
          ref={input}
          className="composer-input"
          rows={1}
          value={text}
          placeholder={placeholder}
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
            {busy ? (
              <button type="button" className="send is-stop" aria-label="Stop" title="Stop" onClick={stop}>
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button type="button" className="send" aria-label="Send" title="Send" disabled={!text.trim()} onClick={submit}>
                <ArrowUp size={17} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
