# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: orchestra-shell.spec.ts >> orchestra-shell fresh profile keeps the leader full height below the title strip
- Location: tests/ui/orchestra-shell.spec.ts:9:1

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
  - region "New chat":
    - heading "Still up?" [level=1]
    - tablist "Open chats":
      - tab "New chat" [selected]
      - button "New chat" [disabled]
    - button "Add a chat beside this one" [disabled]
    - textbox "Message":
      - /placeholder: How can I help you today?
    - button "Attach files"
    - button "Capture"
    - button "~"
    - button "Claude"
    - button "Send" [disabled]
    - paragraph: Pick a provider and model for each message. They all share the conversation.
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
> 12  |   await expect(page.locator('.orch-shell')).toBeVisible()
      |                                             ^ Error: expect(locator).toBeVisible() failed
  13  |   const leader = page.getByTestId('orchestrator-chat')
  14  |   await expect(leader).toBeVisible()
  15  |   await expect(page.getByTestId('worker-board-empty')).toBeVisible()
  16  |   const shell = await page.locator('.orch-shell').boundingBox()
  17  |   const column = await leader.boundingBox()
  18  |   expect(shell).not.toBeNull()
  19  |   expect(column).not.toBeNull()
  20  |   const title = await page.locator('.titlebar').boundingBox()
  21  |   expect(title).not.toBeNull()
  22  |   expect(Math.abs(shell!.y - title!.y - title!.height)).toBeLessThanOrEqual(2)
  23  |   expect(Math.abs(column!.y - shell!.y)).toBeLessThanOrEqual(2)
  24  |   expect(Math.abs(column!.height - shell!.height)).toBeLessThanOrEqual(2)
  25  |   expect(Math.abs(shell!.y + shell!.height - await page.evaluate(() => innerHeight))).toBeLessThanOrEqual(2)
  26  | })
  27  | 
  28  | async function start(rocket: { page: Page; profile: string }) {
  29  |   const { page, profile } = rocket
  30  |   await page.locator('.composer-folder').first().click()
  31  |   const composer = page.getByRole('textbox', { name: 'Message', exact: true }).first()
  32  |   await composer.fill('Continuously exercise the isolated worker board.\nUI check: orchestra-shell')
  33  |   await page.getByRole('button', { name: 'Send', exact: true }).first().click()
  34  |   await expect.poll(async () => readFile(join(profile, 'ui-orchestra.json'), 'utf8').then(() => true).catch(() => false)).toBe(true)
  35  |   const fixture = JSON.parse(await readFile(join(profile, 'ui-orchestra.json'), 'utf8')) as {
  36  |     chatId: string; turnId: string; results: Array<{ isError?: boolean; content: Array<{ text: string }> }>
  37  |   }
  38  |   const channel = JSON.parse(await readFile(join(profile, 'tool-channel.json'), 'utf8')) as { port: number; secret: string }
  39  |   const callRaw = async (args: Record<string, unknown>) => {
  40  |     const response = await fetch(`http://127.0.0.1:${channel.port}/mcp/${channel.secret}/codex/${fixture.chatId}`, {
  41  |       method: 'POST', headers: { 'Content-Type': 'application/json' },
  42  |       body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'orchestrator', arguments: args } })
  43  |     })
  44  |     expect(response.ok).toBe(true)
  45  |     const body = await response.json()
  46  |     expect(body.error).toBeUndefined()
  47  |     return body.result as { isError?: boolean; content: Array<{ text: string }> }
  48  |   }
  49  |   const call = async (args: Record<string, unknown>): Promise<Orchestration> => {
  50  |     const result = await callRaw(args)
  51  |     expect(result.isError, JSON.stringify(result)).toBeUndefined()
  52  |     return JSON.parse(result.content[0].text)
  53  |   }
  54  |   const release = async (task: OrchestratorTask) => {
  55  |     expect(task.turnId).toBeTruthy()
  56  |     await writeFile(join(profile, `ui-release-${task.turnId}`), '')
  57  |     await expect.poll(async () => (await call({ action: 'status' })).tasks.find(each => each.id === task.id)?.status).toBe('completed')
  58  |   }
  59  |   const review = async (task: OrchestratorTask) => call({ action: 'checkpoint', taskId: task.id,
  60  |     summary: 'Controlled fixture inspected.', next: 'Continue isolated board checks.',
  61  |     review: 'Accepted fixture report and observed stream; external provider behavior is outside this check.' })
  62  |   expect(fixture.results).toHaveLength(5)
  63  |   expect(fixture.results.slice(0, 4).every(result => !result.isError)).toBe(true)
  64  |   expect(fixture.results[4].isError).toBe(true)
  65  |   expect(fixture.results[4].content[0].text).toContain('Three workers are already running')
  66  |   return { fixture, call, callRaw, release, review }
  67  | }
  68  | 
  69  | test('orchestra-shell controlled dispatch and report harness exercises actual host limits', async ({ rocket }, info) => {
  70  |   const { fixture, call, callRaw, release, review } = await start(rocket)
  71  |   await info.attach('Controlled tool results', { body: JSON.stringify(fixture, null, 2), contentType: 'application/json' })
  72  |   const run = await call({ action: 'status' })
  73  |   expect(run.tasks).toHaveLength(3)
  74  |   expect(run.tasks.every(task => task.status === 'running')).toBe(true)
  75  |   expect(new Set(run.tasks.map(task => task.provider)).size).toBe(3)
  76  |   await rocket.capture('02-controlled-dispatch-limit')
  77  |   const task = run.tasks[0]
  78  |   await release(task)
  79  |   expect(await readFile(task.report, 'utf8')).toContain('Controlled worker report')
  80  |   const blocked = await callRaw({ action: 'dispatch', provider: 'claude', task: 'UI shell worker blocked before review' })
  81  |   expect(blocked.isError).toBe(true)
  82  |   expect(blocked.content[0].text).toContain('Review the finished worker evidence')
  83  |   await rocket.capture('03-controlled-report-delivered')
  84  |   await review(task)
  85  |   for (const other of run.tasks.slice(1)) {
  86  |     await release(other)
  87  |     await review(other)
  88  |   }
  89  |   for (let index = 4; index <= 8; index++) {
  90  |     const state = await call({ action: 'dispatch', provider: 'claude', task: `UI shell worker ${index}` })
  91  |     expect((state as Orchestration & { totalTasks: number }).totalTasks).toBe(index)
  92  |     const worker = state.tasks.find(each => each.task === `UI shell worker ${index}`)!
  93  |     await release(worker)
  94  |     expect(await readFile(worker.report, 'utf8')).toContain('Controlled worker report')
  95  |     await review(worker)
  96  |   }
  97  |   await info.attach('Eight-worker host state', { body: await readFile(join(rocket.profile, 'orchestrator.json'), 'utf8'), contentType: 'application/json' })
  98  |   await rocket.capture('03b-eight-controlled-reports')
  99  |   await call({ action: 'stop', drain: false })
  100 | })
  101 | 
  102 | test('orchestra-shell streams eight workers and supports expand reply stop reports and scrolling', async ({ rocket }, info) => {
  103 |   const { page } = rocket
  104 |   const { fixture, call, release, review } = await start(rocket)
  105 |   await info.attach('Controlled tool results', { body: JSON.stringify(fixture, null, 2), contentType: 'application/json' })
  106 |   await rocket.capture('04-workers-dispatched')
  107 |   await expect(page.locator('.orch-shell')).toBeVisible()
  108 |   const leader = page.getByTestId('orchestrator-chat')
  109 |   const initialWidth = (await leader.boundingBox())!.width
  110 |   const windows = page.getByTestId('worker-window')
  111 |   const windowOf = (task: OrchestratorTask) => windows.and(page.locator(`[data-chat-id="${task.chatId}"]`))
  112 |   const run = await call({ action: 'status' })
```