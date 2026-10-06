import { createContext, useContext } from 'react'
import { chatIdOf, useApp, viewOf, type ChatView } from './store.ts'

// Which pane a component is in. Everything inside a pane (tabs, transcript, composer) reads its
// chat through this rather than through a global, so four panes are four chats and not one
// drawn four times. The rail stands outside every pane and acts on the focused one.

export const PaneContext = createContext(0)

/**
 * A chat shown outside every pane, read-only: the eval panel's run view puts the real transcript
 * around an eval chat with this, so it is the same transcript the chat column draws.
 */
export const ShownChatContext = createContext<string | null | undefined>(undefined)

export function usePane(): number {
  return useContext(PaneContext)
}

/** The chat this pane shows, or null on the new-chat screen. */
export function usePaneChatId(): string | null {
  const pane = usePane()
  const shown = useContext(ShownChatContext)
  return useApp((state) => (shown !== undefined ? shown : chatIdOf(state, pane)))
}

/** Something of this pane's chat view; an empty view on the new-chat screen. */
export function usePaneView<T>(select: (view: ChatView) => T): T {
  const pane = usePane()
  const shown = useContext(ShownChatContext)
  return useApp((state) => select(viewOf(state, shown !== undefined ? shown : chatIdOf(state, pane))))
}
