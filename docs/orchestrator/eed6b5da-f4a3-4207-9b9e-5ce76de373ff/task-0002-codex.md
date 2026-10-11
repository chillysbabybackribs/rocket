# Task 0002: isolated orchestrator-shell UI eval

Implemented the controlled UI eval in `/home/dp/Desktop/rocket-orchestrator`. No renderer files or rocketv1 source were edited. The only writes in rocketv1 are this explicitly assigned report and its evidence directory. No real provider turns were sent, and the live Rocket application was not restarted, closed, or driven.

## Files changed

- `tests/ui/orchestra-shell.spec.ts`: three fresh-profile Playwright cases: initial layout, independent controlled host/report harness, and full worker-board lifecycle. Named screenshots at each observable stage.
- `src/host/ui-test.ts`: adds `UI check: orchestra-shell`. The controlled leader calls the real MCP `orchestrator` tool to start, dispatch three workers, and attempt a fourth. Tool results are transcript items and are saved in the isolated profile. Only assignments prefixed `UI shell worker` deliver controlled Markdown reports on release; cancellation delivers none. Report paths must stay inside the fixture workspace.
- `src/host/ui-test.test.ts`: two unit tests for report release/cancellation and HTTP tool-call ordering plus rejected fourth-dispatch evidence.
- `docs/evals/rocket-ui-regression.csv`: adds a Lane A UI-layout row with `playwright_grep: orchestra-shell`. Existing local UI eval tooling reads this CSV; importing it into the remote dataset remains separate. No live-model matrix scenario was added.
- `README.md`: documents the grep command, controlled leader, and concurrency behavior.

## Host behavior observed

`src/host/orchestrator.ts` rejects dispatch when three workers are running. It does **not** queue a fourth worker or create a chat for a rejected dispatch. It also allows only one running worker per provider, and blocks deeper dispatch until finished workers have an evidence-review checkpoint.

The independent desktop harness passed: the leader itself called `start` and four `dispatch` attempts; Claude, Cursor and Antigravity workers ran, while the Codex attempt returned “Three workers are already running.” After completion, an attempt before review returned “Review the finished worker evidence”. The harness then completed/reviewed the first three and successfully dispatched/completed/reviewed workers four through eight. All eight delivered readable reports. The leader was held open so automatic review turns could not race fixture actions. No renderer state was mutated.

Thus eight windows should accumulate across reviewed worker batches, rather than eight simultaneously running workers. This is the current host contract and does not add queue behavior.

## Exact commands and results

All commands ran in `/home/dp/Desktop/rocket-orchestrator`.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed on final explicit run; no TypeScript errors. |
| `npm test` | Passed on final explicit run: 258 tests, 258 passed. |
| `npm run check:ui -- --grep orchestra-shell` (initial) | Build and 258 unit tests passed. Desktop: 1 passed, 2 failed, 29.2 seconds. Both UI failures were `.orch-shell` absent. |
| `npm run check:ui -- --grep orchestra-shell` (final full attempt) | Build passed; unit gate returned 257 passed / 1 failed. `src/shared/app-map.test.ts:26`: “the app map names worker.expand, but no renderer control uses it”. Playwright did not run. Concurrent renderer/app-map work changed after the separate passing unit run. Those files were left to their worker. |
| `ROCKET_UI_SKIP_BUILD=1 ROCKET_UI_SKIP_UNIT=1 npm run check:ui -- --grep orchestra-shell` | Against the completed build, 1 passed / 2 failed, 30.2 seconds. Revised independent harness passed including eight successful workers/reports. Both layout cases failed at `.orch-shell` missing. Exit 1. This is desktop evidence, not a passing full gate. |

The runner forwards standard Playwright flags after `--`; `--grep orchestra-shell` matches all three test titles. Builds and unit gates are automatic unless explicitly skipped. Logs are preserved in `task-0002-evidence/` (including initial and final runs).

## DOM contract for renderer integration

| Selector / accessible control | Expected behavior |
| --- | --- |
| `.orch-shell` | Visible on fresh launch, begins immediately below `.titlebar`, ends at viewport bottom (2px tolerance). |
| `[data-testid="orchestrator-chat"]` | Visible, aligns with shell top and spans its height (2px tolerance). Its width stays unchanged after accumulating eight workers. |
| `[data-testid="worker-board-empty"]` | Visible before any worker is dispatched. |
| `[data-testid="worker-window"]` | One per accepted worker chat, including completed/interrupted workers. Has `data-chat-id` equal to the host worker chat ID and `data-status="running"` during its held stream. Shows provider, assigned task and live `Streaming from <provider>.` text. |
| `data-status="done"` | UI value after host task reaches `completed`; stopping must produce a value other than `running`. The host retains `completed`/`interrupted` values. |
| `Expand worker` button | Scoped to the worker window; opens `[data-testid="worker-expanded"]`. |
| Expanded worker | Contains textbox named `Message`, button named `Send`, and worker transcript. Sending a reply on a completed worker shows the user's words and the controlled `Good evening.` response. |
| `Close expanded worker` button | Scoped to expanded worker; returns to the board so stop/scroll checks can continue. This label is an additional test contract and may need alignment with the renderer. |
| `Stop worker` button | Scoped to a running worker; host task becomes `interrupted`, and UI status becomes non-running. |
| `Open report` button | Scoped to a completed worker; displays its report in region named `Artifact preview`. Existing button named `Close artifact` closes that preview. |
| `[data-testid="worker-board"]` | The scroll container. After eight accepted workers: `scrollHeight > clientHeight`; scrolling to bottom puts the last worker window in viewport. |
| Existing composer hooks | Folder control `.composer-folder`; textbox `Message`; button `Send`. Used to create the leader through normal UI. |

The lifecycle case includes named captures for dispatch, stream, done, artifact preview, expanded reply, stopped worker, and eight-worker scroll. Only dispatch and failure captures exist for that case so far, because it fails before worker-window assertions. The independent harness has captures at initial dispatch, first report, and eight delivered reports.

## Evidence and limits

Evidence is beside this report in `task-0002-evidence/`:

- `ui-initial/`, `ui-gated/`, `ui-desktop-final/`: runner logs, summaries, results, HTML reports, captures, traces and attachments. Profile caches and scratch workspaces were excluded from copies.
- `orchestrator.json`, `ui-orchestra.json`: eight-worker state and controlled tool results from the passing final harness. These show actual dispatch rejection and successful completion/review.
- `worker-reports/`: all eight controlled reports.
- `source/`, `source-sha256.json`: exact test/harness/documentation snapshot for review.
- Explicit typecheck, unit and desktop command logs.

The initial screenshot was visually inspected: it shows the old single-chat UI and no worker board. This agrees with the selector failures. Expand/reply UI, Stop-worker UI, report-opening UI, full-height geometry and board overflow **remain unverified**, not independently failing. Their assertions have not been reached. Host report generation and dispatch/review scheduling are verified separately. Concurrent app-map drift is a separate gate failure, not a controlled-provider harness failure.

## Next reproduction and unresolved questions

After the renderer worker installs its shell and controls, run `npm run typecheck`, `npm test`, then `npm run check:ui -- --grep orchestra-shell` with no skip flags. Align the DOM contract above first, especially `done` versus host `completed`, the actual scroll container, and the expanded-worker close label. Resolve the `worker.expand` map/control drift in the worker's renderer changes.

The host currently rejects overflow. If product intent requires a visible queued-worker state, that needs an explicit scheduling change beyond this eval assignment; these tests deliberately assert today's host behavior. The eight-worker board and all lifecycle UI assertions still need a successful run against the completed renderer.
