// Real headless runtime, fixture adapters only, temporary profile and local tool channel.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEvalRuntime } from '../../../../../src/host/eval-runtime.ts';
import { gradeTurnExport } from '../../../../../src/host/eval-grade.ts';
process.env.ROCKET_EVAL_FIXTURE = '1';
const root = mkdtempSync(join(tmpdir(), 'rocket-headless-evidence-'));
let runtime;
try {
  runtime = await createEvalRuntime({ dataDir: root, repoRoot: root });
  const adapter = runtime.hub.adapters.codex;
  const finish = adapter.run.bind(adapter);
  let toolResult;
  adapter.run = async (request, sink) => {
    const response = await fetch(runtime.tools.url('codex', request.chatId), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser_read', arguments: { tab: 'fixture-tab' } } })
    });
    toolResult = (await response.json()).result;
    sink.item({ type: 'tool', id: request.turnId + ':failure', turnId: request.turnId, kind: 'mcp', label: 'rocket · browser_read', status: 'failed', output: JSON.stringify(toolResult) });
    return finish(request, sink);
  };
  const chat = runtime.hub.createChat(root);
  const turnId = runtime.hub.send(chat.id, 'codex', null, 'fixture: browser failure');
  await runtime.hub.waitForTurn(chat.id, { turnId, timeoutMs: 5000 });
  const path = runtime.evalExport.exportTurn(turnId, null, join(root, 'export'));
  const body = JSON.parse(readFileSync(path, 'utf8'));
  const result = { toolResult, turnStatus: body.turn.status, failedTranscriptTools: body.items.filter(i => i.type === 'tool' && i.status === 'failed').length, ledger: body.ledger, grades: gradeTurnExport(body, ['turn_completed', 'no_tool_error_codes', 'tool_error_codes']) };
  writeFileSync(new URL('headless-ledger.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (runtime) await runtime.shutdown();
  rmSync(root, { recursive: true, force: true });
}
