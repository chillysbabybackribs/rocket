import { randomUUID } from 'node:crypto'
import type { Chat, ChatSnapshot, GoalRole, HostEvent, Item, ModelInfo, ProviderId, Turn, UsageSnapshot } from '../shared/types.ts'
import { buildHandoff, type Handoff, type MissedTurn } from './handoff.ts'
import { messageOf, oneLine } from './json.ts'
import type { ProviderAdapter, RunResult, TurnSink, UnpromptedTurn } from './providers/provider.ts'
import { unavailableUsage } from './providers/provider.ts'
import { publicTurn, type Store, type StoredTurn } from './store.ts'
import type { Working } from './teamwork.ts'

// The chat itself. The hub owns every conversation in the store and lends each turn to whichever
// provider the user picked for that message. A provider's session is resumed where it left off
// and handed only the turns it missed (handoff.ts); nothing here knows how any provider works.

const USAGE_REUSE_MS = 60_000
const MODELS_REUSE_MS = 10 * 60_000

/** How long a turn took to show something, measured from the moment the message was sent. */
export type TurnTiming = {
  chatId: string
  provider: ProviderId
  model: string | null
  status: Turn['status']
  /** Why a failed turn failed. */
  error: string | null
  /** To the provider's first sign of life: a session, a model, an item. */
  firstEventMs: number | null
  /** To the first reasoning or reply text the user could read. */
  firstTextMs: number | null
  totalMs: number
}

export function describeTiming(timing: TurnTiming): string {
  const ms = (value: number | null): string => (value === null ? 'none' : `${Math.round(value)}ms`)
  return `turn ${timing.provider}${timing.model ? ` (${timing.model})` : ''} ${timing.status}: `
    + `first event ${ms(timing.firstEventMs)}, first text ${ms(timing.firstTextMs)}, total ${(timing.totalMs / 1000).toFixed(1)}s`
}

type Question = Extract<Item, { type: 'question' }>

type LiveTurn = {
  turn: StoredTurn
  adapter: ProviderAdapter
  /** `performance.now()` at the send, and at the two marks `TurnTiming` reports. */
  clock: { sent: number; firstEvent: number | null; firstText: number | null }
  /** Items as they stand right now, deltas applied; the store gets them when they settle. */
  items: Map<string, Item>
  stopRequested: boolean
}

export class Hub {
  /** chatId → the turn in flight. One turn per chat at a time. */
  private readonly live = new Map<string, LiveTurn>()
  private readonly usageCache = new Map<ProviderId, { at: number; snapshot: UsageSnapshot }>()
  private readonly usagePending = new Map<ProviderId, Promise<UsageSnapshot>>()
  private readonly modelCache = new Map<ProviderId, { at: number; models: Promise<ModelInfo[]> }>()

  constructor(
    private readonly store: Store,
    private readonly adapters: Record<ProviderId, ProviderAdapter>,
    private readonly emit: (event: HostEvent) => void,
    private readonly onTiming: (timing: TurnTiming) => void = () => {},
    /**
     * A few lines about the app's state to put ahead of the user's message, or null for none.
     * `fresh` says the provider's session is new and has been told nothing yet.
     */
    private readonly context: ((chatId: string, provider: ProviderId, fresh: boolean) => Promise<string | null>) | null = null
  ) {
    for (const [provider, adapter] of Object.entries(adapters) as Array<[ProviderId, ProviderAdapter]>) {
      adapter.onUnprompted?.((chatId, reason) => this.openUnprompted(chatId, provider, reason))
    }
  }

  /** The chat a provider is answering right now, when it is answering exactly one. */
  runningChat(provider: ProviderId): string | null {
    const chats = [...this.live.values()].filter((live) => live.turn.provider === provider)
    return chats.length === 1 ? chats[0]!.turn.chatId : null
  }

  /** Every turn in flight, with what it was asked and the files it has edited so far. */
  working(): Working[] {
    return [...this.live.values()].map(({ turn, items }) => {
      const user = items.get(`${turn.id}:user`)
      return {
        chatId: turn.chatId,
        provider: turn.provider,
        model: turn.model,
        request: user?.type === 'user' ? user.text : '',
        edited: [...items.values()].flatMap((item) => (item.type === 'tool' && item.kind === 'edit' && item.status !== 'failed' ? [item.label] : []))
      }
    })
  }

