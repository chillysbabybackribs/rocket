# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: orchestra-shell.spec.ts >> orchestra-shell streams eight workers and supports expand reply stop reports and scrolling
- Location: tests/ui/orchestra-shell.spec.ts:85:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.orch-shell')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('.orch-shell') with timeout 10000ms
  - waiting for locator('.orch-shell')

```

```yaml
- banner:
  - group "Window controls":
    - button "Close window"
    - button "Minimize window"
    - button "Zoom window"
  - button "Sections"
  - 'button "Claude usage: 25% used"': 25%
  - 'button "Codex usage: 25% used"': 25%
  - 'button "Cursor usage: 25% used"': 25%
  - 'button "Antigravity usage: 25% used"': 25%
- main:
  - 'region "Continuously exercise the isolated worker board. UI check: …"':
    - article:
      - paragraph: "Continuously exercise the isolated worker board. UI check: orchestra-shell"
      - status: Thinking Working for 10s
      - button "Worked · 6 steps 1 failed"
      - paragraph: Streaming from claude.
    - tablist "Open chats":
      - 'tab "Answering Continuously exercise the isolated worker board. UI check: …" [selected]': "Continuously exercise the isolated worker board. UI check: …"
      - 'button "Close tab: Continuously exercise the isolated worker board. UI check: …"'
      - button "New chat"
    - button "Add a chat beside this one"
    - textbox "Message":
      - /placeholder: Add to this turn…
    - button "Attach files"
    - button "Capture"
    - button "~/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-21-28-547Z-qpkg5v/results/orchestra-shell-orchestra--4e48f--stop-reports-and-scrolling/workspace" [disabled]
    - button "Claude"
    - button "Stop"
    - button "Add to this turn" [disabled]
