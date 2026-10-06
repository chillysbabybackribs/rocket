import { readFileSync } from 'node:fs'

export type GraderRow = { score: number; pass: boolean; metadata?: Record<string, unknown> }
export type GradeSummary = { allPass: boolean; graders: Record<string, GraderRow> }

/** What the run knows beyond the turn itself: the files it changed in its copy of the folder. */
export type GradeContext = { files?: Array<{ path: string }> }

export function gradeTurnExport(body: unknown, graders: string[], context: GradeContext = {}): GradeSummary {
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

  // The graders that read files only work for a run made in its own copy of the folder.
  const changed = (name: string): string[] | null => {
    if (context.files) return context.files.map((file) => file.path)
    fail(name, 'the run did not record which files changed; run it from the eval panel')
    return null
  }
  // The reply the user would read: the turn's last assistant text, after its tool calls.
  const reply = (): string => {
    const texts = items.filter((it) => (it as { type?: string }).type === 'assistant')
    return String((texts.at(-1) as { text?: string } | undefined)?.text ?? '').trim()
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
      case 'files_unchanged': {
        const files = changed(name)
        if (files) files.length ? fail(name, `changed ${files.join(', ')}`, { files }) : pass(name)
        break
      }
      case 'no_question_asked': {
        const asked = items.some((it) => (it as { type?: string }).type === 'question')
        const text = reply()
        if (asked) fail(name, 'asked with ask_user')
        else if (text.endsWith('?')) fail(name, 'the reply ends with a question')
        else pass(name)
        break
      }
      case 'no_tool_error_codes': {
        const codes = failureCodes()
        codes.length ? fail(name, 'tool failures', { codes }) : pass(name, 1, { codes: [] })
        break
      }
      case 'tool_error_codes': {
        const codes = failureCodes()
        codes.length ? pass(name, 1, { codes }) : fail(name, 'expected tool errors')
        break
      }
      default:
        if (name.startsWith('tool_called:')) {
          const tool = name.slice('tool_called:'.length)
          toolSucceeded(tool) ? pass(name) : fail(name, `no successful ${tool}`)
        } else if (name.startsWith('tool_not_called:')) {
          const tool = name.slice('tool_not_called:'.length)
          toolSucceeded(tool) ? fail(name, `${tool} was called`) : pass(name)
        } else if (name.startsWith('only_files_changed:')) {
          const allowed = name.slice('only_files_changed:'.length).split(',').map((path) => path.trim()).filter(Boolean)
          const files = changed(name)
          if (files) {
            const others = files.filter((path) => !allowed.includes(path))
            if (others.length) fail(name, `also changed ${others.join(', ')}`, { files })
            else if (!files.length) fail(name, `changed nothing; expected ${allowed.join(', ')}`)
            else pass(name, 1, { files })
          }
        } else if (name.startsWith('tool_error_code:')) {
          const code = name.slice('tool_error_code:'.length)
          failureCodes().includes(code) ? pass(name, 1, { code }) : fail(name, `expected code ${code}`)
        } else fail(name, 'unknown grader')
    }
  }

  return { allPass: Object.values(results).every((row) => row.pass), graders: results }
}

export function gradeTurnFile(turnPath: string, graders: string[], context: GradeContext = {}): GradeSummary {
  return gradeTurnExport(JSON.parse(readFileSync(turnPath, 'utf8')), graders, context)
}