  listChats(): Chat[] {
    return this.store.listChats()
  }

  createChat(cwd: string, title = 'New chat'): Chat {
    const now = Date.now()
    const chat: Chat = { id: randomUUID(), title, cwd, lastProvider: null, createdAt: now, updatedAt: now }
    this.store.createChat(chat)
    this.emit({ type: 'chat', chat })
    return chat
  }

  openChat(chatId: string): ChatSnapshot {
    const snapshot = this.store.snapshot(chatId)
    if (!snapshot) throw new Error('That chat no longer exists')
    const live = this.live.get(chatId)
    if (!live) return snapshot
    // A turn in flight holds newer text than the store does.
    const items = snapshot.items.map((item) => live.items.get(item.id) ?? item)
    const known = new Set(items.map((item) => item.id))
    for (const item of live.items.values()) if (!known.has(item.id)) items.push(item)
    return { ...snapshot, items }
  }

  setCwd(chatId: string, cwd: string): Chat {
    const chat = this.requireChat(chatId)
    if (this.live.has(chatId)) throw new Error('Wait for the current turn to finish before changing the folder')
    const next = { ...chat, cwd }
    // A provider's warm session is tied to the folder it was opened in; the next message reopens it in the new one.
    if (cwd !== chat.cwd) for (const adapter of Object.values(this.adapters)) adapter.forget(chatId)
    this.store.updateChat(next)
    this.emit({ type: 'chat', chat: next })
    return next
  }

  async deleteChat(chatId: string): Promise<void> {
    await this.stop(chatId)
    for (const adapter of Object.values(this.adapters)) adapter.forget(chatId)
    this.store.deleteChat(chatId)
    this.emit({ type: 'chatDeleted', chatId })
  }

  /**
   * Start a turn and return its id; its progress and end arrive as events. A goal's turns carry
   * their `goalRole`, and their message is the app's, so it does not name the chat.
   */
  send(chatId: string, provider: ProviderId, model: string | null, text: string, goalRole: GoalRole | null = null): string {
    const message = text.trim()
    if (!message) throw new Error('There is nothing to send')
    if (this.live.has(chatId)) throw new Error('This chat is still answering the last message')
    const chat = this.requireChat(chatId)
    const adapter = this.adapters[provider]
    const session = this.store.session(chatId, provider)
    const handoff = this.handoffFor(chatId, session.seenTurnSeq)

    const turn = this.store.createTurn({
      id: randomUUID(),
      chatId,
      provider,
      model: null,
      status: 'running',
      error: null,
      handoffTurns: handoff?.turns ?? 0,
      goalRole,
      changes: null,
      startedAt: Date.now(),
      endedAt: null
    })
    const clock = { sent: performance.now(), firstEvent: null, firstText: null }
    const live: LiveTurn = { turn, adapter, clock, items: new Map(), stopRequested: false }
    this.live.set(chatId, live)

    const named = chat.lastProvider === null && goalRole === null
    const updated: Chat = {
      ...chat,
      title: named ? oneLine(message, 60) : chat.title,
      lastProvider: provider,
      updatedAt: Date.now()
    }
    this.store.updateChat(updated)
    this.emit({ type: 'chat', chat: updated })
    this.emit({ type: 'turn', turn: publicTurn(turn) })
    this.putItem(live, { type: 'user', id: `${turn.id}:user`, turnId: turn.id, text: message })

    void this.runTurn(live, updated.cwd, message, model, session.sessionId, handoff)
    return turn.id
  }

  /** Whether a chat has a turn in flight. */
  isRunning(chatId: string): boolean {
    return this.live.has(chatId)
  }

  /** A turn's items as they stand: live ones from the turn in flight, settled ones from the store. */
  turnItems(chatId: string, turnId: string): Item[] {
    const live = this.live.get(chatId)
    return live?.turn.id === turnId ? [...live.items.values()] : this.store.turnItems(chatId, turnId)
  }

