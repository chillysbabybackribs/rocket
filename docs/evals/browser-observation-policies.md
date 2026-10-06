# Browser observation policies (eval matrix)

**Phase 4 / WS1.5** — compare how providers use different read modes on the same SPA task.

## Policies under test

| Policy id | Tool guidance | Expected behavior |
|-------------|---------------|-------------------|
| `digest-all` | Default `browser_read` / `tab.read()` (text + controls + network tail) | Baseline token use |
| `digest-a11y` | `focus: 'a11y'` on read | Smaller tree on large pages; refs still click via `eN` |
| `digest-find` | `query: '…'` on read after landing on list view | Fewer tokens than full elements list |

## Scenarios

Run via eval panel after `evals.sync`:

- `docs/evals/scenarios/browser-observation-policies.jsonl`

Graders: `turn_completed`, `no_tool_error_codes`, optional manual review of tool-call counts in the tool ledger.

## Promotion

When a policy wins on pass rate **and** median tokens (tool ledger / export), update default tool copy in `src/host/tools/browser.ts` — do not fork per-provider code paths.
