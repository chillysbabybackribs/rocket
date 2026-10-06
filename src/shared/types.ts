// The vocabulary every process shares: the app-owned transcript, the providers that can answer a
// turn, and the wire protocol between the renderer and the agent host.

export type ProviderId = 'codex' | 'claude' | 'cursor' | 'antigravity'

/**
 * `steers`: a message sent while this provider is answering joins the turn in flight. For the
 * others it waits for the turn to end. The host decides; this only sets what the composer says.
 */
export const PROVIDERS: ReadonlyArray<{ id: ProviderId; label: string; steers: boolean }> = [
  { id: 'claude', label: 'Claude', steers: true },
  { id: 'codex', label: 'Codex', steers: true },
  { id: 'cursor', label: 'Cursor', steers: false },
  { id: 'antigravity', label: 'Antigravity', steers: false }
]

export function providerLabel(id: ProviderId): string {
  return PROVIDERS.find((provider) => provider.id === id)?.label ?? id
}

export type ToolKind = 'command' | 'edit' | 'read' | 'search' | 'web' | 'mcp' | 'other'
export type ToolStatus = 'running' | 'done' | 'failed'

/** One row of the transcript. Ids are unique within a chat and stable across updates. */
export type Item =
  /** `steer`: sent while the turn was running and taken into it, after the turn's first message. */
  | { type: 'user'; id: string; turnId: string; text: string; steer?: boolean }
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
  /**
   * A question the model asked with `ask_user`. It never holds the turn up: the model carries on
   * and the answer, if one comes, is the chat's next message. `recommended` indexes the option
   * the model would take itself.
   */
  | {
      type: 'question'
      id: string
      turnId: string
      text: string
      options: QuestionOption[]
      recommended: number
      /** The option picked or the words typed; null while unanswered. */
      answer: string | null
    }
  /**
   * The plan a model keeps while it works (Claude Code's TodoWrite, Codex's plan, Cursor's
   * todos). One per turn, id `<turnId>:plan`, replaced whole each time the model updates it; it
   * is shown beside the chat, not in the transcript's flow.
   */
  | { type: 'plan'; id: string; turnId: string; steps: PlanStep[] }

/** One clickable answer: a short label and what picking it means. */
export type QuestionOption = { label: string; detail: string }

/** One line of a model's plan. `doing` is the step under way; a provider marks at most one, usually. */
export type PlanStep = { text: string; status: 'todo' | 'doing' | 'done' }

/** The id of a turn's plan item; the one place a turn and its plan are joined. */
export function planItemId(turnId: string): string {
  return `${turnId}:plan`
}

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
  /** What a running turn is doing, when it is something other than thinking: "Waiting for 2 background tasks". Not kept once the turn ends. */
  activity?: string | null
  /** What the turn was in a goal's loop; null for a turn the user sent. Its message is then the app's, not the user's. */
  goalRole: GoalRole | null
  /** What the turn changed in its folder, found by comparing its start and end; null until it has ended, or when nothing changed. */
  changes: TurnChanges | null
  /** What the turn cost in tokens, as its provider reported it; null when the provider reports nothing. */
  tokens: TurnTokens | null
  startedAt: number
  endedAt: number | null
}

/**
 * A turn's tokens. `input` counts every input token its model calls read, cached ones included,
 * and `cached` how many of those came from the provider's prompt cache. `context` is the input of
 * the turn's last model call alone: how full the session was when the turn ended.
 */
export type TurnTokens = {
  input: number
  cached: number
  output: number
  context: number | null
  contextWindow: number | null
}

/** The totals a transcript line shows for a turn's changes, and whether the user has undone them. The full patch is read with `turn.changes`. */
export type TurnChanges = { files: number; added: number; removed: number; undone: boolean }

/**
 * A turn's changes in full: the unified patch as git wrote it, cut to a size limit when a turn
 * changed a great deal, and whether they can be undone right now (`reason` says why not).
 */
export type TurnPatch = { patch: string; truncated: boolean; undo: { offered: boolean; reason: string | null } }

