// Read-only: Cursor turns in the live store whose final assistant text ends in cursor-agent's
// "\n\nError: <Kind>: [code] message" form (6136.index.js processPrompt catch). Prints metadata and
// the error line only. Usage: node store-transport-errors.mjs [path/to/rocket.db]
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

const path = process.argv[2] ?? join(homedir(), '.config', 'Rocket', 'rocket.db')
const db = new DatabaseSync(path, { readOnly: true })
const pattern = /\n\nError: (\w*Error): (\[[a-z_]+\][^\n]*)$/
const turns = db.prepare("SELECT seq, id, chat_id, model, status, error, started_at, ended_at FROM turns WHERE provider = 'cursor' AND status != 'running' ORDER BY seq").all()
const rows = []
for (const turn of turns) {
  const items = db.prepare('SELECT data FROM items WHERE turn_id = ? ORDER BY seq').all(turn.id).map((row) => JSON.parse(row.data))
  const last = items.filter((item) => item.type === 'assistant').at(-1)
  const match = last && pattern.exec(last.text)
  if (!match) continue
  const tools = items.filter((item) => item.type === 'tool').length
  rows.push({
    seq: turn.seq,
    model: turn.model,
    status: turn.status,
    turnError: turn.error,
    durationS: turn.ended_at ? Math.round((turn.ended_at - turn.started_at) / 1000) : null,
    endedAt: turn.ended_at ? new Date(turn.ended_at).toISOString() : null,
    toolCalls: tools,
    assistantCharsBeforeError: last.text.length - match[0].length,
    errorLine: `Error: ${match[1]}: ${match[2]}`
  })
}
const byStatus = turns.reduce((counts, turn) => ({ ...counts, [turn.status]: (counts[turn.status] ?? 0) + 1 }), {})
console.log(JSON.stringify({ cursorTurnsByStatus: byStatus, errorTextTurns: rows }, null, 2))
db.close()
