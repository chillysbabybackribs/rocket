import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROVIDERS, providerLabel, type HostEvent, type ProviderId, type Turn } from '../shared/types.ts'
import {
  describeStep, fillPrompt, fillSources, parseFillReply, voiceSamples,
  type FillTarget, type HostToMainFill, type MainToHostFill
} from '../shared/fill.ts'
import type { Hub } from './hub.ts'
import { messageOf } from './json.ts'
import type { Store } from './store.ts'

// "Fill with Rocket", the host's half (the design is docs/mockups/fill-with-rocket.html). Main
// says what the user pointed at; this runs one turn for it in a chat of its own, in a folder of
// its own under the profile, with every tool a chat turn has. The chat never reaches the window:
// its steps go to main for the chip, its answer is read from the reply's fill block, and then the
// chat and its folder are deleted, so nothing of the fill is kept.

/** How often the chip hears of a new step at most; a model's calls can come in bursts. */
const STEP_EVERY_MS = 250

type Run = { id: string; chatId: string; cwd: string; target: FillTarget; step: string; posted: number; timer: NodeJS.Timeout | null; turnId: string | null }

/** The model a fill uses: the last one the user sent a message with. */
type Choice = { provider: ProviderId; model: string | null }

export type FillHub = Pick<Hub, 'createChat' | 'send' | 'stop' | 'deleteChat' | 'turnItems' | 'opened' | 'models' | 'usage' | 'working'>

export class FillRunner {
  private readonly runs = new Map<string, Run>()
  private readonly byChat = new Map<string, Run>()
  private readonly modelFile: string
  private last: Choice | null = null

  constructor(
    private readonly store: Store,
    private readonly hub: FillHub,
    /** Where fills work: one folder per fill, deleted when it ends. */
    readonly root: string,
    private readonly post: (message: HostToMainFill) => void,
    /** Folders whose chats are not the user's own (eval copies), so their messages are not their voice. */
    private readonly hidden: (cwd: string) => boolean = () => false,
    private readonly warn: (message: string) => void = () => {}
  ) {
    mkdirSync(root, { recursive: true })
    this.modelFile = join(root, 'model.json')
    try {
      const saved = JSON.parse(readFileSync(this.modelFile, 'utf8')) as { provider?: unknown; model?: unknown }
      if (PROVIDERS.some((entry) => entry.id === saved.provider)) {
        this.last = { provider: saved.provider as ProviderId, model: typeof saved.model === 'string' ? saved.model : null }
      }
    } catch {
      // No fill model yet: the latest chat's provider is used.
    }
  }

  /** Whether a folder is a fill's. Its chat stays out of the chat list and the library. */
  owns(cwd: string): boolean {
    return cwd.startsWith(this.root + '/')
  }

