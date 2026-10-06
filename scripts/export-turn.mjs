#!/usr/bin/env node
// Export one turn from the local Rocket store to turn.json (no running app required).
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const turnId = process.argv[2]
const outDir = resolve(process.argv[3] ?? join(root, '.artifacts/evals/manual', turnId ?? 'unknown'))

if (!turnId) {
  console.error('Usage: node scripts/export-turn.mjs <turnId> [outDir]')
  process.exit(2)
}

const dataDir = process.env.ROCKET_DATA_DIR || join(homedir(), '.config', 'rocket')
const storePath = join(dataDir, 'rocket.db')

const { Store } = await import(pathToFileURL(join(root, 'src/host/store.ts')).href)
const { buildTurnExport, writeTurnExport } = await import(pathToFileURL(join(root, 'src/host/eval-export.ts')).href)

const store = new Store(storePath)
const body = buildTurnExport(store, turnId, { ledger: null })
store.close()

if (!body) {
  console.error(`Turn not found: ${turnId} in ${storePath}`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
const path = writeTurnExport(body, outDir)
console.log(path)
