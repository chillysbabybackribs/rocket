// Isolated experiment: does a provider CLI started the way Rocket starts it (its own process
// group via detached:true, stdio pipes) outlive a SIGKILL of the process that spawned it? That
// is what a host crash looks like to the CLI: its stdin reaches EOF and its stdout breaks.
// No model turn is sent. Everything spawned here is SIGKILLed as a group at the end.
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
const local = (name) => (existsSync(join(homedir(), '.local', 'bin', name)) ? join(homedir(), '.local', 'bin', name) : name)
const here = import.meta.dirname
const cases = [
  { name: 'codex app-server', exe: 'codex', args: ['app-server', '--listen', 'stdio://'] },
  { name: 'cursor-agent acp', exe: local('cursor-agent'), args: ['acp'] },
  { name: 'agy stream-json', exe: local('agy'), args: ['--print=', '--input-format', 'stream-json', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--disable-slash-commands', '--print-timeout', '60m', '--add-dir', here] }
]
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const groupOf = async (pid) => (await import('node:fs/promises')).readFile(`/proc/${pid}/stat`, 'utf8').then((s) => s.split(') ')[1].split(' ')[2]).catch(() => '?')
for (const c of cases) {
  // The wrapper plays the host: it spawns the CLI detached with pipes and then idles.
  const wrapper = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process')
    const child = spawn(${JSON.stringify(c.exe)}, ${JSON.stringify(c.args)}, { cwd: ${JSON.stringify(here)}, env: process.env, stdio: ['pipe','pipe','pipe'], detached: true })
    child.stdout.on('data', () => {}); child.stderr.on('data', () => {})
    child.on('exit', (code, sig) => { process.stdout.write('exit ' + code + ' ' + sig + '\\n') })
    process.stdout.write('pid ' + child.pid + '\\n')
    setInterval(() => {}, 1000)
  `], { stdio: ['ignore', 'pipe', 'inherit'] })
  const pid = await new Promise((resolve) => wrapper.stdout.on('data', (d) => { const m = /pid (\d+)/.exec(String(d)); if (m) resolve(Number(m[1])) }))
  await sleep(4000)
  const before = alive(pid)
  const pgid = await groupOf(pid)
  wrapper.kill('SIGKILL')
  const seen = []
  for (let s = 1; s <= 8; s++) { await sleep(1000); seen.push(alive(pid) ? 'alive' : 'gone') }
  console.log(`${c.name}: pid ${pid} pgid ${pgid}; before wrapper SIGKILL: ${before ? 'alive' : 'gone'}; after, per second: ${seen.join(' ')}`)
  try { process.kill(-pid, 'SIGKILL') } catch {}
  try { process.kill(pid, 'SIGKILL') } catch {}
}