// Goals: something the user wants done end to end. The worker drafts a brief, the user confirms
// it, then the worker works in ordinary turns and a second provider checks each round against
// the brief's checklist until every line is met. See docs/goals-phase1.md.

export type GoalRole = 'draft' | 'work' | 'check'

/**
 * drafting and confirming come before the work; working and checking are a round in flight;
 * needs_you is the app asking the user (a question, no progress, usage, a failure); paused is the
 * user's own pause; done and stopped are the ends.
 */
export type GoalStatus = 'drafting' | 'confirming' | 'working' | 'checking' | 'needs_you' | 'paused' | 'done' | 'stopped'

/** One line of what "done" means. `how` says how it will be checked, in a few words. */
export type GoalCriterion = { text: string; how: string; met: boolean | null; metInRound: number | null }

export type GoalVerdict = { line: number; met: boolean; evidence: string }

/** A reference the drafting model actually opened, with the screenshot it saved as proof. */
export type GoalReference = { source: string; screenshot: string; takes: string }

/**
 * For visual work: the one idea that makes this design specific to its product, and the
 * references behind it. The checker holds the result up against the same screenshots.
 */
export type GoalDesign = { concept: string; references: GoalReference[] }

export type GoalRound = {
  n: number
  workTurnId: string
  checkTurnId: string | null
  /** What the worker said it did, from its report or its last reply. */
  summary: string | null
  /** Files the work turn edited. */
  files: string[]
  verdicts: GoalVerdict[]
  /** What the checker found still wrong; null until it has checked. */
  findings: string | null
  startedAt: number
  endedAt: number | null
}

export type GoalAgent = { provider: ProviderId; model: string | null }

export type Goal = {
  id: string
  chatId: string
  cwd: string
  /** What the user asked for, in their own words. */
  request: string
  title: string
  /** The goal as the brief restates it; empty until drafted. */
  goal: string
  criteria: GoalCriterion[]
  /** Present when the deliverable is visual. */
  design: GoalDesign | null
  question: { text: string; options: string[]; answer: string | null } | null
  worker: GoalAgent
  checker: GoalAgent
  /** A usage window at or past this percent pauses the goal before its next turn. */
  pauseAtPercent: number
  status: GoalStatus
  /** The turn the goal takes next, when it carries on from a pause or the user. */
  next: GoalRole
  /** Why the goal is waiting for the user, as a sentence. */
  reason: string | null
  /** When a goal waiting on usage starts again by itself. */
  resumeAt: number | null
  /** Notes from the user for the next work round. */
  steer: string[]
  rounds: GoalRound[]
  createdAt: number
  updatedAt: number
}

/** What the user can change in a goal's brief before it starts. */
export type GoalEdit = {
  goal?: string
  criteria?: Array<{ text: string; how: string }>
  /** The design concept as the user edited it. */
  concept?: string
  answer?: string | null
  worker?: GoalAgent
  checker?: GoalAgent
  pauseAtPercent?: number
}

export type Chat = {
  id: string
  title: string
  cwd: string
  lastProvider: ProviderId | null
  createdAt: number
  updatedAt: number
}

/** A message waiting for the chat's turn in flight to end, to be sent as the next one. Kept in memory only. */
/** `taking`: sent into the running turn, and its model has not read it yet. */
export type QueuedMessage = { id: string; provider: ProviderId; text: string; taking?: boolean }

export type ChatSnapshot = { chat: Chat; turns: Turn[]; items: Item[]; queued?: QueuedMessage[] }

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
  | { type: 'goal'; goal: Goal }
  /** The chat's waiting messages, all of them, each time they change. */
  | { type: 'queue'; chatId: string; queued: QueuedMessage[] }

