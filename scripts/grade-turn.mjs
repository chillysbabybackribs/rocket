#!/usr/bin/env node
// Deterministic graders for exported turn.json (Lane B matrix eval).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function usage() {
  console.error(`Usage: node scripts/grade-turn.mjs <turn.json> [--graders a,b,c] [--budget-ms N] [--out graders.json]`)
  process.exit(2)
}

const args = process.argv.slice(2)
if (!args.length || args[0] === '-h' || args[0] === '--help') usage()
const turnPath = resolve(args[0])
let graders = ['turn_completed']
let budgetMs = null
let outPath = join(dirname(turnPath), 'graders.json')

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--graders') graders = String(args[++i] ?? '').split(',').map(s => s.trim()).filter(Boolean)
  else if (args[i] === '--budget-ms') budgetMs = Number(args[++i])
  else if (args[i] === '--out') outPath = resolve(args[++i])
}

const body = JSON.parse(readFileSync(turnPath, 'utf8'))
const turn = body.turn ?? {}
const items = body.items ?? []
const calls = body.ledger?.calls ?? []

function toolSucceeded(name) {
  return calls.some(c => c.tool === name && c.outcome === 'success')
    || items.some(it => it.type === 'tool' && it.status === 'done' && String(it.label).includes(name))
}

function failureCodes() {
  const codes = []
  for (const call of calls) {
    if (call.outcome === 'failure' && call.finish?.error?.code) codes.push(call.finish.error.code)
  }
  return codes
}

const results = {}

function pass(name, score = 1, metadata = {}) {
  results[name] = { score, pass: score >= 1, metadata }
}

function fail(name, reason, metadata = {}) {
  results[name] = { score: 0, pass: false, metadata: { reason, ...metadata } }
}

for (const name of graders) {
  switch (name) {
    case 'turn_completed':
      turn.status === 'completed' ? pass(name) : fail(name, `status=${turn.status}`)
      break
    case 'turn_failed':
      turn.status === 'failed' ? pass(name) : fail(name, `status=${turn.status}`)
      break
    case 'goal_report_called':
      toolSucceeded('goal_report') ? pass(name) : fail(name, 'no successful goal_report in ledger or transcript')
      break
    case 'ask_user_used':
      items.some(it => it.type === 'question') ? pass(name) : fail(name, 'no question item')
      break
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
    case 'latency_budget': {
      const total = body.timing?.totalMs
      const limit = budgetMs ?? 120_000
      if (typeof total !== 'number') fail(name, 'no timing.totalMs')
      else total <= limit ? pass(name, 1, { totalMs: total, limitMs: limit }) : fail(name, 'over budget', { totalMs: total, limitMs: limit })
      break
    }
    default:
      results[name] = { score: 0, pass: false, metadata: { reason: 'unknown grader' } }
  }
}

const summary = {
  gradedAt: new Date().toISOString(),
  turnPath,
  turnId: turn.id,
  provider: turn.provider,
  model: turn.model,
  graders: results,
  allPass: Object.values(results).every(r => r.pass)
}

writeFileSync(outPath, JSON.stringify(summary, null, 2))
console.log(`${summary.allPass ? 'PASS' : 'FAIL'} → ${outPath}`)
for (const [name, row] of Object.entries(results)) {
  console.log(`  ${row.pass ? '✓' : '✗'} ${name}${row.metadata?.reason ? `: ${row.metadata.reason}` : ''}`)
}
process.exit(summary.allPass ? 0 : 1)
