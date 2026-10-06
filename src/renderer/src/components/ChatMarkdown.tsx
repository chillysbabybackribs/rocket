import type { ReactElement } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatUrlTransform, remarkFileLinks } from '../chat-links.ts'
import { openChatLink } from '../store.ts'

const REMARK = [remarkGfm, remarkFileLinks]

// Parsing is most of what a transcript costs to show, and a chat shown again (another tab, another
// pane, the page above) shows text it has parsed before. `Markdown` is a plain function of its
// options, so what it returns is kept by folder and text and handed back as it was: React elements
// never change once made. A reply still streaming is not kept, or each half-written version would
// push out ones worth keeping.
const PARSED_MAX = 600
const parsed = new Map<string, ReactElement>()
const linksIn = new Map<string, Components>()

function componentsFor(cwd: string | undefined): Components {
  const key = cwd ?? ''
  let components = linksIn.get(key)
  if (!components) {
    components = {
      a: ({ href, children }) => href ? (
        <a href={href} onClick={(event) => {
          event.preventDefault()
          void openChatLink(href, cwd)
        }} onAuxClick={(event) => {
          if (event.button !== 1) return
          event.preventDefault()
          void openChatLink(href, cwd)
        }}>{children}</a>
      ) : <span>{children}</span>
    }
    linksIn.set(key, components)
  }
  return components
}

export function ChatMarkdown({ text, cwd, settled = true }: { text: string; cwd?: string; settled?: boolean }) {
  const key = `${cwd ?? ''}\n${text}`
  const kept = parsed.get(key)
  if (kept) {
    // Most recently shown last, so the oldest is the one let go.
    parsed.delete(key)
    parsed.set(key, kept)
    return kept
  }
  const tree = Markdown({ remarkPlugins: REMARK, urlTransform: chatUrlTransform, components: componentsFor(cwd), children: text })
  if (settled) {
    parsed.set(key, tree)
    if (parsed.size > PARSED_MAX) parsed.delete(parsed.keys().next().value!)
  }
  return tree
}
