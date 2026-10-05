import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatUrlTransform, remarkFileLinks } from '../chat-links.ts'
import { openChatLink } from '../store.ts'

const REMARK = [remarkGfm, remarkFileLinks]

export function ChatMarkdown({ text, cwd }: { text: string; cwd?: string }) {
  return <Markdown remarkPlugins={REMARK} urlTransform={chatUrlTransform} components={{
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
  }}>{text}</Markdown>
}
