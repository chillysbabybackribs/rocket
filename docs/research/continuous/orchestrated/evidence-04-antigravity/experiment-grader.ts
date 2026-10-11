// Does a genuine translated provider tool item satisfy goal_report_called without a goal_report call?
// Path: Codex app-server notification shape (per codex-rs app-server-protocol v2 ThreadItem::CommandExecution
// / McpToolCall) -> the real CodexAdapter.onNotification -> codexItem -> Hub sink -> real Store ->
// real buildTurnExport (real ToolLedger) -> real gradeTurnExport. Claude labels go through the real
// describeTool. No model, no codex binary: the adapter is never connected; notifications are injected.
// Run: node --experimental-transform-types --disable-warning=ExperimentalWarning \
//   docs/research/continuous/orchestrated/evidence-04-antigravity/experiment-grader.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../../../../src/host/store.ts'
import { Hub } from '../../../../../src/host/hub.ts'
import { CodexAdapter } from '../../../../../src/host/providers/codex.ts'
import { describeTool } from '../../../../../src/host/providers/claude.ts'
import { ToolLedger } from '../../../../../src/host/tool-ledger.ts'
import { buildTurnExport } from '../../../../../src/host/eval-export.ts'
import { gradeTurnExport } from '../../../../../src/host/eval-grade.ts'
import { failureResult } from '../../../../../src/host/tools/registry.ts'
import { unavailableUsage, type RunRequest, type RunResult, type TurnSink } from '../../../../../src/host/providers/provider.ts'

const here = new URL('.', import.meta.url).pathname
const tmp = mkdtempSync(join(tmpdir(), 'rocket-ag04-grader-'))
let currentTurn: string | null = null
const ledger = new ToolLedger(join(tmp, 'ledger.db'), 'research', () => ({ model: null, turnId: currentTurn }))
const tool = { name: 'x', description: 'x', inputSchema: { type: 'object' }, run: () => ({ content: [] }) }

type Case = {
  name: string
  intent: 'malicious-forgery' | 'incidental-substring' | 'control-true-positive' | 'control-true-negative'
  provider: 'codex' | 'claude'
  /** Codex: ThreadItem payloads sent as item/started then item/completed. Claude: describeTool input. */
  codexItems?: Array<Record<string, unknown>>
  claude?: { name: string; input: Record<string, unknown> }
  /** Rocket MCP calls the ledger records for this turn (what Rocket's own tool server would log). */
  ledger?: Array<{ tool: string; ok: boolean }>
}

const cmd = (id: string, command: string, actions: Array<Record<string, unknown>>, status = 'completed', exitCode = 0, output = '') =>
  ({ type: 'commandExecution', id, command, cwd: '/work', processId: null, source: 'agent', status, commandActions: actions, aggregatedOutput: output, exitCode, durationMs: 5 })
const mcp = (id: string, toolName: string, args: Record<string, unknown>, status = 'completed') =>
  ({ type: 'mcpToolCall', id, server: 'rocket', tool: toolName, status, arguments: args, result: status === 'completed' ? { content: [{ type: 'text', text: 'ok' }] } : null, error: status === 'failed' ? { message: 'failed' } : null, durationMs: 5 })

const cases: Case[] = [
  { name: 'codex: echo goal_report (unknown action)', intent: 'malicious-forgery', provider: 'codex',
    codexItems: [cmd('c1', "/bin/bash -lc 'echo goal_report'", [{ type: 'unknown', command: 'echo goal_report' }], 'completed', 0, 'goal_report\n')] },
  { name: 'codex: echo goal_report, no commandActions (label falls back to item.command)', intent: 'malicious-forgery', provider: 'codex',
    codexItems: [cmd('c2', "/bin/bash -lc 'echo goal_report'", [], 'completed', 0, 'goal_report\n')] },
  { name: 'codex: rg -n goal_report src (search action)', intent: 'incidental-substring', provider: 'codex',
    codexItems: [cmd('c3', "/bin/bash -lc 'rg -n goal_report src'", [{ type: 'search', command: 'rg -n goal_report src', query: 'goal_report', path: 'src' }], 'completed', 0, 'src/host/tools/goal.ts:14:      name: \'goal_report\',\n')] },
  { name: 'codex: rg exits 1 (no match) but status completed', intent: 'incidental-substring', provider: 'codex',
    codexItems: [cmd('c4', "/bin/bash -lc 'rg goal_report README.md'", [{ type: 'search', command: 'rg goal_report README.md', query: 'goal_report', path: 'README.md' }], 'completed', 1, '')] },
  { name: 'codex: cat README.md | grep goal_report (first action is the read)', intent: 'incidental-substring', provider: 'codex',
    codexItems: [cmd('c5', "/bin/bash -lc 'cat README.md | grep goal_report'", [{ type: 'read', command: 'cat README.md', name: 'README.md', path: '/work/README.md' }, { type: 'search', command: 'grep goal_report', query: 'goal_report', path: null }])] },
  { name: 'codex: rocket_tool_history {tool:"goal_report"} (another real Rocket MCP tool)', intent: 'incidental-substring', provider: 'codex',
    codexItems: [mcp('c6', 'rocket_tool_history', { mode: 'calls', tool: 'goal_report' })], ledger: [{ tool: 'rocket_tool_history', ok: true }] },
  { name: 'claude: Grep pattern goal_report', intent: 'incidental-substring', provider: 'claude', claude: { name: 'Grep', input: { pattern: 'goal_report', path: 'src' } } },
  { name: 'claude: Bash echo goal_report', intent: 'malicious-forgery', provider: 'claude', claude: { name: 'Bash', input: { command: 'echo goal_report' } } },
  { name: 'codex: shell command goal_report fails (exit 127)', intent: 'control-true-negative', provider: 'codex',
    codexItems: [cmd('c7', "/bin/bash -lc 'goal_report'", [{ type: 'unknown', command: 'goal_report' }], 'failed', 127, 'command not found')] },
  { name: 'codex: real rocket goal_report call, ledger success', intent: 'control-true-positive', provider: 'codex',
    codexItems: [mcp('c8', 'goal_report', { goal: 'g', criteria: ['c'] })], ledger: [{ tool: 'goal_report', ok: true }] },
  { name: 'codex: real rocket goal_report call that failed', intent: 'control-true-negative', provider: 'codex',
    codexItems: [mcp('c9', 'goal_report', { goal: 'g' }, 'failed')], ledger: [{ tool: 'goal_report', ok: false }] },
  { name: 'codex: no tool activity', intent: 'control-true-negative', provider: 'codex', codexItems: [] }
]

