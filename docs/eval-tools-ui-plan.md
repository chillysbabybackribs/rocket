# Eval Tools UI — wire-up and test plan

Status: **complete (7/7).** **Configure → Tools** shows ledger summary, review actions, artifact links, and is covered by `eval-tools.spec.ts`.

## Goal

Give humans a reliable **in-app** view of Rocket MCP tool health (same evidence as `rocket_tool_history` / `rocket_tool_review`) and **automated tests** so regressions are caught without manual snapshots. This complements `<agent-environment>` for models (`docs/agent-ui-access.md`); it does not inject history into prompts.

## Implementation checklist

**Progress: 7 of 7 steps complete.**

- **✅ COMPLETE — 1. Read-only Tools view.** Nav under **Configure → Tools**; metrics, failure groups, review queue, scopes, registered tools; detail via `toolLedger.callDetail`.

- **✅ COMPLETE — 2. Host bridge.** `loadToolLedgerPanel` / `loadToolLedgerCallDetail` reuse ledger logic; types on `HostApi`.

- **✅ COMPLETE — 3. Wire review actions in the UI.** `toolLedger.setReview` mirrors `rocket_tool_review` via `setToolLedgerReview`. Buttons: diagnosed, regression_added, verified; retry picker from recent successes.

- **✅ COMPLETE — 4. Wire artifact and evidence links.** artifacts open inside the app through `openChatLink` (browser tab or artifact panel); structured call detail; DB path hint in footer.

- **✅ COMPLETE — 5. Tools-page chrome.** `view === 'tools'` hides **Run cell**; **Refresh ledger** reloads panel.

- **✅ COMPLETE — 6. Playwright UI spec.** `tests/ui/eval-tools.spec.ts` — evals → Tools, metrics, registered tools, mark verified.

- **✅ COMPLETE — 7. Matrix / docs / acceptance.** CSV row in `rocket-ui-regression.csv`; commands below; verification doc updated.

## Test strategy

### Unit (fast)

```bash
npm test
node --experimental-transform-types --disable-warning=ExperimentalWarning --test src/host/tool-ledger.test.ts
```

### Tool-failure integration (isolated Electron + MCP)

```bash
npm run check:ui -- tool-failure-pane.spec.ts tool-failure-loop.spec.ts
```

### Eval Tools UI

```bash
npm run check:ui -- eval-tools.spec.ts
```

### Manual smoke (live app)

1. Restart Rocket after host/renderer/main changes.
2. Evals → **Configure → Tools** — numbers match `rocket_tool_history` summary.
3. **Detail** on a failure; **Mark verified**; optional artifact open.

## Acceptance criteria

- Eval **Tools** view loads without error when ledger is available; clear message when unavailable.
- UI data matches MCP `rocket_tool_history` / `rocket_tool_review` for the same profile (no second source of truth).
- Review lifecycle changes from the UI persist in `reviews` table and appear on reload.
- `eval-tools.spec.ts` passes in `npm run check:ui`.
- Tool history still **not** injected into chat prompts (`contextPolicy.historyInPrompts: false`).
- No replay of failed live scripts from UI buttons.

## Related docs

- [tool-failure-history-plan.md](tool-failure-history-plan.md) — ledger milestone (complete)
- [tool-failure-history-verification.md](tool-failure-history-verification.md) — verification record
- [agent-ui-access.md](agent-ui-access.md) — model situational awareness
