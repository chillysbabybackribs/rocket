import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Chat, Item, ProviderId, Turn } from '../shared/types.ts'
import type { Orchestration, OrchestratorTask } from '../shared/orchestrator.ts'
import { messageOf } from './json.ts'

export const NOTES_MARKER = '<!-- rocket-orchestrator:user-notes -->'
const NOTES_DEFAULT = '\n## User notes\n\nEdit this section to steer the next review, or message the orchestrator chat.\n'

type OrchestratorStore = { chat(id: string): Chat | null }
export type OrchestratorHub = {
  createChat(cwd: string, title: string): Chat
  send(chatId: string, provider: ProviderId, model: string | null, text: string): string
  working(): Array<{ chatId: string; provider: ProviderId }>
  turnItems(chatId: string, turnId: string): Item[]
  stop(chatId: string): Promise<void>
}

/** The host schedules turns; the owning model reviews evidence and chooses deeper work. */
export class Orchestrator {
  private readonly runs = new Map<string, Orchestration>()
  private readonly notesRead = new Map<string, { stamp: string; notes: string }>()
  private readonly wake = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private closing = false
  stateError: string | null = null

  constructor(
    private readonly stateFile: string,
    private readonly store: OrchestratorStore,
    private readonly hub: OrchestratorHub,
    private readonly emit: (run: Orchestration) => void,
    private readonly now: () => number = Date.now
  ) {
    if (existsSync(stateFile)) {
      let saved: Orchestration[]
      try {
        saved = JSON.parse(readFileSync(stateFile, 'utf8')) as Orchestration[]
        if (!Array.isArray(saved) || saved.some(run => !run || typeof run.chatId !== 'string' || typeof run.progressFile !== 'string' || !Array.isArray(run.tasks))) throw new Error('Invalid orchestration state')
      } catch (error) {
        this.stateError = `Cannot read saved orchestration state at ${stateFile}: ${messageOf(error)}. The file was preserved.`
        return
      }
      for (const run of saved) {
        // Restart never silently spends usage or assumes a killed provider stopped cleanly.
        if (run.status === 'running' || run.status === 'draining') {
          run.status = 'paused'
          run.reason = 'Rocket restarted. Review the saved work and resume when ready.'
        }
        run.leaderTurnId = null
        run.history ??= []
        for (const task of run.tasks) if (task.status === 'running') {
          task.status = 'interrupted'
          task.result = 'Interrupted by host restart; inspect the report before retrying.'
        }
        this.runs.set(run.chatId, run)
        this.save(run)
      }
    }
  }

  startMonitoring(): void {
    this.timer ??= setInterval(() => this.tick(), 2_000)
    this.timer.unref()
  }

  list(): Orchestration[] { return structuredClone([...this.runs.values()]) }
  get(chatId: string): Orchestration | null { return structuredClone(this.runs.get(chatId) ?? null) }

  start(chatId: string, provider: ProviderId, task: string): Orchestration {
    if (this.stateError) throw new Error(this.stateError)
    if (this.runs.has(chatId)) throw new Error('This chat already owns an orchestration. Resume it or use a new chat.')
    if ([...this.runs.values()].some(run => run.tasks.some(each => each.chatId === chatId))) throw new Error('Workers cannot start nested orchestrations.')
    const chat = this.store.chat(chatId)
    if (!chat) throw new Error('Open a chat with a working folder first.')
    if (!task.trim()) throw new Error('Give the orchestrator a task.')
    const id = randomUUID()
    const run: Orchestration = {
      id, chatId, provider, cwd: chat.cwd, task: task.trim(),
      progressFile: join(chat.cwd, 'docs', 'orchestrator', id, 'progress.md'),
      status: 'running', reason: null, summary: 'Starting the task and choosing the first investigations.',
      next: 'Review the task and dispatch focused work.', notes: NOTES_DEFAULT, updates: [], history: [], tasks: [],
      checkpointCycle: 0, cycle: 0, leaderTurnId: null, createdAt: this.now(), updatedAt: this.now()
    }
    this.runs.set(chatId, run)
    this.save(run)
    this.wake.add(chatId)
    return this.get(chatId)!
  }

