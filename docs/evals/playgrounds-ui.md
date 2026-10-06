# Braintrust Playgrounds UI (reference for Rocket)

Source: [Iterate in playgrounds](https://www.braintrust.dev/docs/evaluate/playgrounds), live app (`My Project → Playgrounds → Prompt comparer example`).

## Purpose

Playgrounds are a **no-code workspace** to iterate on prompts, models, scorers, and datasets **before** saving an immutable **Experiment**. Each full **Run** overwrites the grid; **+ Experiment** promotes a configuration to Experiments.

Rocket analogue: **same scenario message** × **multiple providers** (matrix columns) × **dataset rows** (or single smoke row), with live turns in the chat column and graders as scorer columns.

## Page layout (two-pane vertical split)

```
┌─────────────────────────────────────────────────────────────┐
│ Breadcrumb · Title · Saved    Comparison▾ Diff  +Experiments│
│                               Add Provider                  │
├─────────────────────────────────────────────────────────────┤
│  [Base task card]  [Comparison task]  [Comparison task]  [+]│  ← horizontal scroll
│   Model picker      Model picker       Model picker         │
│   Messages (User)   Messages           Messages             │
│   Mustache / tools  …                  …                    │
│   Save prompt · Draft                                       │
├─────────────────────────────────────────────────────────────┤
│ All rows view ▾ · Grid · filter · +Row +Task +Scorer        │
│ Dataset ▾ (N rows) · Display ▾                              │
├─────────────────────────────────────────────────────────────┤
│ # │ Input │ Task A (Base) │ Task B (Comp) │ % Scorer │ Tags │
│ 1 │ green │ output/empty  │ output/empty  │ score    │      │
└─────────────────────────────────────────────────────────────┘
```

### Top bar

| Control | Behavior |
|--------|----------|
| **Comparison → Base** | Which task is the diff baseline for comparison pills (Improvement / Regression / Tie). |
| **Diff** | Highlight output/score/token deltas vs base. |
| **+ Experiments** | Snapshot current playground run to Experiments. |
| **Add Provider** | Inline AI provider setup (org settings or first-run). |

### Task cards (workspace)

- **Base task** + optional **Comparison task(s)** — same structure, color dot (white / purple / blue in template).
- **Model** block: provider + model selection.
- **Messages**: role blocks (usually User); template vars `{{input}}`, `{{expected}}`, `{{metadata.*}}`.
- Chips: **Mustache** / **Text output**, **+ Tool/MCP**, **+ Message**.
- Footer: **Save prompt**, **Draft** state.

Task types in Braintrust: Prompt, Workflow (chained prompts, preview), Scorer-as-task, Remote eval / sandbox.

### Results grid

- Toolbar mirrors Experiments: views, search, **+ Row**, **+ Task N**, **+ Scorer**, linked **Dataset**, **Display**.
- Header row: per-task column shows **model name**, **Base** or **Comparison** badge, optional **Tie — No significant difference** pill; scorer columns show e.g. **% ExactMatch**.
- Body: row index, **Input** cell, one cell per task (streaming output or “This cell has not been run yet”), scorer cells, tags, expand trace.

### Run model

- **Run all** (⌘/↵): all tasks × all dataset rows in parallel (with max concurrency / sample rate in advanced settings).
- **Run row** / single task from trace view.
- Results **stream** into cells; select row for side-by-side traces.

## Mapping to Rocket eval panel

| Braintrust | Rocket today |
|------------|----------------|
| Task column | Matrix **provider** (+ model) for one **scenario** JSONL |
| Prompt messages | Scenario `message` (support `{{input}}` when dataset rows supply inputs) |
| Dataset | `eval.loadDashboard` datasets + scenario-derived rows |
| Scorer column | Scenario `graders[]` → badges after `finishScenarioCell` |
| Run cell | `eval.startScenarioCell` → open chat → `eval.finishScenarioCell` |
| + Experiment | Matrix manifest run → `.artifacts/evals/*/summary.json` → Experiments list |
| Remote eval | Future: `eval:ui:dev` / harness rows as a task type |

## Gaps (not in v1 UI clone)

- Real-time multi-cell parallel run queue in the panel
- Mustache substitution from dataset into message before send
- Workflow chains, MCP/tools in prompt editor, Loop optimize, annotations
- Diff mode on output text (UI toggle only until we store per-cell outputs in panel state)

## Playgrounds list page

`/playgrounds` shows saved playgrounds (cards/table). Opening one loads the layout above. Rocket can use **one playground per scenario file** or a fixed “Matrix comparer” until we persist playground configs.
