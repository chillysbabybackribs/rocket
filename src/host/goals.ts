import { randomUUID } from 'node:crypto'
import {
  PROVIDERS, providerLabel,
  type Chat, type Goal, type GoalAgent, type GoalEdit, type GoalRole, type GoalRound, type GoalVerdict,
  type Item, type ProviderId, type Turn, type UsageSnapshot
} from '../shared/types.ts'
import { messageOf, oneLine, recordOf, stringOf } from './json.ts'
import type { Store } from './store.ts'

// Goals: the user says what they want done; the worker drafts a brief (the goal restated, a
// checklist of what "done" means, at most one question); the user confirms it; then the worker
// works in ordinary turns and a second provider checks each round against the checklist, until
// every line is met. A goal is a chat, so its turns, handoff, browser tabs and commits are the
// hub's as for any chat; this file only decides what to send next and when to ask the user.
//
// The models decide how to work and when they are done. There are no step, time or token
// limits. The runner stops to ask the user only when the worker asks, when two checks in a row
// find the same gap, when a turn fails twice, or when a usage window reaches the goal's pause
// level (then it carries on by itself when the window resets).

/** What the runner needs of the hub. Narrow, so it can be tested without a provider. */
export type GoalHub = {
  createChat(cwd: string, title: string): Chat
  send(chatId: string, provider: ProviderId, model: string | null, text: string, goalRole: GoalRole): string
  stop(chatId: string): Promise<void>
  usage(provider: ProviderId): Promise<UsageSnapshot>
  turnItems(chatId: string, turnId: string): Item[]
}

/** What `goal_report` hands over, by the role of the turn that called it. */
export type GoalReport =
  | { role: 'draft'; goal: string; criteria: Array<{ text: string; how: string }>; question: { text: string; options: string[] } | null }
  | { role: 'work'; status: 'done' | 'needs_you'; summary: string }
  | { role: 'check'; verdicts: GoalVerdict[]; findings: string }

const DEFAULT_PAUSE_AT = 90
const MAX_CRITERIA = 8
/** A failed turn is tried once more before the user is asked. */
const TRIES = 2
/** A goal waiting on usage starts this long after the window says it resets. */
const RESUME_SLACK_MS = 60_000

export class GoalRunner {
  /** turnId → the goal and role of a goal turn in flight. */
  private readonly turns = new Map<string, { goalId: string; role: GoalRole }>()
  /** turnId → what that turn reported, until it ends. */
  private readonly reports = new Map<string, GoalReport>()
  /** Goals to pause when their turn in flight ends. */
  private readonly pausing = new Set<string>()
  /** goalId → failed tries of the step it is on. */
  private readonly failures = new Map<string, number>()
  /** Goals whose checker has been asked once already for a missing verdict. */
  private readonly nudged = new Set<string>()
  /** Goals resumed by the user, which go ahead once whatever the usage. */
  private readonly forced = new Set<string>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  /** The app is quitting: turns about to be cut off are the app's doing, not the user's. */
  private closing = false

  constructor(
    private readonly store: Store,
    private readonly hub: GoalHub,
    private readonly emit: (goal: Goal) => void,
    private readonly now: () => number = Date.now
  ) {
    this.recover()
  }

  list(): Goal[] {
    return this.store.goals()
  }

  /** Start a goal: a chat of its own, whose worker drafts the brief for the user to confirm. */
  draft(input: { cwd: string; text: string; provider: ProviderId; model: string | null }): Goal {
    const request = input.text.trim()
    if (!request) throw new Error('Say what you want done first.')
    const chat = this.hub.createChat(input.cwd, oneLine(request, 60))
    const at = this.now()
    const worker = { provider: input.provider, model: input.model }
    const goal: Goal = {
      id: randomUUID(), chatId: chat.id, cwd: input.cwd, request, title: oneLine(request, 80),
      goal: '', criteria: [], question: null, worker, checker: { ...worker },
      pauseAtPercent: DEFAULT_PAUSE_AT, status: 'drafting', next: 'draft', reason: null, resumeAt: null,
      steer: [], rounds: [], createdAt: at, updatedAt: at
    }
    this.save(goal)
    void this.pickChecker(goal.id)
    try {
      this.send(goal, 'draft', draftPrompt(goal))
    } catch (error) {
      this.ask(goal, `Rocket could not ask ${agentName(worker)} to draft the brief: ${messageOf(error)} Press Resume to try again.`)
    }
    return this.require(goal.id)
  }

