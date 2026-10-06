#!/usr/bin/env node
// Launches electron-vite (dev or preview) with an environment Electron can start cleanly in;
// electron-env.mjs says why the scrub is needed.
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronEnv } from './electron-env.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bin = join(root, 'node_modules', '.bin', 'electron-vite')
const child = spawn(bin, process.argv.slice(2), { cwd: root, env: electronEnv(), stdio: 'inherit' })
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
