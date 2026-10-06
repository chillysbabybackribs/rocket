import { Attachments } from './Attachments.tsx'
import { Fragment, memo, useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChatMarkdown } from './ChatMarkdown.tsx'
import { Check, ChevronRight, FileDiff, FileText, Globe, PencilLine, Plug, Search, SquareTerminal, Wrench } from 'lucide-react'
import { planItemId, providerLabel, type Goal, type Item, type ToolKind, type Turn } from '../../../shared/types.ts'
import { splitBlocks } from '../markdown-blocks.ts'
import { usePane, usePaneChatId, usePaneView } from '../pane.ts'
import { answerQuestion, editQueued, openTurnChanges, peekItem, sendNow, togglePlan, useApp, useItem } from '../store.ts'
import { Bar, Counts } from './ChangesView.tsx'

/** Markdown is the expensive part of a row; text that has not changed parses once and never again. */
const Block = memo(function Block({ text }: { text: string }) {
  return <ChatMarkdown text={text} />
})

/**
 * A reply still arriving is parsed block by block, so each batch of text re-parses only the
 * block it lands in (markdown-blocks.ts), and falls a frame behind rather than queueing when
 * even that is slow. Once settled it is parsed whole.
 */
const Prose = memo(function Prose({ text, streaming }: { text: string; streaming: boolean }) {
  const arriving = useDeferredValue(text)
  const blocks = streaming ? splitBlocks(arriving) : [text]
  return (
    <div className="prose">
      {blocks.map((block, index) => <Block key={index} text={block} />)}
    </div>
  )
})

const TOOL_ICONS: Record<ToolKind, typeof Wrench> = {
  command: SquareTerminal,
  edit: PencilLine,
  read: FileText,
  search: Search,
  web: Globe,
  mcp: Plug,
  other: Wrench
}

type ToolItem = Extract<Item, { type: 'tool' }>

/** One borderless line for a tool call: what it is, and nothing around it. */
function ToolLine({ item }: { item: ToolItem }) {
  const Icon = TOOL_ICONS[item.kind]
  return (
    <>
      <Icon size={13} className="tool-icon" />
      <span className="tool-label">{item.label}</span>
      {item.status === 'failed' && <span className="tool-failed">failed</span>}
    </>
  )
}

/**
 * A step in an opened summary: a tool line that opens its output, the reasoning text, or what
 * the model said along the way before its final reply.
 */
const Step = memo(function Step({ id }: { id: string }) {
  const item = useItem(id)
  const [open, setOpen] = useState(false)
  if (!item) return null
  if (item.type === 'reasoning') return item.text.trim() ? <div className="reasoning-text">{item.text}</div> : null
  if (item.type === 'assistant') return item.text.trim() ? <Prose text={item.text} streaming={false} /> : null
  if (item.type !== 'tool') return null
  const expandable = item.output.trim().length > 0
  return (
    <>
      <button type="button" className="tool-line" disabled={!expandable} aria-expanded={expandable ? open : undefined} onClick={() => setOpen(!open)}>
        <ToolLine item={item} />
        {expandable && <ChevronRight size={12} className={`tool-chevron${open ? ' is-open' : ''}`} />}
      </button>
      {open && expandable && <pre className="tool-output">{item.output}</pre>}
    </>
  )
})

/** The one line of live work: the latest tool call, replaced by each new one. */
function CurrentTool({ id }: { id: string }) {
  const item = useItem(id)
  if (item?.type !== 'tool') return null
  return (
    <div className="activity-current">
      {/* Keyed by call, so each new call mounts fresh and rises into place. */}
      <div className="tool-line" key={id}>
        <ToolLine item={item} />
      </div>
    </div>
  )
}

/** Whether a run holds any reasoning text to show. */
function hasThought(ids: string[]): boolean {
  return ids.some((id) => {
    const item = peekItem(id)
    return item?.type === 'reasoning' && item.text.trim().length > 0
  })
}

/** How long the live thinking takes to fold away; the same figure is in `.thought-live`. */
const RETRACT_MS = 220

/** True while `on`, and for `ms` after it ends, so what it showed can animate out before unmounting. */
function useLingering(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(on)
  useEffect(() => {
    if (on) {
      setHeld(true)
      return
    }
    const timer = setTimeout(() => setHeld(false), ms)
    return () => clearTimeout(timer)
  }, [on, ms])
  return on || held
}

/**
 * The model's thinking as it arrives, shown whole: the window grows with the text, since each
 * thought replaces the one before it rather than adding to the page. It opens with the first
 * text and folds away when the work it belongs to is over: the reply starts, or the turn ends.
 */
