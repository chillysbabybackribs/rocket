# Task 0006 (Claude): queued Stop, the ResizeObserver loop, and round-3 board refinements

I worked only in `/home/dp/Desktop/rocket-orchestrator`. In rocketv1, the only changes are this report and `task-0006-evidence/`.

I did not touch any of these:
- `src/host/**`
- `tests/ui/orchestra-shell.spec.ts`
- Cursor's `tests/ui/*.spec.ts`

No real model turns were sent. Every check used isolated profiles and controlled providers.

## Result

**`npm run check:ui -- --grep orchestra-shell`: 3 passed, 0 failed.**
- Artifacts: `rocket-orchestrator/.artifacts/ui/2026-10-08T06-16-25-367Z-f54MDM`
- Log: `task-0006-evidence/logs/orch-0006-ui.log`

**The same check with `--repeat-each=3`: 9 passed, 0 failed, 0 flaky.**
- Artifacts: `.artifacts/ui/2026-10-08T06-18-06-983Z-qE0AoA`
- Log: `logs/orch-0006-ui-repeat.log`
- The spec's `afterEach` fails on any journal `crash` entry. None was recorded in any of the 9 runs.

**Other checks:**
- `npm run typecheck`: clean (exit 0).
- `npm test`: 272 tests, 272 pass, 0 fail. The count rose from 270 because someone else added tests during the task.

## (a) Stop for queued workers

`stopWorker(run, task)` in `src/renderer/src/store.ts` now works like this:
- **Queued** worker: calls `orchestrator.cancelTask { runId, taskId }`. The host marks it cancelled, it never starts, and its `turnId` and `startedAt` stay null.
- **Running dispatch:** also calls `orchestrator.cancelTask`, rather than `chat.stop`. This keeps the run's bookkeeping right:
  - The host first checks that the task belongs to the run.
  - It records "Cancellation requested by the user" on the task, so the leader sees it in `status`.
  - It records a failed stop on the task instead of letting it disappear in the renderer.
  - It then calls the same `hub.stop`. The task stays `running` until the provider's turn really ends.
  - The board still marks the chat as stopped, so the host's `interrupted` reads as `cancelled`. The spec checks this.
- **Finished worker running a reply turn:** calls `chat.stop`. That turn belongs to the chat, not the run, and `cancelTask` would refuse it as already finished.
- The Stop button is now enabled for queued workers. Its tooltip there reads "Take this worker out of the queue; it never starts".
- The run returned by `cancelTask` goes straight into the store; the host event follows.

## (b) The ResizeObserver loop

The source is the transcript's scroll observer (`Transcript.tsx`). It watches both the scroller and its content. Inside its callback, `measure()` wrote `--turn-fill`, and the fill turn's `min-height` follows the scroller's height. So:
1. Setting it resized the content.
2. Content that started to overflow brought in a scrollbar.
3. The scrollbar narrowed the scroller's content box. The scroller sits at a shallower depth than the content, so Chromium reports "loop completed with undelivered notifications".

Many worker windows each starting a "just sent" fill turn made this frequent.

The fix:
- The callback now only scrolls (pins to the bottom and keeps the anchor distance). Scrolling resizes nothing.
- `measure()` waits for a `requestAnimationFrame`, which is cancelled on cleanup and on the next callback.
- Separately, compact windows no longer use the fill layout at all (`.worker-body .turn.is-fill { min-height: 0 }`). In a 300px window it only left the window blank.
- The shell's own new width observer (`useWidth`) also defers to rAF and writes nothing in its callback.
- Nothing is filtered.

Caveat: I did not rerun the pre-fix build to reproduce the error myself; task 0004 recorded it. The evidence for the fix is that 3 of 3 and then 9 of 9 runs passed with no `crash` entries. Because both changes landed together, I can't say how much each one contributes.

## Refinements

1. **Assignment.** `WorkerShownContext` (in `pane.ts`) tells the transcript it is drawing a worker.
   - Detection: a turn is the assignment when its id is the task's `turnId`. Failing that, its user message's first line must be exactly `<rocket-orchestration>` and the message must contain the task text. The host's teamwork quoting never puts the marker alone on line one.
   - Compact windows show a one-line **Assignment** strip. Its tooltip is the full task.
   - Expanded, the assignment is folded behind **Show assignment**. Once open, the toggle ("Hide assignment") is sticky at the top of the transcript.
   - Queued workers and workers cancelled before they started have no turn, so they show the strip built from `task.task`.
2. **Head row and queue.**
   - Compact windows no longer render the turn's "Thinking · Working for Ns" head. The expanded view keeps it.
   - Queued windows read "Waiting for a free Claude slot · #N in queue". N is the place among queued tasks for the same provider, matching the host's `startQueued` rule of one running per provider.
   - Workers taken out of the queue read "Taken out of the queue before it started."
   - An expanded queued worker's reply box and Send are disabled, with the placeholder "Waiting in the queue — starts when a slot frees".
3. **Side panels.** With the browser, artifact, library or evals open:
   - The orchestrator column's minimum drops to 340px and the board's to 300px, in a single column.
   - The column's width is clamped in CSS: `minmax(var(--orch-min), min(var(--orch-width), 100% - board-min - gap))`. A saved dragged width can no longer crush the board.
   - If the minimums still don't fit, the board folds to a 52px **rail** (`data-testid="worker-rail"`, "Show workers") with a dot and count per state. Clicking it lays the board (and any expanded worker) over the shell, 520px wide from the rail leftwards. Esc, or the "Fold workers" button, folds it back.
   - Measured at 1360×860 with the browser open, the overlay ends at x=633 and the browser panel starts at 641. The native page view's bounds are identical before and after opening (`captures/layout-1360-browser.json`).
   - At 1440×960 with the browser open, the board fits as one column: leader 340px, board 314px (`layout-1440-browser.json`).
   - The composer at 340px overlapped the model picker and Stop. Below a 400px column width, the folder pill now shows only its icon (via a container query on `.orch-chat`).
