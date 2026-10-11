import { Store } from '../../../../../src/host/store.ts';
import { ToolLedger } from '../../../../../src/host/tool-ledger.ts';
import { buildTurnExport } from '../../../../../src/host/eval-export.ts';
import fs from 'fs';
import { randomUUID } from 'crypto';

async function run() {
  const store = new Store(':memory:');
  const dbPath = 'docs/research/continuous/orchestrated/evidence-03-antigravity/test-ledger.sqlite';
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const ledger = new ToolLedger(dbPath, false);
  const chatId = 'c1';
  const turnId = 't1';
  
  store.sql('INSERT INTO chats (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)').run(chatId, JSON.stringify({id: chatId, title: 'test', cwd: '/test'}), Date.now(), Date.now());
  const turnObj = { id: turnId, chatId, provider: 'codex', status: 'completed', startedAt: Date.now() - 10000, endedAt: Date.now() };
  store.sql('INSERT INTO turns (id, chat_id, data, created_at) VALUES (?, ?, ?, ?)').run(turnId, chatId, JSON.stringify(turnObj), Date.now());

  const startTime = Date.now() - 5000;
  
  ledger.record(chatId, turnId, 'test_tool', 'failed', 'error', 'args', startTime, 100);
  
  for (let i = 0; i < 50; i++) {
    ledger.record(chatId, turnId, 'test_tool', 'success', 'ok', 'args', startTime + 1000 + i, 100);
  }

  const exportObj = await buildTurnExport(store, ledger, chatId, turnId);
  const exportedCalls = exportObj?.calls || [];
  
  const hasFailure = exportedCalls.some((c: any) => c.outcome === 'failure');
  console.log("Total exported calls:", exportedCalls.length);
  console.log("Has failure?", hasFailure);

  fs.writeFileSync('docs/research/continuous/orchestrated/evidence-03-antigravity/e1-result.json', JSON.stringify({
    exportedCalls: exportedCalls.length,
    hasFailure
  }, null, 2));
}

run().catch(console.error);
