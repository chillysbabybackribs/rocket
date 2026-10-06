import type { ProviderId } from '../../shared/types.ts'
import { messageOf } from '../json.ts'

// The app's own tools. A tool is a name, a schema and a handler; it knows nothing about how a
// provider reaches it. Every provider sees the same list, fixed for the life of the app, so a
// session's tool set never changes under it.

/** Who is calling. `chatId` is null when the provider's session could not be tied to one chat. */
export type ToolContext = { provider: ProviderId; chatId: string | null }

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export type ToolResult = { content: ToolContent[]; isError?: boolean; structuredContent?: { error?: ToolFailure } }

export type ToolFailure = { code: string; origin: 'validation' | 'runner' | 'operation' | 'script' | 'tool'; message: string }
export type ObservedResult = ToolResult & { structuredContent?: { error?: ToolFailure } }
export type ToolObserver = {
  start: (name: string, tool: Tool | undefined, args: Record<string, unknown>, context: ToolContext) => unknown
  finish: (id: unknown, result: ObservedResult) => void
}

export function failureResult(code: string, message: string, origin: ToolFailure['origin'] = 'validation'): ObservedResult {
  return { ...textResult(message), isError: true, structuredContent: { error: { code, origin, message } } }
}

export type Tool = {
  version?: number
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
  constructor(private readonly onFailure: (name: string, message: string, context: ToolContext) => void = () => {}, private readonly observer?: ToolObserver) {}

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
    let id: unknown
    try { id = this.observer?.start(name, tool, args, context) } catch { /* Recording cannot prevent execution. */ }
    let result: ObservedResult
    try {
      result = tool ? await tool.run(args, context) : failureResult('UNKNOWN_TOOL', `There is no tool named ${name}.`)
    } catch (error) {
      result = failureResult('TOOL_EXCEPTION', messageOf(error), 'tool')
    }
    try { this.observer?.finish(id, result) } catch { /* Recording cannot change the outcome. */ }
    if (result.isError) {
      try { this.onFailure(name, result.structuredContent?.error?.message ?? result.content.map(part => part.type === 'text' ? part.text : '').join(' ').trim(), context) } catch { /* Diagnostics are best effort too. */ }
    }
    return result
  }
}
