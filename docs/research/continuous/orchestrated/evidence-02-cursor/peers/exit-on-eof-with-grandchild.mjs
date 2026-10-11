// Exits on stdin EOF, after spawning a grandchild in its own session with stdio ignored.
// Models a CLI that dies with its pipe while a shell it started does not.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const [stayScript, pidFile] = process.argv.slice(2)
const grandchild = spawn(process.execPath, [stayScript], { detached: true, stdio: 'ignore' })
writeFileSync(pidFile, String(grandchild.pid))
grandchild.unref()
process.stdin.on('end', () => process.exit(0))
process.stdin.resume()
setInterval(() => {}, 1_000)
