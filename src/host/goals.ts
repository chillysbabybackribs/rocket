import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { designPreparationContext } from './design-library.ts'
import {
  PROVIDERS, providerLabel,
  type Chat, type Goal, type GoalAgent, type GoalDesign, type GoalEdit, type GoalRole, type GoalRound, type GoalVerdict,
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
  | { role: 'draft'; goal: string; criteria: Array<{ text: string; how: string }>; design: GoalDesign | null; question: { text: string; options: string[] } | null }
  | { role: 'work'; status: 'done' | 'needs_you'; summary: string }
  | { role: 'check'; verdicts: GoalVerdict[]; findings: string }

const DEFAULT_PAUSE_AT = 90
const MAX_CRITERIA = 8
const MAX_REFERENCES = 5

/**
 * Added to every visual goal's checklist. Functional lines alone pass a cookie-cutter result;
 * this one asks the checker to judge the finish against the references the brief was built on.
 */
export const DESIGN_LINE = {
  text: 'Holds up side by side with the references: designed for this product, not a template, down to its empty, loading and hover states.',
  how: 'screenshots compared with the references'
}
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
      goal: '', criteria: [], design: null, question: null, worker, checker: { ...worker },
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
    if (edit.concept !== undefined && goal.design) goal.design = { ...goal.design, concept: edit.concept.trim() }
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

  /** A reference screenshot for the brief and the pane. Only the goal's own references are read. */
  referenceImage(goalId: string, index: number): string {
    const path = this.require(goalId).design?.references[index]?.screenshot
    if (!path || !isImage(path)) throw new Error('That reference screenshot is no longer on disk.')
    const type = /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : /\.gif$/i.test(path) ? 'image/gif' : 'image/jpeg'
    return `data:${type};base64,${readFileSync(path).toString('base64')}`
  }

  /** What `goal_report` was called with. Returns what to tell the model. */
  report(chatId: string | null, args: Record<string, unknown>): { ok: boolean; text: string } {
    const goal = chatId ? this.store.goals().find((entry) => entry.chatId === chatId) : undefined
    const live = goal ? [...this.turns.entries()].find(([, entry]) => entry.goalId === goal.id) : undefined
    if (!goal || !live) return { ok: false, text: 'No goal turn is running in this chat, so there is nothing to report. Answer the user in your reply instead.' }
    const [turnId, { role }] = live
    const parsed = parseReport(role, args, goal.criteria.length, goal.cwd)
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
      // A visual brief always carries the design line, so the checker judges the finish too.
      const lines = report.design && !report.criteria.some((line) => line.text === DESIGN_LINE.text)
        ? [...report.criteria.slice(0, MAX_CRITERIA - 1), DESIGN_LINE]
        : report.criteria
      goal.criteria = lines.map((line) => ({ ...line, met: null, metInRound: null }))
      goal.design = report.design
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
export function parseReport(role: GoalRole, args: Record<string, unknown>, lines: number, cwd = '/'): GoalReport | string {
  if (role === 'draft') {
    const goal = stringOf(args.goal).trim()
    const criteria = (Array.isArray(args.criteria) ? args.criteria : [])
      .map((entry) => ({ text: stringOf(recordOf(entry).text).trim(), how: stringOf(recordOf(entry).how).trim() }))
      .filter((entry) => entry.text)
    if (!goal || !criteria.length) return 'You are drafting the brief: give `goal` and at least one line in `criteria`, each with `text` and `how`.'
    const design = parseDesign(args.design, cwd)
    if (typeof design === 'string') return design
    const question = recordOf(args.question)
    const text = stringOf(question.text).trim()
    const options = (Array.isArray(question.options) ? question.options : []).map(stringOf).map((option) => option.trim()).filter(Boolean).slice(0, 4)
    return { role, goal, criteria: criteria.slice(0, MAX_CRITERIA), design, question: text ? { text, options } : null }
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

/**
 * A visual brief's design, or a sentence saying what to fix. Every reference must name a
 * screenshot that exists, so "I looked at it" can be checked rather than taken on trust.
 */
function parseDesign(value: unknown, cwd: string): GoalDesign | null | string {
  if (value === undefined || value === null) return null
  const record = recordOf(value)
  const concept = stringOf(record.concept).trim()
  const references = (Array.isArray(record.references) ? record.references : []).map((entry) => {
    const reference = recordOf(entry)
    const screenshot = stringOf(reference.screenshot).trim()
    return {
      source: stringOf(reference.source).trim(),
      screenshot: screenshot && !isAbsolute(screenshot) ? resolve(cwd, screenshot) : screenshot,
      takes: stringOf(reference.takes).trim()
    }
  }).filter((reference) => reference.source || reference.screenshot).slice(0, MAX_REFERENCES)
  if (!concept) return 'Your `design` needs a `concept`: the one idea that makes this design specific to its product, in a sentence or two. A list of styles is not a concept.'
  if (references.length < 2) return 'Your `design` needs at least two `references` you actually opened, each with `source`, the `screenshot` you saved of it, and what it `takes`.'
  const missing = references.filter((reference) => !isImage(reference.screenshot))
  if (missing.length) {
    return `These reference screenshots do not exist: ${missing.map((reference) => reference.screenshot || `(none for ${reference.source})`).join(', ')}. Open each reference and take a screenshot (browser_screenshot returns the saved path), then report again.`
  }
  if (references.some((reference) => !reference.takes)) return 'Say for each reference what this design `takes` from it.'
  return { concept, references }
}

function isImage(path: string): boolean {
  try {
    return /\.(png|jpe?g|webp|gif)$/i.test(path) && existsSync(path) && statSync(path).size > 0
  } catch {
    return false
  }
}

// The app's messages to the models. Plain sentences: each provider runs them in its own way.

function numbered(goal: Goal): string {
  return goal.criteria.map((line, index) => `${index + 1}. ${line.text} (checked by: ${line.how})`).join('\n')
}

// What a draft must add when the result is something people look at. Without it, models produce
// competent templates: a style list ("dark, compact, indigo") is not a design, and a reference
// read about is not a reference seen.
const VISUAL_DRAFT = `- design: only if the deliverable has a visual interface. Give:
  - concept: the one idea that makes this design specific to this product and its users, in a sentence or two: what the main screen leads with and why, and what someone will remember about it. Not a list of styles: "dark, compact, subtle borders" describes every dashboard. Do not borrow the look of the app you are running in unless the user asked for it.
  - references: two to five real products or designs you actually opened and looked at, each with source (the URL or library entry), screenshot (the path of a screenshot you saved of it; browser_screenshot returns one) and takes (what this design borrows from it, concretely). Rocket checks that each screenshot exists.
  Rocket adds a line to the checklist that the result must hold up side by side against these references, so choose references worth matching.`

function draftPrompt(goal: Goal): string {
  return `The user wants this done, in their own words:
"${goal.request}"

${designPreparationContext()}
Before any work starts, draft a short brief for them to confirm. Look at the folder as much as you need to understand what they mean, but change nothing yet. Then call goal_report with:
- goal: one or two plain sentences saying what will be true when it is finished.
- criteria: 2 to 6 lines that together define done. Each is one fact about the finished result that someone could check, in plain words the user understands, with how it will be checked in a few words (for example "runs the tests", "screenshot", "tried in the browser"). Leave out anything they did not ask for.
- question: only if one answer would really change the work, with 2 or 3 short options.
${VISUAL_DRAFT}
Then end your turn with a one-line reply. Do not start the work.`
}

function redraftPrompt(goal: Goal): string {
  return `The user answered:
${goal.steer.map((note) => `- ${note}`).join('\n')}

${designPreparationContext()}
Draft the brief again with that in mind and call goal_report with goal, criteria, design if the deliverable is visual and, if still needed, question. Do not start the work.`
}

function workPrompt(goal: Goal, n: number): string {
  const notes = goal.steer.length ? `\n\nNotes from the user:\n${goal.steer.map((note) => `- ${note}`).join('\n')}` : ''
  const checker = agentName(goal.checker)
  if (n === 1) {
    const answer = goal.question?.answer ? `\n\nThey were asked "${goal.question.text}" and answered: ${goal.question.answer}` : goal.question ? `\n\nThey were asked "${goal.question.text}" and left it to you.` : ''
    return `The user confirmed this goal. Work on it until it is finished.

Goal: ${goal.goal}

Done when:
${numbered(goal)}${designBrief(goal, 'work')}${answer}${notes}

Work the way you normally would, for as long as it takes, and check your own work as you go. When every line is true, call goal_report with status "done" and a short summary of what you did. If you reach a decision only the user can make, call goal_report with status "needs_you" and the question as the summary, and end your turn. After you finish, ${checker} will check each line independently.`
  }
  const last = goal.rounds.at(-1)
  const unmet = goal.criteria.flatMap((line, index) => (line.met ? [] : [`${index + 1}. ${line.text}`])).join('\n')
  const findings = last?.findings ? `${checker} checked your last round and found:\n${last.findings}\n\n` : ''
  return `${findings}Still not met:
${unmet || '(none listed; see the notes)'}${notes}

Carry on until every line is true, then call goal_report with status "done" and a summary, or with "needs_you" and your question.`
}

/** The design concept and references, and how each role should use them. Empty for goals that are not visual. */
function designBrief(goal: Goal, role: 'work' | 'check'): string {
  const design = goal.design
  if (!design) return ''
  const references = design.references.map((reference) => `- ${reference.source} (screenshot: ${reference.screenshot}): ${reference.takes}`).join('\n')
  const use = role === 'work'
    ? 'Open the reference screenshots before you design anything, and keep comparing your own screenshots with them as you build. Use realistic content, and design the empty, loading and hover states, not just the happy path.'
    : `Open every reference screenshot, take your own screenshots of the result at the same scale, and compare them side by side as a demanding product designer would. Judge the design line strictly: if the result reads as a generic template, or falls clearly short of the references on hierarchy, typography, density or finish, it is not met. Name the specific screens and elements to change and how.`
  return `\n\nDesign concept: ${design.concept}\nReferences:\n${references}\n${use}`
}

function checkPrompt(goal: Goal): string {
  const round = goal.rounds.at(-1)
  const said = round?.summary ? `\n\n${agentName(goal.worker)} says it did this:\n${round.summary}` : ''
  return `You are checking another assistant's work for the user. Its turns are above.

Goal: ${goal.goal}

Done when:
${numbered(goal)}${designBrief(goal, 'check')}${said}

Check every line yourself: run the commands, open the pages in the browser, read the code. Do not take its account on trust, and do not change any files. Then call goal_report with verdicts (one for each line: line number, met true or false, and the evidence in a sentence) and findings (what is still wrong, specific enough to fix, or empty when every line is met). Then end your turn.`
}