function LiveThought({ id, open }: { id: string; open: boolean }) {
  const item = useItem(id)
  const box = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  // A new thought starts empty; the last one stays up until it has something to say.
  const shown = useRef('')
  const text = item?.type === 'reasoning' ? item.text.trim() : ''
  if (text) shown.current = text
  const visible = open && shown.current !== ''
  // The height is set from the text so that it can animate; a reflow when the column changes
  // width is followed too.
  useLayoutEffect(() => {
    const inner = box.current?.firstElementChild
    if (!visible || !inner) return
    const fit = (): void => setHeight(inner.getBoundingClientRect().height)
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [visible])
  return (
    <div ref={box} className={`thought-live${visible ? ' is-open' : ''}`} aria-hidden={!visible} style={{ height: visible ? height : 0 }}>
      <div>{shown.current}</div>
    </div>
  )
}

/**
 * The work of a turn. While it is live, it is one line showing the current tool over the thinking
 * as it arrives, the tool on top so it keeps its place while the text below it grows; otherwise
 * one summary line that opens the steps. Work that is only thinking has no line of its own: the
 * turn's head opens it.
 */
const Activity = memo(function Activity({ ids, live, thoughtsOpen }: { ids: string[]; live: boolean; thoughtsOpen: boolean }) {
  const [open, setOpen] = useState(false)
  const lingering = useLingering(live, RETRACT_MS)
  const steps = ids.map(peekItem)
  const tools = steps.filter((step): step is ToolItem => step?.type === 'tool')
  const thought = lingering ? steps.findLast((step) => step?.type === 'reasoning') : undefined
  const failed = tools.filter((tool) => tool.status === 'failed').length
  const current = tools.at(-1)
  const body = live
    ? current && <CurrentTool id={current.id} />
    : tools.length === 0
      ? thoughtsOpen && hasThought(ids) && <div className="activity-steps">{ids.map((id) => <Step key={id} id={id} />)}</div>
      : (
        <>
          <button type="button" className="activity-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span>{`Worked · ${tools.length} ${tools.length === 1 ? 'step' : 'steps'}`}</span>
            {failed > 0 && <span className="activity-failed">{failed} failed</span>}
            <ChevronRight size={12} className={`tool-chevron${open ? ' is-open' : ''}`} />
          </button>
          {open && <div className="activity-steps">{ids.map((id) => <Step key={id} id={id} />)}</div>}
        </>
      )
  if (!thought && !body) return null
  return (
    <div className="activity">
      {body}
      {thought && <LiveThought key="thought" id={thought.id} open={live} />}
    </div>
  )
})

type QuestionItem = Extract<Item, { type: 'question' }>

/**
 * A question the model asked, with its answers as buttons. The model's own pick is marked, so
 * taking its word is one click; "Something else" opens a line for an answer in the user's words.
 * It never holds anything up: unanswered, it stays as it is, and the chat goes on around it. Once
 * answered it shows the choice and nothing to click.
 */
function QuestionCard({ item }: { item: QuestionItem }) {
  const pane = usePane()
  const [other, setOther] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (other !== null) input.current?.focus()
  }, [other])
  const answer = async (text: string): Promise<void> => {
    if (sending || !text.trim()) return
    setSending(true)
    await answerQuestion(pane, item.id, text.trim())
    setSending(false)
  }
  if (item.answer !== null) {
    return (
      <div className="question is-answered">
        <div className="question-text">{item.text}</div>
        <div className="question-answer"><Check size={13} /><span>{item.answer}</span></div>
      </div>
    )
  }
  return (
    <div className="question" role="group" aria-label="Question from the model">
      <div className="question-text">{item.text}</div>
      <div className="question-options">
        {item.options.map((option, index) => (
          <button
            type="button"
            key={option.label}
            className={`question-option${index === item.recommended ? ' is-recommended' : ''}`}
            disabled={sending}
            onClick={() => void answer(option.label)}
          >
            <span className="question-option-label">
              {option.label}
              {index === item.recommended && <span className="question-pick">Suggested</span>}
            </span>
            <span className="question-option-detail">{option.detail}</span>
          </button>
        ))}
      </div>
      {other === null
        ? <button type="button" className="question-other" disabled={sending} onClick={() => setOther('')}>Something else…</button>
        : (
          <input
            ref={input}
            className="question-input"
            value={other}
            placeholder="Your answer, then Enter"
            aria-label="Your answer"
            disabled={sending}
            onChange={(event) => setOther(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) void answer(other)
              if (event.key === 'Escape') setOther(null)
            }}
          />
        )}
    </div>
  )
}

