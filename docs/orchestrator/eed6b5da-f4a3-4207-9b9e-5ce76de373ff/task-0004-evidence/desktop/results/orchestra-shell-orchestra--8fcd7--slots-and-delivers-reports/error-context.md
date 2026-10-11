# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: orchestra-shell.spec.ts >> orchestra-shell controlled queue releases slots and delivers reports
- Location: tests/ui/orchestra-shell.spec.ts:74:1

# Error details

```
Error: No journal crash entries, including renderer errors

expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 12

- Array []
+ Array [
+   Object {
+     "at": 1791438717582,
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
        - generic "Stopped by the user. No further work will be dispatched." [ref=e92]: Run stopped
        - button "progress.md" [ref=e93]
      - main [ref=e94]:
        - 'region "Continuously exercise the isolated worker board. UI check: …" [ref=e95]':
          - article [ref=e98]:
            - paragraph [ref=e100]: "Continuously exercise the isolated worker board. UI check: orchestra-shell"
            - generic [ref=e101]:
              - status [ref=e102]:
                - generic [ref=e103]: Thinking
                - generic [ref=e104]: Working for 3s
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
                - button "~/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--8fcd7--slots-and-delivers-reports/workspace" [disabled] [ref=e136]
                - generic [ref=e140]:
                  - button "Claude" [ref=e142]
                  - button "Stop" [ref=e151]
                  - button "Add to this turn" [disabled] [ref=e154]
    - separator "Resize the orchestrator chat" [ref=e157]
    - generic "Workers" [ref=e159]:
      - generic [ref=e160]:
        - generic [ref=e161]: Workers
        - generic "Stopped by the user. No further work will be dispatched." [ref=e162]: Run stopped
        - generic [ref=e164]:
          - generic [ref=e165]: 0 running
          - generic [ref=e167]: 6 done
        - group "Show workers" [ref=e169]:
          - button "All" [pressed] [ref=e170]
          - button "Running" [ref=e171]
          - button "Done" [ref=e172]
      - generic [ref=e173]:
        - 'article "Worker: UI shell worker 6 antigravity" [ref=e174]':
          - generic "UI shell worker 6 antigravity" [ref=e175]:
            - generic "Antigravity" [ref=e176]
            - generic [ref=e181]: 0:00
          - article [ref=e185]:
            - generic [ref=e186]:
              - text: <rocket-orchestration> You are one worker in a continuous orchestration. Complete this assignment, write the report, and end your turn. The owning chat reviews your evidence and chooses the next task.
              - paragraph [ref=e187]: "User task: UI shell fixture: observe eight controlled workers."
              - paragraph [ref=e188]: "Assignment: UI shell worker 6 antigravity"
              - paragraph [ref=e189]:
                - text: Write your report to
                - link "/home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--8fcd7--slots-and-delivers-reports/workspace/docs/orchestrator/a7fed471-9da0-4ebf-ae41-0af1270f1fcd/task-0006-antigravity.md" [ref=e190] [cursor=pointer]:
                  - /url: /home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--8fcd7--slots-and-delivers-reports/workspace/docs/orchestrator/a7fed471-9da0-4ebf-ae41-0af1270f1fcd/task-0006-antigravity.md
                - text: . Keep isolated evidence beside it in task-0006-evidence/.
              - paragraph [ref=e191]: "Latest reviewed summary: Controlled fixture inspected."
              - paragraph [ref=e192]: "User updates:"
              - paragraph [ref=e193]: "User notes:"
              - heading "User notes" [level=2] [ref=e194]
              - paragraph [ref=e195]: Edit this section to steer the next review, or message the orchestrator chat.
              - paragraph [ref=e196]: Follow the user task’s scope. Do not expand research into implementation without authorization. Respect other workers’ files. State what was observed, what remains uncertain, and how to reproduce checks. Open primary sources for uncertain external facts.
              - paragraph [ref=e197]: Do not create other workers, control the orchestrator, modify its progress file, or operate other chats. Do not restart or close Rocket. Finish with the report path and unresolved questions.
            - generic [ref=e198]:
              - generic [ref=e199]: Worked for 0s
              - button "Worked · 1 step" [ref=e202]
              - generic [ref=e206]:
                - paragraph [ref=e207]: Streaming from antigravity.
                - paragraph [ref=e208]:
                  - strong [ref=e209]: Complete.
                  - text: The controlled response finished.
          - generic [ref=e210]:
            - generic [ref=e211]: Antigravity
            - generic [ref=e212]: Done
            - button "Expand worker" [ref=e213]:
              - generic [ref=e219]: Expand
            - button "Stop worker" [disabled] [ref=e220]:
              - generic [ref=e223]: Stop
            - button "Open report" [ref=e224]:
              - generic [ref=e228]: Report
        - 'article "Worker: UI shell worker 5 cursor" [ref=e229]':
          - generic "UI shell worker 5 cursor" [ref=e230]:
            - generic "Cursor" [ref=e231]
            - generic [ref=e236]: 0:00
          - article [ref=e240]:
            - generic [ref=e241]:
              - text: <rocket-orchestration> You are one worker in a continuous orchestration. Complete this assignment, write the report, and end your turn. The owning chat reviews your evidence and chooses the next task.
              - paragraph [ref=e242]: "User task: UI shell fixture: observe eight controlled workers."
              - paragraph [ref=e243]: "Assignment: UI shell worker 5 cursor"
              - paragraph [ref=e244]:
                - text: Write your report to
                - link "/home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--8fcd7--slots-and-delivers-reports/workspace/docs/orchestrator/a7fed471-9da0-4ebf-ae41-0af1270f1fcd/task-0005-cursor.md" [ref=e245] [cursor=pointer]:
                  - /url: /home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--8fcd7--slots-and-delivers-reports/workspace/docs/orchestrator/a7fed471-9da0-4ebf-ae41-0af1270f1fcd/task-0005-cursor.md
                - text: . Keep isolated evidence beside it in task-0005-evidence/.
              - paragraph [ref=e246]: "Latest reviewed summary: Controlled fixture inspected."
              - paragraph [ref=e247]: "User updates:"
              - paragraph [ref=e248]: "User notes:"
              - heading "User notes" [level=2] [ref=e249]
              - paragraph [ref=e250]: Edit this section to steer the next review, or message the orchestrator chat.
              - paragraph [ref=e251]: Follow the user task’s scope. Do not expand research into implementation without authorization. Respect other workers’ files. State what was observed, what remains uncertain, and how to reproduce checks. Open primary sources for uncertain external facts.
              - paragraph [ref=e252]: Do not create other workers, control the orchestrator, modify its progress file, or operate other chats. Do not restart or close Rocket. Finish with the report path and unresolved questions.
            - generic [ref=e253]:
              - generic [ref=e254]: Worked for 0s
              - button "Worked · 1 step" [ref=e257]
              - generic [ref=e261]:
                - paragraph [ref=e262]: Streaming from cursor.
                - paragraph [ref=e263]:
                  - strong [ref=e264]: Complete.
                  - text: The controlled response finished.
          - generic [ref=e265]:
            - generic [ref=e266]: Cursor
            - generic [ref=e267]: Done
            - button "Expand worker" [ref=e268]:
              - generic [ref=e274]: Expand
            - button "Stop worker" [disabled] [ref=e275]:
              - generic [ref=e278]: Stop
            - button "Open report" [ref=e279]:
              - generic [ref=e283]: Report
        - 'article "Worker: UI shell worker 4 claude" [ref=e284]':
          - generic "UI shell worker 4 claude" [ref=e285]:
            - generic "Claude" [ref=e286]
            - generic [ref=e294]: 0:00
          - article [ref=e298]:
            - generic [ref=e299]:
              - text: <rocket-orchestration> You are one worker in a continuous orchestration. Complete this assignment, write the report, and end your turn. The owning chat reviews your evidence and chooses the next task.
              - paragraph [ref=e300]: "User task: UI shell fixture: observe eight controlled workers."
              - paragraph [ref=e301]: "Assignment: UI shell worker 4 claude"
              - paragraph [ref=e302]:
                - text: Write your report to
                - link "/home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--8fcd7--slots-and-delivers-reports/workspace/docs/orchestrator/a7fed471-9da0-4ebf-ae41-0af1270f1fcd/task-0004-claude.md" [ref=e303] [cursor=pointer]:
                  - /url: /home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--8fcd7--slots-and-delivers-reports/workspace/docs/orchestrator/a7fed471-9da0-4ebf-ae41-0af1270f1fcd/task-0004-claude.md
                - text: . Keep isolated evidence beside it in task-0004-evidence/.
              - paragraph [ref=e304]: "Latest reviewed summary: Starting the task and choosing the first investigations."
              - paragraph [ref=e305]: "User updates:"
              - paragraph [ref=e306]: "User notes:"
              - heading "User notes" [level=2] [ref=e307]
              - paragraph [ref=e308]: Edit this section to steer the next review, or message the orchestrator chat.
              - paragraph [ref=e309]: Follow the user task’s scope. Do not expand research into implementation without authorization. Respect other workers’ files. State what was observed, what remains uncertain, and how to reproduce checks. Open primary sources for uncertain external facts.
              - paragraph [ref=e310]: Do not create other workers, control the orchestrator, modify its progress file, or operate other chats. Do not restart or close Rocket. Finish with the report path and unresolved questions.
            - generic [ref=e311]:
              - generic [ref=e312]: Worked for 0s
              - button "Worked · 1 step" [ref=e315]
              - generic [ref=e319]:
                - paragraph [ref=e320]: Streaming from claude.
                - paragraph [ref=e321]:
                  - strong [ref=e322]: Complete.
                  - text: The controlled response finished.
          - generic [ref=e323]:
            - generic [ref=e324]: Claude
            - generic [ref=e325]: Done
            - button "Expand worker" [ref=e326]:
              - generic [ref=e332]: Expand
            - button "Stop worker" [disabled] [ref=e333]:
              - generic [ref=e336]: Stop
            - button "Open report" [ref=e337]:
              - generic [ref=e341]: Report
        - 'article "Worker: UI shell worker 3 antigravity" [ref=e342]':
          - generic "UI shell worker 3 antigravity" [ref=e343]:
            - generic "Antigravity" [ref=e344]
            - generic [ref=e349]: 0:01
          - article [ref=e353]:
            - generic [ref=e354]:
              - text: <rocket-orchestration> You are one worker in a continuous orchestration. Complete this assignment, write the report, and end your turn. The owning chat reviews your evidence and chooses the next task.
              - paragraph [ref=e355]: "User task: UI shell fixture: observe eight controlled workers."
              - paragraph [ref=e356]: "Assignment: UI shell worker 3 antigravity"
              - paragraph [ref=e357]:
                - text: Write your report to
                - link "/home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--8fcd7--slots-and-delivers-reports/workspace/docs/orchestrator/a7fed471-9da0-4ebf-ae41-0af1270f1fcd/task-0003-antigravity.md" [ref=e358] [cursor=pointer]:
                  - /url: /home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--8fcd7--slots-and-delivers-reports/workspace/docs/orchestrator/a7fed471-9da0-4ebf-ae41-0af1270f1fcd/task-0003-antigravity.md
                - text: . Keep isolated evidence beside it in task-0003-evidence/.
              - paragraph [ref=e359]: "Latest reviewed summary: Starting the task and choosing the first investigations."
              - paragraph [ref=e360]: "User updates:"
              - paragraph [ref=e361]: "User notes:"
              - heading "User notes" [level=2] [ref=e362]
              - paragraph [ref=e363]: Edit this section to steer the next review, or message the orchestrator chat.
              - paragraph [ref=e364]: Follow the user task’s scope. Do not expand research into implementation without authorization. Respect other workers’ files. State what was observed, what remains uncertain, and how to reproduce checks. Open primary sources for uncertain external facts.
              - paragraph [ref=e365]: Do not create other workers, control the orchestrator, modify its progress file, or operate other chats. Do not restart or close Rocket. Finish with the report path and unresolved questions.
            - generic [ref=e366]:
              - generic [ref=e367]: Worked for 1s
              - button "Worked · 1 step" [ref=e370]
              - generic [ref=e374]:
                - paragraph [ref=e375]: Streaming from antigravity.
                - paragraph [ref=e376]:
                  - strong [ref=e377]: Complete.
                  - text: The controlled response finished.
          - generic [ref=e378]:
            - generic [ref=e379]: Antigravity
            - generic [ref=e380]: Done
            - button "Expand worker" [ref=e381]:
              - generic [ref=e387]: Expand
            - button "Stop worker" [disabled] [ref=e388]:
              - generic [ref=e391]: Stop
            - button "Open report" [ref=e392]:
              - generic [ref=e396]: Report
        - 'article "Worker: UI shell worker 2 cursor" [ref=e397]':
          - generic "UI shell worker 2 cursor" [ref=e398]:
            - generic "Cursor" [ref=e399]
            - generic [ref=e404]: 0:01
          - article [ref=e408]:
            - generic [ref=e409]:
              - text: <rocket-orchestration> You are one worker in a continuous orchestration. Complete this assignment, write the report, and end your turn. The owning chat reviews your evidence and chooses the next task.
              - paragraph [ref=e410]: "User task: UI shell fixture: observe eight controlled workers."
              - paragraph [ref=e411]: "Assignment: UI shell worker 2 cursor"
              - paragraph [ref=e412]:
                - text: Write your report to
                - link "/home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--8fcd7--slots-and-delivers-reports/workspace/docs/orchestrator/a7fed471-9da0-4ebf-ae41-0af1270f1fcd/task-0002-cursor.md" [ref=e413] [cursor=pointer]:
                  - /url: /home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--8fcd7--slots-and-delivers-reports/workspace/docs/orchestrator/a7fed471-9da0-4ebf-ae41-0af1270f1fcd/task-0002-cursor.md
                - text: . Keep isolated evidence beside it in task-0002-evidence/.
              - paragraph [ref=e414]: "Latest reviewed summary: Starting the task and choosing the first investigations."
              - paragraph [ref=e415]: "User updates:"
              - paragraph [ref=e416]: "User notes:"
              - heading "User notes" [level=2] [ref=e417]
              - paragraph [ref=e418]: Edit this section to steer the next review, or message the orchestrator chat.
              - paragraph [ref=e419]: Follow the user task’s scope. Do not expand research into implementation without authorization. Respect other workers’ files. State what was observed, what remains uncertain, and how to reproduce checks. Open primary sources for uncertain external facts.
              - paragraph [ref=e420]: Do not create other workers, control the orchestrator, modify its progress file, or operate other chats. Do not restart or close Rocket. Finish with the report path and unresolved questions.
            - generic [ref=e421]:
              - generic [ref=e422]: Worked for 1s
              - button "Worked · 1 step" [ref=e425]
              - generic [ref=e429]:
                - paragraph [ref=e430]: Streaming from cursor.
                - paragraph [ref=e431]:
                  - strong [ref=e432]: Complete.
                  - text: The controlled response finished.
          - generic [ref=e433]:
            - generic [ref=e434]: Cursor
            - generic [ref=e435]: Done
            - button "Expand worker" [ref=e436]:
              - generic [ref=e442]: Expand
            - button "Stop worker" [disabled] [ref=e443]:
              - generic [ref=e446]: Stop
            - button "Open report" [ref=e447]:
              - generic [ref=e451]: Report
        - 'article "Worker: UI shell worker 1 claude" [ref=e452]':
          - generic "UI shell worker 1 claude" [ref=e453]:
            - generic "Claude" [ref=e454]
            - generic [ref=e462]: 0:01
          - article [ref=e466]:
            - generic [ref=e467]:
              - text: <rocket-orchestration> You are one worker in a continuous orchestration. Complete this assignment, write the report, and end your turn. The owning chat reviews your evidence and chooses the next task.
              - paragraph [ref=e468]: "User task: UI shell fixture: observe eight controlled workers."
              - paragraph [ref=e469]: "Assignment: UI shell worker 1 claude"
              - paragraph [ref=e470]:
                - text: Write your report to
                - link "/home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--8fcd7--slots-and-delivers-reports/workspace/docs/orchestrator/a7fed471-9da0-4ebf-ae41-0af1270f1fcd/task-0001-claude.md" [ref=e471] [cursor=pointer]:
                  - /url: /home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU/results/orchestra-shell-orchestra--8fcd7--slots-and-delivers-reports/workspace/docs/orchestrator/a7fed471-9da0-4ebf-ae41-0af1270f1fcd/task-0001-claude.md
                - text: . Keep isolated evidence beside it in task-0001-evidence/.
              - paragraph [ref=e472]: "Latest reviewed summary: Starting the task and choosing the first investigations."
              - paragraph [ref=e473]: "User updates:"
              - paragraph [ref=e474]: "User notes:"
              - heading "User notes" [level=2] [ref=e475]
              - paragraph [ref=e476]: Edit this section to steer the next review, or message the orchestrator chat.
              - paragraph [ref=e477]: Follow the user task’s scope. Do not expand research into implementation without authorization. Respect other workers’ files. State what was observed, what remains uncertain, and how to reproduce checks. Open primary sources for uncertain external facts.
              - paragraph [ref=e478]: Do not create other workers, control the orchestrator, modify its progress file, or operate other chats. Do not restart or close Rocket. Finish with the report path and unresolved questions.
            - generic [ref=e479]:
              - generic [ref=e480]: Worked for 1s
              - button "Worked · 1 step" [ref=e483]
              - generic [ref=e487]:
                - paragraph [ref=e488]: Streaming from claude.
                - paragraph [ref=e489]:
                  - strong [ref=e490]: Complete.
                  - text: The controlled response finished.
          - generic [ref=e491]:
            - generic [ref=e492]: Claude
            - generic [ref=e493]: Done
            - button "Expand worker" [ref=e494]:
              - generic [ref=e500]: Expand
            - button "Stop worker" [disabled] [ref=e501]:
              - generic [ref=e504]: Stop
            - button "Open report" [ref=e505]:
              - generic [ref=e509]: Report
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