  /**
   * Add an item of the app's own to the turn in flight, such as a question a tool posted on the
   * model's behalf. Returns the turn's id, or null when the chat has no turn running.
   */
  addItem(chatId: string, make: (turnId: string) => Item): string | null {
    const live = this.live.get(chatId)
    if (!live) return null
    this.putItem(live, make(live.turn.id))
    return live.turn.id
  }

  /** The question asked in the chat's turn in flight, if there is one. */
  liveQuestion(chatId: string): Question | undefined {
    const live = this.live.get(chatId)
    return live && [...live.items.values()].find((item): item is Question => item.type === 'question')
  }

  /** Record the user's answer on a question (null reopens it), whether its turn is still running or long over. */
  answerQuestion(chatId: string, itemId: string, answer: string | null): Question {
    const live = this.live.get(chatId)
    const item = live?.items.get(itemId) ?? this.store.item(chatId, itemId)
    if (item?.type !== 'question') throw new Error('That question is no longer in the chat')
    const answered: Question = { ...item, answer }
    if (live?.items.has(itemId)) live.items.set(itemId, answered)
    this.store.putItem(chatId, answered)
    this.emit({ type: 'item', chatId, item: answered })
    return answered
  }

  /**
   * Get a provider ready for the message being typed, so that message does not wait on a cold
   * start. A null `chatId` is the next new chat, which will start in `cwd`. Never fails: a
   * provider that cannot warm up reports its trouble when the message is sent.
   */
  async prepare(chatId: string | null, provider: ProviderId, model: string | null, cwd: string): Promise<void> {
    try {
      if (chatId === null) {
        await this.adapters[provider].prepare({ chatId: null, cwd, sessionId: null, model })
        return
      }
      const chat = this.store.chat(chatId)
      if (!chat || this.live.has(chatId)) return
      const { sessionId } = this.store.session(chatId, provider)
      await this.adapters[provider].prepare({ chatId, cwd: chat.cwd, sessionId, model })
    } catch {
      // Warming up is a courtesy.
    }
  }

  async stop(chatId: string): Promise<void> {
    const live = this.live.get(chatId)
    if (!live) return
    live.stopRequested = true
    await live.adapter.stop(chatId).catch(() => {})
  }

  /** A provider's usage, shared across callers; a reading younger than a minute is reused. */
  usage(provider: ProviderId, force = false): Promise<UsageSnapshot> {
    const pending = this.usagePending.get(provider)
    if (pending) return pending
    const cached = this.usageCache.get(provider)
    if (!force && cached && Date.now() - cached.at < USAGE_REUSE_MS) return Promise.resolve(cached.snapshot)
    const read = this.adapters[provider].usage()
      .catch((error: unknown) => cached?.snapshot ?? unavailableUsage(provider, messageOf(error)))
      .then((snapshot) => {
        this.noteUsage(snapshot)
        return snapshot
      })
      .finally(() => this.usagePending.delete(provider))
    this.usagePending.set(provider, read)
    return read
  }

  /** A provider's model list. It changes rarely, so one reading serves ten minutes; a failure is not kept. */
  models(provider: ProviderId): Promise<ModelInfo[]> {
    const cached = this.modelCache.get(provider)
    if (cached && Date.now() - cached.at < MODELS_REUSE_MS) return cached.models
    const models = this.adapters[provider].models()
    this.modelCache.set(provider, { at: Date.now(), models })
    models.catch(() => {
      if (this.modelCache.get(provider)?.models === models) this.modelCache.delete(provider)
    })
    return models
  }

