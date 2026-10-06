# Eval Tools UI — wire-up and test plan

Status: read-only **Configure → Tools** panel ships with ledger summary, queue, and call detail. Review actions, artifact links, automated UI tests, and header polish remain.

## Goal

Give humans a reliable **in-app** view of Rocket MCP tool health (same evidence as `rocket_tool_history` / `rocket_tool_review`) and **automated tests** so regressions are caught without manual snapshots. This complements `<agent-environment>` for models (`docs/agent-ui-access.md`); it does not inject history into prompts.

## Current state

| Layer | Done | Gap |
|-------|------|-----|
| Host ledger | `tool-calls.db`, MCP history/review | No `toolLedger.setReview` for renderer |
| Host panel API | `toolLedger.loadPanel`, `toolLedger.callDetail` | No artifact open / path validation |
| Renderer | `EvalToolsPanel` in `EvalDashboard` → **Configure → Tools** | Read-only; raw JSON detail; **Run cell** header on Tools page |
| Unit tests | `tool-ledger.test.ts`, panel loader | — |
| UI integration | `tool-failure-loop.spec.ts`, `tool-failure-pane.spec.ts` | No test that opens **Eval → Tools** in the shell |
| Eval matrix | `tool-ui-readonly` (snapshot) | No scenario for Tools tab content |

## Implementation checklist

**Progress: 2 of 7 steps complete.**

- **✅ COMPLETE — 1. Read-only Tools view.** Nav under **Configure → Tools**; metrics, failure groups, review queue, scopes, registered tools; detail via `toolLedger.callDetail`.

- **✅ COMPLETE — 2. Host bridge.** `loadToolLedgerPanel` / `loadToolLedgerCallDetail` reuse ledger logic; types on `HostApi`.

- **⬜ PENDING — 3. Wire review actions in the UI.** Add `toolLedger.setReview` (annotate lifecycle, link retry) mirroring `rocket_tool_review` validation. Buttons on queue/detail: mark diagnosed, regression_added, verified; optional retry picker from recent successes. Refresh panel after write.

- **⬜ PENDING — 4. Wire artifact and evidence links.** From call detail: open capture directory or first image via main process (`shell.openPath`); show review block distinctly from finish JSON; truncate detail with “open full record in DB path” hint.

- **⬜ PENDING — 5. Tools-page chrome.** When `view === 'tools'`, hide or disable **Run cell** (eval-matrix only). Optional **Refresh** label that only reloads ledger (already tied to topbar refresh + `toolsRefresh`).

- **⬜ PENDING — 6. Playwright UI spec.** New `tests/ui/eval-tools.spec.ts`: open evals (`Show evals`), click **Tools**, assert metrics render, failure table or empty state, registered tools includes `rocket_tool_history`. Seed ledger via MCP in-test (same pattern as `tool-failure-loop.spec.ts`) or inject known call via host test hook if added.

- **⬜ PENDING — 7. Matrix / docs / acceptance.** Add CSV row + optional JSONL grader for “Tools tab loads”; update `tool-failure-history-verification.md` and `docs/evals/README.md` with test commands; define done criteria below.

## Test strategy

### Unit (fast)

```bash
npm test                                    # includes tool-ledger + agent-situation
node --experimental-transform-types --disable-warning=ExperimentalWarning --test src/host/tool-ledger.test.ts
```

Add tests for any new `toolLedger.setReview` handler (invalid lifecycle, unknown callId).

### Tool-failure integration (isolated Electron + MCP)

```bash
npm run check:ui -- tool-failure-pane.spec.ts tool-failure-loop.spec.ts
```

Proves ledger + review loop; does not open Eval Tools UI.

### Eval Tools UI (to add)

```bash
npm run check:ui -- eval-tools.spec.ts
```

Suggested flow:

1. Launch UI-check profile (`tests/ui/app.ts` fixture).
2. MCP: record one failure + one success (or rely on seeded DB file in profile — prefer MCP for hermeticity).
3. Playwright: click rail **Show evals** → **Tools**.
4. Assert: `Prompt injection` → Off; registered tools row `rocket_ui_run`; queue or groups mention failure code; **Detail** expands JSON with `callId`.
5. After step 3 host work: click **Mark verified** → queue count decreases.

### Manual smoke (live app)

1. Restart Rocket after host/renderer changes.
2. Evals → **Configure → Tools** — numbers match `rocket_tool_history` summary.
3. Click **Detail** on a known failure; confirm review lifecycle and artifact paths.

Optional: `rocket_ui_snapshot` after navigating to Tools for visual review.

## Delivery milestones

- **⬜ PENDING — Interactive Tools:** steps 3–5 (review + artifacts + chrome).

- **⬜ PENDING — Automated shell test:** step 6 green in `check:ui`.

- **⬜ PENDING — Documented gate:** step 7; CI/local command documented in README eval section.

## Acceptance criteria

- Eval **Tools** view loads without error when ledger is available; clear message when unavailable.
- UI data matches MCP `rocket_tool_history` / `rocket_tool_review` for the same profile (no second source of truth).
- Review lifecycle changes from the UI persist in `reviews` table and appear on reload.
- `eval-tools.spec.ts` passes in default `npm run check:ui` (or documented optional filter).
- Tool history still **not** injected into chat prompts (`contextPolicy.historyInPrompts: false`).
- No replay of failed live scripts from UI buttons.

## Out of scope

- Braintrust cloud Tools (code-defined scorers) — different product surface.
- Auto-editing MCP tool descriptions from the UI.
- Replacing `<agent-environment>` with Tools-tab-specific model prompts.

## Related docs

- [tool-failure-history-plan.md](tool-failure-history-plan.md) — ledger milestone (complete)
- [tool-failure-history-verification.md](tool-failure-history-verification.md) — verification record
- [agent-ui-access.md](agent-ui-access.md) — model situational awareness
