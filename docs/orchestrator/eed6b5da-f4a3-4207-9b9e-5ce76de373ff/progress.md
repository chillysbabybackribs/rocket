# Orchestrator progress

Status: **stopped** · Updated: 2026-10-11T03:36:03.431Z · Review: 5

Current work and final review finished. No new work will be dispatched.

## Task

Rebuild Rocket's UI as an orchestrator app in /home/dp/Desktop/rocket-orchestrator (a copy of rocketv1 renamed "Rocket Orchestrator" with its own profile). Layout: one full-height orchestrator chat on the left; to its right, an unlimited, scrollable set of smaller worker chat windows — one per worker chat the orchestrator dispatches — each live-streaming its transcript, with status, provider, task and report link, and able to expand, focus, reply to or stop a worker. Keep the host/provider architecture; change the renderer (and shared types/host events only where the UI needs worker data). Keep refining, upgrading and testing with isolated UI checks/evals (npm run check:ui in that folder, controlled providers) until the user says stop. Never touch /home/dp/Desktop/rocketv1 source except reading it.

## Progress

Final state at the user's stopping point. Delivered in /home/dp/Desktop/rocket-orchestrator ("Rocket Orchestrator", its own profile): a one-pane orchestrator shell with a full-height orchestrator chat and an unlimited scrolling board of live worker windows (assignment strip, provider, status, timer, Expand with reply and previous/next, Stop including queued cancel, Report, filters, counts, side-panel rail), plus a host FIFO worker queue with per-task cancel and a queued-reply guard. Verified: 272/272 unit tests; full isolated check:ui 56/58, where the only 2 failures are pre-existing fixture defects (empty web-read output) that also fail on the baseline; orchestra-shell 3/3 on my own rerun; orchestra-stress at 40 workers passes functionally but fails the p95 frame budget (50–83ms against <50) from streaming Markdown re-parsing.

## Next

Next session, in priority order: (1) a renderer fix for streaming Markdown re-parsing so orchestra-stress passes with its budget unchanged; (2) give the fill and sources fixtures non-empty page text (src/host/ui-test.ts:180, :243) so check:ui is 58/58; (3) keep a drafted reply on Esc, allow file drops on the expanded worker reply, and fix the 'Four chats open' copy; (4) retire the stale task-0001 capture spec; (5) the user's sign-off on the new mockup frames; (6) a live-provider orchestration check, which spends usage, so ask first.

## User updates

- let the running tasks complete and come to a stopping point

## Progress log

### 2026-10-08T05:18:18.489Z

Set up /home/dp/Desktop/rocket-orchestrator as a copy of rocketv1 (no .artifacts/.git/out), renamed package to rocket-orchestrator / "Rocket Orchestrator" so it has its own Electron profile and single-instance lock; typecheck passes on the copy. Renderer already receives 'orchestrator' run events (store.ts) so worker data is available without host changes. Dispatched 0001 (claude): mockup + OrchestratorShell layout with a fixed DOM contract; 0002 (codex): isolated UI spec tests/ui/orchestra-shell.spec.ts against that contract, host-side controlled-provider extensions only.

Next: Review 0001's mockup and screenshots, open the mockup for the user, and check 0002's spec against the real layout; then run check:ui on the combined result and dispatch fixes.

### 2026-10-08T05:19:15.378Z

Review 1: both workers still running. Codex (0002) has started on the controlled-provider harness (src/host/ui-test.ts is modified in the new folder). Claude (0001) has not written its mockup yet. Nothing is accepted yet.

Next: When docs/mockups/orchestrator-shell.html appears, screenshot it and show it to the user. When 0001 and 0002 report, read their diffs and run typecheck, unit tests and check:ui on the orchestra-shell spec in /home/dp/Desktop/rocket-orchestrator myself before accepting anything.

### 2026-10-08T05:20:46.375Z

The mockup from 0001 (docs/mockups/orchestrator-shell.html) is reviewed and accepted as the design direction. Opened in Rocket's browser, it shows a title strip and a full-height orchestrator chat on the left (task chip, run status, progress.md link, steering composer). On the right is a worker board with run counts (running/done/failed), an All/Running/Done filter and a scrolling two-column grid of worker cards. Each card shows provider glyph, status dot, task title and elapsed time, a compact live transcript, and Expand/Stop/Report in its footer (Stop is disabled when finished, Report when there is no report). The page also has expanded-overlay and empty-state sections. Minor point to revisit: cards bottom-anchor short transcripts, which leaves empty space at the top. The implementation and test spec are still running.

Next: Wait for the 0001 and 0002 reports, then verify them by running typecheck, npm test and check:ui on the orchestra-shell spec in the new folder.

### 2026-10-08T05:26:23.586Z

Test spec and controlled harness from 0002 are in and accepted with caveats; renderer shell 0001 is still running. Two host gaps found: no queueing beyond the concurrency limit, and no task timestamps for elapsed time.

Next: Dispatch codex to add host task timestamps and a dispatch queue (status 'queued' that starts automatically when a provider slot frees), host and shared files only, with unit tests. When 0001 lands, align the spec's status values and close label, then run the full check:ui.

### 2026-10-08T05:31:42.361Z

Host queue and timestamps are in and verified by unit tests: the orchestrator can now fan out unlimited workers, at most 3 running and one per provider, with the rest queued FIFO. The test spec and harness are in. The renderer shell (0001) is still running.

