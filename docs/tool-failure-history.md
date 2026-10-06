# External tool-call history

Rocket records calls to its shared MCP tools in `<profile>/tool-calls.db`. Provider-native shell and other provider tools are outside this ledger's scope. The ledger is independent of the transcript and rotating journal. It does not inject history or lessons into session prompts, rewrite tool descriptions, or replay actions.

## Records

The database uses format version 1 and immutable `calls` and `finishes` rows. A start is committed before execution; a finish records the terminal outcome. Repeated finish writes are ignored. Calls without a finish from a previous host instance are reported as interrupted, while unfinished calls in the current instance are running. An interrupted call may have completed an action before interruption; that outcome is not guessed.

Starts include a UUID, epoch-millisecond time, host-instance UUID, tool name, schema hash, tool-version fingerprint, host-bundle fingerprint, description byte count, provider/model, chat/turn identity, operation and redacted arguments. Unknown model or turn identity remains null. The version fingerprint covers the explicit tool version (default 1), canonical input schema and description. Source changes are identified separately by the bundle fingerprint.

Finishes include end time, duration, success/failure, structured error information when available and artifact references. Images and base64 data are not copied into the ledger. Successful response bodies are not retained. Arguments have a 16 KB budget, bounded nesting/collections and explicit truncation markers; error messages are limited to 4,000 characters and artifact references to 20 paths of at most 1,000 characters each.

Database access uses the host process and WAL mode. The database file is created with owner-only permissions. Recording and diagnostic errors cannot prevent execution or replace a tool's result. If opening the ledger fails, Rocket logs a warning and continues without ledger recording or the history query tool.

## Redaction and retention

Named authorization, cookie, password, secret, token, API-key and base64 fields are redacted. Text patterns redact bearer credentials, Rocket MCP endpoint secrets, common credential assignments, recognized API-key strings, credential query parameters and literal `fill`/`type` values in scripts. This is pattern-based redaction, not a guarantee that arbitrary free-form text is secret-free. Truncated and redacted arguments are evidence for review, not directly replayable scripts.

Pruning runs at startup and every 100 starts. It removes records older than 30 days and keeps the latest 10,000 finished or previous-instance calls; active calls in the current host are preserved. Up to 99 newer calls may exist between pruning passes. Queries scan at most 10,000 records. Counts describe the retained query window, not lifetime totals.

The ledger stores references to captures and traces but does not delete those artifacts. Their retention remains with the capture/runner systems and manual cleanup. Ledger pruning does not remove transcripts, snapshots, traces or run directories.

## Structured errors

The registry uses `UNKNOWN_TOOL` for an unknown name and `TOOL_EXCEPTION` for an uncaught tool exception. Tools can return an error object in MCP `structuredContent.error`, containing `code`, `origin` and the original message.

UI scripts distinguish errors raised by the model's script (`SCRIPT_ERROR`, origin `script`) from rejected UI operations (`UI_OPERATION_FAILED`, origin `operation`). Playwright operation timeouts use `OPERATION_TIMEOUT`; its strict locator-resolution violation uses `AMBIGUOUS_TARGET`. These classifications occur at the operation boundary, not by analyzing arbitrary script-authored exception messages. Live input guards use `INVALID_ARGUMENT`, `UI_BUSY` and `TARGET_UNAVAILABLE`. Whole-script timeouts use `SCRIPT_TIMEOUT`; connection and capture failures have their own runner codes.

Legacy tools without structured errors remain `UNCLASSIFIED`. Their fallback fingerprint normalizes paths/URLs, UUIDs, numeric values and whitespace, preserving the bounded original error separately. Grouping is evidence aggregation, not a root-cause diagnosis.

## Queries

`rocket_tool_history` is available to all providers when the ledger is available, independently of self-check mode. Default: summary mode, last 24 hours, 10 results. Filters include exact tool name, version fingerprint, error code and inclusive epoch-millisecond date bounds. Calls mode also supports outcome. A call-ID lookup defaults to the entire retained period.

Examples of tool arguments:

```json
{"mode":"summary","tool":"rocket_ui_run","limit":10}
```

```json
{"mode":"calls","tool":"rocket_ui_run","outcome":"failure","limit":5}
```

```json
{"callId":"<UUID returned by a summary or call list>"}
```

Lists omit arguments; an individual call lookup includes the redacted arguments. Summaries group by tool version, operation, error code and origin, adding the normalized message only for unclassified errors. Each group includes up to three representative call IDs, counts, description bytes and the failure rate for its tool-version/operation scope. Error-code filters do not remove successful calls from the denominator. Running and interrupted calls are reported separately and excluded from completed-call failure rates. Summaries also include scope totals when there are no failures.

Result limits range from 1 to 50. The tool reduces list lengths to fit a 12 KB JSON response budget and returns valid JSON. If even one record exceeds that budget, it returns a truncation notice and the local database path. Full redacted records remain queryable locally in SQLite. Artifact references are available through call details.

## Review annotations

Investigator judgments live in a separate `reviews` table keyed by call ID. Original `calls` and `finishes` rows are never edited. Pruning a call removes its review row.

Each review records creation and update times, lifecycle stage, optional cause code and notes, an optional proposed fix and an optional `retryCallId` pointing at a later call (typically a successful retry). Lifecycle stages are `diagnosed`, `regression_added`, `fixed` and `verified`. Failures without a review row are treated as `unreviewed`.

`rocket_tool_review` supports:

- `action=get` with `callId` — call evidence plus the review, if any.
- `action=annotate` with `callId` and `lifecycle` — set or update cause/fix fields (bounded and redacted like other ledger text).
- `action=link_retry` with `callId` and `retryCallId` — attach a retry link without changing other fields unless the call was still unreviewed (then lifecycle becomes `diagnosed`).
- `action=queue` — list recent failures that still need attention (default excludes `verified`; use `lifecycle=unreviewed` to filter further).

Call detail lookups through `rocket_tool_history` include an embedded `review` when present.

## Regression: ambiguous pane selection

When two panes show the same greeting text, unscoped `Message` textboxes fail with `AMBIGUOUS_TARGET`. Scope with `ui.pane(index)` (matching `data-pane-index` on each `.pane` in the shell). Isolated replay: `tests/ui/tool-failure-pane.spec.ts` (`UI check: good evening` fixture). Mark reviewed failures with `rocket_tool_review` lifecycle `regression_added` when promoting a lesson.

## Remaining work

Retention/context verification (step 7) is next. The first integration regression already checks that an ambiguous selector produces a structured failure, preserves existing drafts, and can be retrieved through the history tool with successful calls included in its denominator.