  update(goalId: string, edit: GoalEdit): Goal {
    const goal = this.require(goalId)
    if (goal.status !== 'confirming') throw new Error('The brief can only be changed before the goal starts.')
    if (edit.goal !== undefined) goal.goal = edit.goal.trim()
    if (edit.criteria) {
      goal.criteria = edit.criteria
        .map((line) => ({ text: line.text.trim(), how: line.how.trim(), met: null, metInRound: null }))
        .filter((line) => line.text)
        .slice(0, MAX_CRITERIA)
    }
    if (edit.answer !== undefined && goal.question) goal.question.answer = edit.answer
    if (edit.worker) goal.worker = edit.worker
    if (edit.checker) goal.checker = edit.checker
    if (edit.pauseAtPercent !== undefined) goal.pauseAtPercent = Math.min(100, Math.max(50, Math.round(edit.pauseAtPercent)))
    return this.save(goal)
  }

  start(goalId: string): Goal {
    const goal = this.require(goalId)
    if (goal.status !== 'confirming') throw new Error('This goal has already started.')
    if (!goal.goal || !goal.criteria.length) throw new Error('Add the goal and at least one line of what done means before starting.')
    this.save({ ...goal, status: 'working', next: 'work', reason: null })
    void this.advance(goalId)
    return this.require(goalId)
  }

  pause(goalId: string): Goal {
    const goal = this.require(goalId)
    if (this.inFlight(goalId)) {
      this.pausing.add(goalId)
      return this.save({ ...goal, reason: 'Pauses when this turn ends.' })
    }
    if (goal.status !== 'needs_you') throw new Error('Only a goal that is working or waiting can be paused.')
    this.clearTimer(goalId)
    return this.save({ ...goal, status: 'paused', resumeAt: null })
  }

  resume(goalId: string): Goal {
    const goal = this.require(goalId)
    if (this.inFlight(goalId)) {
      this.pausing.delete(goalId)
      return this.save({ ...goal, reason: null })
    }
    if (goal.status !== 'paused' && goal.status !== 'needs_you') throw new Error('This goal is not paused.')
    this.clearTimer(goalId)
    this.forced.add(goalId)
    this.save({ ...goal, status: runningStatus(goal.next), reason: null, resumeAt: null })
    void this.advance(goalId)
    return this.require(goalId)
  }

  stop(goalId: string): Goal {
    const goal = this.require(goalId)
    if (goal.status === 'done' || goal.status === 'stopped') return goal
    this.clearTimer(goalId)
    this.pausing.delete(goalId)
    const stopped = this.save({ ...goal, status: 'stopped', reason: null, resumeAt: null })
    if (this.inFlight(goalId)) void this.hub.stop(goal.chatId).catch(() => {})
    return stopped
  }

  /** A note for the next work round. A goal waiting on the user takes it as the answer and carries on. */
  steer(goalId: string, text: string): Goal {
    const note = text.trim()
    if (!note) throw new Error('Write the note first.')
    const goal = this.require(goalId)
    if (goal.status === 'done' || goal.status === 'stopped') throw new Error('This goal has ended. Start a new one to carry on.')
    const steered = this.save({ ...goal, steer: [...goal.steer, note] })
    return steered.status === 'needs_you' ? this.resume(goalId) : steered
  }