const ItemRow = memo(function ItemRow({ id }: { id: string }) {
  const item = useItem(id)
  if (!item) return null
  switch (item.type) {
    case 'user':
      return <div className="user-bubble"><Attachments images={item.attachments} /><ChatMarkdown text={item.text} /></div>
    case 'assistant':
      return item.text.trim() ? <Prose text={item.text} streaming={item.streaming} /> : null
    case 'notice':
      return <p className={`notice is-${item.tone}`}>{item.text}</p>
    case 'question':
      return <QuestionCard item={item} />
    default:
      return null
  }
})

function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/**
 * The turn's plan, as its head line says it: "Planning · 2 of 5" while the turn runs, the count
 * moving as steps finish, and "Planned · 5 of 5" once it is over. It opens and closes the plan
 * beside the chat. In a goal's chat the plan is a section of the goal pane, so the line is plain.
 */
function PlanLabel({ turn, running }: { turn: Turn; running: boolean }) {
  const plan = useItem(planItemId(turn.id))
  const chatId = usePaneChatId()
  const open = usePaneView((view) => view.planTurnId === turn.id)
  const inGoal = useApp((state) => state.goals.some((goal) => goal.chatId === chatId))
  if (plan?.type !== 'plan') return null
  const done = plan.steps.filter((step) => step.status === 'done').length
  const text = <span className={running ? 'shimmer' : ''}>{running ? 'Planning' : 'Planned'} · {done} of {plan.steps.length}</span>
  if (inGoal) return text
  return (
    <button type="button" className={`turn-head-toggle plan-toggle${open ? ' is-open' : ''}`} aria-pressed={open} title={open ? 'Hide the plan' : 'Show the plan'} onClick={() => { if (chatId) togglePlan(chatId, turn.id) }}>
      {text}
    </button>
  )
}

/**
 * The line every response starts with, above a divider: a shimmering "Thinking" and a running
 * clock while the turn works, and how long it took once it is over. Everything the model says
 * and does goes under the divider. When the turn has thinking to show, the line opens it; when
 * it keeps a plan, the line names the plan and opens that instead.
 */
function TurnHead({ turn, thoughts, plan, open, onToggle }: { turn: Turn; thoughts: boolean; plan: boolean; open: boolean; onToggle: () => void }) {
  const running = turn.status === 'running'
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [running])
  // A turn can be waiting rather than thinking, on background tasks it started; its head says so.
  const label = running ? <span className="shimmer">{turn.activity ?? 'Thinking'}</span> : thoughts && <span>Thought</span>
  return (
    <div className="turn-head" role={running ? 'status' : undefined}>
      {plan
        ? <PlanLabel turn={turn} running={running} />
        : thoughts
          ? (
            <button type="button" className="turn-head-toggle" aria-expanded={open} onClick={onToggle}>
              {label}
              <ChevronRight size={12} className={`tool-chevron${open ? ' is-open' : ''}`} />
            </button>
          )
          : label}
      {running
        ? <span className="turn-head-time">Working for {duration(now - turn.startedAt)}</span>
        : turn.endedAt !== null && <span className="turn-head-time">Worked for {duration(turn.endedAt - turn.startedAt)}</span>}
    </div>
  )
}

/**
 * A turn's response keeps one shape however long it works, each part replacing the last in its
 * place rather than piling up: a summary of the steps so far, then the model's latest words, and,
 * while it runs, the thinking and tool call under way. Notices and questions keep to the end.
 */
function stageOf(ids: string[], running: boolean): { reply: string | null; steps: string[]; live: string[]; notices: string[] } {
  const trailing = (id: string): boolean => {
    const type = peekItem(id)?.type
    return type === 'notice' || type === 'question'
  }
  const notices = ids.filter(trailing)
  const work = ids.filter((id) => !trailing(id))
  const at = work.findLastIndex((id) => peekItem(id)?.type === 'assistant')
  const reply = at === -1 ? null : work[at]
  if (!running) return { reply, steps: work.filter((id) => id !== reply), live: [], notices }
  return { reply, steps: at === -1 ? [] : work.slice(0, at), live: work.slice(at + 1), notices }
}

/**
 * A goal's turns are sent by the app, not typed by the user, so their message is not shown as
 * the user's. The draft turn shows what the user did write; the others, a line naming the round.
 */
