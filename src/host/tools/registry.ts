import type { ProviderId } from '../../shared/types.ts'
import { messageOf } from '../json.ts'

// The app's own tools. A tool is a name, a schema and a handler; it knows nothing about how a
// provider reaches it. Every provider sees the same list, fixed for the life of the app, so a
// session's tool set never changes under it.

/** Who is calling. `chatId` is null when the provider's session could not be tied to one chat. */
export type ToolContext = { provider: ProviderId; chatId: string | null }

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export type ToolResult = { content: ToolContent[]; isError?: boolean }

export type Tool = {
  name: string
  description: string
  /** JSON Schema for the arguments object. */
  inputSchema: Record<string, unknown>
  run: (args: Record<string, unknown>, context: ToolContext) => ToolResult | Promise<ToolResult>
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] }
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>()

  /** `onFailure` hears every failed call, so the app can remember what its tools got wrong. */
  constructor(private readonly onFailure: (name: string, message: string, context: ToolContext) => void = () => {}) {}

  add(...tools: Tool[]): this {
    for (const tool of tools) this.tools.set(tool.name, tool)
    return this
  }

  list(): Tool[] {
    return [...this.tools.values()]
  }

  /** Run a tool. A failure is a result the model can read, never a thrown error. */
  async call(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      this.onFailure(name, 'There is no such tool', context)
      return { ...textResult(`There is no tool named ${name}.`), isError: true }
    }
    try {
      const result = await tool.run(args, context)
      if (result.isError) this.onFailure(name, result.content.map((part) => (part.type === 'text' ? part.text : '')).join(' ').trim(), context)
      return result
    } catch (error) {
      this.onFailure(name, messageOf(error), context)
      return { ...textResult(messageOf(error)), isError: true }
    }
  }
}
