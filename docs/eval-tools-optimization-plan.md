# Tool evaluation & optimization — product plan

Status: **design** (follows completed [eval-tools-ui-plan.md](./eval-tools-ui-plan.md) ledger view).

## Problem

The **Configure → Tools** tab today is a **control room**: ledger health, review queue, human lifecycle labels. It does not yet answer:

- “How good is `rocket_ui_run` *for models* on representative tasks?”
- “Does candidate description B beat A under real providers?”
- “How do we **promote** a winning variant into the shipped app?”

You want **evaluate → score (objective) → run with real models in the eval dashboard → update Rocket’s tools** — reusable for this app and potentially other MCP hosts.

## Principles

| Principle | Meaning |
|-----------|---------|
| **Scores from evidence** | Primary signals come from **ledger slices** and **deterministic graders**, not ad-hoc “looks fine.” |
| **Same host, forked definitions** | Eval runs use the real hub/MCP path; variants are **overlays**, not a second tool server. |
| **Prompts stay clean** | Tool-eval history does not inject into normal chat (`historyInPrompts: false` unchanged). |
| **Promotion is explicit** | Nothing silently rewrites `src/host/tools/*.ts`; winners produce a **reviewable patch** or version bump. |
| **Attribution** | Every score is labeled `(tool, toolVersion, provider, model, app_build, scenario_id)`. |
| **Same chat UI** | Tool eval cells use **`eval.startScenarioCell` → existing `ChatCard` panes** (`openChat`). Pass only from exported turn + ledger-slice for that chat. Tools/Experiments/Playground are control surfaces — no second composer in Evals. |

## What “non hand-rolled” score means here

Avoid one subjective “tool quality” number. Use a **published composite** from measurable inputs:

### 1. Reliability index **R** (retrospective, ledger)

Per `(tool, toolVersion, operation)` over a rolling window (e.g. 30 days or retained cap):

- **Input:** completed calls only; successes / (successes + failures).
- **Statistic:** Wilson score **lower bound** at 95% (or Beta prior mean) so low-volume tools are not ranked on 2/2 luck.
- **Already available:** ledger `summary.scopes`, failure groups, `descriptionBytes`.

This is **objective** (frequentist/Bayesian formula fixed in repo config).

### 2. Scenario pass rate **P** (prospective, eval matrix)

Per tool (or tool set), run **tool-focused scenarios** with **real providers** (Lane B):

- **Input:** `turn.json` + `ledger-slice.json` from `eval.runCell` / matrix runner.
- **Graders:** existing deterministic set in `scripts/grade-turn.mjs`, extended (see below).
- **Score:** fraction of cells where **all** configured graders pass (or weighted mean of grader scores).

Examples already aligned with the codebase:

| Grader | Use for tool eval |
|--------|-------------------|
| `no_tool_error_codes` | Turn must not fail any MCP tool |
| `tool_called:<name>` | *(new)* Ledger shows success for named tool |
| `tool_not_called:<name>` | *(new)* Negative control |
| `tool_error_code:<code>` | *(new)* Expected failure scenarios |
| `latency_budget` | Tool-heavy turns stay within budget |

Optional later: **LLM rubric graders** per dimension (description clarity) — separate from the core composite.

### 3. Composite **TES** (Tool Eval Score)

Single number for sorting in the Tools tab, **formula in git** (e.g. `config/tool-eval-weights.json`):

```
TES = wR * R + wP * P
```

Default proposal: `wR = 0.35`, `wP = 0.65` (emphasize forward eval over past luck). Document and version the weights; changing them is a config commit, not a UI slider.

Show **components** in UI (R, P, n_calls, n_cells) so the composite is never a black box.

## Tool variants (candidates to optimize)

Today tools live in code (`ToolRegistry.add` in host). For eval without shipping:

```
docs/evals/tool-variants/
  rocket_ui_run/
    baseline.json          # optional metadata only (points at shipped version)
    v2-pane-first.json     # { "description": "...", "inputSchema": { ... }, "version": 2 }
  rocket_tool_history/
    ...
```

**Variant file** (minimal):

```json
{
  "id": "rocket_ui_run__v2-pane-first",
  "baseTool": "rocket_ui_run",
  "version": 2,
  "description": "...",
  "inputSchema": { "type": "object", "properties": { ... } },
  "notes": "Emphasize ui.pane(index) in first paragraph."
}
```

**Runtime (to build):**

