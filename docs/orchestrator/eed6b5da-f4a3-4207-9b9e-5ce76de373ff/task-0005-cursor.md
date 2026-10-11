# Task 0005 — one-pane UI specs

Work was only in `/home/dp/Desktop/rocket-orchestrator/tests/ui`. `orchestra-shell.spec.ts`, `src/renderer/**`, and `src/host/**` were not edited.

## Result

`npm run check:ui` in `/home/dp/Desktop/rocket-orchestrator`:

| Stage | Result |
| --- | --- |
| Unit | 272 passed, 0 failed |
| Desktop | 58 tests, **56 passed, 2 failed**, 7.7m |
| Exit | 1 |

The two failures are the baseline fill and sources bugs below. Every rewritten pane spec passed in this run, including `orchestra-shell` (3/3) and `orchestra-stress` (1/1), which this task did not own.

Artifact folder: `/home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T06-28-19-414Z-iYX3po`

Log: `task-0005-evidence/full-ui.log`. Per-test lines: `task-0005-evidence/results.txt`.

## Per spec

| Spec | Decision | Full-run result |
| --- | --- | --- |
| `panes.spec.ts` | Replaced the four-pane split with one-pane invariants: one `.pane`, no "Add a chat beside this one", history switches the left chat, restart keeps that chat, closing both tabs returns the empty new-chat screen, `pane.add` is refused, the only pane cannot close. | 1 passed (5.1s) |
| `app-map.spec.ts` | `pane.add` is refused with the renderer's exact string `There are already 1 panes, the most the card holds.` `pane.close` of pane 0 still says `The only pane cannot close.` A dispatched worker expands and collapses through `worker.expand` / `worker.collapse` and the Expand / Close expanded worker buttons. | 1 passed (5.6s) |
| `images.spec.ts` | The two pane-add tests now use the board. Drops and paste stay on the orchestrator pane; a dragover on the expanded worker does not highlight or attach. Copy-to-chat lists the worker under Recent (no Pane 2; New chat is disabled). A drag from the expanded transcript's file lands on the orchestrator composer. The other three image tests were already one-pane and were left as they were. | 5 passed |
| `ui-live.spec.ts` | Scripts still drive the live window (`target` omitted) and `ui.pane(0)`. After the browser panel opens, the board is a rail: the test clicks Show workers, then Expand worker. The unscoped Message fill is then `AMBIGUOUS_TARGET`. History stays 1 ambiguous group, 3 successes, 3 failures, failure rate 0.5. | 1 passed (6.7s) |
| `tool-failure-pane.spec.ts` | `openWorkerBeside` dispatches a real Claude worker and expands it, so two Message boxes exist. The unscoped fill is `AMBIGUOUS_TARGET`; `ui.pane(0)` plus `worker-expanded` writes each composer separately. | 1 passed (18.3s) |
| `eval-tools.spec.ts` | Same worker setup instead of a second pane. Ledger, mark verified, and the queue assertions are unchanged. | 1 passed (19.1s) |
| `tool-failure-loop.spec.ts` | Same worker setup. The verified fix fills `ui.pane(0)`. Review lifecycle assertions are unchanged. | 1 passed (18.4s) |
| `fill.spec.ts` | Expectation left at chip count `1`. This is a host fixture bug, not a stale spec. | **1 failed** |
| `sources.spec.ts` | Expectation left at `is-opened` for the auth docs link. Same fixture bug. | **1 failed** |

None of the eight pane specs were skipped. `AMBIGUOUS_TARGET` is produced by the orchestrator composer and the expanded worker's reply box, both Claude, both live tool connections.

## Files

New: `tests/ui/orch.ts` (`dispatchClaude`, `finishWorker`, `openWorkerBeside`).

Edited: `tests/ui/panes.spec.ts`, `app-map.spec.ts`, `images.spec.ts`, `ui-live.spec.ts`, `tool-failure-pane.spec.ts`, `eval-tools.spec.ts`, `tool-failure-loop.spec.ts`. Comments only in `fill.spec.ts` and `sources.spec.ts`.

