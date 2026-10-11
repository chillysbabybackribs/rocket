// Runs the board capture spec beside this file against Rocket Orchestrator's built app.
// Run from /home/dp/Desktop/rocket-orchestrator after `npm run build`:
//   ROCKET_UI_OUTPUT=<dir> xvfb-run -a --server-args='-screen 0 1440x960x24' node node_modules/@playwright/test/cli.js test --config <this file>
import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const output = process.env.ROCKET_UI_OUTPUT || resolve('.artifacts/ui/board-capture')

export default defineConfig({
  testDir: import.meta.dirname,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 10_000 },
  outputDir: resolve(output, 'results'),
  reporter: [['list'], ['json', { outputFile: resolve(output, 'results.json') }]]
})