Next: When 0001 reports: read its diff and report, run typecheck, npm test and check:ui on the orchestra-shell spec myself, and look at the captures. Then dispatch (a) a host 'orchestrator.cancelTask' action with a queued-card Stop and gated queued replies, and (b) fixes for any spec failures.

### 2026-10-08T05:50:17.518Z

The orchestrator shell is built and working in the real app (0001's report and captures are reviewed; formal review is recorded once its turn closes). My verification in the new folder: typecheck clean, npm test 266/266. check:ui --grep orchestra-shell: 1 pass and 2 failures, both from the spec's stale 'fourth dispatch rejected' assumption now that the host queues. Round 2 is running: 0004 (codex) adds the orchestrator.cancelTask host API, the queued-reply gate, the fixture fix and the queue-aware spec; 0005 (cursor) rewrites or retires the 8 pane-dependent UI specs for the one-pane product and investigates 2 baseline failures. The claude renderer-polish task is held, because the host still counts 0001 as running.

Next: When 0001's turn ends, record its review and dispatch the claude renderer polish task: hide the injected assignment in cards, cancel queued workers from their card, gate queued replies, fix the ResizeObserver loop, side-panel rail, previous/next keyboard navigation. Then review 0004 and 0005 and run the full check:ui.

### 2026-10-08T05:58:54.350Z

The orchestrator shell is built and verified: a full-height orchestrator chat, and an unlimited scrolling board of live worker windows with status, provider, elapsed time, Expand/reply, Stop, Report, filters and counts. Host queue and timestamps are in. typecheck clean, 266/266 unit tests. Round 2 is running: 0004 codex (per-task cancel, queued-reply gate, fixture and spec), 0005 cursor (pane-spec rewrite).

Next: Dispatch the claude renderer polish: hide the assignment prompt in cards, cancel queued workers from their card, gate queued replies, fix the ResizeObserver loop, side-panel rail, previous/next navigation. Then review 0004 and 0005 and run the full check:ui.

### 2026-10-08T05:59:13.798Z

The host side of round 2 is done: per-task cancel, the queued-reply guard and the fixture fix are in, and the spec covers the queue (270/270 unit tests). The orchestra-shell desktop spec now fails only on the two known renderer gaps. 0005 cursor (pane-spec rewrite) is still running.

Next: Dispatch the claude renderer polish (cancelTask wiring, ResizeObserver fix, assignment strip, side-panel rail, previous/next navigation), then rerun the orchestra-shell spec and the full check:ui after 0005.

### 2026-10-08T05:59:49.580Z

Review 2: 0006 (claude renderer polish against the orchestra-shell acceptance spec) and 0005 (cursor pane-spec rewrite) are still running. Codex was idle, so I dispatched 0007: a scale/performance eval (tests/ui/orchestra-stress.spec.ts) with 40 controlled workers, measuring long tasks, frame intervals, heap, DOM size, expand latency and journal crashes, to test the 'unlimited workers' claim instead of assuming it.

Next: Review 0005, 0006 and 0007 as they finish. Then rerun the orchestra-shell and orchestra-stress specs and the full check:ui myself, and feed any performance findings back to the renderer worker.

### 2026-10-08T06:14:07.984Z

The 40-worker stress eval is in (tests/ui/orchestra-stress.spec.ts; 272/272 unit tests). It passes functionally but fails the p95 frame budget (50–83ms against <50) because streaming Markdown is re-parsed on every delta. 0006 (renderer polish) and 0005 (pane specs) are still running.

Next: When 0006 lands, dispatch a renderer performance task: coalesce or throttle streaming Markdown parsing (especially in compact cards), use content-visibility for offscreen cards, and avoid re-rendering cards on unrelated deltas. The target is passing orchestra-stress without changing its budgets. Then run the full check:ui.

### 2026-10-08T06:26:03.958Z

Stopping point requested by the user. Delivered in /home/dp/Desktop/rocket-orchestrator: the orchestrator shell (full-height orchestrator chat, unlimited scrolling board of live worker windows with assignment strip, status, timer, Expand/reply with previous/next, Stop including queued cancel, Report, filters, counts, side-panel rail); a host FIFO queue with per-task cancel and queued-reply guard; isolated evals (orchestra-shell 3/3 passing, verified by me; orchestra-stress at 40 workers functionally passes but fails the p95 frame budget because streaming Markdown is re-parsed on every delta). 272/272 unit tests. The pane-spec rewrite (0005, cursor) is draining.

Next: Drain: let 0005 finish and write the final review. Open follow-ups for the next session: the streaming Markdown performance fix to pass orchestra-stress, a full check:ui after 0005, retiring the stale 0001 capture spec, keeping a drafted reply on Esc, user sign-off on the new mockup frames, and a live-provider check.

### 2026-10-08T06:38:14.883Z

Final state at the user's stopping point. Delivered in /home/dp/Desktop/rocket-orchestrator ("Rocket Orchestrator", its own profile): a one-pane orchestrator shell with a full-height orchestrator chat and an unlimited scrolling board of live worker windows (assignment strip, provider, status, timer, Expand with reply and previous/next, Stop including queued cancel, Report, filters, counts, side-panel rail), plus a host FIFO worker queue with per-task cancel and a queued-reply guard. Verified: 272/272 unit tests; full isolated check:ui 56/58, where the only 2 failures are pre-existing fixture defects (empty web-read output) that also fail on the baseline; orchestra-shell 3/3 on my own rerun; orchestra-stress at 40 workers passes functionally but fails the p95 frame budget (50–83ms against <50) from streaming Markdown re-parsing.

Next: Next session, in priority order: (1) a renderer fix for streaming Markdown re-parsing so orchestra-stress passes with its budget unchanged; (2) give the fill and sources fixtures non-empty page text (src/host/ui-test.ts:180, :243) so check:ui is 58/58; (3) keep a drafted reply on Esc, allow file drops on the expanded worker reply, and fix the 'Four chats open' copy; (4) retire the stale task-0001 capture spec; (5) the user's sign-off on the new mockup frames; (6) a live-provider orchestration check, which spends usage, so ask first.

## Work and review history

### Task 0001 — claude — completed

Work ONLY in /home/dp/Desktop/rocket-orchestrator (a copy of Rocket renamed "Rocket Orchestrator"; never edit /home/dp/Desktop/rocketv1). Read its README.md, CLAUDE.md, docs/orchestrator.md, src/renderer/src/App.tsx, pane.ts, store.ts (orchestrator event handling) and src/shared/orchestrator.ts first.

Goal: rebuild the renderer's main layout as an orchestrator app.
1. Mockup first: write docs/mockups/orchestrator-shell.html (static HTML/CSS matching the app's existing styles.css look) showing: title strip on top; LEFT a full-height orchestrator chat column (transcript + composer, ~40% width, min 420px, resizable divider); RIGHT a worker board: an unlimited, vertically scrollable responsive grid of smaller worker chat windows (cards ~360px min width, auto-fill columns), each with header (provider glyph, status dot running/done/failed/interrupted, short task title, elapsed time), a live-scrolling compact transcript, and footer actions (Expand, Stop, Open report). Board header shows run status, counts (running/done/failed) and a filter (All/Running/Done). Empty board state when no run. Screenshot it with a deterministic tool (e.g. npx playwright screenshot or electron capture) to verify it renders.
2. Implement it: a new OrchestratorShell in the renderer that replaces ChatCard as the default layout. Orchestrator chat = pane 0's chat (the chat owning the active orchestration if one exists, else the focused chat/new chat). Worker windows come from the Orchestration run's tasks (chatId per task) received through the existing 'orchestrator' event / 'orchestrator.list' call. Render each worker's real transcript read-only using ShownChatContext (see pane.ts) with a compact CSS variant; make sure worker chat views are loaded (look at how the store loads a chat's view and request it for worker chats). Expand opens a worker in a large overlay with its own composer so the user can reply; Stop requests cancellation of that one chat's turn via the existing stop path; Open report opens the report file in the artifact panel. Unlimited workers: no cap, board scrolls, older finished workers sorted after running ones.
DOM contract (a separate test worker relies on it, keep exactly): root `.orch-shell`; left `[data-testid="orchestrator-chat"]`; right `[data-testid="worker-board"]`; each worker `[data-testid="worker-window"]` with attributes `data-chat-id` and `data-status` (running|done|failed|interrupted|cancelled — mirror the run task status values); buttons with aria-label "Expand worker", "Stop worker", "Open report"; expanded overlay `[data-testid="worker-expanded"]` with a textbox; board empty state `[data-testid="worker-board-empty"]`.
Keep the app-map rule in CLAUDE.md: add places/actions to src/shared/app-map.ts + dispatcher for worker.expand / worker.collapse so models can drive it. Style per CLAUDE.md (no semicolons, single quotes, .ts imports). Run `npm run typecheck` and `npm test` in that folder and fix failures you caused; existing UI specs in tests/ui that assume the old pane card may break — note which, don't delete them. Then run `npm run build` and capture the real app with controlled data if feasible (`ROCKET_USER_DATA=<tmp dir>` + `ROCKET_CAPTURE`, see README) — do not touch real chats.
Write your report with: files changed, screenshots paths, test results (exact counts), known gaps.

Chat: 07016fb9-ac4d-4e49-9427-e91a8e7260f9

Report: [task-0001-claude.md](/home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0001-claude.md)

Outcome: That notice is only the leftover UI-suite watch expiring. The suite had already finished and every failure is in the report, so I'm not re-arming it. No checks are still running, and the report is complete at `/home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0001-claude.md`.

Review: Accepted, and the layout works in the real app. I read the report and inspected its real-app captures (02 streaming: 3 running and 1 queued with live transcripts; 04: expanded worker with its reply box over the board, orchestrator still visible; 07: 8 workers scrolled, with done/failed/cancelled cards, head counts and Report enabled when a report exists). They match the mockup and the DOM contract. My own verification in the new folder: typecheck clean, npm test 266/266. check:ui --grep orchestra-shell: 1 passed and 2 failed, both at spec line 64 (it expects the fourth dispatch to be rejected, but the host now queues it), which matches the report's analysis; that is the spec's stale assumption, not a layout bug. Open items: (1) compact cards show the whole injected '<rocket-orchestration>' assignment as the user bubble; (2) MAX_PANES=1 breaks 8 pane specs. Decision: one pane is the product, so the specs get rewritten (0005); (3) the board is crushed to about 190px with a side panel open; (4) queued workers can't be stopped individually; (5) a renderer journal entry 'ResizeObserver loop completed with undelivered notifications' appears during runs; (6) fill.spec and sources.spec also fail on the baseline.

### Task 0002 — codex — completed

Work ONLY in /home/dp/Desktop/rocket-orchestrator (a copy of Rocket renamed "Rocket Orchestrator"; never edit /home/dp/Desktop/rocketv1). Another worker is concurrently rebuilding the renderer layout there (App.tsx, new OrchestratorShell component, styles) — do NOT edit src/renderer files. Your job: the isolated UI eval for the new orchestrator layout.
Read README.md (UI check section), CLAUDE.md, docs/orchestrator.md, tests/ui/app.ts, tests/ui/orchestrator.spec.ts, scripts/ui-check.mjs and how controlled providers script responses (src/host/ui-test.ts).
Write tests/ui/orchestra-shell.spec.ts using controlled providers (no real model turns) that: (a) starts the app with a fresh profile and asserts `.orch-shell`, `[data-testid="orchestrator-chat"]` and `[data-testid="worker-board-empty"]` are visible and the orchestrator chat column spans the full height under the title strip (boundingBox check); (b) drives an orchestration where the controlled orchestrator chat calls the orchestrator tool to start and dispatch at least 4 workers (more than the 3-concurrency limit, so some queue — check how dispatch limits behave and assert accordingly), then asserts one `[data-testid="worker-window"]` per worker with `data-chat-id` and `data-status` attributes, that running workers show streaming transcript text from their controlled replies, that status flips to done when they finish; (c) clicks aria-label "Expand worker" and asserts `[data-testid="worker-expanded"]` with a textbox, sends a reply and sees it in the worker transcript; (d) "Stop worker" on a running worker leads to a non-running status; (e) "Open report" shows the report in the artifact panel; (f) with 8+ workers the board scrolls (scrollHeight > clientHeight) and the orchestrator column width is unchanged. Save screenshots to the test's artifact folder at each step. If the controlled-provider harness lacks what's needed to script an orchestrator dispatching workers, extend src/host/ui-test.ts (host side, allowed) minimally and add unit tests beside it.
Also add an eval-scenario entry if the repo's evals/ scenarios support a UI-layout scenario cheaply; otherwise skip and say why.
Run `npm run typecheck` and `npm test`. The layout may not exist yet when you finish; run `npm run check:ui -- --grep orchestra-shell` (check the actual flag syntax in scripts/ui-check.mjs) anyway and report which assertions fail because the layout is not yet there vs. harness problems. Report: files changed, exact commands and results, and the DOM contract you relied on.

Chat: 14756ee7-256f-4e66-9928-6529032bc7f5

Report: [task-0002-codex.md](/home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0002-codex.md)

Outcome: [Report and evidence](/home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0002-codex.md) saved.

Typecheck and 258 unit tests passed. The controlled desktop harness verified eight workers and reports. Layout tests remain blocked by missing `.orch-shell`; a concurrent app-map change also failed the later unit gate.

The report documents the DOM contract and unverified UI behavior. Overflow dispatch is rejected, not queued.

Review: Accepted with caveats. I read the report and confirmed in the folder that the files it names exist and are modified: tests/ui/orchestra-shell.spec.ts, src/host/ui-test.ts, src/host/ui-test.test.ts, the eval CSV row and the README. Its harness evidence (eight workers delivering reports in reviewed batches, and the fourth concurrent dispatch rejected with "Three workers are already running") matches the host code I read. The layout assertions were never reached, because the renderer shell did not exist when it ran, so the layout is unverified, not failing. Contract mismatches to fix: (1) the spec expects data-status="done", but OrchestratorTask.status in src/shared/orchestrator.ts is running|completed|failed|interrupted, and 0001 was told to mirror the host values, so the spec must use "completed"; (2) the "Close expanded worker" label is the spec's own invention and must match whatever 0001 builds. Gap the report found: the host refuses dispatch beyond 3 workers or a second worker on the same provider instead of queueing it, which limits the "unlimited workers" goal. OrchestratorTask also has no start or end timestamps, so the mockup's elapsed time cannot be shown truthfully.

### Task 0003 — codex — completed

Work ONLY in /home/dp/Desktop/rocket-orchestrator (never edit /home/dp/Desktop/rocketv1 source). A Claude worker is concurrently editing src/renderer/** and src/shared/app-map.ts there — do NOT edit those. You own src/host/orchestrator.ts, src/host/tools/orchestrator.ts, src/shared/orchestrator.ts, their tests, and docs/orchestrator.md in that folder.
Goal: make the orchestrator able to fan out an unlimited number of workers, and give the UI timing data.
1. Add `createdAt: number`, `startedAt: number | null`, `endedAt: number | null` to OrchestratorTask; backfill sensible values when loading older orchestrator.json state (no crash on missing fields).
2. Dispatch queue: instead of rejecting a dispatch when three workers are running or the provider already has a running worker in this run, accept it as a task with new status 'queued' (no chat created yet, or chat created but turn not started — pick whichever keeps the hub/store contract cleanest and explain), and start it automatically, FIFO per provider, when a slot frees (worker finishes/fails/interrupted). Keep the Antigravity shared-identity rule. Keep the 'review before more dispatch' rule but think it through: queued tasks were already approved by the orchestrator at dispatch time, so starting them from the queue must not require a new review; new dispatch calls still obey the review gate. Stop with drain=false cancels queued tasks (status 'interrupted' or a new 'cancelled' — choose, document); drain=true lets queued ones run? Decide the least surprising behavior (I suggest: drain=true does NOT start queued tasks, marks them cancelled) and document it. Host restart: queued tasks stay queued while the run is paused and start on resume.
3. Broadcast the orchestrator event on every queue transition so the UI updates. Update the progress.md rendering to show queued tasks.
4. Update the status union in src/shared/orchestrator.ts; grep src/renderer for places that switch on task status and LIST them in your report (don't edit them — the renderer worker will).
5. Unit tests in src/host/orchestrator.test.ts for: queueing beyond 3, per-provider FIFO, auto-start on completion, drain/stop behavior with queued tasks, restart persistence, backfill of old state.
Run `npm run typecheck` and `npm test` (exact counts in report). Update docs/orchestrator.md. Report: design decisions, files, test output, and the renderer touch-points list.

Chat: a5e5df78-fe6c-44d2-91df-0592a622bdc8

Report: [task-0003-codex.md](/home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0003-codex.md)

Outcome: Implemented persisted FIFO queueing, task timestamps, cancellation/drain behavior, and legacy-state backfill.

Typecheck passed; all 266 unit tests passed.

[Report and evidence](/home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0003-codex.md)

Remaining renderer questions: queued-worker replies, individual queue cancellation, and filter behavior. Desktop integration remains unverified; host changes require a restart.

Review: Accepted. I reran src/host/orchestrator.test.ts myself: 18 of 18 pass, covering 30 queued workers beyond the running cap, per-provider FIFO, auto-start without re-review, stop/drain cancelling queued tasks, restart keeping queued work paused, legacy timestamp backfill and Antigravity waiting. src/shared/orchestrator.ts now has queued and cancelled statuses plus timestamps. The design is sound: every queued task gets an ordinary chat immediately with turnId null, so the UI can render a window for it before it starts. The report's own open gaps: (a) no host action cancels one queued task, so Stop on a queued card is disabled; (b) replying to a queued worker from the expanded view could start provider work outside the queue. Its renderer touch-point list says the renderer worker already maps completed to done and handles queued, so the spec's 'done' value is consistent with the renderer after all. Not yet verified: desktop integration, because check:ui was not run.

### Task 0004 — codex — completed

Work ONLY in /home/dp/Desktop/rocket-orchestrator (never edit /home/dp/Desktop/rocketv1 source). Concurrent workers: Claude owns src/renderer/**; Cursor owns tests/ui/*.spec.ts EXCEPT orchestra-shell.spec.ts. You own: src/host/**, src/shared/orchestrator.ts, src/shared/types.ts (request additions only), tests/ui/orchestra-shell.spec.ts, docs/orchestrator.md.
Context: current state verified by the orchestrator — typecheck clean, npm test 266/266; `npm run check:ui -- --grep orchestra-shell` → 1 passed, 2 failed, both at tests/ui/orchestra-shell.spec.ts:64 `expect(fixture.results[4].isError).toBe(true)` because the host now QUEUES a 4th dispatch instead of rejecting it. Also the renderer shell maps task 'completed' → data-status 'done', passes running/failed/interrupted/cancelled/queued through, and shows a user-stopped interrupted worker as 'cancelled'. Expanded overlay has 'Close expanded worker' button, 'Message' textbox, 'Send'.
Tasks:
1. Host API to cancel ONE task: add request `'orchestrator.cancelTask': [{ runId: string; taskId: string }, Orchestration]` to the request map in src/shared/types.ts (exact name — the renderer worker is coding against it), handled in src/host (index.ts wiring + orchestrator.ts method). Queued task → status 'cancelled', endedAt set, never starts. Running task → request cancellation via the existing worker-cancel path (same as stop drain=false for one task); status follows the real turn end. Finished → no-op error with a full-sentence message. Broadcast + persist + progress.md. Unit tests.
2. Gate replies: if the user sends a message into a queued worker's chat before it starts, the host must not start a provider turn outside the queue — decide: reject with a clear error ("This worker is waiting in the queue; it starts when a slot frees. Cancel it or wait.") — and unit-test it. Find where user messages enter (hub/index) and check run task status.
3. Fixture fix in src/host/ui-test.ts: the reply-detection checks `request.text.includes('<rocket-orchestration>')`, but teamwork context quotes other workers' assignments, so a user reply into a worker chat is mistaken for a held worker stream. Match on the message's own content (e.g. the user message text / first line) instead. Unit test.
4. Update orchestra-shell.spec.ts for queue semantics: dispatch 5+ workers at once, assert 3 running + rest data-status="queued" windows exist immediately (one window per accepted dispatch), queued ones transition to running then done as slots free, cancel a queued worker via its 'Stop worker' button (the renderer will call orchestrator.cancelTask for queued workers) → data-status="cancelled" and it never streams; keep expand/reply (expect 'Good evening.'), stop running, report, 8+ scroll, column width stable. Also fail the test if the journal records a renderer 'crash' entry (there is currently a 'ResizeObserver loop completed with undelivered notifications' one — the renderer worker is fixing it; if it is benign per spec, filter only that exact message and say so).
Run npm run typecheck, npm test, and `npm run check:ui -- --grep orchestra-shell` at the end (renderer edits may land concurrently — if a failure is due to a missing renderer piece, say exactly which). Report: files, exact commands + counts, remaining failures with cause.

Chat: 353b1ac6-dccc-4369-93b3-cbe8feaf6972

Report: [task-0004-codex.md](/home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0004-codex.md)

Outcome: Implemented cancellation, queued-reply protection, fixture fix, and updated shell checks.

Typecheck passed; unit tests **270/270**. UI checks: **1 passed, 2 failed**, blocked by disabled queued Stop and the renderer’s ResizeObserver error.

[Report and remaining verification](/home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0004-codex.md). No user clarification needed.

Review: Accepted. I confirmed in source that 'orchestrator.cancelTask' is in src/shared/types.ts:419, wired in host/index.ts:357 and implemented in orchestrator.ts:215, with unit tests covering the queued, running, finished and invalid cases (orchestrator.test.ts:429-464). Reported unit results: 270/270. The fixture now matches the orchestration marker only on its own line, which fixes the 'teamwork context quoted the marker' misdetection that 0001 diagnosed. The spec now asserts the queue (6 accepted: 3 running, 3 queued) and fails on any renderer journal crash entry, deliberately not filtering the ResizeObserver message, which is the right call. Its two remaining UI failures are exactly the renderer gaps the next claude task covers: the queued Stop is disabled and not wired to cancelTask (OrchestratorShell.tsx:75, store.ts:1268), and the ResizeObserver journal entry. Not yet verified: expand/reply, running stop and nine-window scroll in the interaction scenario, which were unreachable behind the queued-Stop click.

### Task 0005 — cursor — completed

Work ONLY in /home/dp/Desktop/rocket-orchestrator (never edit /home/dp/Desktop/rocketv1 source). You own tests/ui/*.spec.ts EXCEPT tests/ui/orchestra-shell.spec.ts (Codex owns it) — do not edit src/renderer/** (Claude owns it) or src/host/** (Codex). Context: this app is a fork of Rocket whose renderer is now an orchestrator shell: one full-height orchestrator chat (pane 0) + a worker board; MAX_PANES = 1 so `pane.add` is refused by design (product decision: one pane is final). Eight existing isolated UI specs fail because they add a second pane: app-map.spec.ts:9, images.spec.ts:67, images.spec.ts:162, panes.spec.ts:6, tool-failure-pane.spec.ts:6, ui-live.spec.ts:5, eval-tools.spec.ts:5, tool-failure-loop.spec.ts:6 (the last two use a second pane to set up an AMBIGUOUS_TARGET case). Two more fail on the untouched baseline too: fill.spec.ts:8 (chip count), sources.spec.ts:5 (is-opened) — evidence: /home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0001-evidence/full-ui.log and baseline-ui.log.
Task: for each of the 8 pane specs, read what feature it really protects. Rewrite it to test that feature in the one-pane shell (e.g. images: drag/copy between the orchestrator chat and an expanded worker's composer instead of two panes; app-map: assert pane.add is refused with a clear message and that worker.expand/worker.collapse exist and work; panes.spec: replace with one-pane invariants — no 'add a chat beside' button, history switching changes the left chat). For the AMBIGUOUS_TARGET specs, find another honest way to create two chats on the same provider with live tool connections (worker chats on the board are real chats — maybe use those) or, if impossible without panes, mark them test.skip with a precise reason comment and explain in the report. Investigate the 2 baseline failures (fill chip count, sources is-opened) — fix the spec if it's a stale expectation; if it's a real app bug, describe the bug precisely (file:line) instead of masking it. Run each spec you touch via `npm run check:ui -- <spec file or --grep>` (check scripts/ui-check.mjs for syntax; use ROCKET_UI_SKIP_UNIT=1 to save time), and finally the whole `npm run check:ui`. Note that Claude and Codex are concurrently changing the renderer/host — if a failure is in their area, report it rather than changing their files. Report: per-spec decision, files, exact pass/fail counts, artifact folders.

Chat: 74487208-f8ef-4f73-849b-ecf85b6a3c73

Report: [task-0005-cursor.md](/home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0005-cursor.md)

Outcome: The eight pane specs now test the one-pane shell, and the full isolated suite is 56 passed and 2 failed.

`npm run check:ui` in `/home/dp/Desktop/rocket-orchestrator` ran 272 unit tests (all passed) and 58 desktop tests. The only failures are the two baseline cases that were already failing before this work: the fill chip stays at 0, and the auth-docs link stays `is-unopened`. Both specs still expect the product behavior. The fixture emits those web reads with empty output (`src/host/ui-test.ts:180` and `:243`), and the host drops an empty read (`src/host/hub.ts:712-715`, `src/shared/web-evidence.ts:5`).

The pane tests now use the single orchestrator chat and a worker on the board. `pane.add` is refused with `There are already 1 panes, the most the card holds.` Two Message boxes, for the ambiguous-target cases, come from the orchestrator composer and an expanded worker. No spec was skipped.

Report: `/home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0005-cursor.md`

Full-run artifacts: `/home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T06-28-19-414Z-iYX3po`

Still open: the host fixture needs non-empty page text for those two tools; the expanded worker reply does not accept a file drop; the copy picker still says "Four chats open" while the product allows one pane.

Review: Accepted. I checked the evidence directly. task-0005-evidence/full-ui.log ends with '56 passed (7.7m)' and '2 failed': fill.spec.ts:8 and sources.spec.ts:5, the same two that fail on the untouched baseline. No test.skip exists in tests/ui/*.spec.ts, so no spec was masked. I confirmed the stated root cause in source: the fixture emits its web read with output '' (src/host/ui-test.ts:180-181), and the host marks an empty web read as failed rather than opened (hub.ts:712-715, webReadProblem). The two specs still describe the correct product behavior; the fixture is what's stale. That is a test-harness defect, not an app bug, and the fix is non-empty fixture page text. The rewritten pane specs test the one-pane product honestly: pane.add is refused, and the ambiguous-target cases use the orchestrator composer plus an expanded worker. Open items it found: the expanded worker reply doesn't accept file drops; the copy picker still says 'Four chats open'.

### Task 0006 — claude — completed

Work ONLY in /home/dp/Desktop/rocket-orchestrator (never edit /home/dp/Desktop/rocketv1 source). You own src/renderer/** and src/shared/app-map.ts. Concurrent: Cursor owns tests/ui/*.spec.ts except orchestra-shell.spec.ts. Don't edit src/host/** or tests/ui/orchestra-shell.spec.ts (the acceptance test you must make pass). Read first: the shell's build report /home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0001-claude.md and host report task-0004-codex.md (same folder).
Current state (verified): typecheck clean; npm test 270/270; `npm run check:ui -- --grep orchestra-shell` → 1 passed, 2 failed, ONLY because of renderer gaps: (a) queued worker 'Stop worker' is disabled (OrchestratorShell.tsx ~:75 enables only for running) and store.ts stopWorker (~:1268) only calls chat.stop — it must call the new host request `'orchestrator.cancelTask'` `{ runId, taskId }` (exists in src/shared/types.ts:419) for queued workers (running keep chat.stop or use cancelTask — pick the one that keeps the run's bookkeeping right, explain); (b) the journal records a renderer 'crash' entry 'ResizeObserver loop completed with undelivered notifications.' and the spec fails on ANY renderer crash entry — find the observer causing it (likely transcript auto-scroll/size observers across many compact cards) and remove the loop (rAF-defer, no layout writes in the callback) — don't filter it.
Then refinements:
1. Compact cards show the whole injected `<rocket-orchestration>` assignment as the first user bubble. Replace it in compact cards with a one-line 'Assignment' strip (task first line; title tooltip with full text); in the expanded view collapse it behind 'Show assignment'. Detect robustly (worker's first user turn, compare to run task text).
2. Hide the duplicate 'Thinking · Working for Ns' head row in compact cards. Queued cards: 'Waiting for a free <Provider> slot · #N in queue'. Queued workers' reply composer disabled: 'Waiting in the queue — starts when a slot frees' (host also rejects such replies).
3. Side panels: with browser/artifact/library/evals open the board is crushed to ~190px. When a side panel is open: orchestrator column min 340px; board single-column min 300px; if still too narrow, collapse the board to a slim vertical rail (status dots + counts) that expands as an overlay over the board area on click — never move/resize the browser page.
4. Expanded view: Esc closes; ←/→ and buttons aria-label 'Previous worker'/'Next worker' move between workers; add 'worker.next'/'worker.previous' map actions if cheap. Card hover/focus states and running-card tint per the mockup.
Keep the DOM contract. Verify: npm run typecheck, npm test, then `npm run check:ui -- --grep orchestra-shell` must pass 3/3 (report exact counts + artifact dir), then capture the real app with the board-capture spec (.artifacts/board-capture) at 1440x960 and at 1360x860 with the browser panel open and inspect the images yourself. Report: files, exact counts, capture paths, remaining gaps.

Chat: 697dfd1f-6d58-4fbb-ae6f-da9b1606ed26

Report: [task-0006-claude.md](/home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0006-claude.md)

Outcome: Both blockers are fixed and the acceptance check passes: `npm run check:ui -- --grep orchestra-shell` gives **3 passed, 0 failed**, and **9 of 9** with `--repeat-each=3`, with no renderer crash entries in the journal. `npm run typecheck` is clean and `npm test` passes **272 of 272**.

**Stop on queued workers.** Stop is now enabled for queued workers and calls `orchestrator.cancelTask`. Running workers use `cancelTask` too, rather than `chat.stop`: the host checks the task belongs to the run, records that the user asked for the stop, and records a stop that fails. The worker reads "cancelled" once its provider's turn really ends. A finished worker that is running a reply still uses `chat.stop`, because that turn belongs to the chat and `cancelTask` refuses finished tasks.

**ResizeObserver loop.** The cause was the transcript's scroll observer (`Transcript.tsx`). Inside its callback it set the "fill" height of the newest turn. That resized the content, a scrollbar appeared and narrowed the view, and the browser reported a loop. The callback now only scrolls, and the height update waits for the next frame. Compact worker cards also no longer use the fill layout. I didn't reproduce the error on the old build myself; the evidence is the clean repeated runs, and I can't say how much each of the two changes contributes.

**Refinements, all built:**
- **Assignment:** compact cards show a one-line "Assignment" strip with the full text as a tooltip. The expanded view folds it behind "Show assignment", and the toggle stays pinned at the top once opened.
- **Queue:** cards with no turn yet use the task text for the strip. Queued cards read "Waiting for a free Claude slot · #N in queue", and their reply box is disabled with "Waiting in the queue — starts when a slot frees". Compact cards no longer show the duplicate "Working for" row.
- **Side panels:** the orchestrator column's minimum drops to 340px and the board's to 300px, in one column. If that still doesn't fit, the board folds to a slim rail of status counts; clicking it opens the board over the orchestrator column. At 1360×860 with the browser open, the browser page's position and size are identical before and after opening it.
- **Expanded view:** Esc closes it. ←/→ and new "Previous worker"/"Next worker" buttons move between workers, also when the reply box is focused but empty. I added `worker.next` / `worker.previous` map actions.
- **Card states:** hover, focus ring, and a faint tint on running cards.
- **Narrow composer fix:** at 340px the orchestrator composer overlapped its model picker and Stop button, so the folder chip now shrinks to its icon.

I also added two frames to the mockup and updated the README. The user hasn't agreed to those mockup frames.

**Captures:** I inspected them at 1440×960 and at 1360×860 with the browser open; they're in `task-0006-evidence/captures/` from a new capture spec, which passed 1/1.

**Remaining gaps:**
- The original task-0001 capture spec now fails at its line 83. It waits for zero running workers, but with the host queue each released worker starts a queued one. Every renderer step before that line passed.
- When the opened assignment is short, the view can still settle near the bottom; the pinned toggle keeps it usable.
- Esc throws away a drafted reply in the expanded view (it already did before).
- I didn't rerun the full UI suite or check against real providers.

**Questions for the orchestrator:**
1. Is it right for the rail's board to open over the orchestrator column, rather than shrinking the side panel?
2. Should the new mockup frames go to the user for agreement before more visual work?
3. Should the old task-0001 capture spec be retired or rewritten for the queue?

Report: `/home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0006-claude.md`

Review: Accepted. My own run of `npm run check:ui -- --grep orchestra-shell`: build ok, 272/272 unit tests, desktop 3 passed and 0 failed (artifacts at .artifacts/ui/2026-10-08T06-23-46-304Z-VXOcF2). The worker also reported 9/9 with --repeat-each=3. Because that spec fails on any renderer journal crash, the ResizeObserver loop fix is confirmed by the passing run. I inspected the captures. 01 (1440): Assignment strips replace the injected prompt, queued cards read 'Waiting for a free <Provider> slot · #1 in queue', the board head shows 3 running and 3 queued, and Stop is enabled on queued cards. 06 (1360 with browser): the board folds to a rail, opens as an overlay over the orchestrator column, and the browser page is not resized. Open items: the old task-0001 capture spec is stale under the queue; Esc discards a drafted reply in the expanded view; the rail overlays the orchestrator column (an acceptable choice, noted for the user); and there is still no full-suite or live-provider check.

### Task 0007 — codex — completed

Work ONLY in /home/dp/Desktop/rocket-orchestrator (never edit /home/dp/Desktop/rocketv1 source). Concurrent: Claude owns src/renderer/** (polishing the worker board right now); Cursor owns tests/ui/*.spec.ts except orchestra-shell.spec.ts and your new file. You own: src/host/ui-test.ts (+ its test), and a NEW file tests/ui/orchestra-stress.spec.ts. Don't edit renderer files.
Goal: prove the 'unlimited workers' claim holds up — a scale/performance eval of the worker board with controlled providers.
1. Extend the controlled fixture so one orchestrator run accepts 40 dispatches across the providers (most queued), workers stream controlled text continuously for a while (e.g. many small deltas over ~5–10s each, enough to stress rendering), then finish with reports; keep it deterministic and fast enough for CI (< ~90s total).
2. tests/ui/orchestra-stress.spec.ts: fresh profile; start the run; assert 40 [data-testid="worker-window"] eventually exist with correct data-status mix over time (3 running max at once, rest queued → done). Measure in the renderer via page.evaluate + PerformanceObserver('longtask') and requestAnimationFrame sampling while 3 workers stream and 37 cards exist: record long-task count/total ms, p95 frame interval, JS heap (performance.memory if available), DOM node count. Assert sane budgets (propose numbers from a first measurement, e.g. p95 frame < 50ms, no long task > 200ms, expand click → [data-testid="worker-expanded"] visible < 500ms, board scroll to bottom keeps last card in view). Also assert no renderer journal 'crash' entries. Save the metrics as a JSON attachment + screenshots at start/mid/end.
3. If budgets fail, DON'T change the renderer — report precisely what's slow (which component re-renders, from a Performance trace / React profiling if feasible) so the renderer worker can fix it, and set the budget assertions to the measured failing values only if I should see them pass? No: leave them failing and report.
Run npm run typecheck, npm test, and `npm run check:ui -- --grep orchestra-stress` (the renderer may be changing concurrently; if a failure is clearly from a half-landed renderer change, rerun once later). Report: files, fixture design, measured metrics table, pass/fail with exact counts, artifact dir, and concrete performance findings for the renderer.

Chat: 74234abb-f522-4271-ba80-6c5bc3176936

Report: [task-0007-codex.md](/home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0007-codex.md)

Outcome: [Report and evidence](/home/dp/Desktop/rocketv1/docs/orchestrator/eed6b5da-f4a3-4207-9b9e-5ce76de373ff/task-0007-codex.md) saved.

40 workers completed with reports; typecheck and 272 tests pass. Stress check takes 83.6 seconds but fails the unchanged frame budget: p95 **50 ms**, required **<50 ms**. Remaining investigation: repeated Markdown parsing and unattributed native CPU time.

Review: Accepted, and the failing budget is a real finding. I read the report and final-spec/stress-metrics.json myself. At 40 workers the board works functionally: 3 running and 37 queued at the start, 40 done and 40 reports at the end, the last card in view after scrolling, expand latency 40ms, max long task 0ms, no journal crashes. The frame budget fails: p95 is 50.0ms against <50 in the final run, and 83.4ms in the standard run with 11 long tasks. The raw frame list shows intervals quantized to 16.7/33.3/50/66.7ms, i.e. regular dropped frames while 3 workers stream. The CPU profile attributes about 925ms of a 4.2s window to ChatMarkdown re-parsing the whole growing text on every delta (ChatMarkdown.tsx caches only settled text). That is a concrete, plausible cause, and the renderer owner should fix it. The budget was not loosened, which is correct. Caveats: it was measured under xvfb software rendering with renderer edits landing concurrently, there is about 2.5s of unattributed (program) time, and 40 workers is a tested scale, not a proof of unbounded scaling.

---

The orchestrator maintains the sections above. Edit the User notes section below to steer it; those notes are preserved. Stop from the owning chat to prevent further dispatch.

<!-- rocket-orchestrator:user-notes -->
## User notes

Edit this section to steer the next review, or message the orchestrator chat.
