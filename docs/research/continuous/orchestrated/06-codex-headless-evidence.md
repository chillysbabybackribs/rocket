# Headless evals omit the tool ledger

The isolated experiment `evidence-02-codex/headless-ledger.mjs` creates the real headless eval runtime with fixture providers and a temporary data directory. A fixture turn calls the runtime's real `browser_read` over its local MCP channel. The tool returns `PAGE_UNREADABLE`, because browser access is unavailable in the headless runtime. The fixture also records a failed tool transcript item. No real provider is invoked.

Exporting through the runtime's own `EvalExport` yields `ledger: {path: null, calls: []}`. `no_tool_error_codes` passes; `tool_error_codes` fails. The exact result is in `evidence-02-codex/headless-ledger.json`.

This is separate from the 50-call truncation finding. `src/host/eval-runtime.ts` constructs its ToolRegistry without a ledger observer and gives EvalExport a ledger getter that returns undefined. `src/host/eval-grade.ts` reads error codes exclusively from the ledger. Thus even a failed transcript item does not make this grader detect the actual tool error.

Recommended correction: record the headless channel with the same structured observer contract as the app, supply it to the exporter, and include evidence availability/completeness in grading. An absent ledger must not silently mean no failures. Browser unavailability in a headless runtime is expected; the defect demonstrated here is the misleading grade, not that browsers are unavailable.

Reproduce with `node --experimental-transform-types --disable-warning=ExperimentalWarning docs/research/continuous/orchestrated/evidence-02-codex/headless-ledger.mjs`. The script cleans up its temporary runtime and files. No application implementation was changed.
