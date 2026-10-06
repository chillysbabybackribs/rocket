import type { Tool } from './tools/registry.ts'
import type { ToolLedger } from './tool-ledger.ts'

export type ToolLedgerPanelScope = {
  scope: string[]
  attempts: number
  successes: number
  failures: number
  interrupted?: number
  running?: number
  descriptionBytes: number
  successRate: number | null
  failureRate: number | null
}

export type ToolLedgerPanelGroup = {
  tool: string
  operation: string
  code: string
  count: number
  failureRate: number
  examples: string[]
}

export type ToolLedgerPanelQueueRow = {
  callId: string
  tool: string
  code: string | null
  lifecycle: string
  at: number
}

export type ToolLedgerPanelData = {
  available: boolean
  message?: string
  path?: string
  syncedAt?: string
  contextPolicy?: Record<string, unknown>
  scopes?: ToolLedgerPanelScope[]
  groups?: ToolLedgerPanelGroup[]
  queue?: ToolLedgerPanelQueueRow[]
  registeredTools?: Array<{ name: string; descriptionBytes: number; version: number }>
}

export type ToolLedgerCallDetailData = {
  path?: string
  calls?: Array<Record<string, unknown>>
  matching?: number
  available?: boolean
  message?: string
}

/** Bounded payload for the eval Tools view — same evidence as rocket_tool_history, not prompt memory. */
export function loadToolLedgerPanel(ledger: ToolLedger | undefined, registered: Tool[]): ToolLedgerPanelData {
  if (!ledger) {
    return { available: false, message: 'Tool-call ledger is unavailable for this profile.' }
  }
  // Retention/pruning already bounds size; the UI shows the full retained ledger.
  const since = 0
  const summary = ledger.summary({ since, limit: 20 })
  const queue = ledger.reviewQueue({ since, limit: 20 })
  return {
    available: true,
    path: ledger.path,
    syncedAt: new Date().toISOString(),
    contextPolicy: summary.contextPolicy,
    scopes: summary.scopes as ToolLedgerPanelScope[],
    groups: (summary.groups as Array<Record<string, unknown>>).map(row => ({
      tool: String(row.tool ?? ''),
      operation: String(row.operation ?? ''),
      code: String(row.code ?? ''),
      count: Number(row.count ?? 0),
      failureRate: Number(row.failureRate ?? 0),
      examples: Array.isArray(row.examples) ? row.examples.filter((id): id is string => typeof id === 'string') : []
    })),
    queue: queue.queue as ToolLedgerPanelQueueRow[],
    registeredTools: registered.map(tool => ({
      name: tool.name,
      descriptionBytes: Buffer.byteLength(tool.description),
      version: tool.version ?? 1
    })).sort((a, b) => a.name.localeCompare(b.name))
  }
}

export function loadToolLedgerCallDetail(ledger: ToolLedger | undefined, callId: string): ToolLedgerCallDetailData {
  if (!ledger) return { available: false, message: 'Ledger unavailable.' }
  return ledger.query({ callId, since: 0, limit: 1 }) as ToolLedgerCallDetailData
}
