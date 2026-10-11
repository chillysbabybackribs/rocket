// Holds session/prompt forever and records every incoming method. Does not answer cancel.
import { createInterface } from 'node:readline'
import { writeFileSync } from 'node:fs'

const logPath = process.env.PEER_LOG
const lines = []
function record(entry) {
  lines.push({ at: Date.now(), ...entry })
  writeFileSync(logPath, JSON.stringify(lines))
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  const message = JSON.parse(line)
  record({ method: message.method ?? null, id: message.id ?? null })
})
setInterval(() => {}, 1_000)
