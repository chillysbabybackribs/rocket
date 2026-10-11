# Task 0003 — persisted worker queue and task timing

Implemented in `/home/dp/Desktop/rocket-orchestrator` only. The required report and evidence are written here in rocketv1; no rocketv1 source was edited. No renderer or shared app-map edits, other worker creation, chat control, live restart, or progress-file modification were performed.

## Design and behavior

- Dispatch accepts unlimited assignments; running capacity remains three workers per run and one worker per provider. Every assignment immediately gets an ordinary store chat and report path. Queued chats have no provider turn, `turnId: null`, `startedAt: null`, and no provider usage yet. This preserves the UI's string chat ID and ordinary chat-loading contract without introducing nullable IDs or temporary placeholders.
- Tasks are scanned in acceptance order. Each provider runs FIFO; blocked providers do not prevent eligible work for another provider. Starts occur immediately on owned worker completion, failure or interruption, on resume, and in the two-second scheduler tick. Synchronous launch failure releases the slot and continues to the next already-approved assignment.
- New dispatch still rejects unreviewed finished evidence. Running, queued and never-started cancelled assignments do not trigger this gate. A queued assignment was already approved at acceptance, so starting it never requires another checkpoint. Checkpoint cannot review a queued task as finished.
- Both stop modes cancel queued tasks with status `cancelled` and `endedAt` set, leaving `startedAt`/`turnId` null. Drain finishes only workers already running and schedules the existing final review. Immediate stop requests cancellation only of owned running workers; their running status remains until the provider event. Resume never resurrects cancelled tasks. Cancelled assignments have no worker evidence and do not block fresh dispatch after reviews of actual finished work.
- Antigravity still cannot dispatch when its shared identity belongs to the owner or an unrelated active chat. Assignments behind this run's own active Antigravity worker can queue. Every actual queued start rechecks all active Antigravity chats, so an external reservation keeps the task waiting.
- `createdAt` records accepted dispatch, `startedAt` records host launch reservation, `endedAt` records observed terminal events, launch failures, queued cancellations or restart recovery. Values are epoch milliseconds. They measure host lifecycle timing, not exact provider execution boundaries.
- On restart, active runs pause, running workers become interrupted and get an end timestamp, and queued workers remain queued. No queued usage starts while paused; explicit resume starts eligible queued work without reapproval.
- Legacy tasks backfill creation from run creation, approximate start from creation for tasks that ran, and terminal end from the saved run update. Queued tasks keep null start/end. Valid saved timestamps survive. Legacy timings are approximations.
- Every queued acceptance, launch reservation, launch result, completion/failure and queued cancellation persists and emits the orchestration event. Progress Markdown shows queued state, waiting text and all three timestamps.

## Files changed

- `src/shared/orchestrator.ts`: `queued`/`cancelled` task statuses and required task timestamps.
- `src/host/orchestrator.ts`: timestamp migration, queue scheduling, lifecycle/event persistence, review gate, cancellation and progress rendering.
- `src/host/tools/orchestrator.ts`: tool descriptions explain FIFO queueing and drain/stop cancellation of queued work.
- `src/host/orchestrator.test.ts`: replaces fourth-worker rejection assertion with queue acceptance; adds eight lifecycle tests and event capture assertions.
- `docs/orchestrator.md`: queue contract, timing/migration semantics, stop/drain behavior, recovery and validation scope.

## Validation and reproduction

Run from `/home/dp/Desktop/rocket-orchestrator`:

1. `npm run typecheck`: **exit 0**, no TypeScript diagnostics. Evidence: [typecheck.log](task-0003-evidence/typecheck.log).
2. `npm test`: **exit 0**, **266 tests**, **5 suites**, **266 passed**, **0 failed**, **0 cancelled**, **0 skipped**, **0 todo**. Recorded duration: 9094.358568 ms. Evidence: [tests.log](task-0003-evidence/tests.log).
3. `node --experimental-transform-types --disable-warning=ExperimentalWarning --test src/host/orchestrator.test.ts`: **exit 0**, **18 tests**, **18 passed**, **0 failed/cancelled/skipped/todo**. Evidence: [orchestrator-tests.log](task-0003-evidence/orchestrator-tests.log).

