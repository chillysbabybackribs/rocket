# Evidence Review & Context Behavior (Round 3: Antigravity)

## 1. Context Budget & Attachment Truncation

**Refuting Predecessor Claims:**
The previous report asserted that `buildHandoff` elegantly handles deep conversation history and that "100% of the attachments were preserved... No attachment loss occurs." It also claimed that keeping exact conclusions is a "superior" mechanism, diluting focus otherwise.

**Measured Behavior & Corrections:**
1. **Unmeasured Attention Claims:** The claim that a 30k budget is "superior" and avoids "diluting the model's focus" is an unmeasured hypothesis about model attention. It must be dismissed.
2. **Attachment Budget Bypass:** The previous report observed that `handoff.attachments` retains all attachments even when turns are dropped from the text `blocks` (verified in `evidence-03-antigravity/test-attachments.ts` where `handoff.turns` correctly counts retained text blocks as 6, but `handoff.attachments` returns 100). However, it failed to trace what `hub.ts` and the provider adapters actually do with `handoff.attachments`. 
3. **Massive Context Leak:** In `src/host/providers/images.ts` (`attachmentInput`), all retained attachments are re-injected into the prompt. For `FileAttachment` items, `images.ts` reads the file from disk (`readFileSync`) and appends its contents up to `MESSAGE_FILE_CHARS` (120,000 characters). This completely bypasses the `HANDOFF_BUDGET_CHARS` (30,000) intended by `handoff.ts`. Thus, "preserving references" causes runaway context growth because the text truncation is undone by the attachment pipeline re-appending file contents on every turn.

## 2. Local Source Verification

**Refuting Predecessor Claims:**
The previous report concluded that "current workflows do not require rigid citation enforcement for local codebase files" and declared it a non-goal. This was asserted without any behavioral evidence or user telemetry. 

**Correction:**
We cannot declare what workflows require without measuring them. `src/shared/sources.ts` indeed returns `null` for non-HTTP URLs, meaning local artifacts cannot be tracked by `eval-grade.ts` the same way web sources are. Determining whether semantic verification is necessary requires empirical evaluation of model hallucination rates on local files, not a theoretical dismissal.

## 3. Grader Evidence & Counterexamples

Independently reproducing Codex E1, E2, E3, and E5 from `02-codex-evaluation-evidence.md`. 
Machine-readable outputs are stored in `evidence-03-antigravity/`.

**Confirmed Findings:**
- **E1 (Export Truncation):** Reproduced via `evidence-03-antigravity/test-e1.ts`. `src/host/eval-export.ts:81` hardcodes a `limit: 50` when querying `ToolLedger`. If a single turn executes 51 tool calls (e.g., 1 failure followed by 50 successes), the oldest call (the failure) is silently dropped from the export. The grader (`no_tool_error_codes`) then falsely passes the turn because the error evidence was discarded during export pagination. **Confirmed grading defect**, as real models in continuous loops easily exceed 50 calls.
- **E2 (Display Label Substitution):** Reproduced via `evidence-03-antigravity/test-e2-e3-e5.ts`. `src/host/eval-grade.ts:20` uses `String(row.label).includes(name)` to verify tool usage. A synthetic item with `type: 'tool'` and `label: 'echo goal_report'` passes the `goal_report_called` grader. This is a **synthetic-only concern** since providers cannot inject fake `type: 'tool'` transcript items, but it reveals a deterministic weakness in the grader's reliance on unstructured strings.
- **E3 (Negative Grader Logic):** Reproduced. `tool_not_called:goal_report` passes even if `goal_report` was called, as long as it failed. The name implies checking absence of invocation, but the implementation only checks for absence of success. **Confirmed grading defect**.
- **E5 (No Question Grader):** Reproduced. A response of `"Should I proceed? I can do this once you approve."` passes `no_question_asked` because the heuristic (`text.endsWith('?')`) only checks the final character of the reply. **Confirmed grading defect**, as real provider text generation does not guarantee punctuation placement at the absolute end.

## 4. Next Questions

1. How should Rocket reconcile `HANDOFF_BUDGET_CHARS` with `MESSAGE_FILE_CHARS` so that older file attachments don't re-inject their entire text contents into the prompt on every handoff?
2. Should `eval-export.ts` loop over paginated `ToolLedger` results or remove the limit when exporting a turn's exact ID, to guarantee completeness of evidence?
3. Should `toolSucceeded` in `eval-grade.ts` strictly check `row.kind` or a dedicated tool name field instead of loosely matching `row.label` strings?
