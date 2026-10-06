#!/usr/bin/env node
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mockRoot = join(root, 'docs/evals/mock-ui')
const port = Number(process.env.ROCKET_EVAL_MOCK_PORT ?? 8765)

const types = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
}

createServer((req, res) => {
  const path = req.url?.split('?')[0] === '/' ? '/index.html' : req.url?.split('?')[0] ?? '/index.html'
  const file = join(mockRoot, path.replace(/^\//, ''))
  if (!file.startsWith(mockRoot) || !existsSync(file)) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
}).listen(port, () => {
  console.log(`Rocket eval mock UI → http://127.0.0.1:${port}/`)
  console.log('Load live matrix runs: npm run eval:mock-ui:sync')
})