The focused suite uses temporary state/progress files and a controlled fake hub; no live providers. New tests cover 30 queued workers beyond three running, stable chat ownership, queued/running/cancelled broadcasts, per-provider FIFO and independent capacity, auto-start without evidence review, completion/failure/interruption/launch-failure slot release, both stop modes, final drain review, no resurrection on resume, restart persistence, legacy timing backfill, and Antigravity shared-identity waiting. Source fingerprints are in [source-hashes.json](task-0003-evidence/source-hashes.json).

No `npm run check:ui` was run by this host assignment while the renderer worker was actively changing the shell. These are host lifecycle and repository type checks, not proof of desktop integration or live-provider behavior. The concurrent renderer changes are included in the repository-wide checks as they existed at execution time.

## Renderer touch-points (read only)

The renderer changed concurrently; the following is the final observed inventory. Exact grep evidence: [renderer-touch-points.txt](task-0003-evidence/renderer-touch-points.txt).

- `src/renderer/src/store.ts:168`: `WorkerStatus` union. The renderer worker has now added `queued`; `cancelled` was already present.
- `src/renderer/src/store.ts:1239`: `workerStatus` maps completed to done, passes other statuses through, and distinguishes interrupted/cancelled worker turns. It now accepts queued through the expanded union.
- `src/renderer/src/components/OrchestratorShell.tsx:25`: `STATUS_TEXT` status label map; the latest observed version includes queued.
- `src/renderer/src/components/OrchestratorShell.tsx:58`: `Elapsed` uses task timing in the latest observed version. Started-null tasks should display waiting rather than elapsed execution.
- `src/renderer/src/components/OrchestratorShell.tsx:72`: `WorkerActions` status-dependent Stop and report controls; queued/cancelled reports are absent and queued Stop cannot use ordinary `chat.stop` to cancel the queue assignment.
- `src/renderer/src/components/OrchestratorShell.tsx:115` and `:190`: timing live updates are conditional on running status.
- `src/renderer/src/components/OrchestratorShell.tsx:122` and `:189`: compact/expanded status labels.
- `src/renderer/src/components/OrchestratorShell.tsx:131` and `:199`: expanded `WorkerReply`, which can send an ordinary chat turn independently of the queue. Queue-safe gating needs renderer review.
- `src/renderer/src/components/OrchestratorShell.tsx:205`: `RANK` now places running before queued before terminal workers.
- `src/renderer/src/components/OrchestratorShell.tsx:222`: filter currently groups queued with running through `RANK < 2`; confirm desired filter label/behavior.
- `src/renderer/src/components/OrchestratorShell.tsx:223` and `:233–236`: stopped/running/queued/done/failed counts.
- `src/renderer/src/store.ts:1268`, `:1274`, `:1285`: ordinary worker stop, reply and report calls are adjacent integration points. No host API for cancelling one queued assignment was added in this scope.

Other grep hits in Composer, Transcript, eval components and generic store turn handling concern provider Turn/eval statuses, not OrchestratorTask status switches. `src/renderer/src/app-map.ts` worker expand/collapse operations identify workers by chat ID and do not switch on task status; they retain a valid ID with this design.

## Remaining integration questions

The renderer should prevent queued-worker replies from launching provider work outside the host queue. Queued-worker Stop is currently disabled in the shell; adding per-task queue cancellation would require a separately authorized host action (whole-run stop already cancels every queued task). Confirm whether the Running filter should include queued workers or have a separate waiting filter.

Host source changes require loading the new host on restart; Rocket was kept running. The renderer owner's isolated desktop checks should verify queued cards, elapsed timing, report controls, no premature reply dispatch, stop/drain events and restart/resume UI. No uncertain external API claims or dependencies were needed; behavior was established from local host/store code and controlled tests.