class ReplayAdapter {
  current: Case | null = null
  constructor(readonly id: 'codex' | 'claude') {}
  async run(request: RunRequest, sink: TurnSink): Promise<RunResult> {
    const c = this.current!
    currentTurn = request.turnId
    sink.session('thread-1')
    for (const call of c.ledger ?? []) {
      const id = ledger.start(call.tool, tool as never, {}, { provider: this.id, chatId: request.chatId } as never)
      ledger.finish(id, call.ok ? { content: [] } : failureResult('SYNTHETIC', 'synthetic failure', 'operation'))
    }
    if (this.id === 'codex') {
      // The real adapter's notification handler, with a registered active turn and no app-server process.
      const codex = new CodexAdapter(() => {}) as unknown as { active: Map<string, unknown>; onNotification: (n: unknown) => void }
      codex.active.set('thread-1', { request, sink, codexTurnId: 't', stopRequested: false, interrupt: null, finish: () => {} })
      for (const item of c.codexItems ?? []) {
        codex.onNotification({ method: 'item/started', params: { threadId: 'thread-1', turnId: 't', item: { ...item, status: 'inProgress' } } })
        codex.onNotification({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 't', item } })
      }
    } else {
      const { kind, label } = describeTool(c.claude!.name, c.claude!.input)
      sink.item({ type: 'tool', id: `${request.turnId}:t1`, turnId: request.turnId, kind, status: 'done', label, output: '' })
    }
    sink.item({ type: 'assistant', id: `${request.turnId}:a`, turnId: request.turnId, text: 'Done.', streaming: false })
    return { status: 'completed' }
  }
  async prepare() {}
  async stop() {}
  forget() {}
  async usage() { return unavailableUsage(this.id, 'test') }
  async models() { return [] }
  shutdown() {}
}

const store = new Store(join(tmp, 'rocket.db'))
const codex = new ReplayAdapter('codex'), claude = new ReplayAdapter('claude')
const hub = new Hub(store, { codex, claude, cursor: claude, antigravity: claude } as never, () => {})
const rows = []
try {
  for (const c of cases) {
    const adapter = c.provider === 'codex' ? codex : claude
    adapter.current = c
    const chat = hub.createChat(tmp)
    const turnId = hub.send(chat.id, c.provider, null, 'Draft a goal and use goal_report when ready.')
    await hub.waitForTurn(chat.id, { turnId, timeoutMs: 10_000 })
    const exported = buildTurnExport(store, turnId, { ledger })!
    const grade = gradeTurnExport(exported, ['goal_report_called', 'tool_called:goal_report', 'tool_not_called:goal_report'])
    const tools = exported.items.filter((item) => item.type === 'tool').map((item) => item.type === 'tool' ? { kind: item.kind, status: item.status, label: item.label } : null)
    const ledgerGoalReport = (exported.ledger.calls as Array<{ tool?: string; outcome?: string }>).filter((call) => call.tool === 'goal_report').map((call) => call.outcome)
    rows.push({
      case: c.name, intent: c.intent, translatedTools: tools, ledgerGoalReport,
      goal_report_called: grade.graders.goal_report_called!.pass,
      tool_not_called_goal_report: grade.graders['tool_not_called:goal_report']!.pass,
      // eval-runtime.ts:74 builds EvalExport with () => undefined, so headless matrix exports carry no ledger calls.
      goal_report_called_without_ledger: gradeTurnExport(buildTurnExport(store, turnId, {})!, ['goal_report_called']).graders.goal_report_called!.pass,
      correct: c.intent === 'control-true-positive' ? grade.graders.goal_report_called!.pass : !grade.graders.goal_report_called!.pass
    })
  }
  const out = { codexProtocolSource: 'https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/item.rs', rows }
  writeFileSync(join(here, 'experiment-grader.json'), JSON.stringify(out, null, 2) + '\n')
  console.table(rows.map(({ case: name, intent, goal_report_called, goal_report_called_without_ledger, tool_not_called_goal_report, correct }) => ({ name, intent, goal_report_called, goal_report_called_without_ledger, tool_not_called_goal_report, correct })))
} finally {
  store.close()
  ledger.close()
  rmSync(tmp, { recursive: true, force: true })
}
