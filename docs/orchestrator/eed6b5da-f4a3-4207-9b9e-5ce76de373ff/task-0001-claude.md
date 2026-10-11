# Task 0001 (Claude): Orchestrator shell, the worker board

Worked only in `/home/dp/Desktop/rocket-orchestrator`. Nothing in `/home/dp/Desktop/rocketv1` changed except this report and its evidence folder. Evidence is in `task-0001-evidence/`.

## Result

The renderer now opens on an orchestrator shell instead of the old pane card:

- **Left:** pane 0 is the orchestrator's chat, full height below the title strip. It has its own transcript and composer. When its chat owns a run, a head row shows the run's task, its status and a `progress.md` link. The column is 40% wide by default, at least 420px, and has a draggable divider (double-click resets it).
- **Right:** a worker board with one live window per task in the run that the left chat owns.
  - There is no cap on windows. The board scrolls.
  - Order: running first, then queued, then finished, newest first.
  - The board head shows the run's status, counts for running, queued, done, failed and stopped, and an All / Running / Done filter.
  - Each window shows the worker chat's real transcript, read-only and compact, through `ShownChatContext`, kept live by the usual events.
  - Each window has a provider glyph, a status dot, the first line of the task, elapsed time, and Expand / Stop / Report buttons.
- **Expand** puts the worker over the board with its full transcript and a reply box. The reply goes to that worker's chat, using the provider it was dispatched to. Esc or the close button collapses it.
- **Stop** calls the existing `chat.stop` for that one chat. Stop is also enabled when a reply turn is running in a finished worker.
- **Report** opens the report in the artifact panel.
- **Empty state** appears when there is no run.
- **App map:** new actions `worker.expand {chatId}` and `worker.collapse`. `rocket_ui_where` now has a `board` entry (run, filter, expanded, and each worker's chatId, taskId, provider, status and task). The host's one-line "Where you are" sentence mentions the board.

### DOM contract (kept exactly)

- `.orch-shell`
- `[data-testid="orchestrator-chat"]`
- `[data-testid="worker-board"]`: this is the scrolling element.
- `[data-testid="worker-window"]` with `data-chat-id` and `data-status`.
- Buttons labelled `Expand worker`, `Stop worker` and `Open report`.
- `[data-testid="worker-expanded"]` with a `Message` textbox, a `Send` button and a `Close expanded worker` button.
- `[data-testid="worker-board-empty"]`

`data-status` values:
- `completed` is shown as `done`.
- `running`, `failed`, `interrupted`, `cancelled` and `queued` pass through as they are.
- An interrupted worker that the user stopped (from the board, or by stopping the whole run) also reads as `cancelled`.

`queued` and the task's `cancelled` status arrived mid-task from another worker's host change. I adapted to them rather than fighting them.

## Files changed (rocket-orchestrator)

- `docs/mockups/orchestrator-shell.html`: new static mockup with three frames: a run in progress, an expanded worker, and the empty board.
- `src/renderer/src/components/OrchestratorShell.tsx`: new. The shell, board, windows, expanded view and reply box.
- `src/renderer/src/orchestrator.css`: new. Shell, board, compact transcript, dots, the narrow-window container query, and side-panel grid overrides.
- `src/renderer/src/App.tsx`: renders `OrchestratorShell` around a one-pane `ChatCard`, and adds the `orch-app` class.
- `src/renderer/src/store.ts`:
  - `MAX_PANES = 1`
  - `board` state (`expanded`, `filter`, `width`, `stopped`)
  - `boardRun`, `workerChatIds`, `workerStatus`, `expandWorker`, `setWorkerFilter`, `setOrchWidth`, `stopWorker`, `replyToWorker`, `openWorkerReport`, `loadWorkerChat`
  - Loading a chat view now merges concurrent loads.
  - `pruneViews` keeps the board's worker chats.
  - On start, pane 0 shows the chat that owns an active run if its own chat owns none.
- `src/renderer/src/app-map.ts`: `worker.expand` and `worker.collapse` handlers, plus `board` in `where()`.
- `src/shared/app-map.ts`: the two actions.
- `src/shared/types.ts`: optional `UiWhere.board`.
- `src/host/tools/ui-map.ts`: `describeWhere` mentions the board. This is a small host change, only for the map.
- `src/renderer/src/components/Composer.tsx`: the "add a chat beside" button renders only when `MAX_PANES > 1`.
- `README.md`: new section "The orchestrator shell", and a note on Chat panes.

I did not touch files other workers were changing (`src/host/orchestrator.ts`, `src/host/tools/orchestrator.ts`, `src/host/ui-test*.ts`, `src/shared/orchestrator.ts`, `docs/orchestrator.md`, `tests/ui/orchestra-shell.spec.ts`). I meant to update the renderer line in `docs/orchestrator.md`, but it was being rewritten concurrently, so I left it.

## Screenshots

**Mockup** (headless Chromium via Playwright, deterministic):
- `task-0001-evidence/mockup-orchestrator-shell.png`: full page, 3 frames.
- `task-0001-evidence/mockup-frame1.png`

**Real built app**: isolated profile, controlled providers, `ROCKET_UI_TEST`, xvfb 1440×960. All in `task-0001-evidence/captures/`:
- `01-empty-board-shell.png`
- `02-workers-streaming-shell.png`: 3 running and 1 queued, live "Streaming from …".
- `03-report-artifact-shell.png`: report in the artifact panel, with the board narrowed and showing icon-only actions. A crop is at `task-0001-evidence/03-report-artifact-board-crop.png`.
- `04-worker-expanded-reply-shell.png`: the reply shows up as a new turn in the worker's chat.
- `05-worker-stopped-shell.png`: the stopped worker reads as `cancelled`.
- `06-many-workers-top-shell.png` and `07-many-workers-scrolled-shell.png`: 8 workers; the board scrolls and the leader column's width doesn't change.
- `08-filter-done-shell.png`
- `09-map-expand-shell.png`: expanded through `rocketMap.act('worker.expand')`.
- `where-after-collapse.json`: `where().board` after `worker.collapse`.

**Capture spec** (mine, kept as evidence): `task-0001-evidence/spec/board-capture.spec.ts` and its config. It runs from a copy at `rocket-orchestrator/.artifacts/board-capture/`, because Playwright resolves `@playwright/test` from the spec's own folder.

To reproduce, build first with `npm run build`, then from `rocket-orchestrator` run:

```sh
ROCKET_UI_OUTPUT=<dir> NODE_ENV=test xvfb-run -a --server-args='-screen 0 1440x960x24' node node_modules/@playwright/test/cli.js test --config .artifacts/board-capture/playwright.config.ts
```

Result: **1 passed** (empty → streaming → done → report → expand + reply → stop → 8+ workers scrolled → Done filter → map expand/collapse).

## Test results (exact)

**Unit tests and typecheck:**
- `npm run typecheck`: clean.
- `npm test`: **266 tests, 266 pass, 0 fail**. The count went from 258 to 266 during the task because another worker added tests.

**Full isolated UI suite** (`ROCKET_UI_SKIP_UNIT=1 npm run check:ui`): **57 tests, 43 passed, 14 failed**. Artifacts are in `rocket-orchestrator/.artifacts/ui/2026-10-08T05-32-07-230Z-EI1Cym`; the log is `task-0001-evidence/full-ui.log`.

I then fixed what my layout broke. Rerun log: `task-0001-evidence/sub-ui.log`. Baseline comparison: an untouched `git archive HEAD` copy in `/tmp/orch-baseline`, log in `task-0001-evidence/baseline-ui.log`.

How the 14 failures break down:

- **Fixed (2): `reading.spec.ts:7` and `rocket.spec.ts:6`.** I had given side panels 0.75fr, which made the browser about 575px wide. At that width its address field covers Back and "Read hands-free". I restored Rocket's side-panel proportions. Both now pass, along with `reading.spec.ts:86`.
- **Broken by design, one pane (8).** These add a second pane and need a decision (see the questions below), not a quiet fix:
  - `app-map.spec.ts:9` (`pane.add` is now refused)
  - `images.spec.ts:67` and `images.spec.ts:162`
  - `panes.spec.ts:6`
  - `tool-failure-pane.spec.ts:6`
  - `ui-live.spec.ts:5`
  - `eval-tools.spec.ts:5` and `tool-failure-loop.spec.ts:6`: these add a second pane to set up the `AMBIGUOUS_TARGET` case. Both pass on the baseline.
- **Fail on the baseline too (2):** `fill.spec.ts:8` (chip count) and `sources.spec.ts:5` (`is-opened`). They fail identically on the untouched HEAD copy, so they predate this work.
- **Another worker's host change (2):** `orchestra-shell.spec.ts:69` and `:102` stop at line 64, `expect(fixture.results[4].isError).toBe(true)`. The host now queues a fourth dispatch instead of rejecting it, so the spec's assumption no longer holds.
  - In my first run, before the queue change landed, `:102` got through windows, streaming, done, report and expand. It failed only at `toContainText('Good evening.')`.
  - Cause: the fixture in `src/host/ui-test.ts` checks `request.text.includes('<rocket-orchestration>')`. The reply's prompt also contains `teamwork.context`, which quotes other workers' assignments, so the reply gets treated as a held worker stream rather than "good evening".
  - The reply itself does arrive in the worker chat (capture 04). The fix belongs to whoever owns the fixture, for example matching the message's own first line instead of the whole prompt.

## Known gaps

- **Mockup approval:** CLAUDE.md asks for agreement on a mockup before building. The assignment said to implement, so I built straight after the mockup. It has not been agreed with the user.
- **One pane:** `MAX_PANES = 1` removes split panes app-wide. The `pane.*` map actions remain; `pane.add` now refuses. Eight older UI specs depend on panes and need rewriting or retiring (the test worker's call).
- **Cramped board with a side panel open:** with the browser, artifact, library or evals open, the board gets what is left after the orchestrator column's 420px minimum (about 190px at 1360px wide). Windows go icon-only. A better option might be to shrink the orchestrator column, or to let the side panel overlay the board.
- **Plan drawer and goal pane:** these still open inside the left column (`Split`), which is cramped at 420px. Not reworked.
- **Elapsed time:** taken from the task's `startedAt` / `endedAt`, falling back to the dispatched turn. It counts from dispatch, not including later reply turns.
- **Queued workers can't be stopped individually:** a per-task cancel isn't in the host API. Stopping the run cancels queued work, so Stop is disabled for queued workers.
- **The board only follows pane 0's run.** If you switch the left chat in History, the board switches with it. After start-up, there's no automatic jump to a run that some other chat starts.
- **No live-provider check:** everything was checked with controlled providers only. No real model turns were sent.
- **Event timing on load:** live events that arrive between a worker's `chat.open` request and its response are dropped. The snapshot usually covers them. The eval run view has the same pattern.

## Unresolved questions for the orchestrator

1. Should the eight pane-dependent UI specs be rewritten for one pane, or should the shell keep multi-pane support in some form (for example, tabs only)?
2. When a side panel is open, should the orchestrator column shrink, should the board collapse, or should the side panel overlay the board?
3. The `orchestra-shell.spec.ts` owner needs to update the dispatch-limit assertion (the host now queues) and the fixture's `<rocket-orchestration>` detection (it catches teamwork context).
