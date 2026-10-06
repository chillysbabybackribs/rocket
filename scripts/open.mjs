#!/usr/bin/env node
// `npm run open -- <path or URL>`: open something inside Rocket, as a link in the chat would.
// With the app running it lands there in a browser tab (a page) or the artifact panel (a text
// file) and this exits at once; otherwise the app starts and opens it. Runs the built app, so
// `npm run build` first after changing the source.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { electronEnv } from './electron-env.mjs'
import { ensureElectronSandbox } from './electron-sandbox.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const target = process.argv[2]
if (!target) {
  console.error('Give a file path or URL to open: npm run open -- docs/mockups/turn-changes.html')
  process.exit(2)
}
if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
  console.error('The app is not built yet. Run npm run build first.')
  process.exit(1)
}
const href = /^(https?|file):/i.test(target) ? target : resolve(process.cwd(), target)
// The app's own directory, so Electron reads package.json and the launch shares the running
// instance's identity; `out/main/index.js` as the entry would make a second, separate app.
const electron = join(root, 'node_modules', '.bin', 'electron')
const env = electronEnv()
ensureElectronSandbox(env)
const child = spawn(electron, [root, href], { cwd: root, env, stdio: 'inherit', detached: true })
child.unref()
