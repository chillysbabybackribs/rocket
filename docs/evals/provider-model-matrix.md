# Provider × model behavior eval (matrix)

Compare **agents** (provider + model + harness), not models in isolation. Same prompt, same workspace fixture, different `{ provider, model }` cells; score outcomes and trajectories with deterministic graders first.

Status: design. Harness UI regression stays in `check:ui` / `rocket-ui-regression`. This doc is **Lane B: live app behavior**.

---

## What you are comparing

| Comparison | Example | Same data? |
|------------|---------|------------|
| **Provider A vs B** | Claude vs Cursor on “draft a goal brief for …” | Yes — one scenario row, two cells |
| **Model vs model (same provider)** | `claude-opus` vs `claude-sonnet` | Yes |
| **Model vs model (cross provider)** | Codex gpt-5 vs Claude opus | Yes — still one scenario; cells differ |
| **Harness only** | Before/after a prompt or tool schema change | Same provider+model, different git SHA |

Label every result **`(provider, model, app_build, tool_version)`** so regressions are attributable.

---

## Scenario (dataset row)

Store scenarios in git as JSONL: `docs/evals/scenarios/*.jsonl`.

```json
{
  "id": "goal-draft-login-fixture",
  "cwd": "evals/fixtures/login-fixture",
  "message": "Start a goal: user wants a minimal login page checked against the README.",
  "setup": { "openGoal": false },
  "matrix": {
    "include": [
      { "provider": "claude", "model": null },
      { "provider": "codex", "model": null },
      { "provider": "cursor", "model": null },
      { "provider": "antigravity", "model": null }
    ]
  },
  "graders": ["turn_completed", "goal_report_called", "no_tool_error_codes"],
  "trials": 2
}
```

- **`matrix.include`** — explicit cells to run. Omit a provider to skip it (e.g. steer scenarios only list `claude` + `codex`).
- **`model: null`** — use whatever model is default in Rocket for that provider when the run starts (document it in the run manifest).
- **`trials`** — repeat for variance; compare distributions, not one lucky pass.

Optional **`matrix.baseline`**: `{ "provider": "claude", "model": "…" }` for pairwise “did we beat baseline?” reports.

---

## Graders (start deterministic)

| Grader | Source | Pass condition |
|--------|--------|----------------|
| `turn_completed` | Turn `status === 'completed'` | Binary |
| `turn_failed` | Turn `status === 'failed'` | Expect fail for negative tests |
| `goal_report_called` | Tool ledger / transcript | `goal_report` success in turn |
| `ask_user_used` | Transcript | `question` item present when scenario expects it |
| `tool_error_codes` | Tool ledger (`provider`, `model`, `turnId`) | No `failure` with codes in deny list |
| `steer_honored` | Transcript | Steer item + follow-up (Claude/Codex only) |
| `checker_agrees` | Goals runner | Checker verdict all lines met (cross-provider by design) |
| `latency_budget` | `TurnTiming` | `firstTextMs`, `totalMs` under thresholds |

Add LLM rubric graders later (brief quality, tool choice); keep them **per dimension**, not one “helpfulness” score.

**Tool ledger** (SQLite profile DB) already records `provider`, `model`, `turnId` per call — use it for tool-behavior cells without stuffing history into prompts.

---

## Run manifest and artifacts

Each matrix run writes:

```
.artifacts/evals/<iso>-<short-id>/
  manifest.json       # git sha, app version, scenario ids, matrix cells, trials
  cells/
    <scenarioId>__<provider>__<modelSlug>__trial0/
      turn.json         # full turn items + timing + tokens
      graders.json      # { name, score, metadata }
      ledger-slice.json # optional: tool calls for this turnId
  summary.json          # pass rates, pairwise wins vs baseline
  report.html           # optional viewer
```

`summary.json` should support:

- **Grid**: scenarios × cells → score
- **Pairwise**: cell A vs cell B on same scenario (win/tie/loss per grader)
- **Regression**: cell vs last run on `main` for same scenario

---

## How to execute cells (three phases)

### Phase 1 — Manual / dogfood (now)

1. Open fixture folder, pick provider + model in UI.
2. Send scenario `message` (or run a Goal).
3. Export turn (once host exposes export — see below).
4. Run local grader script on `turn.json` + ledger query.

Good for defining scenarios and graders before automation.

### Phase 2 — Live UI driver

Use **`rocket_ui_run` (live)** to script: focus composer, select provider/model if exposed in a11y tree, fill message, send, **`waitForFunction`** until turn completes (DOM signal). Fragile but uses the real app with no new host API.

Keep **one script at a time** (live runner lock).

### Phase 3 — Host eval API (recommended for CI matrix)

Add a narrow host RPC (eval-only or self-check):

`eval.runCell({ scenarioId, provider, model, cwd, message, trial }) → { turnId, paths }`

- Creates or reuses an eval chat in the fixture cwd.
- Calls the same `hub.post` path as the UI.
- Waits for terminal turn status.
- Writes `turn.json` + ledger slice; does **not** inject ledger into model context.

Matrix runner: `node scripts/run-agent-matrix.mjs scenarios/goal.jsonl` loops cells × trials, aggregates `summary.json`.

---

## Pairwise comparison rules

When comparing **cell A** vs **cell B** on the same scenario and trial index:

1. **Primary**: grader `goal_report_called`, `checker_agrees`, or scenario-specific oracle.
2. **Tie-break**: lower `totalMs` at equal pass; optional token cost from `TurnTokens`.
3. **Steer scenarios**: only compare providers with `steers: true`.

Report **win rate** across trials, not single runs. Example line:

`goal-draft-login-fixture: claude/null 2/2 pass, cursor/null 1/2 pass (tool_error_codes: TARGET_UNAVAILABLE×1)`

---

## Overlap with Goals

Goals already implement **worker vs checker** (different providers). Reuse for scenarios tagged `"kind": "goal"`:

- Worker cell = `matrix.include[i]`
- Checker = auto-picked (see `goals.ts`) or fixed in scenario for reproducibility: `"checker": { "provider": "cursor", "model": null }`

Matrix eval then compares **worker** providers while holding checker constant, or compares **checker strictness** with a fixed worker.

---

## What we do not need

- **Braintrust** — optional upload of `summary.json`; not required.
- **Isolated `check:ui`** — harness lane; run before matrix to ensure shell isn’t broken.
- **Full transcript in CI logs** — redact; keep evidence in artifact dirs.

---

## Implementation order

1. [ ] JSONL scenario format + 2–3 fixtures under `evals/fixtures/`
2. [ ] Turn export to `turn.json` (host/store; one function, eval chats tagged)
3. [ ] `scripts/grade-turn.mjs` — deterministic graders on exported turn + ledger path
4. [ ] `scripts/run-agent-matrix.mjs` — Phase 1 manual manifest helper, then Phase 3 when RPC exists
5. [ ] `report.html` generator from `summary.json`
6. [ ] Optional: in-app “Eval runs” panel reading `.artifacts/evals/`

Track progress here; check items when acceptance matches `docs/tool-failure-history-plan.md` (ledger as evidence source).
