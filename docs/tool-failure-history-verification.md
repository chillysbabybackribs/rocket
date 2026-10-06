# Tool failure history — verification record

**Status: built and verified.** In the app: **Eval panel → Configure → Tools** (read-only ledger). This document and MCP tools remain the full audit trail.

Last automated run: **2026-10-06** (ledger unit tests + isolated UI loop specs + live ledger read).

## What was built (not eval UI)

| Component | Purpose |
|-----------|---------|
| `~/.config/Rocket/tool-calls.db` | Versioned tool-call ledger (starts/finishes, redacted args) |
| `rocket_tool_history` | Bounded summaries and call lookup |
| `rocket_tool_review` | Review queue, lifecycle, retry links |
| `rocket_ui_run` + `ui.pane(n)` | Live/isolated UI control; fixes multi-pane ambiguity |
| `rocket_ui_snapshot` | Read-only composed window capture for agents |
| `tests/ui/tool-failure-pane.spec.ts` | Regression: unscoped vs `ui.pane` |
| `tests/ui/tool-failure-loop.spec.ts` | End-to-end: fail → review → verified |

Eval panel (Playgrounds / Experiments) is a **separate** project surface.

## Acceptance criteria (plan)

| Criterion | Verified by |
|-----------|-------------|
| Every call has start + terminal outcome (or interrupted) | Unit: restart test; UI loop spec |
| Structured failures group consistently | Unit: grouping test; live summary groups |
| Failure rates include successes in denominator | Unit + live summary (`failureRate` 0.2 live / 1.0 isolated scope) |
| Evidence separate from review annotations | Unit: review table; loop spec |
| Queries bounded, not in prompts | `contextPolicy.historyInPrompts: false` in live summary |
| Recording failures don’t break tools | Unit: broken observer test |
| Redaction + retention | Unit: redaction, prune tests |
| One failure → regression + verified fix | `tool-failure-loop.spec.ts` PASS |

## Commands to re-check locally

```bash
# Ledger unit tests (9 tests)
node --experimental-transform-types --disable-warning=ExperimentalWarning --test src/host/tool-ledger.test.ts

# Isolated desktop proof (both specs, ~30s)
npm run check:ui -- tool-failure-pane.spec.ts tool-failure-loop.spec.ts
```

Latest UI artifact folder (example): `.artifacts/ui/2026-10-06T03-58-12-559Z-mqudXm` — **PASS**.

## Live app spot-check (after restart)

Ask a connected agent (or MCP client) to call:

```json
{"mode":"summary","tool":"rocket_ui_run","since":0,"limit":5}
```

Expect:

- `contextPolicy.historyInPrompts` → `false`
- `scopes` with `descriptionBytes`, `successRate`, `failureRate`
- `groups` with codes such as `AMBIGUOUS_TARGET` when failures occurred

Review queue:

```json
{"action":"queue","since":0,"limit":10}
```

Verified failures (e.g. live ambiguous pane demo) should **not** appear once lifecycle is `verified`.

Example verified call (live session): failure id `55634641-840e-4be2-a119-3fb07c91143c` — `AMBIGUOUS_TARGET`, review **verified**, retry linked.

Detail lookup:

```json
{"callId":"55634641-840e-4be2-a119-3fb07c91143c"}
```

Includes redacted arguments, finish error, embedded `review`, artifact paths.

## Documentation map

- [tool-failure-history-plan.md](tool-failure-history-plan.md) — **7/7 complete**
- [tool-failure-history.md](tool-failure-history.md) — format, retention, queries

## Optional future UI

A rail “Tool history” investigator panel is **not required** for correctness; MCP + this record are the source of truth until such UI is prioritized.
