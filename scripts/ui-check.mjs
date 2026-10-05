#!/usr/bin/env node
// One entry point: build the current source, then test a fresh Electron profile. Each run
// keeps its own report, including failures during build, rather than replacing the last run.
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
await mkdir(join(root, '.artifacts/ui'), { recursive: true })
const output = await mkdtemp(join(root, '.artifacts/ui', `${new Date().toISOString().replace(/[:.]/g, '-')}-`))
const env = { ...process.env, NODE_ENV: 'test', ROCKET_UI_OUTPUT: output }
const log = createWriteStream(join(output, 'runner.log'))
let child
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child?.kill(signal))
const run = (command, args) => new Promise((resolve, reject) => {
  child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { process.stdout.write(data); log.write(data) })
  child.once('error', reject)
  child.once('exit', (code) => resolve(code ?? 1))
})
console.log(`UI check artifacts: ${output}`)
let status = 1
try {
  status = await run('npm', ['run', 'build'])
  if (!status) status = await run(process.execPath, [join(root, 'node_modules/@playwright/test/cli.js'), 'test', ...process.argv.slice(2)])
} catch (error) {
  console.error(error)
  log.write(String(error))
} finally {
  await writeFile(join(output, 'summary.json'), JSON.stringify({ status: status === 0 ? 'passed' : 'failed', exitCode: status, output }, null, 2))
  log.end()
  console.log(`\n${status === 0 ? 'PASS' : 'FAIL'} — UI check artifacts: ${output}`)
  process.exitCode = status
}
