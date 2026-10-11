# Task 0004 — per-worker cancellation, queue reply guard and shell regression checks

Implemented the assigned host changes in `/home/dp/Desktop/rocket-orchestrator`. No renderer files or rocketv1 source files were edited. The requested report and evidence are the only outputs written into rocketv1. No live Rocket instance was restarted or closed; desktop checks used isolated, marked profiles and controlled providers.

## Files changed

- `src/shared/types.ts`: exact request map addition `orchestrator.cancelTask: [{ runId: string; taskId: string }, Orchestration]`.
- `src/host/index.ts`: request wiring to `Orchestrator.cancelTask`. Existing `chat.send` calls `userMessage` before `hub.post`, so queued replies fail before entering Hub posting.
- `src/host/orchestrator.ts`: cancel one task by run ID and task ID. Queued cancellation sets cancelled/end time, preserves null start/turn IDs, persists JSON/progress Markdown and broadcasts. Running cancellation calls the existing Hub stop path; its status remains running until the real turn ends. Stop failures are recorded. Finished tasks and invalid IDs throw full-sentence errors. `userMessage` rejects replies into queued worker chats with exactly: “This worker is waiting in the queue; it starts when a slot frees. Cancel it or wait.”
- `src/host/orchestrator.test.ts`: three added tests cover queued cancellation persistence/events/progress/no launch/no peer stop, running cancellation and real slot release/stop failures, and reply rejection before scheduling starts.
- `src/host/ui-test.ts`: recognizes orchestration only with a marker on its own line (`/^<rocket-orchestration>\r?$/m`), rather than any substring. Teamwork formats quoted assignments onto a prefixed single line, so those quoted markers do not match. Fixture accepts six dispatches: Claude, Cursor, Antigravity, then another of each. All errors now fail the fixture rather than expecting overflow rejection.
- `src/host/ui-test.test.ts`: updated six-dispatch fixture test and added regression test that a reply containing quoted orchestration context completes with `Good evening.` rather than becoming a held stream.
- `tests/ui/orchestra-shell.spec.ts`: six accepted workers, three running/three queued, slot release and report delivery; queued Stop/cancel assertions; queued-to-running-to-done transitions; report artifact; expand/reply/close; running Stop; nine windows, scrolling and stable leader width. Every journal `crash` entry fails afterEach. No ResizeObserver error is filtered.
- `docs/orchestrator.md`: documents cancellation request semantics, queued reply rejection and isolated check coverage.

## Commands and results

Run from `/home/dp/Desktop/rocket-orchestrator`:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed, exit 0. |
| `npm test` | 270 passed, 0 failed, 0 skipped. |
| `npm run check:ui -- --grep orchestra-shell` | Build passed; its unit-test stage also passed 270/270; desktop stage 1 passed, 2 failed. |

UI artifact directory: `/home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T05-51-27-089Z-LcztSU`.

Copied evidence is beside this report in [task-0004-evidence](task-0004-evidence/): command logs, runner summary, test attachments/screenshots/traces, error contexts, journals and fixture data. Profile/tool-channel secrets were not copied. The six-window screenshot was visually inspected: full-height left chat, three streamed windows, queued windows with blank transcripts and disabled Stop controls.

## Remaining failures and exact causes

1. `orchestra-shell controlled queue releases slots and delivers reports` passed all its body assertions: six tasks accepted, three running/three queued, same-provider slot release, finished evidence gating and six controlled report deliveries. It failed only at `tests/ui/orchestra-shell.spec.ts:71`, the new journal assertion. The renderer journal records exactly `ResizeObserver loop completed with undelivered notifications.` as `source: renderer`, `kind: crash`. This is a recorded renderer error, not evidence of process termination. No external claim about whether it is benign was made; no error was filtered.
2. `orchestra-shell streams queued workers and supports cancel expand reply stop reports and scrolling` passed the initial six-window/status/provider/task/stream assertions, then timed out clicking queued task 0006's disabled `Stop worker` button at `tests/ui/orchestra-shell.spec.ts:121`. It also fails the same ResizeObserver journal assertion. At inspection, `WorkerActions` in `src/renderer/src/components/OrchestratorShell.tsx:75` still uses `status === 'running' || turnRunning` to enable Stop. `stopWorker` in `src/renderer/src/store.ts:1268` still calls `chat.stop`; there is no `orchestrator.cancelTask` call in renderer source. Those files belong to the concurrent renderer worker and were left untouched.

The fresh-profile/full-height geometry check passed. Expand/reply/report interaction, running Stop, later queued-to-done UI assertions and nine-window scrolling/width assertions remain unexecuted in the interaction scenario because queued Stop blocked first. The Good evening regression is verified at adapter unit-test level, and report/queue completion is verified through the real host MCP boundary in the other desktop scenario.

## Next verification / unresolved questions

The renderer needs queued Stop enabled and wired to `orchestrator.cancelTask` using the owning run/task IDs, plus its pending ResizeObserver correction. Rerun exactly `npm run check:ui -- --grep orchestra-shell` after those changes are saved and rebuilt; then inspect the later interaction assertions that this run could not reach. No user clarification is required for the host implementation. No live provider behavior or actual provider cancellation latency was tested.
