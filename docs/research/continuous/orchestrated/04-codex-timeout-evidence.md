# Evaluation timeout cleanup

A controlled-provider experiment on 2026-10-08 confirms that an evaluation can finish with an error while its provider turn remains running. The reproduction uses the actual `Hub`, `Store`, and `EvalRuns`, with an in-memory transcript and a held fake adapter. It does not launch a CLI or touch the live app.

Run `node --experimental-transform-types docs/research/continuous/orchestrated/evidence-02-codex/eval-timeout.mjs`. Results are in `evidence-02-codex/eval-timeout.json`.

The fixture sets the cell deadline to 20 ms and never completes the fake provider until cleanup. Observed results:

- The evaluation run is `done`; its cell is `error`.
- One provider turn remains running.
- The adapter's stop method has not been called.
- Calling `EvalRuns.stop` on that finished run still leaves one running turn and zero stop calls.

The path is explicit in source. `Hub.waitForTurn` drops the waiter and rejects when its timer expires (`src/host/hub.ts:129`). `finishEvalCell` never reaches export after that rejection (`src/host/eval-run-cell.ts:93`). `EvalRuns.runCell` records an error, and the enclosing executor ends the run (`src/host/eval-runs.ts:144`, `:105`). `EvalRuns.stop` returns early for any run whose status is no longer `running` (`:89`). None of these timeout paths invokes the adapter's stop method.

This proves the lifecycle behavior under a controlled adapter. It does not measure how often a real provider exceeds the default 15-minute deadline. A provider can also legitimately need more than 15 minutes; cancellation policy should be explicit rather than silently inferred from a waiting timeout.

A useful regression would require the cell owner to reconcile its active turn on timeout, record cancellation outcome, and retain a stop path until work has actually ended. If a stop notification is ignored, escalation must be scoped to the affected provider session; killing a shared provider process could interrupt unrelated chats. The live loop should also distinguish transport completion from a finished research artifact: one observed Cursor turn here ended in assistant text reporting a PING timeout, despite the transcript status being completed.

For a multi-trial run, an unresolved timed-out provider may also keep later trials waiting in the provider-busy loop. That extension is supported by code inspection but was not exercised in this single-trial fixture. It is an appropriate next independent check.
