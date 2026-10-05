import { X } from 'lucide-react'
import { dismissError, useApp } from './store.ts'
import { BrowserPanel } from './components/BrowserPanel.tsx'
import { Composer } from './components/Composer.tsx'
import { Rail } from './components/Rail.tsx'
import { Transcript } from './components/Transcript.tsx'

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Still up?'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function ChatPane() {
  const chat = useApp((state) => state.chats.find((entry) => entry.id === state.activeChatId) ?? null)
  const chatId = useApp((state) => state.activeChatId)
  const hasTurns = useApp((state) => state.turns.length > 0)

  if (!chat || !hasTurns) {
    return (
      <main className="chat is-empty">
        <div className="welcome">
          <h1 className="welcome-title">{greeting()}</h1>
          <Composer key={chatId ?? 'new'} placeholder="How can I help you today?" />
          <p className="welcome-hint">Pick a provider and model for each message. They all share the conversation.</p>
        </div>
      </main>
    )
  }
  return (
    <main className="chat">
      <Transcript />
      <div className="composer-dock">
        <Composer key={chatId ?? 'new'} placeholder="Reply…" />
      </div>
    </main>
  )
}

export function App() {
  const browserOpen = useApp((state) => state.browserOpen)
  const error = useApp((state) => state.error)
  return (
    <div className={`app${browserOpen ? ' has-browser' : ''}`}>
      <Rail />
      <ChatPane />
      {browserOpen && <BrowserPanel />}
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