`dispatchClaude` prefixes the assignment with `UI shell worker`. The fixture writes a report only when the prompt contains that phrase (`src/host/ui-test.ts:92-95`). Without the file, `turnEnded` marks a completed worker failed (`src/host/orchestrator.ts:247-249`). After the worker finishes, the host starts a leader review within about two seconds; `finishWorker` releases that turn so the left composer is idle and the run pauses for a missing checkpoint.

## Baseline bugs (not masked)

Both fail because the fixture's web tool output is `''`, and the host refuses to record an empty read.

- Fill chip stays `0`. `src/host/ui-test.ts:180` emits `https://wiki.example/rules` with `output: ''`. `src/host/hub.ts:712-715` calls `webReadProblem`; `src/shared/web-evidence.ts:5` returns `The reader returned no content.` for empty text, so the URL is not pushed to `live.opened` and the item is marked failed. `src/renderer/src/fill.ts` counts `sources.length`. The spec at `tests/ui/fill.spec.ts:69` still expects `1`.
- Sources mark stays `source-mark is-unopened` (title `Not opened this turn: the model cited this page without reading it`). `src/host/ui-test.ts:243` fetches `https://docs.example.com/auth/sessions` with `output: ''`. Same gate. The spec at `tests/ui/sources.spec.ts:17` still expects `/is-opened/`. The blog-post link correctly stays unopened.

A non-empty readable `output` on those two fixture tools would satisfy the existing specs. That edit belongs to the host owner.

## Renderer gaps left in place

- The expanded worker reply is a local textarea (`OrchestratorShell.tsx` `WorkerReply`, around line 165). It is not a drop target and does not take attachments. Drops are handled only on `.pane` (`App.tsx:167-179`). The image spec copies into the worker's draft through the menu, and drags the worker's sent file back onto the orchestrator composer.
- The copy picker still says `Four chats open` and `Four chats is the most for now` (`AttachmentMenu.tsx:128` and `:135`) while `MAX_PANES` is 1. The New chat row is disabled. The spec asserts disabled, not that subtitle.

## Earlier runs

These were the iterations before the full suite. The full run above is the count that includes every spec together.

| Command | Artifact | Result |
| --- | --- | --- |
| panes, app-map, images, ui-live (first) | `.artifacts/ui/2026-10-08T06-06-09-511Z-nSd8iD` | 3 passed, 5 failed. Workers were `failed` because no report was written. The ask question is not the first `.prose`. |
| same four files (second) | `.artifacts/ui/2026-10-08T06-14-20-521Z-2vSwET` | 4 passed, 4 failed. Workers reached `done`. An empty composer keeps Send disabled, so waiting for Send to be enabled was wrong. |
| app-map, paste, copy, ui-live | `.artifacts/ui/2026-10-08T06-16-53-888Z-hy7scm` | 2 passed, 2 failed. The worker's chat title is the assignment prompt, not the task sentence. With the browser open the board is a rail and Expand worker is not in the tree until Show workers. |
| copy and ui-live | `.artifacts/ui/2026-10-08T06-19-51-378Z-BaYMeZ` | 2 passed |
| eval-tools, tool-failure-loop, tool-failure-pane | `.artifacts/ui/2026-10-08T06-21-03-175Z-1fJlaT` | 3 passed |
| fill and sources | `.artifacts/ui/2026-10-08T06-27-35-951Z-2ZQPf8` | 2 failed, same two assertions |

## Unresolved

- The host owner needs to give `fill()` and `cite()` non-empty page text so `fill.spec.ts:69` and `sources.spec.ts:17` pass. The specs should stay as they are.
- Whether an expanded worker's reply should accept a file drop is a renderer decision. The specs do not require it.
- The "Four chats open" picker copy is stale for `MAX_PANES = 1`.