4. **Expanded navigation.**
   - Esc closes the expanded worker.
   - ← and → move between workers, in the board's order and filter, wrapping round. They also work when the reply box has focus but is empty, because it takes focus on open.
   - New "Previous worker" and "Next worker" buttons, with a "3 of 6" position between them.
   - New map actions `worker.next` and `worker.previous`, in `shared/app-map.ts` and the renderer dispatcher. They are backed by `boardWorkers` / `stepWorker` in the store, and the board's ordering moved there too.
   - Checked: `nav.json` shows ArrowRight from task 1 went to the newest queued worker, as the board order predicts, and `worker.next` returned the same chat.
   - **Card states:** hover brightens the border; `:focus-within` adds a ring; running windows get a faint accent wash at the top; queued and cancelled windows sit a shade darker.

The mockup `docs/mockups/orchestrator-shell.html` gained frame 4 (strips, queued note, focus and tint) and frame 5 (the rail and its overlay beside the browser). Renders: `task-0006-evidence/mockup-frame4.png` and `mockup-frame5.png`. These frames were drawn alongside the build. The user has not agreed to them.

The README's "The orchestrator shell" section is updated.

The DOM contract is kept. The only new test id is `worker-rail`.

## Files changed (rocket-orchestrator)

- `src/renderer/src/store.ts`: `stopWorker(run, task)`, `boardWorkers`, `stepWorker`, `setBoardRailOpen`, `queuePlace`, `board.railOpen`
- `src/renderer/src/components/OrchestratorShell.tsx`: rewritten around the above, plus the rail, queued and not-started bodies, navigation, and the width-driven layout
- `src/renderer/src/components/Transcript.tsx`: the observer fix, `AssignmentLead` / `AssignmentStrip`, and no compact turn head
- `src/renderer/src/pane.ts`: `WorkerShownContext`
- `src/renderer/src/orchestrator.css`
- `src/renderer/src/app-map.ts`
- `src/shared/app-map.ts`
- `docs/mockups/orchestrator-shell.html`
- `README.md`
- New capture spec: `.artifacts/board-capture/board-capture-0006.spec.ts`, also copied to `task-0006-evidence/spec/`

## Captures (inspected)

Spec `board-capture-0006` passed 1/1 (log: `logs/orch-0006-cap.log`). Its output is in `rocket-orchestrator/.artifacts/board-capture/out-0006/`, and copies are in `task-0006-evidence/captures/`.

At 1440×960 I used the `-shell.png` captures. On this xvfb screen the X11 window grab clips 1440×960 to 1400×910, while the CDP shell captures are full size.

- `01-1440-six-workers-hover-shell.png`: 3 running windows with Assignment strips and live "Streaming from …", 3 queued windows with "Waiting for a free … slot · #1 in queue", and a hovered window.
- `02-…-expanded-assignment-folded`: "Show assignment" plus the first line of the task, the turn head, and "3 of 6" with ‹ ›.
- `03-…-expanded-assignment-open`: the full injected message, with "Hide assignment" sticky at the top.
- `04-…-expanded-queued`: the strip, the waiting note, and the disabled reply box with the queue placeholder.
- `05-1360-browser-rail-window.png`: the board folded to its rail beside the browser.
- `06-1360-browser-rail-open-window.png`: the board laid over the orchestrator column, with the browser page untouched.
- `07-1440-browser-shell.png`: leader at 340px, a single-column board, and the composer no longer overlapping (the browser page is `07-…-view-0.png`).

## Remaining gaps

- **The task-0001 capture spec now fails at its own line 83** (`logs/orch-0006-cap0001.log`). Its settle loop waits for zero running workers after releasing them, but with the host queue, releasing a worker starts a queued one. It passed every renderer step before that point: streaming, done, report, expand and reply, and stop reading as cancelled. It needs a queue-aware settle loop, or retiring now that `board-capture-0006` and `orchestra-shell.spec.ts` cover the same ground.
- **The opened assignment can still end up near the bottom.** When opening it moves the view by less than 80px, the transcript still counts as "at the bottom" and follows it there. The sticky "Hide assignment" keeps it usable. A real fix would let the transcript accept an explicit "stop following".
- **Esc clears a drafted reply.** Esc closes the expanded worker even with text in its reply box, and the draft is lost (this was already so).
- **Full UI suite not rerun.** I ran only the orchestra-shell grep and my capture spec. Pane-dependent specs remain Cursor's (task 0005).
- **No live-provider check.** No real-provider check of cancel latency or of how the assignment detection behaves with real CLIs.
- **Plan drawer and goal pane:** still inside the left column, which can now be 340px beside a side panel. Not reworked.

## Unresolved questions

1. When a side panel is open, should the rail overlay cover the orchestrator column (as built), or should the side panel shrink instead? The assignment said never to move or resize the browser page, so I built the overlay.
2. Should mockup frames 4 and 5 go to the user for agreement before more visual work?
3. Retire or rewrite `.artifacts/board-capture/board-capture.spec.ts` (task 0001)?