  dispatch(chatId: string, provider: ProviderId, task: string): Orchestration {
    const run = this.require(chatId)
    if (run.status !== 'running') throw new Error('Resume the orchestrator before dispatching work.')
    if (!task.trim()) throw new Error('Give the worker a focused assignment.')
    if (provider === 'antigravity' && (run.provider === 'antigravity' || this.hub.working().some(turn => turn.provider === provider))) throw new Error('Antigravity uses shared tool identity and is already reserved or running. Choose another available worker provider.')
    if (run.tasks.some(each => each.status !== 'running' && !each.review)) throw new Error('Review the finished worker evidence with checkpoint before dispatching deeper work.')
    const active = run.tasks.filter(each => each.status === 'running')
    if (active.length >= 3) throw new Error('Three workers are already running. Review completed work or wait.')
    if (active.some(each => each.provider === provider)) throw new Error('This provider already has an active worker in this orchestration.')
    const id = String(run.tasks.length + 1).padStart(4, '0')
    const chat = this.hub.createChat(run.cwd, `Orchestrator ${id}: ${task.trim().slice(0, 65)}`)
    const report = join(dirname(run.progressFile), `task-${id}-${provider}.md`)
    const worker: OrchestratorTask = { id, chatId: chat.id, turnId: null, provider, task: task.trim(), report, status: 'running', result: '', review: null }
    run.tasks.push(worker)
    // Persist ownership before starting a turn, so recovery never adopts an unrelated chat.
    this.save(run)
    if (run.status !== 'running') {
      worker.status = 'failed'
      worker.result = 'Not dispatched because the progress file could not be updated.'
      this.save(run)
      return this.get(chatId)!
    }
    try {
      worker.turnId = this.hub.send(chat.id, provider, null, [
        '<rocket-orchestration>\nYou are one worker in a continuous orchestration. Complete this assignment, write the report, and end your turn. The owning chat reviews your evidence and chooses the next task.',
        `User task: ${run.task}`, `Assignment: ${worker.task}`,
        `Write your report to ${report}. Keep isolated evidence beside it in task-${id}-evidence/.`,
        `Latest reviewed summary: ${run.summary}`, `User updates: ${run.updates.join('\n')}`, `User notes: ${run.notes}`,
        'Follow the user task’s scope. Do not expand research into implementation without authorization. Respect other workers’ files. State what was observed, what remains uncertain, and how to reproduce checks. Open primary sources for uncertain external facts.',
        'Do not create other workers, control the orchestrator, modify its progress file, or operate other chats. Do not restart or close Rocket. Finish with the report path and unresolved questions.'
      ].join('\n\n'))
    } catch (error) {
      worker.status = 'failed'
      worker.result = messageOf(error)
      this.wake.add(chatId)
    }
    this.save(run)
    return this.get(chatId)!
  }

  checkpoint(chatId: string, summary: string, next: string, taskId?: string, review?: string): Orchestration {
    const run = this.require(chatId)
    if (!summary.trim() || !next.trim()) throw new Error('Give a readable progress summary and the next question or action.')
    if (taskId) {
      const task = run.tasks.find(each => each.id === taskId)
      if (!task || task.status === 'running') throw new Error('Review a finished task from this orchestration.')
      if (!review?.trim()) throw new Error('Describe the evidence accepted, rejected, and still uncertain.')
      task.review = review.trim()
    }
    run.checkpointCycle = run.cycle
    run.summary = summary.trim()
    run.next = next.trim()
    run.history.push({ at: this.now(), summary: run.summary, next: run.next })
    this.save(run)
    return this.get(chatId)!
  }

  /** User messages are recorded before Hub posts them, so the next dispatch sees the update. */
  userMessage(chatId: string, text: string): void {
    const run = this.runs.get(chatId)
    if (!run || run.status === 'stopped') return
    run.updates.push(text)
    this.save(run)
  }

  resume(chatId: string): Orchestration {
    const run = this.require(chatId)
    if (run.status === 'draining') throw new Error('Let the current workers finish before resuming.')
    run.status = 'running'
    run.reason = null
    this.wake.add(chatId)
    this.save(run)
    return this.get(chatId)!
  }

