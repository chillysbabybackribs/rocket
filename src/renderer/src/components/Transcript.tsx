import { memo, useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronRight, FileText, Globe, PencilLine, Plug, Search, SquareTerminal, Wrench } from 'lucide-react'
import { providerLabel, type Goal, type Item, type ToolKind, type Turn } from '../../../shared/types.ts'
import { splitBlocks } from '../markdown-blocks.ts'
import { peekItem, useApp, useItem } from '../store.ts'

const REMARK = [remarkGfm]

/** Markdown is the expensive part of a row; text that has not changed parses once and never again. */
const Block = memo(function Block({ text }: { text: string }) {
  return <Markdown remarkPlugins={REMARK}>{text}</Markdown>
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
 * The work of a turn. While it is live, it is the thinking as it arrives over one line showing
 * the current tool; otherwise one summary line that opens the steps. Work that is only thinking
 * has no line of its own: the turn's head opens it.
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
      {thought && <LiveThought key="thought" id={thought.id} open={live} />}
      {body}
    </div>
  )
})

const ItemRow = memo(function ItemRow({ id }: { id: string }) {
  const item = useItem(id)
  if (!item) return null
  switch (item.type) {
    case 'user':
      return <div className="user-bubble">{item.text}</div>
    case 'assistant':
      return item.text.trim() ? <Prose text={item.text} streaming={item.streaming} /> : null
    case 'notice':
      return <p className={`notice is-${item.tone}`}>{item.text}</p>
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
 * The line every response starts with, above a divider: a shimmering "Thinking" and a running
 * clock while the turn works, and how long it took once it is over. Everything the model says
 * and does goes under the divider. When the turn has thinking to show, the line opens it.
 */
function TurnHead({ turn, thoughts, open, onToggle }: { turn: Turn; thoughts: boolean; open: boolean; onToggle: () => void }) {
  const running = turn.status === 'running'
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [running])
  const label = running ? <span className="shimmer">Thinking</span> : thoughts && <span>Thought</span>
  return (
    <div className="turn-head" role={running ? 'status' : undefined}>
      {thoughts
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
 * place rather than piling up: the model's latest words, a summary of the steps before them, and,
 * while it runs, the thinking and tool call under way. Notices keep to the end.
 */
function stageOf(ids: string[], running: boolean): { reply: string | null; steps: string[]; live: string[]; notices: string[] } {
  const notices = ids.filter((id) => peekItem(id)?.type === 'notice')
  const work = ids.filter((id) => peekItem(id)?.type !== 'notice')
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
  if (turn.goalRole === 'draft' && goal && round === 0) return <div className="user-bubble">{goal.request}</div>
  const label = turn.goalRole === 'draft' ? `${name} drafts the goal again`
    : turn.goalRole === 'work' ? `Round ${round} · ${name} works`
    : `Round ${round} · ${name} checks`
  return <div className={`goal-lead is-${turn.goalRole}`}>{label}</div>
}

const TurnBlock = memo(function TurnBlock({ turn, ids, fill, goal, round }: { turn: Turn; ids: string[]; fill: boolean; goal: Goal | null; round: number }) {
  const [userId, ...rest] = ids
  const running = turn.status === 'running'
  const { reply, steps, live, notices } = stageOf(rest, running)
  const [thoughtsOpen, setThoughtsOpen] = useState(false)
  // Thinking that stands alone, with no tool calls around it, is what the head opens.
  const thoughts = hasThought(steps) && steps.every((id) => peekItem(id)?.type !== 'tool')
  return (
    <article className={`turn${fill ? ' is-fill' : ''}`}>
      {turn.goalRole ? <GoalLead turn={turn} goal={goal} round={round} /> : userId && <ItemRow id={userId} />}
      <div className="answer">
        <TurnHead turn={turn} thoughts={thoughts} open={thoughtsOpen} onToggle={() => setThoughtsOpen(!thoughtsOpen)} />
        {reply && <ItemRow key={reply} id={reply} />}
        {steps.length > 0 && <Activity ids={steps} live={false} thoughtsOpen={thoughtsOpen} />}
        {live.length > 0 && <Activity key={live[0]} ids={live} live thoughtsOpen={false} />}
        {notices.map((id) => <ItemRow key={id} id={id} />)}
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

/** Per chat, the turn last sent while the app has been open: the one laid out to fill the view. */
const sentTurns = new Map<string, string>()

export function Transcript() {
  const turns = useApp((state) => state.turns)
  const turnItems = useApp((state) => state.turnItems)
  const chatId = useApp((state) => state.activeChatId)
  const goal = useApp((state) => state.goals.find((entry) => entry.chatId === state.activeChatId) ?? null)
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
      </div>
    </div>
  )
}
