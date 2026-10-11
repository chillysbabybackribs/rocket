# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: orchestra-shell.spec.ts >> orchestra-shell streams queued workers and supports cancel expand reply stop reports and scrolling
- Location: tests/ui/orchestra-shell.spec.ts:101:1

# Error details

```
TimeoutError: locator.click: Timeout 10000ms exceeded.
Call log:
  - waiting for getByTestId('worker-window').and(locator('[data-chat-id="55bf1590-7dc6-4c66-9706-5d6242e16371"]')).getByRole('button', { name: 'Stop worker', exact: true })
    - locator resolved to <button disabled type="button" aria-label="Stop worker" class="worker-action is-stop" title="Stop this worker’s turn">…</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
      - waiting 100ms
    18 × waiting for element to be visible, enabled and stable
       - element is not enabled
     - retrying click action
       - waiting 500ms

```

```
Error: No journal crash entries, including renderer errors

expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 12

- Array []
+ Array [
+   Object {
+     "at": 1791438722667,
+     "details": Object {
+       "stack": "",
+     },
+     "kind": "crash",
+     "message": "ResizeObserver loop completed with undelivered notifications.",
+     "severity": "error",
+     "source": "renderer",
+   },
+ ]
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]:
      - group "Window controls" [ref=e6]:
        - button "Close window" [ref=e7]
        - button "Minimize window" [ref=e10]
        - button "Zoom window" [ref=e12]
      - generic [ref=e16]:
        - button "Sections" [ref=e17]
        - generic [ref=e23]:
          - button [ref=e25]:
            - generic [ref=e26]: Goals
          - button [ref=e30]:
            - generic [ref=e31]: Chats
          - button [ref=e35]:
            - generic [ref=e36]: Library
          - button [ref=e38]:
            - generic [ref=e39]: Evals
          - button [ref=e41]:
            - generic [ref=e42]: Browser
          - button [ref=e44]
    - generic "Subscription usage" [ref=e46]:
      - 'button "Claude usage: 25% used" [ref=e47]':
        - generic [ref=e58]: 25%
      - 'button "Codex usage: 25% used" [ref=e59]':
        - generic [ref=e68]: 25%
      - 'button "Cursor usage: 25% used" [ref=e69]':
        - generic [ref=e77]: 25%
      - 'button "Antigravity usage: 25% used" [ref=e78]':
        - generic [ref=e86]: 25%
  - generic [ref=e87]:
    - region "Orchestrator chat" [ref=e88]:
      - generic [ref=e89]:
        - 'generic "UI shell fixture: observe eight controlled workers." [ref=e91]'
        - generic [ref=e92]: Run running
        - button "progress.md" [ref=e93]
      - main [ref=e94]:
        - 'region "Continuously exercise the isolated worker board. UI check: …" [ref=e95]':
          - article [ref=e98]:
            - paragraph [ref=e100]: "Continuously exercise the isolated worker board. UI check: orchestra-shell"
            - generic [ref=e101]:
              - status [ref=e102]:
                - generic [ref=e103]: Thinking
                - generic [ref=e104]: Working for 12s
              - button "Worked · 8 steps" [ref=e106]
              - paragraph [ref=e111]: Streaming from claude.
          - generic [ref=e113]:
            - tablist "Open chats" [ref=e114]:
              - 'generic "Continuously exercise the isolated worker board. UI check: …" [ref=e115]':
                - 'tab "Answering Continuously exercise the isolated worker board. UI check: …" [selected] [ref=e116]':
                  - generic "Answering" [ref=e117]
                  - generic [ref=e118]: "Continuously exercise the isolated worker board. UI check: …"
                - 'button "Close tab: Continuously exercise the isolated worker board. UI check: …" [ref=e119]'
              - button "New chat" [ref=e123]
            - generic [ref=e125]:
              - textbox "Message" [active] [ref=e127]:
                - /placeholder: Add to this turn…
              - generic [ref=e128]:
                - button "Attach files" [ref=e129]
                - button "Capture" [ref=e132]
                - button "~/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--0740c--stop-reports-and-scrolling/workspace" [disabled] [ref=e136]
                - generic [ref=e140]:
                  - button "Claude" [ref=e142]
                  - button "Stop" [ref=e151]
                  - button "Add to this turn" [disabled] [ref=e154]
    - separator "Resize the orchestrator chat" [ref=e157]
    - generic "Workers" [ref=e159]:
      - generic [ref=e160]:
        - generic [ref=e161]: Workers
        - generic [ref=e162]: Run running
        - generic [ref=e164]:
          - generic [ref=e165]: 3 running
          - generic [ref=e167]: 3 queued
          - generic [ref=e169]: 0 done
        - group "Show workers" [ref=e171]:
          - button "All" [pressed] [ref=e172]
          - button "Running" [ref=e173]
          - button "Done" [ref=e174]
      - generic [ref=e175]:
        - 'article "Worker: UI shell worker 3 antigravity" [ref=e176]':
          - generic "UI shell worker 3 antigravity" [ref=e177]:
            - generic "Antigravity" [ref=e178]
            - generic [ref=e183]: 0:12
          - article [ref=e187]:
            - generic [ref=e188]:
              - text: <rocket-orchestration> You are one worker in a continuous orchestration. Complete this assignment, write the report, and end your turn. The owning chat reviews your evidence and chooses the next task.
              - paragraph [ref=e189]: "User task: UI shell fixture: observe eight controlled workers."
              - paragraph [ref=e190]: "Assignment: UI shell worker 3 antigravity"
              - paragraph [ref=e191]:
                - text: Write your report to
                - link "/home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--0740c--stop-reports-and-scrolling/workspace/docs/orchestrator/3fa9de03-4f77-4133-b446-df5b49d5d335/task-0003-antigravity.md" [ref=e192] [cursor=pointer]:
                  - /url: /home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--0740c--stop-reports-and-scrolling/workspace/docs/orchestrator/3fa9de03-4f77-4133-b446-df5b49d5d335/task-0003-antigravity.md
                - text: . Keep isolated evidence beside it in task-0003-evidence/.
              - paragraph [ref=e193]: "Latest reviewed summary: Starting the task and choosing the first investigations."
              - paragraph [ref=e194]: "User updates:"
              - paragraph [ref=e195]: "User notes:"
              - heading "User notes" [level=2] [ref=e196]
              - paragraph [ref=e197]: Edit this section to steer the next review, or message the orchestrator chat.
              - paragraph [ref=e198]: Follow the user task’s scope. Do not expand research into implementation without authorization. Respect other workers’ files. State what was observed, what remains uncertain, and how to reproduce checks. Open primary sources for uncertain external facts.
              - paragraph [ref=e199]: Do not create other workers, control the orchestrator, modify its progress file, or operate other chats. Do not restart or close Rocket. Finish with the report path and unresolved questions.
            - generic [ref=e200]:
              - status [ref=e201]:
                - generic [ref=e202]: Thinking
                - generic [ref=e203]: Working for 12s
              - button "Worked · 1 step" [ref=e205]
              - paragraph [ref=e210]: Streaming from antigravity.
          - generic [ref=e211]:
            - generic [ref=e212]: Antigravity
            - generic [ref=e213]: Running
            - button "Expand worker" [ref=e214]:
              - generic [ref=e220]: Expand
            - button "Stop worker" [ref=e221]:
              - generic [ref=e224]: Stop
            - button "Open report" [disabled] [ref=e225]:
              - generic [ref=e229]: Report
        - 'article "Worker: UI shell worker 2 cursor" [ref=e230]':
          - generic "UI shell worker 2 cursor" [ref=e231]:
            - generic "Cursor" [ref=e232]
            - generic [ref=e237]: 0:12
          - article [ref=e241]:
            - generic [ref=e242]:
              - text: <rocket-orchestration> You are one worker in a continuous orchestration. Complete this assignment, write the report, and end your turn. The owning chat reviews your evidence and chooses the next task.
              - paragraph [ref=e243]: "User task: UI shell fixture: observe eight controlled workers."
              - paragraph [ref=e244]: "Assignment: UI shell worker 2 cursor"
              - paragraph [ref=e245]:
                - text: Write your report to
                - link "/home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--0740c--stop-reports-and-scrolling/workspace/docs/orchestrator/3fa9de03-4f77-4133-b446-df5b49d5d335/task-0002-cursor.md" [ref=e246] [cursor=pointer]:
                  - /url: /home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--0740c--stop-reports-and-scrolling/workspace/docs/orchestrator/3fa9de03-4f77-4133-b446-df5b49d5d335/task-0002-cursor.md
                - text: . Keep isolated evidence beside it in task-0002-evidence/.
              - paragraph [ref=e247]: "Latest reviewed summary: Starting the task and choosing the first investigations."
              - paragraph [ref=e248]: "User updates:"
              - paragraph [ref=e249]: "User notes:"
              - heading "User notes" [level=2] [ref=e250]
              - paragraph [ref=e251]: Edit this section to steer the next review, or message the orchestrator chat.
              - paragraph [ref=e252]: Follow the user task’s scope. Do not expand research into implementation without authorization. Respect other workers’ files. State what was observed, what remains uncertain, and how to reproduce checks. Open primary sources for uncertain external facts.
              - paragraph [ref=e253]: Do not create other workers, control the orchestrator, modify its progress file, or operate other chats. Do not restart or close Rocket. Finish with the report path and unresolved questions.
            - generic [ref=e254]:
              - status [ref=e255]:
                - generic [ref=e256]: Thinking
                - generic [ref=e257]: Working for 12s
              - button "Worked · 1 step" [ref=e259]
              - paragraph [ref=e264]: Streaming from cursor.
          - generic [ref=e265]:
            - generic [ref=e266]: Cursor
            - generic [ref=e267]: Running
            - button "Expand worker" [ref=e268]:
              - generic [ref=e274]: Expand
            - button "Stop worker" [ref=e275]:
              - generic [ref=e278]: Stop
            - button "Open report" [disabled] [ref=e279]:
              - generic [ref=e283]: Report
        - 'article "Worker: UI shell worker 1 claude" [ref=e284]':
          - generic "UI shell worker 1 claude" [ref=e285]:
            - generic "Claude" [ref=e286]
            - generic [ref=e294]: 0:12
          - article [ref=e298]:
            - generic [ref=e299]:
              - text: <rocket-orchestration> You are one worker in a continuous orchestration. Complete this assignment, write the report, and end your turn. The owning chat reviews your evidence and chooses the next task.
              - paragraph [ref=e300]: "User task: UI shell fixture: observe eight controlled workers."
              - paragraph [ref=e301]: "Assignment: UI shell worker 1 claude"
              - paragraph [ref=e302]:
                - text: Write your report to
                - link "/home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--0740c--stop-reports-and-scrolling/workspace/docs/orchestrator/3fa9de03-4f77-4133-b446-df5b49d5d335/task-0001-claude.md" [ref=e303] [cursor=pointer]:
                  - /url: /home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--0740c--stop-reports-and-scrolling/workspace/docs/orchestrator/3fa9de03-4f77-4133-b446-df5b49d5d335/task-0001-claude.md
                - text: . Keep isolated evidence beside it in task-0001-evidence/.
              - paragraph [ref=e304]: "Latest reviewed summary: Starting the task and choosing the first investigations."
              - paragraph [ref=e305]: "User updates:"
              - paragraph [ref=e306]: "User notes:"
              - heading "User notes" [level=2] [ref=e307]
              - paragraph [ref=e308]: Edit this section to steer the next review, or message the orchestrator chat.
              - paragraph [ref=e309]: Follow the user task’s scope. Do not expand research into implementation without authorization. Respect other workers’ files. State what was observed, what remains uncertain, and how to reproduce checks. Open primary sources for uncertain external facts.
              - paragraph [ref=e310]: Do not create other workers, control the orchestrator, modify its progress file, or operate other chats. Do not restart or close Rocket. Finish with the report path and unresolved questions.
            - generic [ref=e311]:
              - status [ref=e312]:
                - generic [ref=e313]: Thinking
                - generic [ref=e314]: Working for 12s
              - button "Worked · 1 step" [ref=e316]
              - paragraph [ref=e321]: Streaming from claude.
          - generic [ref=e322]:
            - generic [ref=e323]: Claude
            - generic [ref=e324]: Running
            - button "Expand worker" [ref=e325]:
              - generic [ref=e331]: Expand
            - button "Stop worker" [ref=e332]:
              - generic [ref=e335]: Stop
            - button "Open report" [disabled] [ref=e336]:
              - generic [ref=e340]: Report
        - 'article "Worker: UI shell worker 6 antigravity" [ref=e341]':
          - generic "UI shell worker 6 antigravity" [ref=e342]:
            - generic "Antigravity" [ref=e343]
          - generic [ref=e351]:
            - generic [ref=e352]: Antigravity
            - generic [ref=e353]: Queued
            - button "Expand worker" [ref=e354]:
              - generic [ref=e360]: Expand
            - button "Stop worker" [disabled] [ref=e361]:
              - generic [ref=e364]: Stop
            - button "Open report" [disabled] [ref=e365]:
              - generic [ref=e369]: Report
        - 'article "Worker: UI shell worker 5 cursor" [ref=e370]':
          - generic "UI shell worker 5 cursor" [ref=e371]:
            - generic "Cursor" [ref=e372]
          - generic [ref=e380]:
            - generic [ref=e381]: Cursor
            - generic [ref=e382]: Queued
            - button "Expand worker" [ref=e383]:
              - generic [ref=e389]: Expand
            - button "Stop worker" [disabled] [ref=e390]:
              - generic [ref=e393]: Stop
            - button "Open report" [disabled] [ref=e394]:
              - generic [ref=e398]: Report
        - 'article "Worker: UI shell worker 4 claude" [ref=e399]':
          - generic "UI shell worker 4 claude" [ref=e400]:
            - generic "Claude" [ref=e401]
          - generic [ref=e412]:
            - generic [ref=e413]: Claude
            - generic [ref=e414]: Queued
            - button "Expand worker" [ref=e415]:
              - generic [ref=e421]: Expand
            - button "Stop worker" [disabled] [ref=e422]:
              - generic [ref=e425]: Stop
            - button "Open report" [disabled] [ref=e426]:
              - generic [ref=e430]: Report
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
  8   | // Every accepted assignment gets a window immediately, including queued workers.
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
  62  |   expect(fixture.results).toHaveLength(7)
  63  |   expect(fixture.results.every(result => !result.isError)).toBe(true)
  64  |   return { fixture, call, callRaw, release, review }
  65  | }
  66  | 
  67  | test.afterEach(async ({ rocket }) => {
  68  |   const text = await readFile(join(rocket.profile, 'journal.jsonl'), 'utf8').catch(() => '')
  69  |   const crashes = text.split('\n').filter(Boolean).map(line => JSON.parse(line))
  70  |     .filter(entry => entry.kind === 'crash')
> 71  |   expect(crashes, 'No journal crash entries, including renderer errors').toEqual([])
      |                                                                          ^ Error: No journal crash entries, including renderer errors
  72  | })
  73  | 
  74  | test('orchestra-shell controlled queue releases slots and delivers reports', async ({ rocket }, info) => {
  75  |   const { fixture, call, callRaw, release, review } = await start(rocket)
  76  |   await info.attach('Controlled tool results', { body: JSON.stringify(fixture, null, 2), contentType: 'application/json' })
  77  |   const run = await call({ action: 'status' })
  78  |   expect(run.tasks).toHaveLength(6)
  79  |   expect(run.tasks.filter(task => task.status === 'running')).toHaveLength(3)
  80  |   expect(run.tasks.filter(task => task.status === 'queued')).toHaveLength(3)
  81  |   expect(new Set(run.tasks.filter(task => task.status === 'running').map(task => task.provider)).size).toBe(3)
  82  |   await rocket.capture('02-six-accepted-dispatches')
  83  |   await release(run.tasks[0])
  84  |   const after = await call({ action: 'status' })
  85  |   expect(after.tasks[3].status).toBe('running')
  86  |   expect(await readFile(run.tasks[0].report, 'utf8')).toContain('Controlled worker report')
  87  |   const blocked = await callRaw({ action: 'dispatch', provider: 'claude', task: 'UI shell worker blocked before review' })
  88  |   expect(blocked.isError).toBe(true)
  89  |   expect(blocked.content[0].text).toContain('Review the finished worker evidence')
  90  |   await review(run.tasks[0])
  91  |   for (const original of run.tasks.slice(1)) {
  92  |     const task = (await call({ action: 'status' })).tasks.find(each => each.id === original.id)!
  93  |     expect(task.status).toBe('running')
  94  |     await release(task)
  95  |     await review(task)
  96  |   }
  97  |   await info.attach('Six-worker host state', { body: await readFile(join(rocket.profile, 'orchestrator.json'), 'utf8'), contentType: 'application/json' })
  98  |   await call({ action: 'stop', drain: false })
  99  | })
  100 | 
  101 | test('orchestra-shell streams queued workers and supports cancel expand reply stop reports and scrolling', async ({ rocket }, info) => {
  102 |   const { page } = rocket
  103 |   const { fixture, call, release, review } = await start(rocket)
  104 |   await info.attach('Controlled tool results', { body: JSON.stringify(fixture, null, 2), contentType: 'application/json' })
  105 |   const leader = page.getByTestId('orchestrator-chat')
  106 |   const initialWidth = (await leader.boundingBox())!.width
  107 |   const windows = page.getByTestId('worker-window')
  108 |   const windowOf = (task: OrchestratorTask) => windows.and(page.locator(`[data-chat-id="${task.chatId}"]`))
  109 |   const run = await call({ action: 'status' })
  110 |   await expect(windows).toHaveCount(6)
  111 |   for (const task of run.tasks) {
  112 |     const worker = windowOf(task)
  113 |     await expect(worker).toHaveAttribute('data-status', task.status)
  114 |     await expect(worker).toContainText(task.task)
  115 |     await expect(worker).toContainText(new RegExp(task.provider, 'i'))
  116 |     if (task.status === 'running') await expect(worker).toContainText(`Streaming from ${task.provider}.`)
  117 |     else await expect(worker).not.toContainText('Streaming from')
  118 |   }
  119 |   await rocket.capture('04-three-running-three-queued')
  120 |   const cancelled = run.tasks[5]
  121 |   await windowOf(cancelled).getByRole('button', { name: 'Stop worker', exact: true }).click()
  122 |   await expect(windowOf(cancelled)).toHaveAttribute('data-status', 'cancelled')
  123 |   const cancelledState = (await call({ action: 'status' })).tasks.find(each => each.id === cancelled.id)!
  124 |   expect(cancelledState.turnId).toBeNull()
  125 |   expect(cancelledState.startedAt).toBeNull()
  126 |   expect(cancelledState.endedAt).not.toBeNull()
  127 |   await expect(windowOf(cancelled)).not.toContainText('Streaming from')
  128 |   await rocket.capture('05-queued-worker-cancelled')
  129 |   const finished = run.tasks[0]
  130 |   await release(finished)
  131 |   await expect(windowOf(finished)).toHaveAttribute('data-status', 'done')
  132 |   await expect(windowOf(run.tasks[3])).toHaveAttribute('data-status', 'running')
  133 |   await expect(windowOf(run.tasks[3])).toContainText('Streaming from claude.')
  134 |   await review(finished)
  135 |   await windowOf(finished).getByRole('button', { name: 'Open report', exact: true }).click()
  136 |   await expect(page.getByRole('region', { name: 'Artifact preview' })).toContainText('Controlled worker report')
  137 |   await rocket.capture('06-report-artifact')
  138 |   await page.getByRole('button', { name: 'Close artifact', exact: true }).click()
  139 |   await windowOf(finished).getByRole('button', { name: 'Expand worker', exact: true }).click()
  140 |   const expanded = page.getByTestId('worker-expanded')
  141 |   await expect(expanded).toBeVisible()
  142 |   await expanded.getByRole('textbox', { name: 'Message', exact: true }).fill('Reply observed in worker transcript\nUI check: good evening')
  143 |   await expanded.getByRole('button', { name: 'Send', exact: true }).click()
  144 |   await expect(expanded).toContainText('Reply observed in worker transcript')
  145 |   await expect(expanded).toContainText('Good evening.')
  146 |   await rocket.capture('07-expanded-reply')
  147 |   await expanded.getByRole('button', { name: 'Close expanded worker', exact: true }).click()
  148 |   const stopped = run.tasks[1]
  149 |   await windowOf(stopped).getByRole('button', { name: 'Stop worker', exact: true }).click()
  150 |   await expect(windowOf(stopped)).toHaveAttribute('data-status', 'cancelled')
  151 |   await expect.poll(async () => (await call({ action: 'status' })).tasks.find(task => task.id === stopped.id)?.status).toBe('interrupted')
  152 |   await review(stopped)
  153 |   await expect(windowOf(run.tasks[4])).toHaveAttribute('data-status', 'running')
  154 |   for (const original of [run.tasks[2], run.tasks[3], run.tasks[4]]) {
  155 |     const task = (await call({ action: 'status' })).tasks.find(each => each.id === original.id)!
  156 |     await release(task)
  157 |     await expect(windowOf(task)).toHaveAttribute('data-status', 'done')
  158 |     await review(task)
  159 |   }
  160 |   for (let index = 7; index <= 9; index++) {
  161 |     const state = await call({ action: 'dispatch', provider: 'claude', task: `UI shell worker ${index}` })
  162 |     const task = state.tasks.find(each => each.task === `UI shell worker ${index}`)!
  163 |     await expect(windows).toHaveCount(index)
  164 |     await expect(windowOf(task)).toContainText('Streaming from claude.')
  165 |     if (index < 9) {
  166 |       await release(task)
  167 |       await expect(windowOf(task)).toHaveAttribute('data-status', 'done')
  168 |       await review(task)
  169 |     }
  170 |   }
  171 |   const board = page.getByTestId('worker-board')
```