/** Request name → [params, result]. */
export type HostApi = {
  'chats.list': [Record<string, never>, Chat[]]
  'chat.create': [{ cwd: string }, Chat]
  'chat.open': [{ chatId: string }, ChatSnapshot]
  'chat.setCwd': [{ chatId: string; cwd: string }, Chat]
  'chat.delete': [{ chatId: string }, null]
  /** `model` is one of the provider's `models.list` ids, or null for the provider's default. */
  /**
   * Sent at once when the chat is idle. While a turn runs, it joins that turn when its provider
   * is the one answering and can take it, and otherwise waits for the turn to end.
   */
  'chat.send': [{ chatId: string; provider: ProviderId; model: string | null; text: string }, null]
  /**
   * Stop the turn in flight. Waiting messages are withdrawn and their text returned, for the
   * composer to take back; with `sendQueued` they stay and go out as soon as the turn has stopped.
   */
  'chat.stop': [{ chatId: string; sendQueued?: boolean }, string | null]
  /** Take one waiting message back; returns its text. */
  'chat.unqueue': [{ chatId: string; id: string }, string]
  /** A turn's changes as a unified patch; null when the turn changed nothing or its folder is not a repository. */
  'turn.changes': [{ chatId: string; turnId: string }, TurnPatch | null]
  /** Put the turn's files back as they were before it; the reversal is committed like a turn. Returns the turn as it now stands. */
  'turn.undo': [{ chatId: string; turnId: string }, Turn]
  /**
   * Answer a question a model asked. The answer is sent as the chat's next message to `provider`,
   * or given to the chat's goal as a note when one is running there.
   */
  'question.answer': [{ chatId: string; itemId: string; answer: string; provider: ProviderId; model: string | null }, null]
  /** Warm the provider up for the message being typed. A null `chatId` is the next new chat, in `cwd`. */
  'chat.prepare': [{ chatId: string | null; cwd: string; provider: ProviderId; model: string | null }, null]
  'usage.read': [{ provider: ProviderId; force?: boolean }, UsageSnapshot]
  'models.list': [{ provider: ProviderId }, ModelInfo[]]
  'goals.list': [Record<string, never>, Goal[]]
  /** Start a goal: a chat in `cwd` whose worker drafts a brief from `text` for the user to confirm. */
  'goal.draft': [{ cwd: string; text: string; provider: ProviderId; model: string | null }, Goal]
  /** Change the brief; only while it is being confirmed. */
  'goal.update': [{ goalId: string; edit: GoalEdit }, Goal]
  'goal.start': [{ goalId: string }, Goal]
  /** Pause after the turn in flight. */
  'goal.pause': [{ goalId: string }, Goal]
  /** Carry on from a pause, or from waiting on the user. */
  'goal.resume': [{ goalId: string }, Goal]
  'goal.stop': [{ goalId: string }, Goal]
  /** One of a goal's reference screenshots, as a data URL; only images named in the goal's design are served. */
  'goal.referenceImage': [{ goalId: string; index: number }, string]
  /** A note for the next work round. A goal waiting on the user takes it as the answer and carries on. */
  'goal.steer': [{ goalId: string; text: string }, Goal]
  /** An error the page caught, for the host's journal. */
  'journal.report': [{ message: string; stack?: string }, null]
  /** Mark a chat so ended turns export to `.artifacts/evals/` when `ROCKET_EVAL_EXPORT=tagged` (default). */
  'eval.tagChat': [{ chatId: string }, null]
  'eval.untagChat': [{ chatId: string }, null]
  /** List chat ids tagged for eval export. */
  'eval.listTaggedChats': [Record<string, never>, string[]]
  /** Write `turn.json` for a finished turn; optional `outDir` overrides `ROCKET_EVAL_CELL`. */
  'eval.exportTurn': [{ turnId: string; outDir?: string | null }, string | null]
  /** Directory for automatic export on the next ended turns (matrix cell folder). */
  'eval.setCellDir': [{ dir: string | null }, null]
  /** One matrix cell: send (or goal draft), wait, export to `outDir`. Requires a running app host. */
  'eval.runCell': [{
    cwd: string
    message: string
    provider: ProviderId
    model: string | null
    outDir: string
    openGoal?: boolean
    scenarioId?: string
    timeoutMs?: number
  }, { turnId: string; chatId: string; turnPath: string; cellDir: string }]
  'eval.listScenarios': [Record<string, never>, {
    files: string[]
    scenarios: Array<{
      id: string
      cwd: string
      message: string
      openGoal: boolean
      graders: string[]
      trials: number
      matrix: Array<{ provider: ProviderId; model: string | null }>
    }>
  }]
  'eval.startScenarioCell': [{
    scenarioId: string
    provider: ProviderId
    model: string | null
    trial?: number
    timeoutMs?: number
  }, {
    runId: string
    chatId: string
    turnId: string
    cellDir: string
    scenarioId: string
    provider: ProviderId
    graders: string[]
  }]
  'eval.finishScenarioCell': [{
    chatId: string
    turnId: string
    cellDir: string
    graders: string[]
    timeoutMs?: number
  }, { turnPath: string; graders: { allPass: boolean; graders: Record<string, { pass: boolean; score: number; metadata?: Record<string, unknown> }> } }]
  /** Braintrust-style dashboard payload (sample + `.artifacts/evals` + live scenarios). */
  'eval.loadDashboard': [Record<string, never>, {
    project: string
    org: string
    syncedAt: string
    datasets: Array<{
      id: string
      description: string
      rows: Array<{ id: string; input: string; expected: string; tags: string[] }>
    }>
    experiments: Array<{
      id: string
      name: string
      createdAt: string
      datasetId: string
      kind: 'matrix' | 'harness'
      passRate: number
      cellCount: number
      passCount: number
      durationMs: number | null
      scores: Record<string, number>
      sourcePath?: string
      cells: Array<{
        scenarioId: string
        provider: string
        model: string | null
        trial: number
        pass: boolean
        graders: Record<string, boolean>
        turnPath?: string
      }>
    }>
  }]
  /** Tool Eval Score (TES = wR·R + wP·P) from ledger + eval-live scenario cells. */
  'toolEval.scores': [Record<string, never>, {
    weights: { wR: number; wP: number; description?: string }
    syncedAt: string
    note: string
    tools: Array<{
      tool: string
      tes: number | null
      r: number | null
      p: number | null
      ledgerCalls: number
      scenarioCells: number
      scenarioPasses: number
      scenarioIds: string[]
    }>
  }]
  /** MCP tool-call ledger for the eval Tools view (read-only; not injected into agent prompts). */
  'toolLedger.loadPanel': [Record<string, never>, {
    available: boolean
    message?: string
    path?: string
    syncedAt?: string
    contextPolicy?: Record<string, unknown>
    scopes?: Array<{
      scope: string[]
      attempts: number
      successes: number
      failures: number
      descriptionBytes: number
      successRate: number | null
      failureRate: number | null
    }>
    groups?: Array<{
      tool: string
      operation: string
      code: string
      count: number
      failureRate: number
      examples: string[]
    }>
    queue?: Array<{
      callId: string
      tool: string
      code: string | null
      lifecycle: string
      at: number
    }>
    registeredTools?: Array<{ name: string; descriptionBytes: number; version: number }>
    retryCandidates?: Array<{ callId: string; tool: string; at: number }>
  }]
  'toolLedger.callDetail': [{ callId: string }, {
    path?: string
    calls?: Array<Record<string, unknown>>
    matching?: number
  }]
  'toolLedger.setReview': [{
    callId: string
    lifecycle?: 'diagnosed' | 'regression_added' | 'fixed' | 'verified'
    retryCallId?: string | null
    linkRetry?: boolean
    causeCode?: string | null
    causeNote?: string | null
    proposedFix?: string | null
  }, {
    path: string
    review: {
      callId: string
      lifecycle: string
      retryCallId: string | null
      causeCode: string | null
      proposedFix: string | null
    }
  }]
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
 * created the first time one is needed (the strip switches to it when opened); `chat` is null when the caller's chat
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
/** The host-to-main channel also carries app UI captures, live automation connections and the app map. */
export type MainAgentOp = BrowserAgentOp | { op: 'uiSnapshot' } | { op: 'uiConnection' } | { op: 'uiResize'; width: number; height: number } | UiMapOp
/** Main runs these in the renderer's dispatcher (`window.rocketMap`); see `src/shared/app-map.ts`. */
export type UiMapOp =
  | { op: 'uiMap'; call: 'where' }
  | { op: 'uiMap'; call: 'go'; place: string; params: Record<string, unknown> }
  | { op: 'uiMap'; call: 'act'; action: string; params: Record<string, unknown> }
/** Where the shell is, in the app map's words. `place` is the most specific place on screen. */
export type UiWhere = {
  place: string
  panes: Array<{ index: number; chatId: string | null; title: string; provider: ProviderId; focused: boolean; running: boolean; goal: string | null; planOpen: boolean }>
  focused: number
  side: 'chat' | 'browser' | 'evals' | 'artifact'
  artifact: { kind: string; path: string | null } | null
  evals: {
    view: string
    experimentId: string | null
    datasetId: string | null
    playground: {
      scenario: string; dataset: string; compare: string; diff: boolean; filter: string; busy: boolean; error: string | null
      cells: Array<{ rowId: string; provider: ProviderId; status: string; pass: boolean | null; output: string | null }>
    }
    runSheet: { open: boolean; scenario: string; provider: ProviderId; trial: number; phase: string; chatId: string | null; error: string | null; grades: Array<{ name: string; pass: boolean; reason?: string }> | null }
    tools: { section: 'health' | 'evaluate' }
  } | null
  dialogs: string[]
  railOpen: boolean
}
/** A dispatcher call's answer: what it returned, or why it failed, and where the shell ended up. */
export type UiMapResult = { ok: true; value: unknown; where: UiWhere } | { ok: false; error: string; where: UiWhere }
export type LiveUiConnection = { endpoint: string; pid: number; surfaces: Partial<Record<'shell' | 'browser' | 'suggestions', string>> }
export type UiSnapshot = {
  capturedAt: string
  instance: { pid: number; startedAt: string; version: string; mainBundleSha256: string; rendererUrl: string }
  window: { bounds: Bounds; contentBounds: Bounds; focused: boolean; minimized: boolean }
  shell: {
    panels: Array<{ name: string; bounds: Bounds }>
    /** `nav` is the app map's name for a control that opens a place; see `src/shared/app-map.ts`. */
    controls: Array<{ role: string; name: string; disabled: boolean; bounds: Bounds; nav?: string }>
    controlsTruncated: boolean
  }
  views: Array<{ url: string; bounds: Bounds; z: number }>
  capture: 'window' | 'surfaces'
  warnings: string[]
  directory: string
  images: Array<{ label: string; path: string; mimeType: string; base64: string }>
}
export type BrowserAgentRequest = { type: 'browser'; id: number; op: MainAgentOp }
export type BrowserAgentReply =
  | { type: 'browserReply'; id: number; ok: true; result: unknown }
  | { type: 'browserReply'; id: number; ok: false; error: string }

/** Host → isolated UI supervisor, over its private JSON-lines stdin. */
export type UiRunRequest = { id: number; code?: string; timeout?: number; capture?: boolean; close?: boolean }

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
  | { type: 'newTab'; url?: string }
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

export type ChatLinkTarget =
  | { kind: 'browser'; url: string }
  | { kind: 'artifact'; path: string; text: string; markdown: boolean; line: number | null }

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
  openChatLink: (href: string, cwd: string) => Promise<ChatLinkTarget>
  /** Main hands over something to open as a chat link would: a second launch of the app with a path or URL. */
  onOpen: (listener: (target: { href: string; cwd: string }) => void) => () => void
  homeDir: string
  browser: {
    send: (command: BrowserCommand) => void
    onState: (listener: (state: BrowserState) => void) => () => void
    onSuggestions: (listener: (list: SuggestionList) => void) => () => void
    /** Main asks for the address field to take focus (Ctrl+L, a new tab). */
    onFocusAddress: (listener: () => void) => () => void
  }
  /** file: URL of the bundled eval panel (docs/evals/mock-ui). */
  evalPanelUrl: () => Promise<string>
  /** Open a file or folder under the user home directory (captures, artifacts). */
  openLocalPath: (path: string) => Promise<void>
}

export const HOST_PORT_MESSAGE = 'rocket:host-port'