  stop(chatId: string, drain = false): Orchestration | null {
    const run = this.runs.get(chatId)
    if (!run) return null
    run.status = drain ? 'draining' : 'stopped'
    run.reason = drain ? 'No new work. Letting current workers finish.' : 'Stopped by the user. No further work will be dispatched.'
    this.wake.delete(chatId)
    this.save(run)
    if (!drain) for (const task of run.tasks) if (task.status === 'running') {
      // A stop request is not proof of stopped work. Keep status running until the actual event.
      void this.hub.stop(task.chatId).catch(error => {
        task.result = `Stop request failed: ${messageOf(error)}`
        this.save(run)
      })
    }
    return this.get(chatId)
  }

  turnEnded(turn: Turn): void {
    for (const run of this.runs.values()) {
      const task = run.tasks.find(each => each.turnId === turn.id)
      if (task) {
        task.status = turn.status === 'completed' ? 'completed' : turn.status === 'interrupted' ? 'interrupted' : 'failed'
        const reply = this.hub.turnItems(task.chatId, turn.id).filter((item): item is Extract<Item, { type: 'assistant' }> => item.type === 'assistant').at(-1)?.text ?? ''
        task.result = turn.error ?? reply.slice(-8_000)
        let delivered = false
        try { delivered = !!readFileSync(task.report, 'utf8').trim() } catch { /* Missing/unreadable reports need review. */ }
        if (task.status === 'completed' && !delivered) {
          task.status = 'failed'
          task.result = `No report was delivered. Provider's last reply: ${task.result}`
        }
        this.wake.add(run.chatId)
        this.save(run)
      }
      if (run.chatId === turn.chatId && turn.id === run.leaderTurnId) {
        run.leaderTurnId = null
        if (turn.status !== 'completed' && run.status === 'running') {
          run.status = 'paused'
          run.reason = turn.error ?? 'The orchestrator turn was interrupted. Resume when ready.'
        }
        if (run.status === 'running' && turn.status === 'completed' && run.checkpointCycle !== run.cycle) {
          run.status = 'paused'
          run.reason = 'The review ended without a progress checkpoint. Inspect its reply and resume; no empty retry loop was started.'
        }
        if (run.status === 'draining' && !run.tasks.some(task => task.status === 'running')) {
          run.status = 'stopped'
          run.reason = turn.status === 'completed' && run.checkpointCycle === run.cycle
            ? 'Current work and final review finished. No new work will be dispatched.'
            : 'Workers finished, but the final review did not complete with a checkpoint. Inspect the saved reports before resuming.'
        }
        this.save(run)
      }
    }
  }

  /** Deterministic scheduling entry point, also used by tests. */
  tick(): void {
    if (this.closing) return
    for (const run of this.runs.values()) {
      if (run.status !== 'running' && run.status !== 'draining') continue
      try {
        const notes = this.readNotes(run)
        if (notes !== run.notes) { run.notes = notes; this.wake.add(run.chatId); this.save(run) }
        if (this.hub.working().some(turn => turn.chatId === run.chatId || (run.provider === 'antigravity' && turn.provider === 'antigravity'))) continue
        const unfinished = run.tasks.some(task => task.status === 'running')
        if (run.status === 'draining' && unfinished) continue
        if (unfinished && !this.wake.has(run.chatId)) continue
        this.wake.delete(run.chatId)
        run.cycle++
        run.leaderTurnId = this.hub.send(run.chatId, run.provider, null, this.prompt(run))
        this.save(run)
      } catch (error) {
        run.status = 'paused'
        run.reason = `Orchestration paused: ${messageOf(error)}`
        // Do not overwrite an externally edited file whose user-notes boundary was removed.
        this.persist()
        this.emit(structuredClone(run))
      }
    }
  }

