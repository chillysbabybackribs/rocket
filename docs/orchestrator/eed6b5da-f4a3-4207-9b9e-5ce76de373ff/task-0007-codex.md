# Task 0007 — Forty-worker scale and performance evaluation

The board accepts and retains 40 workers, starts at **3 running / 37 queued**, drains to **40 done**, and delivers **40 reports**. The performance evaluation remains **failing**: the final p95 frame interval is **50.0 ms**, against the unchanged strict **<50 ms** budget. Maximum long-task duration, expansion responsiveness, scrolling, queue concurrency, report delivery and crash checks pass. No renderer files were changed.

Changes are confined to `/home/dp/Desktop/rocket-orchestrator/src/host/ui-test.ts`, its existing `ui-test.test.ts`, and the new `tests/ui/orchestra-stress.spec.ts`. This report and its evidence are the only writes in rocketv1. Other workers' files and the orchestrator progress file were left alone; the running Rocket app was not restarted or closed.

The `UI check: orchestra-stress` leader makes one real orchestrator `start` call followed by 40 sequential `dispatch` calls through the existing local HTTP tool boundary. Workers rotate Claude / Cursor / Antigravity (14 / 13 / 13); the real host supplies the capacity limit and queue. Active workers emit an initial prefix, then wait on the shared `ui-stress-ready` file. The test opens that barrier after all 40 cards have mounted. Each worker emits **100 deltas, paced at 50 ms**, followed by a completion/report message and a real report file in the isolated workspace. Cancellation interrupts the barrier or streaming timer and delivers no report. The leader stays held for up to 100 seconds, preventing automatic review turns from interfering with the scale test. Normal six-worker fixtures retain their existing behavior.

The test uses the existing fresh, marked Electron profile and controlled provider boundary. It verifies 41 successful tool responses, the initial status mix, three distinct active providers, all reports, and every sampled status mix. Its 100 ms renderer sampler records **745 samples**, all with 40 cards and at most three running workers; mixed running/queued/done states occur before the final 0/0/40 state. The orchestrator tool deliberately returns only the last 12 pending tasks, so complete host assertions read the actual isolated `orchestrator.json` after successful tool calls. The fixture records the actual leader provider instead of assuming Codex.

Performance measurements run in the renderer with `PerformanceObserver('longtask')` and `requestAnimationFrame`. The initial four-second window retains all 40 cards with 3 streaming / 37 queued. A CDP CPU sample covers the same window. Expansion uses a real Playwright click, with renderer event-to-visible latency measured separately from Playwright actionability and transport overhead. The board is scrolled to the bottom during the run and after completion; its last card is in the viewport on both checks. Start, mid and end screenshots are attached, along with metrics JSON and the CPU profile. Journal crash entries are checked independently after the test.

| Metric | Initial baseline, full DOM tracing | Standard command rerun | Final spec, renderer screenshots | Budget / result |
|---|---:|---:|---:|---|
| Sample duration | 4,220.7 ms | 4,314.0 ms | 4,231.0 ms | Initial full-queue streaming window |
| Frame samples | 141 | 110 | 155 | >30: pass |
| p95 frame interval | 50.0 ms | 83.4 ms | **50.0 ms** | **<50 ms: fail in all three** |
| Maximum frame interval | 83.4 ms | 116.7 ms | 66.7 ms | Recorded |
| Long-task count | 0 | 11 | 0 | Recorded |
| Long-task total | 0 ms | 651 ms | 0 ms | Recorded |
| Maximum long task | 0 ms | 75 ms | 0 ms | <200 ms: pass |
| Expand click event → visible | 50.9 ms | 56.8 ms | **40.1 ms** | <500 ms: pass |
| Playwright click call → visibility assertion | 801 ms | 529 ms | 399 ms | Recorded separately |
| Used JS heap | 31.2 MB | 19.3 MB | 24.5 MB | Recorded, decimal MB |
| DOM elements during sample | 1,700 | 1,775 | 1,775 | Recorded |
| DOM elements after completion | 3,058 | 2,038 | 2,173 | Recorded |
| Completed workers / delivered reports | 40 / 40 | 40 / 40 | **40 / 40** | Pass |
| Journal crash entries | 0 | 0 | **0** | Pass |

Final board scroll height is **6,261 px** against **811 px** visible height. The final test takes **83.606 seconds**, and the desktop runner takes **85.573 seconds**, meeting the approximate 90-second scenario target. The earlier test took 93.601 seconds. The final spec uses dedicated renderer screenshots for its three checkpoints instead of the fixture's slower native composite captures. Continuous DOM/screenshot tracing is disabled for this performance workload; API/source tracing, dedicated screenshots and CPU profiling remain. This changes instrumentation, not thresholds or renderer code. The timing spread across runs does not establish a single cause, since renderer edits and other system activity were concurrent.

