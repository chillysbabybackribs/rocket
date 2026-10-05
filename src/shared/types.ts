// The vocabulary every process shares: the app-owned transcript, the providers that can answer a
// turn, and the wire protocol between the renderer and the agent host.

export type ProviderId = 'codex' | 'claude' | 'cursor' | 'antigravity'

export const PROVIDERS: ReadonlyArray<{ id: ProviderId; label: string }> = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'antigravity', label: 'Antigravity' }
]

export function providerLabel(id: ProviderId): string {
  return PROVIDERS.find((provider) => provider.id === id)?.label ?? id
}

export type ToolKind = 'command' | 'edit' | 'read' | 'search' | 'web' | 'mcp' | 'other'
export type ToolStatus = 'running' | 'done' | 'failed'

/** One row of the transcript. Ids are unique within a chat and stable across updates. */
export type Item =
  | { type: 'user'; id: string; turnId: string; text: string }
  | { type: 'assistant'; id: string; turnId: string; text: string; streaming: boolean }
  | { type: 'reasoning'; id: string; turnId: string; text: string; streaming: boolean }
  | {
      type: 'tool'
      id: string
      turnId: string
      kind: ToolKind
      /** What the call is, in one line: the command, the file, the query. */
      label: string
      status: ToolStatus
      output: string
    }
  | { type: 'notice'; id: string; turnId: string; text: string; tone: 'info' | 'error' }

export type TurnStatus = 'running' | 'completed' | 'failed' | 'interrupted'

/** One user message and everything one provider did in answer to it. */
export type Turn = {
  id: string
  chatId: string
  provider: ProviderId
  /** The model the provider reported for this turn, when it reports one. */
  model: string | null
  status: TurnStatus
  error: string | null
  /** How many turns by other providers were handed to this provider along with the message. */
  handoffTurns: number
  startedAt: number
  endedAt: number | null
}

export type Chat = {
  id: string
  title: string
  cwd: string
  lastProvider: ProviderId | null
  createdAt: number
  updatedAt: number
}

export type ChatSnapshot = { chat: Chat; turns: Turn[]; items: Item[] }

export type UsageWindow = { label: string; percent: number; resetsAt: number | null }

/** A provider account's subscription usage, normalized to rolling windows. */
export type UsageSnapshot = {
  provider: ProviderId
  account: string | null
  plan: string | null
  windows: UsageWindow[]
  note: string | null
  /** Why there are no windows, when there are none. */
  unavailable: string | null
  updatedAt: number
}

/** One model a provider offers this account. `id` is whatever that provider takes back. */
export type ModelInfo = { id: string; label: string; description: string; isDefault: boolean }

export type HostEvent =
  | { type: 'item'; chatId: string; item: Item }
  | { type: 'delta'; chatId: string; itemId: string; delta: string }
  | { type: 'turn'; turn: Turn }
  | { type: 'chat'; chat: Chat }
  | { type: 'chatDeleted'; chatId: string }
  | { type: 'usage'; snapshot: UsageSnapshot }

/** Request name → [params, result]. */
export type HostApi = {
  'chats.list': [Record<string, never>, Chat[]]
  'chat.create': [{ cwd: string }, Chat]
  'chat.open': [{ chatId: string }, ChatSnapshot]
  'chat.setCwd': [{ chatId: string; cwd: string }, Chat]
  'chat.delete': [{ chatId: string }, null]
  /** `model` is one of the provider's `models.list` ids, or null for the provider's default. */
  'chat.send': [{ chatId: string; provider: ProviderId; model: string | null; text: string }, null]
  'chat.stop': [{ chatId: string }, null]
  /** Warm the provider up for the message being typed. A null `chatId` is the next new chat, in `cwd`. */
  'chat.prepare': [{ chatId: string | null; cwd: string; provider: ProviderId; model: string | null }, null]
  'usage.read': [{ provider: ProviderId; force?: boolean }, UsageSnapshot]
  'models.list': [{ provider: ProviderId }, ModelInfo[]]
}

export type HostMethod = keyof HostApi

export type HostRequestMessage = { kind: 'request'; id: number; method: HostMethod; params: unknown }
export type HostResponseMessage =
  | { kind: 'response'; id: number; ok: true; result: unknown }
  | { kind: 'response'; id: number; ok: false; error: string }
/** Events are batched per frame so a fast token stream costs one message, not hundreds. */
export type HostEventBatch = { kind: 'events'; events: HostEvent[] }
export type HostToRenderer = HostResponseMessage | HostEventBatch

/** One browser tab, as the tab strip and the address field need to see it. */
export type BrowserTab = {
  id: string
  /** Empty on the new tab page, as in Chromium. */
  url: string
  title: string
  /** A data: URL, or null when the page has no icon. */
  favicon: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  pinned: boolean
  audible: boolean
  muted: boolean
  /** Opened by a model for its own work. */
  agent: boolean
}

/** Tabs in strip order: pinned ones first. */
export type BrowserState = { tabs: BrowserTab[]; activeId: string | null }

