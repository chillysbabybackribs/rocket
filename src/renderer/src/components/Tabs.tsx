import { Plus, X } from 'lucide-react'
import { usePane, usePaneChatId } from '../pane.ts'
import { act } from '../app-map.ts'
import { closeTab, paneAt, useApp } from '../store.ts'
import { GoalStatusIcon } from './GoalIcons.tsx'

// The open chats, as tabs standing on the composer's top edge. The selected tab is drawn as part
// of the composer: same fill, same outline, and no line between the two. A chat that has not
// been sent to yet has no id, so it shows as a "New chat" tab only while it is the one on screen.
// Each pane has tabs of its own.

export function Tabs() {
  const pane = usePane()
  const tabs = useApp((state) => paneAt(state, pane).tabs)
  const chats = useApp((state) => state.chats)
  const activeChatId = usePaneChatId()
  const panes = useApp((state) => state.panes.length)
  const running = useApp((state) => state.running)
  const goals = useApp((state) => state.goals)

  return (
    <div className="tabs" role="tablist" aria-label="Open chats">
      {tabs.map((id) => {
        const title = chats.find((chat) => chat.id === id)?.title ?? 'New chat'
        const active = id === activeChatId
        // A goal's chat is a tab like any other, marked with where the goal stands.
        const goal = goals.find((entry) => entry.chatId === id)
        return (
          <div
            key={id}
            className={`tab${active ? ' is-active' : ''}`}
            title={title}
            onAuxClick={(event) => {
              if (event.button === 1) closeTab(id, pane)
            }}
          >
            <button type="button" role="tab" aria-selected={active} className="tab-main" onClick={() => void act('chat.open', { chatId: id, pane })}>
              {goal
                ? <span className="tab-goal" title={`Goal: ${goal.status.replace('_', ' ')}`}><GoalStatusIcon status={goal.status} size={12} /></span>
                : running.has(id) && <span className="live-dot" aria-label="Answering" />}
              <span className="tab-title">{title}</span>
            </button>
            <button type="button" className="tab-close" aria-label={`Close tab: ${title}`} onClick={() => closeTab(id, pane)}>
              <X size={12} />
            </button>
          </div>
        )
      })}
      {activeChatId === null && (
        <div className="tab is-active is-draft">
          <button type="button" role="tab" aria-selected className="tab-main">
            <span className="tab-title">New chat</span>
          </button>
          {/* A new chat that is one pane of several closes like a tab, taking its pane with it. */}
          {panes > 1 && (
            <button type="button" className="tab-close" aria-label="Close this chat pane" onClick={() => void act('pane.close', { pane })}>
              <X size={12} />
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        className="tab-new"
        title="New chat"
        aria-label="New chat"
        disabled={activeChatId === null}
        onClick={() => void act('chat.new', { pane })}
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
