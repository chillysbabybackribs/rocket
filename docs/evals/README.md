# Evals in Rocket

## Provider × model behavior (Lane B)

See [provider-model-matrix.md](./provider-model-matrix.md). Sample scenarios: `scenarios/goal-draft-minimal.jsonl`.

```bash
node scripts/run-agent-matrix.mjs docs/evals/scenarios/goal-draft-minimal.jsonl
```

Produces a run plan under `.artifacts/evals/` (manual or future host automation).

### Turn export + graders (manual matrix cells)

1. Tag the eval chat (once per chat), or set `ROCKET_EVAL_EXPORT=all` when launching Rocket.
2. Optional: point the next exports at a matrix cell folder:

   ```bash
   export ROCKET_EVAL_CELL=/path/to/.artifacts/evals/<run>/cells/goal-draft-minimal__claude__default__trial0
   ```

3. Run the scenario message in the live app; when the turn ends, the host writes `turn.json` + `ledger-slice.json`.
4. Grade:

   ```bash
   npm run eval:grade-turn -- .artifacts/evals/inbox/<turnId>__*/turn.json --graders turn_completed,goal_report_called
   ```

Host RPC (from renderer or future runner): `eval.tagChat`, `eval.setCellDir`, `eval.exportTurn`.

Offline export from the profile DB:

```bash
npm run eval:export-turn -- <turnId> [outDir]
```

---

## Braintrust UI regression eval (Lane A — harness)

## One-time setup

1. Log in: `bt login` (or set `BRAINTRUST_API_KEY`).
2. Dataset **rocket-ui-regression** lives in Braintrust project **My Project** (import from `rocket-ui-regression.csv` if needed).

## Remote eval (Experiments UI)

```bash
npm install --include=dev   # braintrust is a devDependency
npm run eval:ui:dev         # http://localhost:8300
```

In Braintrust: **Experiments** → **Task** → **Remote eval** → **http://localhost:8300** → pick the eval → **Create**.

Each row runs Playwright with `--grep` after **one** shared build + unit test pass (`ROCKET_UI_SKIP_*`).

**Rough duration (this machine):**

| Phase | Time |
|--------|------|
| Prepare (build + `npm test`, once) | ~25–40s |
| Each Playwright case (grep-only) | ~15–25s typical; ui-run / recovery / host-crash up to ~1–2 min |
| **7 cases total** | **~3–8 minutes** |

Without skip flags (old behavior: full `check:ui` per row), expect **~7× (prepare + case) ≈ 30–45+ minutes**.

Local run (no Braintrust API): `npm run eval:ui:local`

## CLI (no UI)

```bash
npm run eval:ui
```

Uses `evals/rocket-ui-regression.eval.ts` and uploads results to **My Project**.