/** One browser tab, as a model is told about it. `id` is short (t3) and lasts until the app quits. */
export type AgentTab = {
  id: string
  url: string
  title: string
  /** The tab the user is looking at. */
  active: boolean
  loading: boolean
  /** Opened by a model for its own work, not by the user. */
  agent: boolean
}

/**
 * Which tab an operation is for. With no `tab`, it is the tab the calling chat's model works in,
 * opened in the background the first time one is needed; `chat` is null when the caller's chat
 * is unknown, and such callers share one.
 */
type OnTab = { chat: string | null; tab: string | null }
export type ReadFocus = 'all' | 'text' | 'elements' | 'network'

/** What the agent host's tools can ask of the browser. Main does the work and answers once. */
export type BrowserAgentOp =
  | { op: 'tabs' }
  | { op: 'open'; chat: string | null; url: string | null }
  /** A request with the browser's cookies but no page: no CORS, no rendering. */
  | { op: 'fetch'; url: string; method: string | null; headers: Record<string, string> | null; body: string | null }
  | (OnTab & { op: 'info' })
  | (OnTab & { op: 'close' })
  | (OnTab & { op: 'goto'; url: string })
  /** The page as text a model can read. With a `url`, the tab goes there first. */
  | (OnTab & { op: 'read'; url: string | null; focus: ReadFocus; selector: string | null; max: number | null })
  /** JavaScript in the page's own world; the result must survive JSON. */
  | (OnTab & { op: 'eval'; expression: string })
  | (OnTab & { op: 'click'; target: string })
  | (OnTab & { op: 'fill'; target: string; value: string })
  | (OnTab & { op: 'press'; key: string })
  | (OnTab & { op: 'type'; text: string })
  /** Until `target` is visible or `expression` is truthy. */
  | (OnTab & { op: 'wait'; target: string | null; expression: string | null; timeout: number })
  | (OnTab & { op: 'requests'; match: string | null })
  | (OnTab & { op: 'body'; request: string })
  | (OnTab & { op: 'screenshot' })
  /** The chat's turn is over: the tabs it worked in go back to being ordinary background tabs. */
  | { op: 'rest'; chat: string }
  /** The chat is gone: its own tab is closed. */
  | { op: 'forget'; chat: string }
export type BrowserAgentRequest = { type: 'browser'; id: number; op: BrowserAgentOp }
export type BrowserAgentReply =
  | { type: 'browserReply'; id: number; ok: true; result: unknown }
  | { type: 'browserReply'; id: number; ok: false; error: string }

export type Bounds = { x: number; y: number; width: number; height: number }

/** One row of the address field's dropdown. `value` is what choosing it navigates to. */
export type Suggestion = { kind: 'search' | 'url' | 'history'; value: string; title: string; detail: string }
export type SuggestionList = { items: Suggestion[]; selected: number }

/** The dropdown is a native view sized by main, so both sides share its row metrics. */
export const SUGGEST_ROW_HEIGHT = 32
export const SUGGEST_PADDING = 5

/** Everything the UI can ask of the browser. Commands without an id act on the active tab. */
export type BrowserCommand =
  /** Where the page goes, in window coordinates; null hides the browser. */
  | { type: 'setBounds'; bounds: Bounds | null }
  /** Ask for the current state, on mount. */
  | { type: 'sync' }
  /** Whether keyboard focus is in the browser's own toolbar, so tab shortcuts apply there too. */
  | { type: 'chromeFocus'; focused: boolean }
  | { type: 'newTab' }
  | { type: 'closeTab'; id: string }
  | { type: 'activateTab'; id: string }
  /** `index` is the tab's new place in the strip. */
  | { type: 'moveTab'; id: string; index: number }
  | { type: 'muteTab'; id: string; muted: boolean }
  /** Show the tab's right-click menu at the pointer. */
  | { type: 'tabMenu'; id: string }
  | { type: 'navigate'; input: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'stop' }
  /** Show suggestions for what is typed, in a dropdown under `anchor` (the address field). */
  | { type: 'suggest'; text: string; anchor: Bounds }
  | { type: 'suggestSelect'; index: number }
  | { type: 'suggestHide' }
  /** Sent by the dropdown itself when a row is clicked. */
  | { type: 'suggestPick'; value: string }

/** What the preload exposes on `window.rocket`. */
export type RocketBridge = {
  /** Ask main for a MessagePort to the agent host; it arrives as a window `message` event. */
  requestHostPort: () => void
  window: {
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
  }
  pickFolder: (current: string | null) => Promise<string | null>
  homeDir: string
  browser: {
    send: (command: BrowserCommand) => void
    onState: (listener: (state: BrowserState) => void) => () => void
    onSuggestions: (listener: (list: SuggestionList) => void) => () => void
    /** Main asks for the address field to take focus (Ctrl+L, a new tab). */
    onFocusAddress: (listener: () => void) => () => void
  }
}

export const HOST_PORT_MESSAGE = 'rocket:host-port'
