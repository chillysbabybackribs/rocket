import { ToolLedger } from '../../../../../src/host/tool-ledger.ts'
import { buildTurnExport } from '../../../../../src/host/eval-export.ts'
import { gradeTurnExport } from '../../../../../src/host/eval-grade.ts'
import { failureResult } from '../../../../../src/host/tools/registry.ts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const dir = mkdtempSync(join(tmpdir(), 'rocket-export-research-'))
let at = 1000
const ledger = new ToolLedger(join(dir, 'ledger.db'), 'synthetic', () => ({ model: null, turnId: 'target' }), () => at)
const tool = { name: 'probe', description: 'Synthetic probe', inputSchema: { type: 'object' }, run: () => ({ content: [] }) }
try {
  const first = ledger.start('probe', tool, {}, { provider: 'codex', chatId: 'chat' })
  ledger.finish(first, failureResult('SYNTHETIC_FAILURE', 'Known failure at the start of this turn.', 'operation'))
  for (let i=0; i<50; i++) {
    at++
    const id = ledger.start('probe', tool, {}, { provider: 'codex', chatId: 'chat' })
    ledger.finish(id, { content: [] })
  }
  const turn = { id: 'target', seq: 1, chatId: 'chat', provider: 'codex', status: 'completed', startedAt: 1000, endedAt: at }
  const store = { turn: () => turn, chat: () => ({id:'chat',title:'Synthetic',cwd:dir}), turnItems: () => [] }
  const exported = buildTurnExport(store, 'target', { ledger })
  const result = { realCalls: ledger.query({since:0,until:at,limit:50}).matching, exportedCalls: exported.ledger.calls.length, exportedFailures: exported.ledger.calls.filter(c => c.outcome === 'failure').length, grade: gradeTurnExport(exported, ['no_tool_error_codes']), exportMarksTruncation: Object.hasOwn(exported.ledger,'truncated') }
  writeFileSync(new URL('./export-truncation.json',import.meta.url),JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify(result,null,2))
} finally { ledger.close(); rmSync(dir,{recursive:true,force:true}) }
