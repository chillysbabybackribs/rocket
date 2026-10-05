import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { runCommand } from './ui-process.mjs'

const alive = async pid => {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z'
  } catch { return false }
}

test('UI cancellation stops wrapper, ordinary children and detached TERM-resistant descendants', { timeout: 10_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rocket-ui-process-'))
  const controller = new AbortController()
  const pids = []
  let running
  try {
    await writeFile(join(dir, 'child.mjs'), `
      import { writeFileSync } from 'node:fs'
      process.on('SIGTERM', () => {})
      writeFileSync(process.argv[2], String(process.pid))
      setInterval(() => {}, 1000)
    `)
    await writeFile(join(dir, 'wrapper.mjs'), `
      import { spawn } from 'node:child_process'
      import { writeFileSync } from 'node:fs'
      writeFileSync('wrapper.pid', String(process.pid))
      for (const detached of [false, true]) spawn(process.execPath, ['child.mjs', detached ? 'detached.pid' : 'child.pid'], { detached, stdio: 'inherit' })
      setInterval(() => {}, 1000)
    `)
    running = runCommand(process.execPath, ['wrapper.mjs'], {
      cwd: dir, env: process.env, signal: controller.signal, onOutput: () => {}, graceMs: 150
    })
    for (const file of ['wrapper.pid', 'child.pid', 'detached.pid']) {
      const deadline = Date.now() + 3_000
      while (true) {
        try { pids.push(Number(await readFile(join(dir, file), 'utf8'))); break } catch {}
        assert.ok(Date.now() < deadline, `Process did not start: ${file}`)
        await delay(10)
      }
    }
    assert.deepEqual(await Promise.all(pids.map(alive)), [true, true, true])
    controller.abort()
    assert.notEqual(await running, 0)
    assert.deepEqual(await Promise.all(pids.map(alive)), [false, false, false])
  } finally {
    controller.abort()
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL') } catch {} }
    await running?.catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }
})

test('UI command preserves exit status and does not start work after interruption', async () => {
  const controller = new AbortController()
  const options = { cwd: tmpdir(), env: process.env, signal: controller.signal, onOutput: () => {} }
  assert.equal(await runCommand(process.execPath, ['-e', 'process.exit(7)'], options), 7)
  controller.abort()
  assert.notEqual(await runCommand('/must/not/start', [], options), 0)
})