  /** What `goal_report` was called with. Returns what to tell the model. */
  report(chatId: string | null, args: Record<string, unknown>): { ok: boolean; text: string } {
    const goal = chatId ? this.store.goals().find((entry) => entry.chatId === chatId) : undefined
    const live = goal ? [...this.turns.entries()].find(([, entry]) => entry.goalId === goal.id) : undefined
    if (!goal || !live) return { ok: false, text: 'No goal turn is running in this chat, so there is nothing to report. Answer the user in your reply instead.' }
    const [turnId, { role }] = live
    const parsed = parseReport(role, args, goal.criteria.length)
    if (typeof parsed === 'string') return { ok: false, text: parsed }
    this.reports.set(turnId, parsed)
    return { ok: true, text: 'Reported to Rocket. Finish your reply and end your turn.' }
  }

  /** A turn has ended. Called for every turn; those that are not a goal's are ignored. */
  turnEnded(turn: Turn): void {
    const entry = this.turns.get(turn.id)
    if (!entry) return
    this.turns.delete(turn.id)
    const report = this.reports.get(turn.id)
    this.reports.delete(turn.id)
    const goal = this.store.goal(entry.goalId)
    if (!goal || goal.status === 'stopped') return
    try {
      this.ended(goal, entry.role, turn, report)
    } catch (error) {
      this.ask(goal, `Rocket could not carry on with this goal: ${messageOf(error)} Press Resume to try again.`)
    }
  }

  /**
   * The files a turn changed, as found by comparing the folder before and after it. That catches
   * edits made through shell commands, which the turn's own edit items miss.
   */
  noteFiles(turnId: string, files: string[]): void {
    if (!files.length) return
    const goal = this.store.goals().find((entry) => entry.rounds.some((round) => round.workTurnId === turnId))
    const round = goal?.rounds.find((entry) => entry.workTurnId === turnId)
    if (!goal || !round) return
    const merged = [...new Set([...round.files, ...files])]
    if (merged.length === round.files.length) return
    round.files = merged
    this.save(goal)
  }

  /** The chat is gone, and its goal with it. */
  forget(chatId: string): void {
    for (const [turnId, entry] of this.turns) {
      if (this.store.goal(entry.goalId)?.chatId !== chatId) continue
      this.turns.delete(turnId)
      this.reports.delete(turnId)
    }
  }