- `ToolRegistry` clone with **overlay**: replace `description` / `inputSchema` / `version` for named tools when `ROCKET_TOOL_VARIANT=<id>` or `eval.runCell({ toolVariantId })`.
- Ledger records **toolVersion fingerprint** per variant (already hashes description + schema) so R and P attach to the right variant.

Optimization workflows (human or agent-assisted):

1. Edit variant JSON (or generate from failure `proposedFix` + review notes).
2. Run matrix comparing `baseline` vs `v2-pane-first` on `docs/evals/scenarios/tools/*.jsonl`.
3. If `TES_variant > TES_baseline` with sufficient n, **promote**.

**Promotion (to build):**

- Tools tab: **“Promote variant → source”** generates a unified diff against the canonical tool module (or opens a checklist PR body).
- Requires mapping `baseTool` → file path (`src/host/tools/ui-run.ts`, etc.).
- Bump `version` on `Tool` type; old fingerprint remains in ledger for history.

## UX: Tools tab as eval hub

Evolve **Configure → Tools** in three layers (same nav, new sections):

| Section | Content |
|---------|---------|
| **Health** *(today)* | Ledger metrics, groups, queue, registered tools |
| **Scores** *(new)* | Per-tool TES, R, P, sparkline from last N matrix runs |
| **Variants** *(new)* | List variants, compare to baseline, **Run tool eval** |
| **Runs** *(new)* | Link to Experiments rows where `kind === 'tool-matrix'` |

Actions:

- **Run tool eval** — queues cells (scenario × variant × provider); each cell is **`runScenarioCell`** with optional `toolVariantId`, chat focused in the center column while running → artifacts under `.artifacts/evals/` and row in Experiments.
- **Open in Experiments** — same data as Braintrust-style grid (pass rate by provider/model).
- **Promote** — after pass, apply variant to source (human confirms).

Eval dashboard **Run cell** stays for **model/scenario** evals; tool evals prefer batch matrix (many cells) launched from Tools.

## Execution path (phased)

### Phase A — Scores without new host APIs *(mostly wiring)*

- [x] `docs/evals/scenarios/tools/` — starter scenarios (`rocket_ui_snapshot`, `rocket_tool_history`).
- [x] Extend `grade-turn.mjs` + `eval-grade.ts`: `tool_called:*`, `tool_not_called:*`, `tool_error_code:*`.
- [x] `src/host/tool-eval-scores.ts` + `toolEval.scores` host RPC (`config/tool-eval-weights.json`).
- [x] Tools tab **Evaluate** sub-tab (TES, R, P table).

### Phase B — Variants in eval runs

- [ ] Tool variant loader + overlay registry for eval/self-check profiles only.
- [ ] `eval.runCell({ ..., toolVariantId })` and matrix manifest field `toolVariantId`.
- [ ] Experiments loader recognizes `kind: 'tool-matrix'` in `.artifacts/evals/`.

### Phase C — Dashboard integration & promotion

- [ ] Tools tab: variant list, compare table, **Run tool eval** → `eval.runMatrix` subset.
- [ ] **Promote variant** → patch generator + version bump checklist.
- [ ] CSV row + Playwright smoke: “Tools scores render” / “tool eval experiment appears.”

### Phase D — Optional automation

- [ ] Suggest variant from review `proposedFix` (draft JSON only).
- [ ] Nightly tool-matrix on `main` with fixture providers for smoke; weekly with real models.

## Relationship to other eval lanes

| Lane | Measures | Tools tab role |
|------|----------|----------------|
| **A — UI regression** (`check:ui`) | Shell determinism | Feeds failure evidence into ledger |
| **B — Agent matrix** | Provider × scenario | **P** and tool scenarios |
| **Ledger review** | Incident closure | Inputs variant ideas, not scores |

Braintrust cloud **Tools** (remote scorers) remain out of scope; Rocket’s **Tools** tab is **local MCP + ledger + matrix**.

## Acceptance (when done)

- Every registered MCP tool has a **published TES** with visible R and P components.
- Running **Run tool eval** from Tools produces an Experiment with real-model cells and `graders.json` per cell.
- A variant that beats baseline on P (and does not regress R below threshold) can be **promoted** to source in one reviewed step.
- Ledger and prompts unchanged: eval overlays do not affect normal chats until promotion.

## Related

- [tool-failure-history.md](./tool-failure-history.md) — ledger semantics
- [eval-tools-ui-plan.md](./eval-tools-ui-plan.md) — current UI (complete)
- [provider-model-matrix.md](./evals/provider-model-matrix.md) — Lane B matrix & graders