  /** A reading an adapter pushed on its own (a rate-limit event mid-turn). */
  noteUsage(snapshot: UsageSnapshot): void {
    this.usageCache.set(snapshot.provider, { at: Date.now(), snapshot })
    this.emit({ type: 'usage', snapshot })
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.live.keys()].map((chatId) => this.stop(chatId)))
    for (const adapter of Object.values(this.adapters)) adapter.shutdown()
  }

  private async runTurn(
    live: LiveTurn,
    cwd: string,
    text: string,
    model: string | null,
    sessionId: string | null,
    handoff: Handoff | null
  ): Promise<void> {
    const { turn, adapter } = live
    const { chatId, provider } = turn
    const session = { id: sessionId }
    const sink = this.sinkFor(live, session)

    let result: RunResult
    try {
      // The provider is sent the message with the app's context ahead of it; the transcript keeps the message as typed.
      // With nothing to ask, the provider is started in the same tick as the send.
      const { context } = this
      const told = async (fresh: boolean): Promise<string> => {
        const lines = context ? await context(chatId, provider, fresh).catch(() => null) : null
        return lines ? `${lines}\n\n${text}` : text
      }
      const first = context ? await told(session.id === null) : text
      result = await adapter.run({ chatId, turnId: turn.id, cwd, sessionId: session.id, model, text: first, handoff }, sink)
      if (result.sessionLost && !live.stopRequested) {
        // The provider dropped its session: start a new one and hand over the whole chat.
        this.store.setSession(chatId, provider, { sessionId: null, seenTurnSeq: 0 })
        session.id = null
        const full = this.handoffFor(chatId, 0, turn.seq)
        turn.handoffTurns = full?.turns ?? 0
        result = await adapter.run({ chatId, turnId: turn.id, cwd, sessionId: null, model, text: await told(true), handoff: full }, sink)
      }
    } catch (error) {
      result = { status: 'failed', error: messageOf(error) }
    }
    if (result.sessionLost) result = { status: 'failed', error: `${provider} could not start a session for this chat` }
    this.endTurn(live, result, session.id)
  }

  /**
   * A turn the provider began by itself, such as Claude Code answering when a background task
   * it started has finished. Without this its reply had nowhere to go and was lost. The turn has
   * no message of the user's; a notice says what woke it.
   */
  private openUnprompted(chatId: string, provider: ProviderId, reason: string): UnpromptedTurn | null {
    const chat = this.store.chat(chatId)
    if (!chat || this.live.has(chatId)) return null
    const adapter = this.adapters[provider]
    const turn = this.store.createTurn({
      id: randomUUID(), chatId, provider, model: null, status: 'running', error: null,
      handoffTurns: 0, goalRole: null, changes: null, startedAt: Date.now(), endedAt: null
    })
    const live: LiveTurn = { turn, adapter, clock: { sent: performance.now(), firstEvent: null, firstText: null }, items: new Map(), stopRequested: false }
    this.live.set(chatId, live)
    const updated: Chat = { ...chat, lastProvider: provider, updatedAt: Date.now() }
    this.store.updateChat(updated)
    this.emit({ type: 'chat', chat: updated })
    this.emit({ type: 'turn', turn: publicTurn(turn) })
    this.putItem(live, { type: 'notice', id: `${turn.id}:woke`, turnId: turn.id, text: reason, tone: 'info' })
    const session = { id: this.store.session(chatId, provider).sessionId }
    let ended = false
    return {
      turnId: turn.id,
      sink: this.sinkFor(live, session),
      finish: (result) => {
        if (ended) return
        ended = true
        this.endTurn(live, result.sessionLost ? { status: 'failed', error: result.error ?? 'The session was lost' } : result, session.id)
      }
    }
  }

  /** Where an adapter sends a turn's stream. The session id it reports is saved at once, so a crash mid-turn can still resume. */
  private sinkFor(live: LiveTurn, session: { id: string | null }): TurnSink {
    const { turn, clock } = live
    const { chatId, provider } = turn
    const mark = (text: boolean): void => {
      clock.firstEvent ??= performance.now()
      if (text) clock.firstText ??= performance.now()
    }
    const readable = (item: Item | undefined): boolean => item?.type === 'assistant' || item?.type === 'reasoning'
    return {
      item: (item) => {
        mark(readable(item) && 'text' in item && item.text.length > 0)
        this.putItem(live, item)
      },
      delta: (itemId, delta) => {
        mark(delta.length > 0 && readable(live.items.get(itemId)))
        this.applyDelta(live, itemId, delta)
      },
      session: (id) => {
        mark(false)
        // What the session has seen moves at the end.
        session.id = id
        this.store.setSession(chatId, provider, { sessionId: id, seenTurnSeq: this.store.session(chatId, provider).seenTurnSeq })
      },
      model: (model) => {
        mark(false)
        if (turn.model === model) return
        turn.model = model
        this.store.updateTurn(turn)
        this.emit({ type: 'turn', turn: publicTurn(turn) })
      },
      usage: (snapshot) => this.noteUsage(snapshot),
      activity: (text) => {
        if ((turn.activity ?? null) === text) return
        turn.activity = text
        this.emit({ type: 'turn', turn: publicTurn(turn) })
      }
    }
  }

  /** Settle a turn: final items, status, what the provider's session now holds, and timing. */
  private endTurn(live: LiveTurn, result: RunResult, sessionId: string | null): void {
    const { turn, clock } = live
    const { chatId, provider } = turn
    // Whatever was still streaming is final now.
    for (const item of live.items.values()) {
      if ((item.type === 'assistant' || item.type === 'reasoning') && item.streaming) this.putItem(live, { ...item, streaming: false })
      else if (item.type === 'tool' && item.status === 'running') {
        this.putItem(live, { ...item, status: result.status === 'completed' ? 'done' : 'failed' })
      }
    }
    turn.status = live.stopRequested && result.status !== 'completed' ? 'interrupted' : result.status
    turn.error = turn.status === 'failed' ? result.error ?? 'The turn failed' : null
    turn.endedAt = Date.now()
    turn.activity = null
    this.store.updateTurn(turn)
    // The session now contains this turn, unless it failed before the provider took the message.
    // A failed turn that got as far as a reply or a tool call was taken: handing it over again
    // later would give the provider its own turn back as someone else's.
    const taken = turn.status !== 'failed'
      || [...live.items.values()].some((item) => item.type === 'assistant' || item.type === 'reasoning' || item.type === 'tool')
    if (taken) this.store.setSession(chatId, provider, { sessionId, seenTurnSeq: turn.seq })
    this.live.delete(chatId)
    this.emit({ type: 'turn', turn: publicTurn(turn) })
    this.onTiming({
      chatId,
      provider,
      model: turn.model,
      status: turn.status,
      error: turn.error,
      firstEventMs: clock.firstEvent === null ? null : clock.firstEvent - clock.sent,
      firstTextMs: clock.firstText === null ? null : clock.firstText - clock.sent,
      totalMs: performance.now() - clock.sent
    })
    void this.usage(provider, true)
  }

  /** The turns after `seenSeq` (and before `beforeSeq`), as a handoff for a provider that missed them. */
  private handoffFor(chatId: string, seenSeq: number, beforeSeq = Number.MAX_SAFE_INTEGER): Handoff | null {
    const missed: MissedTurn[] = this.store.turnsAfter(chatId, seenSeq)
      .filter((turn) => turn.seq < beforeSeq)
      .map((turn) => ({
        provider: turn.provider,
        model: turn.model,
        status: turn.status,
        items: this.store.turnItems(chatId, turn.id)
      }))
    return buildHandoff(missed, undefined, this.store.chat(chatId)?.cwd ?? null)
  }

  private putItem(live: LiveTurn, item: Item): void {
    live.items.set(item.id, item)
    this.store.putItem(live.turn.chatId, item)
    this.emit({ type: 'item', chatId: live.turn.chatId, item })
  }

  private applyDelta(live: LiveTurn, itemId: string, delta: string): void {
    const item = live.items.get(itemId)
    if (!item) return
    if (item.type === 'assistant' || item.type === 'reasoning') live.items.set(itemId, { ...item, text: item.text + delta })
    else if (item.type === 'tool') live.items.set(itemId, { ...item, output: item.output + delta })
    else return
    this.emit({ type: 'delta', chatId: live.turn.chatId, itemId, delta })
  }

  private requireChat(chatId: string): Chat {
    const chat = this.store.chat(chatId)
    if (!chat) throw new Error('That chat no longer exists')
    return chat
  }
}
