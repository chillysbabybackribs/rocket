# Evaluation evidence gaps

The research loop needs checks that can reject wrong answers and incomplete evidence. Inspection and isolated counterexamples on 2026-10-08 found several cases where Rocket's current checks pass without establishing the claimed behavior. These results concern grading, not the quality of any particular provider.

## Confirmed findings

**E1 — An early tool failure disappears from a long turn's export.** `src/host/eval-export.ts:78` queries at most 50 calls across the time window, then filters by turn ID. `ToolLedger.query` returns newest calls first (`src/host/tool-ledger.ts:131`, `:207`). The export omits the query's truncation flag. An isolated real ToolLedger with one failure followed by 50 successful calls exported 50 successes and no failure. `no_tool_error_codes` then passed. This reproduces on a single turn; competing turns could consume the same 50 slots as well. The full transcript items do not repair this grader, which reads errors only from the exported ledger calls.

Evidence and reproduction:

- `evidence-02-codex/export-truncation.mjs`
- `evidence-02-codex/export-truncation.json`
- Run `node --experimental-transform-types docs/research/continuous/orchestrated/evidence-02-codex/export-truncation.mjs`.

A useful fix would query all retained calls belonging to the turn, with filtering before pagination, and explicitly record completeness. If retention has removed evidence, the result should distinguish insufficient evidence from success. Acceptance: an early failure survives 51-call and interleaved-provider cases; missing evidence does not yield an unqualified clean result.

**E2 — A display label can substitute for the required tool.** `src/host/eval-grade.ts:20` accepts either a successful named ledger call or any completed tool item whose label contains that name. A synthetic completed shell item labeled `echo goal_report` passes `goal_report_called` without a corresponding call. This is a deterministic weakness in the grader's evidence rules. It does not show that any real provider attempted to manipulate grading.

Acceptance for a correction: shell/read labels mentioning a required tool must fail; an actual successful exact-name call must pass. If native provider tool events are needed as a fallback, use a structured identity rather than substring matching and distinguish missing evidence.

**E3 — A prohibited attempted call passes the negative check when it fails.** `tool_not_called:name` negates the same success predicate (`eval-grade.ts:88`). A ledger failure for `goal_report` therefore passes `tool_not_called:goal_report`. The name promises absence of a call, while its implementation checks absence of success. No current scenario found in this pass uses the negative grader, so this is a latent behavior mismatch rather than a demonstrated production score regression.

**E4 — Browser observation scenarios do not grade answer correctness.** `docs/evals/scenarios/browser-observation-policies.jsonl` asks for BETA-99 and imposes observation-method constraints, but its grader lists contain only `turn_completed` and `no_tool_error_codes`. Those predicates do not inspect answer contents or required read focus. A completed wrong answer with no recorded tool error satisfies them. The source note is already included in the prompt, so merely comparing the final answer to BETA-99 would still not establish that the agent observed the page. A stronger fixture would generate an unpredictable value and verify the observation method plus returned value independently.

**E5 — No-question grading is a narrow heuristic.** A final answer `Should I proceed? I can do this once you approve.` passes `no_question_asked`, because only question items and the final question-mark character are checked (`eval-grade.ts:66`). Existing tests intentionally permit an earlier assistant question followed by a later answer. Therefore this is a limitation of the current proxy, not proof that every question in intermediate reasoning should fail. Define whether the desired property is no user-blocking question, no question tool, or no natural-language question before replacing it.

The synthetic inputs and outputs for E2, E3, E5, and an additional turn-ID isolation probe are in `evidence-02-codex/grader-counterexamples.json`.

## A rejected overstatement

The grader accepts a successful call tagged with a different turn ID. That was reproduced with a fabricated export. However, `buildTurnExport` filters returned calls to the target turn at line 83. I do not claim normal exports currently mix turn identities. Validating imported exports remains a separate robustness question, while E1 is present in the normal export path.

## Next research assignments

1. Independently reproduce E1 and E2 through the real export/grading path and inspect whether the displayed tool scores amplify these errors.
2. Design outcome checks for browser research that cannot be passed by copying answers from the prompt. Separate retrieval correctness, tool reliability, and inference quality.
3. Determine the smallest durable research checkpoint that lets a fresh reviewer reconstruct the claim, inspect the source, and challenge it without replaying every token.
4. Compare a successful tool invocation with successful completion of the user's task; do not blend these into one score without showing both components and evidence coverage.

No application source or dependencies were changed. Experiments used temporary databases and synthetic data; no real model evaluation runs were started for these counterexamples.
