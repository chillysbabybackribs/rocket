// Exercise the shared reader against live HTTP and the running app browser without model turns.
// node --experimental-transform-types scripts/check-research.mjs
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { researchTools } from '../src/host/tools/research.ts'
const profile = process.env.ROCKET_DATA_DIR || join(homedir(), '.config', 'Rocket')
const channel = JSON.parse(await readFile(join(profile, 'tool-channel.json'), 'utf8'))
const endpoint = `http://127.0.0.1:${channel.port}/mcp/${channel.secret}/codex/research-validation`
const call = async (name, args) => {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }), signal: AbortSignal.timeout(60_000) })
  const envelope = await response.json()
  if (envelope.error) throw new Error(envelope.error.message)
  const result = envelope.result
  const text = result.content.map(x => x.text || '').join('\n')
  if (result.isError) throw new Error(text)
  return text
}
const folder = join(process.cwd(), '.artifacts', 'research', new Date().toISOString().replace(/[:.]/g, '-'))
await mkdir(folder, { recursive: true })
const tools = researchTools({ request: async op => {
  if (op.op !== 'read') throw new Error('Unexpected browser operation')
  return call('browser_read', { url: op.url, focus: 'text', max: op.max })
} }, folder)
const context = { provider: 'codex', chatId: 'research-validation' }
const checks = [
  ['html', 'web_read', { url: 'https://github.com/mozilla/readability', max: 1500 }],
  ['pdf', 'web_read', { url: 'https://arxiv.org/pdf/2608.14611', max: 1500 }],
  ['search', 'web_search', { query: 'site:github.com/mozilla/readability Readability' }],
  ['blocked-destination', 'web_read', { url: 'https://openai.com/index/navier-stokes-solution/', max: 1500 }]
]
const results = []
try {
  for (const [name, tool, args] of checks) {
    const start = Date.now()
    const result = await tools.find(t => t.name === tool).run(args, context)
    const text = result.content.map(c => c.text || '').join('\n')
    results.push({ name, isError: !!result.isError, milliseconds: Date.now() - start, text })
    console.log(JSON.stringify({ name, isError: !!result.isError, milliseconds: Date.now() - start, preview: text.slice(0, 450) }))
  }
} finally {
  await writeFile(join(folder, 'results.json'), JSON.stringify(results, null, 2))
  await call('browser_run', { code: 'await tab.close(); return "Validation tab closed"' }).catch(() => {})
}
console.log(`Results: ${folder}/results.json`)
if (results.some(r => r.isError && r.name !== 'blocked-destination')) process.exitCode = 1