function GoalLead({ turn, goal, round }: { turn: Turn; goal: Goal | null; round: number }) {
  const name = providerLabel(turn.provider)
  if (turn.goalRole === 'draft' && goal && round === 0) return <div className="user-bubble"><ChatMarkdown text={goal.request} /></div>
  const label = turn.goalRole === 'draft' ? `${name} drafts the goal again`
    : turn.goalRole === 'work' ? `Round ${round} · ${name} works`
    : `Round ${round} · ${name} checks`
  return <div className={`goal-lead is-${turn.goalRole}`}>{label}</div>
}

/**
 * What the turn changed in the folder, in one line like the summary of its steps: the count, the
 * added and removed lines, and a bar of their balance. It opens the diff beside the chat.
 */
function ChangesLine({ turn }: { turn: Turn }) {
  const pane = usePane()
  const open = useApp((state) => state.artifact?.kind === 'changes' && state.artifact.turnId === turn.id)
  const { changes } = turn
  if (!changes || changes.files === 0) return null
  return (
    <button type="button" className={`changes-line${open ? ' is-open' : ''}${changes.undone ? ' is-undone' : ''}`} aria-pressed={open} onClick={() => void openTurnChanges(pane, turn.id)}>
      <FileDiff size={12} className="changes-icon" />
      <span>Changed {changes.files} {changes.files === 1 ? 'file' : 'files'}</span>
      <Counts added={changes.added} removed={changes.removed} />
      <Bar added={changes.added} removed={changes.removed} />
      {changes.undone && <span className="undone-tag">undone</span>}
    </button>
  )
}

/**
 * A turn's items cut where the user sent words into it while it ran: each part keeps the usual
 * shape, and only the last can still be live.
 */
function partsOf(ids: string[]): Array<{ steer: string | null; ids: string[] }> {
  const parts: Array<{ steer: string | null; ids: string[] }> = [{ steer: null, ids: [] }]
  for (const id of ids) {
    const item = peekItem(id)
    if (item?.type === 'user' && item.steer) parts.push({ steer: id, ids: [] })
    else parts.at(-1)!.ids.push(id)
  }
  return parts
}

/** One part of a turn's response: the summary of its steps, its latest words, and, if live, the work under way. */
function Stage({ ids, running, thoughtsOpen }: { ids: string[]; running: boolean; thoughtsOpen: boolean }) {
  const { reply, steps, live } = stageOf(ids, running)
  return (
    <>
      {steps.length > 0 && <Activity ids={steps} live={false} thoughtsOpen={thoughtsOpen} />}
      {reply && <ItemRow key={reply} id={reply} />}
      {live.length > 0 && <Activity key={live[0]} ids={live} live thoughtsOpen={false} />}
    </>
  )
}

const TurnBlock = memo(function TurnBlock({ turn, ids, fill, goal, round }: { turn: Turn; ids: string[]; fill: boolean; goal: Goal | null; round: number }) {
  // The plan is not a row of the response; the head line names it and it shows beside the chat.
  const planId = planItemId(turn.id)
  const [userId, ...rest] = ids.filter((id) => id !== planId)
  const running = turn.status === 'running'
  const parts = partsOf(rest)
  const [thoughtsOpen, setThoughtsOpen] = useState(false)
  // Thinking that stands alone, with no tool calls around it, is what the head opens.
  const { steps } = stageOf(parts[0]!.ids, running && parts.length === 1)
  const thoughts = hasThought(steps) && steps.every((id) => peekItem(id)?.type !== 'tool')
  return (
    <article className={`turn${fill ? ' is-fill' : ''}`}>
      {turn.goalRole ? <GoalLead turn={turn} goal={goal} round={round} /> : userId && <ItemRow id={userId} />}
      <div className="answer">
        <TurnHead turn={turn} thoughts={thoughts} plan={ids.includes(planId)} open={thoughtsOpen} onToggle={() => setThoughtsOpen(!thoughtsOpen)} />
        {parts.map((part, index) => (
          <Fragment key={part.steer ?? 'first'}>
            {part.steer && (
              <div className="steer">
                <ItemRow id={part.steer} />
                <div className="steer-tag">Added during the turn</div>
              </div>
            )}
            <Stage ids={part.ids} running={running && index === parts.length - 1} thoughtsOpen={index === 0 && thoughtsOpen} />
          </Fragment>
        ))}
        {!running && <ChangesLine turn={turn} />}
        {parts.flatMap((part) => stageOf(part.ids, false).notices).map((id) => <ItemRow key={id} id={id} />)}
        {turn.status === 'interrupted' && <p className="notice is-info">Stopped</p>}
        {turn.status === 'failed' && <p className="notice is-error">{turn.error ?? 'This turn failed.'}</p>}
      </div>
    </article>
  )
})