  shutdown(): void {
    this.closing = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  private ended(goal: Goal, role: GoalRole, turn: Turn, report: GoalReport | undefined): void {
    if (turn.status === 'interrupted') {
      this.pausing.delete(goal.id)
      if (role === 'work') endRound(goal, this.now())
      if (role === 'check') goal.rounds.at(-1)!.checkTurnId = null
      const reason = this.closing ? 'Rocket was closed during this turn. Press Resume to carry on.' : 'The turn was stopped before it finished. Press Resume to carry on.'
      this.save({ ...goal, status: 'paused', next: role, reason })
      return
    }
    if (turn.status === 'failed') {
      const tries = (this.failures.get(goal.id) ?? 0) + 1
      if (role === 'work') goal.rounds.pop()
      if (role === 'check') goal.rounds.at(-1)!.checkTurnId = null
      goal.next = role
      if (tries < TRIES) {
        this.failures.set(goal.id, tries)
        this.save(goal)
        void this.advance(goal.id)
        return
      }
      this.failures.delete(goal.id)
      this.ask(goal, `${agentName(role === 'check' ? goal.checker : goal.worker)} could not finish its turn twice in a row: ${oneLine(turn.error ?? 'no reason given', 200)} Press Resume to try again.`)
      return
    }
    this.failures.delete(goal.id)
    const items = this.hub.turnItems(goal.chatId, turn.id)

    if (role === 'draft') {
      if (report?.role !== 'draft') {
        goal.next = 'draft'
        this.ask(goal, `${agentName(goal.worker)} replied without drafting the brief. Answer it below, or press Resume to ask again.`)
        return
      }
      goal.goal = report.goal
      goal.criteria = report.criteria.map((line) => ({ ...line, met: null, metInRound: null }))
      goal.question = report.question ? { ...report.question, answer: null } : null
      goal.steer = []
      this.settle({ ...goal, status: 'confirming', next: 'work', reason: null })
      return
    }

    if (role === 'work') {
      const round = goal.rounds.at(-1)!
      const said = report?.role === 'work' ? report.summary : ''
      round.summary = said || oneLine(lastReply(items), 600)
      round.files = editedIn(items)
      if (report?.role === 'work' && report.status === 'needs_you') {
        endRound(goal, this.now())
        goal.next = 'work'
        this.ask(goal, `${agentName(goal.worker)} needs you: ${oneLine(round.summary, 400)}`)
        return
      }
      goal.next = 'check'
      this.carryOn(goal)
      return
    }

    const round = goal.rounds.at(-1)!
    if (report?.role !== 'check') {
      round.checkTurnId = null
      goal.next = 'check'
      if (!this.nudged.has(goal.id)) {
        this.nudged.add(goal.id)
        this.save(goal)
        this.send(goal, 'check', 'You ended your turn without calling goal_report. Call it now with a verdict for every line and your findings, then end your turn.')
        return
      }
      this.nudged.delete(goal.id)
      this.ask(goal, `${agentName(goal.checker)} finished checking without a verdict. Press Resume to ask it again.`)
      return
    }
    this.nudged.delete(goal.id)
    round.verdicts = report.verdicts
    round.findings = report.findings
    round.endedAt = this.now()
    for (const verdict of report.verdicts) {
      const line = goal.criteria[verdict.line - 1]
      if (!line) continue
      if (verdict.met && !line.met) line.metInRound = round.n
      if (!verdict.met) line.metInRound = null
      line.met = verdict.met
    }
    if (goal.criteria.every((line) => line.met)) {
      this.settle({ ...goal, status: 'done', reason: null })
      return
    }
    goal.next = 'work'
    const previous = goal.rounds.slice(0, -1).reverse().find((entry) => entry.findings !== null)
    if (previous && sameGap(previous, round)) {
      this.ask(goal, `${agentName(goal.checker)} found the same gap twice in a row: ${oneLine(report.findings || 'see its verdict', 300)} Add a note to point the way, or press Resume to let ${agentName(goal.worker)} try again.`)
      return
    }
    this.carryOn(goal)
  }

  /** Save, then take the next step unless the user asked to pause. */
  private carryOn(goal: Goal): void {
    if (this.pausing.delete(goal.id)) {
      this.save({ ...goal, status: 'paused', reason: null })
      return
    }
    this.save({ ...goal, status: runningStatus(goal.next) })
    void this.advance(goal.id)
  }

  /** Save a goal that has reached a resting state; a pause asked for on the way is no longer needed. */
  private settle(goal: Goal): void {
    this.pausing.delete(goal.id)
    this.save(goal)
  }

  /** Take the goal's next step: check the usage, then send the turn. */
  private async advance(goalId: string): Promise<void> {
    let goal = this.require(goalId)
    const role = goal.next
    if (role !== 'draft') {
      const agent = role === 'check' ? goal.checker : goal.worker
      const forced = this.forced.delete(goalId)
      const over = forced ? null : await this.overUsage(agent.provider, goal.pauseAtPercent)
      goal = this.require(goalId)
      // The user may have paused or stopped it while the usage was being read.
      if (goal.status !== runningStatus(role)) return
      if (over) {
        const resumeAt = over.resetsAt ? over.resetsAt + RESUME_SLACK_MS : null
        const when = resumeAt ? ` It carries on by itself at ${new Date(resumeAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, or press Resume to go ahead now.` : ' Press Resume to go ahead anyway.'
        this.save({ ...goal, status: 'needs_you', resumeAt, reason: `${providerLabel(agent.provider)}'s ${over.label} usage is at ${over.percent}%.${when}` })
        if (resumeAt) this.timer(goalId, resumeAt)
        return
      }
    }
    try {
      if (role === 'draft') {
        this.save({ ...goal, status: 'drafting' })
        this.send(goal, 'draft', goal.steer.length ? redraftPrompt(goal) : draftPrompt(goal))
      } else if (role === 'work') {
        const n = (goal.rounds.at(-1)?.n ?? 0) + 1
        const text = workPrompt(goal, n)
        const turnId = this.send(goal, 'work', text)
        goal = this.require(goalId)
        goal.rounds.push({ n, workTurnId: turnId, checkTurnId: null, summary: null, files: [], verdicts: [], findings: null, startedAt: this.now(), endedAt: null })
        this.save({ ...goal, steer: [], status: 'working' })
      } else {
        const turnId = this.send(goal, 'check', checkPrompt(goal))
        goal = this.require(goalId)
        goal.rounds.at(-1)!.checkTurnId = turnId
        this.save({ ...goal, status: 'checking' })
      }
    } catch (error) {
      this.ask(this.require(goalId), `Rocket could not send the next turn: ${messageOf(error)} Press Resume to try again.`)
    }
  }

  private send(goal: Goal, role: GoalRole, text: string): string {
    const agent = role === 'check' ? goal.checker : goal.worker
    const turnId = this.hub.send(goal.chatId, agent.provider, agent.model, text, role)
    this.turns.set(turnId, { goalId: goal.id, role })
    return turnId
  }

  /** The window that has reached the pause level, or null when there is none or usage cannot be read. */
  private async overUsage(provider: ProviderId, pauseAt: number): Promise<{ label: string; percent: number; resetsAt: number | null } | null> {
    try {
      const usage = await this.hub.usage(provider)
      const over = usage.windows.filter((window) => window.percent >= pauseAt).sort((a, b) => (b.resetsAt ?? 0) - (a.resetsAt ?? 0))[0]
      return over ? { label: over.label, percent: Math.round(over.percent), resetsAt: over.resetsAt } : null
    } catch {
      return null
    }
  }

  /** The checker: another provider whose usage can be read, with the most room left; the worker when there is none. */
  private async pickChecker(goalId: string): Promise<void> {
    const worker = this.require(goalId).worker.provider
    const readings = await Promise.all(PROVIDERS.filter((entry) => entry.id !== worker).map(async (entry) => {
      try {
        const usage = await this.hub.usage(entry.id)
        if (usage.unavailable) return null
        return { provider: entry.id, used: Math.max(0, ...usage.windows.map((window) => window.percent)) }
      } catch {
        return null
      }
    }))
    const best = readings.filter((entry) => entry !== null).sort((a, b) => a.used - b.used)[0]
    const goal = this.store.goal(goalId)
    if (!best || !goal || (goal.status !== 'drafting' && goal.status !== 'confirming')) return
    this.save({ ...goal, checker: { provider: best.provider, model: null } })
  }

  private ask(goal: Goal, reason: string): void {
    this.pausing.delete(goal.id)
    this.save({ ...goal, status: 'needs_you', reason, resumeAt: null })
  }

  private inFlight(goalId: string): boolean {
    return [...this.turns.values()].some((entry) => entry.goalId === goalId)
  }

  private timer(goalId: string, at: number): void {
    this.clearTimer(goalId)
    const timer = setTimeout(() => {
      this.timers.delete(goalId)
      const goal = this.store.goal(goalId)
      if (goal?.status === 'needs_you' && goal.resumeAt) this.resume(goalId)
    }, Math.max(0, at - this.now()))
    timer.unref?.()
    this.timers.set(goalId, timer)
  }

  private clearTimer(goalId: string): void {
    clearTimeout(this.timers.get(goalId))
    this.timers.delete(goalId)
  }

  /** Goals whose turn was cut off by the app closing wait for the user; ones waiting on usage wait again. */
  private recover(): void {
    for (const goal of this.store.goals()) {
      if (goal.status === 'drafting' || goal.status === 'working' || goal.status === 'checking') {
        if (goal.status === 'working') endRound(goal, this.now())
        if (goal.status === 'checking') goal.rounds.at(-1)!.checkTurnId = null
        this.save({ ...goal, status: 'paused', next: goal.status === 'drafting' ? 'draft' : goal.status === 'working' ? 'work' : 'check', reason: 'Rocket was closed during this turn. Press Resume to carry on.' })
      } else if (goal.status === 'needs_you' && goal.resumeAt) {
        this.timer(goal.id, goal.resumeAt)
      }
    }
  }

  private require(goalId: string): Goal {
    const goal = this.store.goal(goalId)
    if (!goal) throw new Error('That goal no longer exists.')
    return goal
  }

  private save(goal: Goal): Goal {
    const saved = { ...goal, updatedAt: this.now() }
    this.store.putGoal(saved)
    this.emit(saved)
    return saved
  }
}

function runningStatus(role: GoalRole): Goal['status'] {
  return role === 'draft' ? 'drafting' : role === 'work' ? 'working' : 'checking'
}

/** A work round that will not be checked: it ends here, and the next work starts a new one. */
function endRound(goal: Goal, at: number): void {
  const round = goal.rounds.at(-1)
  if (round && round.endedAt === null) round.endedAt = at
}

/** The same lines unmet as last time, and no more lines met. */
function sameGap(before: GoalRound, after: GoalRound): boolean {
  const unmet = (round: GoalRound): string => round.verdicts.filter((verdict) => !verdict.met).map((verdict) => verdict.line).sort().join(',')
  const met = (round: GoalRound): number => round.verdicts.filter((verdict) => verdict.met).length
  return unmet(before) === unmet(after) && met(after) <= met(before)
}

function agentName(agent: GoalAgent): string {
  return providerLabel(agent.provider)
}

function lastReply(items: Item[]): string {
  return items.filter((item) => item.type === 'assistant').at(-1)?.text ?? ''
}

function editedIn(items: Item[]): string[] {
  return [...new Set(items.flatMap((item) => (item.type === 'tool' && item.kind === 'edit' && item.status !== 'failed' ? item.label.split(', ').filter(Boolean) : [])))]
}

/** The tool's arguments for the calling turn's role, or a sentence saying what is wrong with them. */
export function parseReport(role: GoalRole, args: Record<string, unknown>, lines: number): GoalReport | string {
  if (role === 'draft') {
    const goal = stringOf(args.goal).trim()
    const criteria = (Array.isArray(args.criteria) ? args.criteria : [])
      .map((entry) => ({ text: stringOf(recordOf(entry).text).trim(), how: stringOf(recordOf(entry).how).trim() }))
      .filter((entry) => entry.text)
    if (!goal || !criteria.length) return 'You are drafting the brief: give `goal` and at least one line in `criteria`, each with `text` and `how`.'
    const question = recordOf(args.question)
    const text = stringOf(question.text).trim()
    const options = (Array.isArray(question.options) ? question.options : []).map(stringOf).map((option) => option.trim()).filter(Boolean).slice(0, 4)
    return { role, goal, criteria: criteria.slice(0, MAX_CRITERIA), question: text ? { text, options } : null }
  }
  if (role === 'work') {
    const status = stringOf(args.status)
    if (status !== 'done' && status !== 'needs_you') return 'You are working on the goal: give `status` as "done" or "needs_you", and a `summary` (with your question, for needs_you).'
    return { role, status, summary: stringOf(args.summary).trim() }
  }
  const verdicts = (Array.isArray(args.verdicts) ? args.verdicts : []).flatMap((entry): GoalVerdict[] => {
    const record = recordOf(entry)
    const line = Number(record.line)
    if (!Number.isInteger(line) || line < 1 || line > lines || typeof record.met !== 'boolean') return []
    return [{ line, met: record.met, evidence: stringOf(record.evidence).trim() }]
  })
  if (!verdicts.length) return `You are checking the goal: give \`verdicts\`, one per line numbered 1 to ${lines}, each with \`line\`, \`met\` (true or false) and \`evidence\`, and your \`findings\`.`
  return { role, verdicts, findings: stringOf(args.findings).trim() }
}

// The app's messages to the models. Plain sentences: each provider runs them in its own way.

function numbered(goal: Goal): string {
  return goal.criteria.map((line, index) => `${index + 1}. ${line.text} (checked by: ${line.how})`).join('\n')
}

function draftPrompt(goal: Goal): string {
  return `The user wants this done, in their own words:
"${goal.request}"

Before any work starts, draft a short brief for them to confirm. Look at the folder as much as you need to understand what they mean, but change nothing yet. Then call goal_report with:
- goal: one or two plain sentences saying what will be true when it is finished.
- criteria: 2 to 6 lines that together define done. Each is one fact about the finished result that someone could check, in plain words the user understands, with how it will be checked in a few words (for example "runs the tests", "screenshot", "tried in the browser"). Leave out anything they did not ask for.
- question: only if one answer would really change the work, with 2 or 3 short options.
Then end your turn with a one-line reply. Do not start the work.`
}

function redraftPrompt(goal: Goal): string {
  return `The user answered:
${goal.steer.map((note) => `- ${note}`).join('\n')}

Draft the brief again with that in mind and call goal_report with goal, criteria and, if still needed, question. Do not start the work.`
}

function workPrompt(goal: Goal, n: number): string {
  const notes = goal.steer.length ? `\n\nNotes from the user:\n${goal.steer.map((note) => `- ${note}`).join('\n')}` : ''
  const checker = agentName(goal.checker)
  if (n === 1) {
    const answer = goal.question?.answer ? `\n\nThey were asked "${goal.question.text}" and answered: ${goal.question.answer}` : goal.question ? `\n\nThey were asked "${goal.question.text}" and left it to you.` : ''
    return `The user confirmed this goal. Work on it until it is finished.

Goal: ${goal.goal}

Done when:
${numbered(goal)}${answer}${notes}

Work the way you normally would, for as long as it takes, and check your own work as you go. When every line is true, call goal_report with status "done" and a short summary of what you did. If you reach a decision only the user can make, call goal_report with status "needs_you" and the question as the summary, and end your turn. After you finish, ${checker} will check each line independently.`
  }
  const last = goal.rounds.at(-1)
  const unmet = goal.criteria.flatMap((line, index) => (line.met ? [] : [`${index + 1}. ${line.text}`])).join('\n')
  const findings = last?.findings ? `${checker} checked your last round and found:\n${last.findings}\n\n` : ''
  return `${findings}Still not met:
${unmet || '(none listed; see the notes)'}${notes}

Carry on until every line is true, then call goal_report with status "done" and a summary, or with "needs_you" and your question.`
}

function checkPrompt(goal: Goal): string {
  const round = goal.rounds.at(-1)
  const said = round?.summary ? `\n\n${agentName(goal.worker)} says it did this:\n${round.summary}` : ''
  return `You are checking another assistant's work for the user. Its turns are above.

Goal: ${goal.goal}

Done when:
${numbered(goal)}${said}

Check every line yourself: run the commands, open the pages in the browser, read the code. Do not take its account on trust, and do not change any files. Then call goal_report with verdicts (one for each line: line number, met true or false, and the evidence in a sentence) and findings (what is still wrong, specific enough to fix, or empty when every line is met). Then end your turn.`
}