```

# Test source

```ts
  1   | import { readFile, writeFile } from 'node:fs/promises'
  2   | import { join } from 'node:path'
  3   | import type { Page } from 'playwright'
  4   | import { test, expect } from './app'
  5   | import type { Orchestration, OrchestratorTask } from '../../src/shared/orchestrator'
  6   | 
  7   | // The fixture launches a fresh marked profile, real host/store and controlled providers only.
  8   | // Host dispatch rejects overflow rather than queueing: eight windows accumulate over reviews.
  9   | test('orchestra-shell fresh profile keeps the leader full height below the title strip', async ({ rocket }) => {
  10  |   const { page } = rocket
  11  |   await rocket.capture('01-fresh-profile')
  12  |   await expect(page.locator('.orch-shell')).toBeVisible()
  13  |   const leader = page.getByTestId('orchestrator-chat')
  14  |   await expect(leader).toBeVisible()
  15  |   await expect(page.getByTestId('worker-board-empty')).toBeVisible()
  16  |   const shell = await page.locator('.orch-shell').boundingBox()
  17  |   const column = await leader.boundingBox()
  18  |   expect(shell).not.toBeNull()
  19  |   expect(column).not.toBeNull()
  20  |   expect(shell!.y).toBeGreaterThan(0)
  21  |   expect(Math.abs(column!.y - shell!.y)).toBeLessThanOrEqual(2)
  22  |   expect(Math.abs(column!.height - shell!.height)).toBeLessThanOrEqual(2)
  23  |   expect(Math.abs(shell!.y + shell!.height - await page.evaluate(() => innerHeight))).toBeLessThanOrEqual(2)
  24  | })
  25  | 
  26  | async function start(rocket: { page: Page; profile: string }) {
  27  |   const { page, profile } = rocket
  28  |   await page.locator('.composer-folder').first().click()
  29  |   const composer = page.getByRole('textbox', { name: 'Message', exact: true }).first()
  30  |   await composer.fill('Continuously exercise the isolated worker board.\nUI check: orchestra-shell')
  31  |   await page.getByRole('button', { name: 'Send', exact: true }).first().click()
  32  |   await expect.poll(async () => readFile(join(profile, 'ui-orchestra.json'), 'utf8').then(() => true).catch(() => false)).toBe(true)
  33  |   const fixture = JSON.parse(await readFile(join(profile, 'ui-orchestra.json'), 'utf8')) as {
  34  |     chatId: string; turnId: string; results: Array<{ isError?: boolean; content: Array<{ text: string }> }>
  35  |   }
  36  |   const channel = JSON.parse(await readFile(join(profile, 'tool-channel.json'), 'utf8')) as { port: number; secret: string }
  37  |   const callRaw = async (args: Record<string, unknown>) => {
  38  |     const response = await fetch(`http://127.0.0.1:${channel.port}/mcp/${channel.secret}/codex/${fixture.chatId}`, {
  39  |       method: 'POST', headers: { 'Content-Type': 'application/json' },
  40  |       body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'orchestrator', arguments: args } })
  41  |     })
  42  |     expect(response.ok).toBe(true)
  43  |     const body = await response.json()
  44  |     expect(body.error).toBeUndefined()
  45  |     return body.result as { isError?: boolean; content: Array<{ text: string }> }
  46  |   }
  47  |   const call = async (args: Record<string, unknown>): Promise<Orchestration> => {
  48  |     const result = await callRaw(args)
  49  |     expect(result.isError, JSON.stringify(result)).toBeUndefined()
  50  |     return JSON.parse(result.content[0].text)
  51  |   }
  52  |   const release = async (task: OrchestratorTask) => {
  53  |     expect(task.turnId).toBeTruthy()
  54  |     await writeFile(join(profile, `ui-release-${task.turnId}`), '')
  55  |     await expect.poll(async () => (await call({ action: 'status' })).tasks.find(each => each.id === task.id)?.status).toBe('completed')
  56  |   }
  57  |   const review = async (task: OrchestratorTask) => call({ action: 'checkpoint', taskId: task.id,
  58  |     summary: 'Controlled fixture inspected.', next: 'Continue isolated board checks.',
  59  |     review: 'Accepted fixture report and observed stream; external provider behavior is outside this check.' })
  60  |   expect(fixture.results).toHaveLength(5)
  61  |   expect(fixture.results.slice(0, 4).every(result => !result.isError)).toBe(true)
  62  |   expect(fixture.results[4].isError).toBe(true)
  63  |   expect(fixture.results[4].content[0].text).toContain('Three workers are already running')
  64  |   return { fixture, call, callRaw, release, review }
  65  | }
  66  | 
  67  | test('orchestra-shell controlled dispatch and report harness exercises actual host limits', async ({ rocket }, info) => {
  68  |   const { fixture, call, callRaw, release } = await start(rocket)
  69  |   await info.attach('Controlled tool results', { body: JSON.stringify(fixture, null, 2), contentType: 'application/json' })
  70  |   const run = await call({ action: 'status' })
  71  |   expect(run.tasks).toHaveLength(3)
  72  |   expect(run.tasks.every(task => task.status === 'running')).toBe(true)
  73  |   expect(new Set(run.tasks.map(task => task.provider)).size).toBe(3)
  74  |   await rocket.capture('02-controlled-dispatch-limit')
  75  |   const task = run.tasks[0]
  76  |   await release(task)
  77  |   expect(await readFile(task.report, 'utf8')).toContain('Controlled worker report')
  78  |   const blocked = await callRaw({ action: 'dispatch', provider: 'claude', task: 'UI shell worker blocked before review' })
  79  |   expect(blocked.isError).toBe(true)
  80  |   expect(blocked.content[0].text).toContain('Review the finished worker evidence')
  81  |   await rocket.capture('03-controlled-report-delivered')
  82  |   await call({ action: 'stop', drain: false })
  83  | })
  84  | 
  85  | test('orchestra-shell streams eight workers and supports expand reply stop reports and scrolling', async ({ rocket }, info) => {
  86  |   const { page } = rocket
  87  |   const { fixture, call, release, review } = await start(rocket)
  88  |   await info.attach('Controlled tool results', { body: JSON.stringify(fixture, null, 2), contentType: 'application/json' })
  89  |   await rocket.capture('04-workers-dispatched')
> 90  |   await expect(page.locator('.orch-shell')).toBeVisible()
      |                                             ^ Error: expect(locator).toBeVisible() failed
  91  |   const leader = page.getByTestId('orchestrator-chat')
  92  |   const initialWidth = (await leader.boundingBox())!.width
  93  |   const windows = page.getByTestId('worker-window')
  94  |   const windowOf = (task: OrchestratorTask) => windows.and(page.locator(`[data-chat-id="${task.chatId}"]`))
  95  |   const run = await call({ action: 'status' })
  96  |   await expect(windows).toHaveCount(3)
  97  |   for (const task of run.tasks) {
  98  |     const worker = windowOf(task)
  99  |     await expect(worker).toHaveAttribute('data-chat-id', task.chatId)
  100 |     await expect(worker).toHaveAttribute('data-status', 'running')
  101 |     await expect(worker).toContainText(`Streaming from ${task.provider}.`)
  102 |     await expect(worker).toContainText(task.task)
  103 |     await expect(worker).toContainText(new RegExp(task.provider, 'i'))
  104 |   }
  105 |   await rocket.capture('05-workers-streaming')
  106 |   const finished = run.tasks[0]
  107 |   await release(finished)
  108 |   await expect(windowOf(finished)).toHaveAttribute('data-status', 'done')
  109 |   await review(finished)
  110 |   await rocket.capture('06-worker-done')
  111 |   await windowOf(finished).getByRole('button', { name: 'Open report', exact: true }).click()
  112 |   await expect(page.getByRole('region', { name: 'Artifact preview' })).toContainText('Controlled worker report')
  113 |   await rocket.capture('07-report-artifact')
  114 |   await page.getByRole('button', { name: 'Close artifact', exact: true }).click()
  115 |   await windowOf(finished).getByRole('button', { name: 'Expand worker', exact: true }).click()
  116 |   const expanded = page.getByTestId('worker-expanded')
  117 |   await expect(expanded).toBeVisible()
  118 |   const reply = 'Reply observed in worker transcript\nUI check: good evening'
  119 |   await expanded.getByRole('textbox', { name: 'Message', exact: true }).fill(reply)
  120 |   await expanded.getByRole('button', { name: 'Send', exact: true }).click()
  121 |   await expect(expanded).toContainText('Reply observed in worker transcript')
  122 |   await expect(expanded).toContainText('Good evening.')
  123 |   await rocket.capture('08-worker-expanded-reply')
  124 |   // Close only the expanded worker surface. The app itself stays running.
  125 |   await expanded.getByRole('button', { name: 'Close expanded worker', exact: true }).click()
  126 |   const stopped = run.tasks[1]
  127 |   await windowOf(stopped).getByRole('button', { name: 'Stop worker', exact: true }).click()
  128 |   await expect(windowOf(stopped)).not.toHaveAttribute('data-status', 'running')
  129 |   await expect.poll(async () => (await call({ action: 'status' })).tasks.find(task => task.id === stopped.id)?.status).toBe('interrupted')
  130 |   await review(stopped)
  131 |   await release(run.tasks[2])
  132 |   await review(run.tasks[2])
  133 |   await rocket.capture('09-worker-stopped')
  134 |   for (let index = 4; index <= 8; index++) {
  135 |     const state = await call({ action: 'dispatch', provider: 'claude', task: `UI shell worker ${index}` })
  136 |     const task = state.tasks.find(each => each.task === `UI shell worker ${index}`)!
  137 |     await expect(windows).toHaveCount(index)
  138 |     await expect(windowOf(task)).toContainText('Streaming from claude.')
  139 |     if (index < 8) {
  140 |       await release(task)
  141 |       await expect(windowOf(task)).toHaveAttribute('data-status', 'done')
  142 |       await review(task)
  143 |     }
  144 |   }
  145 |   const board = page.getByTestId('worker-board')
  146 |   const sizes = await board.evaluate(element => ({ scroll: element.scrollHeight, client: element.clientHeight }))
  147 |   expect(sizes.scroll).toBeGreaterThan(sizes.client)
  148 |   expect(Math.abs((await leader.boundingBox())!.width - initialWidth)).toBeLessThanOrEqual(2)
  149 |   await board.evaluate(element => { element.scrollTop = element.scrollHeight })
  150 |   await expect(windows.last()).toBeInViewport()
  151 |   await rocket.capture('10-eight-workers-board-scrolled')
  152 |   await call({ action: 'stop', drain: false })
  153 | })
  154 | 
```