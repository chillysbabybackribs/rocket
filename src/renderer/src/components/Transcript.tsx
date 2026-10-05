import { memo, useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronRight, FileText, Globe, PencilLine, Plug, Search, SquareTerminal, Wrench } from 'lucide-react'
import type { Item, ToolKind, Turn } from '../../../shared/types.ts'
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

/** A step in an opened summary: a tool line that opens its output, or the reasoning text. */
const Step = memo(function Step({ id }: { id: string }) {
  const item = useItem(id)
  const [open, setOpen] = useState(false)
  if (!item) return null
  if (item.type === 'reasoning') return item.text.trim() ? <div className="reasoning-text">{item.text}</div> : null
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

/**
 * A run of reasoning and tool calls between replies. While the turn is working on it, it is one
 * line showing the current tool; once done, one summary line that opens the steps. A run that is
 * only thinking has no line of its own: the turn's head opens it.
 */
const Activity = memo(function Activity({ ids, live, thoughtsOpen }: { ids: string[]; live: boolean; thoughtsOpen: boolean }) {
  const [open, setOpen] = useState(false)
  const steps = ids.map(peekItem)
  const tools = steps.filter((step): step is ToolItem => step?.type === 'tool')
  if (live) {
    const current = tools.at(-1)
    return current ? <div className="activity"><CurrentTool id={current.id} /></div> : null
  }
  if (tools.length === 0) {
    if (!thoughtsOpen || !hasThought(ids)) return null
    return <div className="activity"><div className="activity-steps">{ids.map((id) => <Step key={id} id={id} />)}</div></div>
  }
  const failed = tools.filter((tool) => tool.status === 'failed').length
  return (
    <div className="activity">
      <button type="button" className="activity-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{`Worked · ${tools.length} ${tools.length === 1 ? 'step' : 'steps'}`}</span>
        {failed > 0 && <span className="activity-failed">{failed} failed</span>}
        <ChevronRight size={12} className={`tool-chevron${open ? ' is-open' : ''}`} />
      </button>
      {open && <div className="activity-steps">{ids.map((id) => <Step key={id} id={id} />)}</div>}
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
  const line = (
    <>
      {running && <span className="shimmer">Thinking</span>}
      {running
        ? <span>Working for {duration(now - turn.startedAt)}</span>
        : turn.endedAt !== null && <span>Worked for {duration(turn.endedAt - turn.startedAt)}</span>}
    </>
  )
  return (
    <div className="turn-head" role={running ? 'status' : undefined}>
      {thoughts
        ? (
          <button type="button" className="turn-head-toggle" aria-expanded={open} onClick={onToggle}>
            {line}
            <ChevronRight size={12} className={`tool-chevron${open ? ' is-open' : ''}`} />
          </button>
        )
        : line}
    </div>
  )
}

type Segment = { kind: 'activity'; ids: string[] } | { kind: 'item'; id: string }

/** Consecutive reasoning and tool items fold into one activity; replies and notices stand alone. */
function segmentsOf(ids: string[]): Segment[] {
  const segments: Segment[] = []
  for (const id of ids) {
    const type = peekItem(id)?.type
    if (type === 'reasoning' || type === 'tool') {
      const last = segments.at(-1)
      if (last?.kind === 'activity') last.ids.push(id)
      else segments.push({ kind: 'activity', ids: [id] })
    } else {
      segments.push({ kind: 'item', id })
    }
  }
  return segments
}

const TurnBlock = memo(function TurnBlock({ turn, ids, fill }: { turn: Turn; ids: string[]; fill: boolean }) {
  const [userId, ...rest] = ids
  const segments = segmentsOf(rest)
  const running = turn.status === 'running'
  const last = segments.at(-1)
  const [thoughtsOpen, setThoughtsOpen] = useState(false)
  // Thinking that stands alone, with no tool calls around it, is what the head opens.
  const thoughts = segments.some((segment) => segment.kind === 'activity'
    && !(running && segment === last)
    && hasThought(segment.ids)
    && segment.ids.every((id) => peekItem(id)?.type !== 'tool'))
  return (
    <article className={`turn${fill ? ' is-fill' : ''}`}>
      {userId && <ItemRow id={userId} />}
      <div className="answer">
        <TurnHead turn={turn} thoughts={thoughts} open={thoughtsOpen} onToggle={() => setThoughtsOpen(!thoughtsOpen)} />
        {segments.map((segment) => segment.kind === 'item'
          ? <ItemRow key={segment.id} id={segment.id} />
          : <Activity key={segment.ids[0]} ids={segment.ids} live={running && segment === last} thoughtsOpen={thoughtsOpen} />)}
        {turn.status === 'interrupted' && <p className="notice is-info">Stopped</p>}
        {turn.status === 'failed' && <p className="notice is-error">{turn.error ?? 'This turn failed.'}</p>}
      </div>
    </article>
  )
})

const NO_ITEMS: string[] = []

/** Per chat, the turn last sent while the app has been open: the one laid out to fill the view. */
const sentTurns = new Map<string, string>()

export function Transcript() {
  const turns = useApp((state) => state.turns)
  const turnItems = useApp((state) => state.turnItems)
  const chatId = useApp((state) => state.activeChatId)
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
        {turns.map((turn) => <TurnBlock key={turn.id} turn={turn} ids={turnItems[turn.id] ?? NO_ITEMS} fill={turn.id === sentId} />)}
      </div>
    </div>
  )
}