  /** Fills cut off by the last exit left their chats behind; nothing will finish them now. */
  async recover(): Promise<void> {
    for (const chat of this.store.listChats()) {
      if (this.owns(chat.cwd)) await this.hub.deleteChat(chat.id).catch(() => {})
    }
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (entry.isDirectory()) rmSync(join(this.root, entry.name), { recursive: true, force: true })
    }
  }

  /** A message the user sent from the composer: its model is the one the next fill uses. */
  noteSent(provider: ProviderId, model: string | null): void {
    if (this.last?.provider === provider && this.last.model === model) return
    this.last = { provider, model }
    try {
      writeFileSync(this.modelFile, JSON.stringify(this.last))
    } catch {
      // Remembered for this run only.
    }
    void this.announce()
  }

  /** Tell main which model the menu should name. */
  async announce(): Promise<void> {
    const { provider, model } = this.current()
    this.post({ type: 'fillModel', label: await this.label(provider, model) })
  }

  async handle(message: MainToHostFill): Promise<void> {
    if (message.type === 'fillStop') {
      const run = this.runs.get(message.id)
      if (run) await this.hub.stop(run.chatId)
      return
    }
    if (this.runs.has(message.id)) return
    const current = this.current()
    const pick: Choice = message.provider && message.provider !== current.provider ? { provider: message.provider, model: null } : current
    const fail = async (error: string): Promise<void> => this.post({ type: 'fillFailed', id: message.id, error, alternative: await this.alternative(pick.provider) })
    // Antigravity's tools reach the app on one shared address and are matched to the one chat it
    // is answering, so a second turn of its own would leave both not knowing which is which.
    if (pick.provider === 'antigravity' && this.hub.working().some((turn) => turn.provider === 'antigravity')) {
      return fail('Antigravity is answering another chat, and two of its turns at once cannot tell their tools apart. Try again when it is done, or fill with another provider.')
    }
    const cwd = join(this.root, message.id)
    mkdirSync(cwd, { recursive: true })
    const chat = this.hub.createChat(cwd, 'Fill')
    const run: Run = { id: message.id, chatId: chat.id, cwd, target: message.target, step: '', posted: 0, timer: null, turnId: null }
    this.runs.set(run.id, run)
    this.byChat.set(chat.id, run)
    const voice = message.variant === 'voice'
      ? voiceSamples(this.store.userMessages(400).filter((entry) => !this.hidden(entry.cwd) && !this.owns(entry.cwd)).map((entry) => entry.text))
      : []
    this.post({ type: 'fillChat', id: run.id, chatId: chat.id, model: await this.label(pick.provider, pick.model) })
    try {
      run.turnId = this.hub.send(chat.id, pick.provider, pick.model, fillPrompt(message.target, message.variant, message.instructions, voice))
    } catch (error) {
      await this.end(run)
      return fail(messageOf(error))
    }
  }

  /**
   * Every host event goes through here first. True for a fill's own, which the window never sees;
   * its items become the chip's steps, and its turn's end becomes the fill.
   */
  observe(event: HostEvent): boolean {
    switch (event.type) {
      case 'chat': return this.owns(event.chat.cwd)
      case 'chatDeleted': case 'queue': return this.byChat.has(event.chatId) || this.ending.has(event.chatId)
      case 'delta': return this.byChat.has(event.chatId)
      case 'item': {
        const run = this.byChat.get(event.chatId)
        if (!run) return false
        const step = describeStep(event.item, run.target.url)
        if (step && step !== run.step) {
          run.step = step
          this.sendStep(run)
        }
        return true
      }
      case 'turn': {
        const run = this.byChat.get(event.turn.chatId)
        if (!run) return false
        if (event.turn.status !== 'running') void this.finish(run, event.turn)
        return true
      }
      default: return false
    }
  }

  /** Chats being deleted, whose last events still belong to no one else. */
  private readonly ending = new Set<string>()

  async shutdown(): Promise<void> {
    await Promise.all([...this.runs.values()].map((run) => this.hub.stop(run.chatId).catch(() => {})))
  }

  private current(): Choice {
    if (this.last) return this.last
    const latest = this.store.listChats().filter((chat) => chat.lastProvider && !this.owns(chat.cwd) && !this.hidden(chat.cwd))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    return { provider: latest?.lastProvider ?? 'claude', model: null }
  }

  /** The model's name as the provider lists it; the provider's own name when the default is not listed. */
  private async label(provider: ProviderId, model: string | null): Promise<string> {
    try {
      const models = await this.hub.models(provider)
      const found = model ? models.find((entry) => entry.id === model) : models.find((entry) => entry.isDefault)
      if (found) return found.label
    } catch {
      // The list could not be read; the name below still says who answers.
    }
    return model ?? providerLabel(provider)
  }

  /** Another provider to offer when a fill fails: the one with the most usage left. */
  private async alternative(failed: ProviderId): Promise<{ provider: ProviderId; label: string } | null> {
    const readings = await Promise.all(PROVIDERS.filter((entry) => entry.id !== failed).map(async (entry) => {
      try {
        const usage = await this.hub.usage(entry.id)
        if (usage.unavailable) return null
        return { provider: entry.id, used: Math.max(0, ...usage.windows.map((window) => window.percent)) }
      } catch {
        return null
      }
    }))
    const best = readings.filter((entry) => entry !== null && entry.used < 100).sort((a, b) => a!.used - b!.used)[0]
    return best ? { provider: best.provider, label: providerLabel(best.provider) } : null
  }

  private sendStep(run: Run): void {
    const wait = STEP_EVERY_MS - (Date.now() - run.posted)
    if (wait > 0) {
      run.timer ??= setTimeout(() => { run.timer = null; this.sendStep(run) }, wait)
      return
    }
    if (!this.runs.has(run.id)) return
    run.posted = Date.now()
    const items = run.turnId ? this.hub.turnItems(run.chatId, run.turnId) : []
    this.post({ type: 'fillStep', id: run.id, step: run.step, sources: fillSources(this.hub.opened(run.chatId), items, run.target.url) })
  }

  private async finish(run: Run, turn: Turn): Promise<void> {
    if (!this.runs.has(run.id)) return
    if (run.timer) clearTimeout(run.timer)
    const items = this.hub.turnItems(run.chatId, turn.id)
    const sources = fillSources(turn.sources?.opened ?? [], items, run.target.url)
    if (turn.status === 'completed') {
      const reply = items.flatMap((item) => (item.type === 'assistant' ? [item.text] : [])).join('\n')
      try {
        const { values, left } = parseFillReply(reply, run.target.fields.map((field) => field.id))
        this.post({ type: 'fillDone', id: run.id, values, left, sources })
      } catch (error) {
        this.post({ type: 'fillFailed', id: run.id, error: messageOf(error), alternative: null })
      }
    } else if (turn.status === 'failed') {
      const error = turn.error ? `${providerLabel(turn.provider)} could not fill it: ${turn.error.replace(/\.?$/, '.')} The field is unchanged.` : 'The fill failed and the field is unchanged. Try again.'
      this.post({ type: 'fillFailed', id: run.id, error, alternative: await this.alternative(turn.provider) })
    }
    // A stopped fill says nothing: the chip closed when the user stopped it.
    await this.end(run)
  }

  private async end(run: Run): Promise<void> {
    this.runs.delete(run.id)
    this.byChat.delete(run.chatId)
    this.ending.add(run.chatId)
    try {
      await this.hub.deleteChat(run.chatId)
    } catch (error) {
      this.warn(`A fill's chat could not be deleted: ${messageOf(error)}`)
    } finally {
      this.ending.delete(run.chatId)
    }
    rmSync(run.cwd, { recursive: true, force: true })
    this.post({ type: 'fillEnded', id: run.id, chatId: run.chatId })
  }
}