const NO_ITEMS: string[] = []

/** A goal turn's round; for a draft, how many drafts came before it. A turn that has been retried belongs to the round it retried. */
function roundOf(goal: Goal | null, turns: Turn[], turn: Turn): number {
  if (!goal || !turn.goalRole) return 0
  if (turn.goalRole === 'draft') return turns.filter((entry) => entry.goalRole === 'draft' && entry.startedAt < turn.startedAt).length
  const known = goal.rounds.find((round) => round.workTurnId === turn.id || round.checkTurnId === turn.id)
  if (known) return known.n
  // A failed work turn was replaced by the next one for the same round; a check asked again checks the round before it.
  if (turn.goalRole === 'work') return goal.rounds.find((round) => round.startedAt >= turn.startedAt)?.n ?? goal.rounds.length + 1
  return goal.rounds.filter((round) => round.startedAt <= turn.startedAt).at(-1)?.n ?? goal.rounds.length
}

/**
 * Messages waiting for the turn in flight to end, under it: dashed until they are sent, with a
 * way to send them now (stopping the turn) or take them back into the composer. Words sent into
 * the turn wait here too, until its model reads them and they join the turn at that point.
 */
function Waiting() {
  const pane = usePane()
  const queued = usePaneView((view) => view.queued)
  const answering = usePaneView((view) => view.turns.findLast((turn) => turn.status === 'running')?.provider ?? null)
  if (!queued.length) return null
  return (
    <>
      {queued.map((entry) => (
        <div key={entry.id} className="steer is-waiting">
          <div className="user-bubble"><Attachments images={entry.attachments} /><ChatMarkdown text={entry.text} /></div>
          {entry.taking ? (
            <div className="steer-status"><span>{providerLabel(entry.provider)} reads this at its next step</span></div>
          ) : (
            <div className="steer-status">
              <span>Sends when {answering ? providerLabel(answering) : 'the turn'} finishes</span>
              <span aria-hidden>·</span>
              <button type="button" onClick={() => sendNow(pane)}>Send now</button>
              <button type="button" onClick={() => editQueued(pane, entry.id)}>Edit</button>
            </div>
          )}
        </div>
      ))}
    </>
  )
}

/** Per chat, the turn last sent while the app has been open: the one laid out to fill the view. */
const sentTurns = new Map<string, string>()

export function Transcript() {
  const turns = usePaneView((view) => view.turns)
  const turnItems = usePaneView((view) => view.turnItems)
  const chatId = usePaneChatId()
  const goal = useApp((state) => state.goals.find((entry) => entry.chatId === chatId) ?? null)
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  // The turn just sent in this chat. It is made as tall as the view, so that scrolled to the
  // bottom its message sits at the top with the whole view beneath it free for the response.
  const [sentId, setSentId] = useState<string | null>(null)
  const seen = useRef({ chatId, count: turns.length })

  // Stay at the bottom while the user is there; leave them alone once they scroll up.
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const measure = (): void => {
      const style = content.current ? getComputedStyle(content.current) : null
      const padding = style ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : 0
      element.style.setProperty('--turn-fill', `${Math.max(0, element.clientHeight - padding)}px`)
    }
    measure()
    const onScroll = (): void => {
      pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(() => {
      measure()
      if (pinned.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    if (content.current) observer.observe(content.current)
    return () => {
      element.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [])

  useLayoutEffect(() => {
    const before = seen.current
    seen.current = { chatId, count: turns.length }
    // A turn added to the chat on screen was just sent, and one still running was sent not long
    // ago. The chat remembers it, so the layout is the same on coming back from another tab.
    const last = turns.at(-1)
    const sent = before.chatId === chatId && turns.length > before.count
    if (chatId && last && (sent || last.status === 'running')) sentTurns.set(chatId, last.id)
    setSentId((chatId && sentTurns.get(chatId)) || null)
  }, [chatId, turns.length])

  useLayoutEffect(() => {
    pinned.current = true
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [chatId, turns.length, sentId])

  return (
    <div className="transcript" ref={scroller}>
      <div className="transcript-inner" ref={content}>
        {turns.map((turn) => (
          <TurnBlock key={turn.id} turn={turn} ids={turnItems[turn.id] ?? NO_ITEMS} fill={turn.id === sentId} goal={goal} round={roundOf(goal, turns, turn)} />
        ))}
        <Waiting />
      </div>
    </div>
  )
}