  async wait(chatId: string, seconds = 20): Promise<Orchestration> {
    const before = this.require(chatId).updatedAt
    const deadline = Date.now() + Math.min(25, Math.max(1, seconds)) * 1000
    while (!this.closing && Date.now() < deadline) {
      const run = this.require(chatId)
      if (run.updatedAt !== before || run.status !== 'running') break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return this.get(chatId)!
  }

  shutdown(): void {
    this.closing = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.persist()
  }

  private prompt(run: Orchestration): string {
    return [
      '<rocket-orchestration>',
      run.status === 'draining' ? 'Final review: workers have finished. Review their results, checkpoint a final summary and next steps, then finish. Do not dispatch new work.' : `Continue the user’s orchestration (review ${run.cycle}).`,
      `Task: ${run.task}`,
      `Read and maintain ${run.progressFile} using orchestrator checkpoint. Read the actual worker reports and evidence before accepting claims.`,
      `Current summary: ${run.summary}`, `Next: ${run.next}`, `User updates: ${run.updates.join('\n')}`, `User notes: ${run.notes}`,
      `Workers: ${JSON.stringify(run.tasks.filter(task => !task.review || task.status === 'running').slice(-12).map(task => ({ ...task, result: task.result.slice(-3000) })))}`,
      'Use the orchestrator tool: checkpoint the evidence accepted/rejected and next question; dispatch fresh focused tasks based on those findings; wait for workers when needed. Worker and orchestrator turns use provider defaults. Give concise user-facing progress updates.',
      'Keep deepening the user’s task without a fixed round limit. Follow its scope; do not treat report existence or completed status as proof of correctness. If a provider fails or hits quota, record it and continue useful work with available providers without a rapid retry loop.',
      'A user message can redirect the work. On a request to stop or wrap up, call stop with drain=true to finish current workers, or drain=false to request their cancellation. Do not dispatch further work. If information only the user can supply blocks all progress, explain it and stop rather than generating empty rounds.'
    ].join('\n\n')
  }

  private require(chatId: string): Orchestration {
    const run = this.runs.get(chatId)
    if (!run) throw new Error('This chat does not own an orchestration. Start one here first.')
    return run
  }

  // The tick checks every running run's notes every 2 seconds. A progress file is only read again
  // when its modification time or size has changed.
  private readNotes(run: Orchestration): string {
    if (!existsSync(run.progressFile)) return run.notes
    const info = statSync(run.progressFile)
    const stamp = `${info.mtimeMs}:${info.size}`
    const known = this.notesRead.get(run.progressFile)
    if (known?.stamp === stamp) return known.notes
    const text = readFileSync(run.progressFile, 'utf8')
    const index = text.indexOf(NOTES_MARKER)
    if (index < 0) throw new Error('The progress file’s user-notes marker was removed. Restore it before resuming; your file was preserved.')
    const notes = text.slice(index + NOTES_MARKER.length)
    this.notesRead.set(run.progressFile, { stamp, notes })
    return notes
  }

  private save(run: Orchestration): void {
    try {
      run.notes = this.readNotes(run)
      run.updatedAt = Math.max(this.now(), run.updatedAt + 1)
      const tasks = run.tasks.map(task => [
        `### Task ${task.id} — ${task.provider} — ${task.status}`,
        task.task, `Chat: ${task.chatId}\n\nReport: [${task.report.split('/').pop()}](${task.report})`,
        task.result ? `Outcome: ${task.result}` : 'In progress.',
        task.review ? `Review: ${task.review}` : 'Review: pending.'
      ].join('\n\n')).join('\n\n')
      const text = [
        '# Orchestrator progress',
        `Status: **${run.status}** · Updated: ${new Date(run.updatedAt).toISOString()} · Review: ${run.cycle}`,
        run.reason ?? '', '## Task', run.task, '## Progress', run.summary, '## Next', run.next,
        '## User updates', run.updates.length ? run.updates.map(note => `- ${note}`).join('\n') : 'No chat updates yet.',
        '## Progress log', run.history.map(entry => `### ${new Date(entry.at).toISOString()}\n\n${entry.summary}\n\nNext: ${entry.next}`).join('\n\n') || 'No checkpoints yet.',
        '## Work and review history', tasks || 'No workers dispatched yet.',
        '---', 'The orchestrator maintains the sections above. Edit the User notes section below to steer it; those notes are preserved. Stop from the owning chat to prevent further dispatch.',
        NOTES_MARKER + run.notes
      ].filter(Boolean).join('\n\n')
      mkdirSync(dirname(run.progressFile), { recursive: true })
      writeFileSync(run.progressFile, text)
    } catch (error) {
      if (run.status === 'running' || run.status === 'draining') run.status = 'paused'
      run.reason = `Progress file could not be updated: ${messageOf(error)}`
    }
    this.persist()
    this.emit(structuredClone(run))
  }

  private persist(): void {
    if (this.stateError) return
    mkdirSync(dirname(this.stateFile), { recursive: true })
    writeFileSync(`${this.stateFile}.tmp`, JSON.stringify([...this.runs.values()], null, 2))
    renameSync(`${this.stateFile}.tmp`, this.stateFile)
  }
}