Long tasks measure main-thread tasks of at least 50 ms; frame delays can therefore fail this budget even with zero recorded long tasks. See the opened [MDN long-task reference](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming). Heap readings use the available Chromium `performance.memory` API and are estimates, not process memory or evidence of a leak; see the opened [MDN memory reference](https://developer.mozilla.org/en-US/docs/Web/API/Performance/memory).

The concrete renderer finding is repeated Markdown parsing in the streaming reply. The final **4,200.6 ms CPU profile** attributes **926.5 ms inclusive** to `ChatMarkdown`, **923.7 ms** to its nested `Markdown` call, and **797.3 ms** to nested `parse` work. These inclusive times overlap and must not be summed. The standard command's profile similarly attributes 965.9 ms to `ChatMarkdown` and 849.5 ms to parsing. The initial profile shows 958.3 ms / 849.4 ms respectively. Thus the recurring parsing cost is present across all three measurements.

Source inspection explains the sampled render stack: `store.ts` handles a delta by notifying the individual item subscriber; `Transcript.tsx`'s memoized `ItemRow` subscribes with `useItem`, then renders the assistant through `Prose` into `ChatMarkdown`. `ChatMarkdown.tsx` parses the complete growing text with `Markdown(...)`; streaming text does not enter its settled-text cache. This identifies the streaming reply path as an optimization candidate for the renderer owner: investigate batching/coalescing the Markdown parse frequency or incrementally rendering growing text. The evidence does **not** establish that every worker card re-renders on every delta. No React commit instrumentation was added, so exact component commit counts are not available.

The final CPU profile also contains **2,546.9 ms** of unattributed `(program)` samples. CPU sampling alone does not identify these as layout, paint, or other native work. A Chrome performance timeline on the same workload would be the next useful diagnostic if parsing improvements do not resolve frame pacing. The saved compiled renderer bundle and CPU summaries support inspection without guessing from current, concurrently edited source. All budget assertions remain strict and failing where measured; no measured failing value was used to raise a budget.

Validation and reproduction, from `/home/dp/Desktop/rocket-orchestrator`:

```bash
npm run typecheck
npm test
npm run check:ui -- --grep orchestra-stress
```

- Final standalone typecheck: **pass, exit 0**.
- Final standalone unit suite: **272/272 pass**, including **7/7 fixture tests**. New coverage exercises 40 HTTP dispatches and the stress worker's cancellation/barrier/100-delta/report behavior.
- Standard command rerun: **build/typecheck pass; 272/272 units pass; desktop 0/1 pass**. The desktop failure is solely p95 83.4 ms against <50 ms.
- Final screenshot-only test revision: **desktop 0/1 pass**, with exactly one error, p95 50.0 ms against <50 ms. Ran `ROCKET_UI_SKIP_BUILD=1 ROCKET_UI_SKIP_UNIT=1 npm run check:ui -- --grep orchestra-stress` using the bundle already validated by the standard command; only test capture code changed afterward. All other assertions pass.
- Initial transient checks: typecheck was blocked at renderer `OrchestratorShell.tsx:84` (TS2554), and units were 271/272 because `worker.next` lacked a renderer control. Subsequent renderer work resolved both without edits from this worker. The first desktop attempt also revealed the 12-task tool summary limit; the corrected test uses complete persisted state.

Standard command artifacts: `/home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T06-06-12-845Z-Yn1O2A/`.

Final spec artifacts: `/home/dp/Desktop/rocket-orchestrator/.artifacts/ui/2026-10-08T06-09-37-506Z-ri0jXn/`.

Portable evidence: [task-0007-evidence/](task-0007-evidence/), including [final metrics](task-0007-evidence/final-spec/stress-metrics.json), [CPU summary](task-0007-evidence/final-spec/cpu-summary.json), [CPU profile](task-0007-evidence/final-spec/stream.cpuprofile), three screenshots, complete host state, all 40 reports, journal, runner results and source snapshots with SHA-256 hashes. The baseline and standard-command measurements are preserved in separate subdirectories.

Remaining uncertainties: whether the renderer can meet <50 ms after reducing streaming parse cost; what causes the unattributed native CPU time; and how performance changes above 40 workers, with larger real-provider transcripts, or on other devices. Forty workers demonstrate no cap at this tested scale; they do not prove unbounded memory or performance scalability.
