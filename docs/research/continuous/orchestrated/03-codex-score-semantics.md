# Tool score interpretation

Isolated checks on 2026-10-08 found that Rocket's aggregate scores can conceal missing evaluation outcomes and do not honor a configured zero weight. These findings extend the grading and export checks in `02-codex-evaluation-evidence.md`.

## Evaluation coverage

`src/host/tool-eval-scores.ts:66` recursively collects files named `graders.json`, extracting their scenario identity from the directory name. It does not read run cell statuses. A fixture containing one passing graded cell and one newer run with a timed-out error cell yields `p: 1`, `scenarioCells: 1`, and `scenarioPasses: 1`. The fixture's timeout is absent from the denominator.

This is reproducible loader behavior, not a measurement of the actual provider failure rate. A clean denominator could count completed graded cells only, but the UI must expose that coverage condition rather than imply every attempted run contributed. Show separate attempted, graded, error, interrupted, and missing counts; define how each contributes to any aggregate. Do not blindly turn every user cancellation into a quality failure.

The actual lifecycle supports the fixture's shape: `finishEvalCell` waits before exporting (`src/host/eval-run-cell.ts:93`), and `EvalRuns.runCell` catches a thrown timeout as an error without writing a grader result (`src/host/eval-runs.ts`). `Hub.waitForTurn` rejects its wait after the deadline. That path deserves a separate check for whether the underlying provider turn also stops; rejection of a waiter does not itself demonstrate cancellation.

Historical graded cells are pooled across providers and run versions. Changing the grader or scenario while retaining its ID does not isolate the new measurement. A useful upgrade would preserve scenario/grader/tool version fingerprints and allow a comparable cohort, with the old and new sample sizes visible.

## Configured weights

`loadToolEvalWeights` uses `Number(body.wR) || 0.35`. Configuring `{ "wR": 0, "wP": 1 }` therefore loads `{ "wR": 0.35, "wP": 1 }`. This defeats an explicit attempt to disable reliability weighting and allows weights that sum above one. A correction should distinguish absent values from zero, validate finite nonnegative values, and specify whether weights must sum to one or are normalized.

With only one component available, the current formula retains that component's partial weight rather than renormalizing. That may be intentional conservatism; it should be labeled as incomplete coverage rather than compared directly with a fully measured score. This investigation does not establish the best weighting policy.

## Reproduction and next checks

Run `node --experimental-transform-types docs/research/continuous/orchestrated/evidence-02-codex/score-counterexamples.mjs`. Its JSON output is saved beside it. The script uses temporary synthetic repo/profile folders and deletes them afterward; it changes no app configuration.

Next: independently review the denominator policy, verify timeout cancellation with a controlled provider, and specify minimum evidence coverage for ranking proposed upgrades. These are research recommendations; no production changes were applied.
