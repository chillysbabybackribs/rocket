import { readFileSync } from 'node:fs'

export type GraderRow = { score: number; pass: boolean; metadata?: Record<string, unknown> }
export type GradeSummary = { allPass: boolean; graders: Record<string, GraderRow> }

export function gradeTurnExport(body: unknown, graders: string[]): GradeSummary {
  const turn = (body as { turn?: { status?: string; id?: string } }).turn ?? {}
  const items = (body as { items?: unknown[] }).items ?? []
  const calls = (body as { ledger?: { calls?: Array<{ tool?: string; outcome?: string; finish?: { error?: { code?: string } }; turnId?: string }> } }).ledger?.calls ?? []

  const results: Record<string, GraderRow> = {}
  const pass = (name: string, score = 1, metadata: Record<string, unknown> = {}) => { results[name] = { score, pass: score >= 1, metadata } }
  const fail = (name: string, reason: string, metadata: Record<string, unknown> = {}) => {
    results[name] = { score: 0, pass: false, metadata: { reason, ...metadata } }
  }

  const toolSucceeded = (name: string) =>
    calls.some((c) => c.tool === name && c.outcome === 'success')
    || items.some((it) => {
      const row = it as { type?: string; status?: string; label?: string }
      return row.type === 'tool' && row.status === 'done' && String(row.label).includes(name)
    })

  const failureCodes = () => {
    const codes: string[] = []
    for (const call of calls) {
      if (call.outcome === 'failure' && call.finish?.error?.code) codes.push(call.finish.error.code)
    }
    return codes
  }

  for (const name of graders) {
    switch (name) {
      case 'turn_completed':
        turn.status === 'completed' ? pass(name) : fail(name, `status=${turn.status ?? 'unknown'}`)
        break
      case 'turn_failed':
        turn.status === 'failed' ? pass(name) : fail(name, `status=${turn.status ?? 'unknown'}`)
        break
      case 'goal_report_called':
        toolSucceeded('goal_report') ? pass(name) : fail(name, 'no successful goal_report')
        break
      case 'ask_user_used':
        items.some((it) => (it as { type?: string }).type === 'question') ? pass(name) : fail(name, 'no question item')
        break
      case 'no_tool_error_codes': {
        const codes = failureCodes()
        codes.length ? fail(name, 'tool failures', { codes }) : pass(name, 1, { codes: [] })
        break
      }
      default:
        fail(name, 'unknown grader')
    }
  }

  return { allPass: Object.values(results).every((row) => row.pass), graders: results }
}

export function gradeTurnFile(turnPath: string, graders: string[]): GradeSummary {
  return gradeTurnExport(JSON.parse(readFileSync(turnPath, 'utf8')), graders)
}
