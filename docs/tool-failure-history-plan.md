# Tool failure history plan

Status: planned. Implementation has not started.

## Objective

Build a versioned external tool-call ledger, then use observed failures to produce tested improvements. Keep the history outside normal model context. Logging and grouping should be deterministic; diagnoses remain reviewable judgments.

Rocket already records tool errors in `journal.jsonl` and saves UI-run results and captures. The journal rotates and does not consistently record arguments, tool versions, or recovery outcomes. The ledger will provide durable, structured evidence without expanding session prompts.

## Implementation checklist

- [ ] **1. Define the record format.** Record every call with a unique ID, timestamps, tool and schema versions, app build, provider/model, chat/turn identity, arguments, duration, outcome, structured error, and artifact references. Keep observed facts separate from later diagnoses. Define record size limits and secret redaction rules.
- [ ] **2. Instrument the shared tool boundary.** Add recording to `ToolRegistry` so all providers use the same path. Write a start record before execution and a finish record afterward. Identify interrupted calls after restart. Recording failures must never break tool execution.
- [ ] **3. Make errors structured.** Introduce stable codes such as `INVALID_ARGUMENT`, `AMBIGUOUS_TARGET`, `TARGET_UNAVAILABLE`, and `SCRIPT_TIMEOUT`. Preserve original error text. For `rocket_ui_run`, distinguish runner errors from exceptions raised by model-authored scripts; do not infer a precise cause from arbitrary exception text.
- [ ] **4. Add bounded queries and deterministic grouping.** Filter by tool, version, error code, date, and outcome. Group using stable fields, with documented text normalization only as a fallback. Return counts, representative call IDs, and artifact links. Record successes to calculate failure rates.
- [ ] **5. Track review and recovery separately.** Allow an investigator to link a retry, classify the cause, and attach a proposed fix. Keep annotations separate from original records. Track the lifecycle: unreviewed → diagnosed → regression added → fixed → verified.
- [ ] **6. Turn lessons into regression cases.** Build controlled fixtures from selected failures. Start with the ambiguous pane selector: a conversation contains the same greeting as the empty pane. Verify that improved pane selection identifies the intended target. Replay tests in isolated apps, never automatically against live chats.
- [ ] **7. Verify retention and context limits.** Test restart recovery, interrupted calls, malformed records, concurrent calls, redaction, grouping, and bounded queries. Define retention for records and captures separately. Keep history out of session prompts and track tool-description size alongside success rate.

## Delivery milestones

- [ ] **First deliverable:** steps 1–4, including a query showing recent recurring failures.
- [ ] **Complete the learning loop:** use one real failure to validate review, regression creation, repair, and verification through steps 5–7.
- [ ] **Consider automation afterward:** automate only workflows demonstrated to be reliable. Do not automatically rewrite tool descriptions from failed calls.

## Acceptance criteria

- Every tool call has a recorded start and a terminal outcome, or is identifiable as interrupted after restart.
- Equivalent structured failures group consistently within the same tool version.
- Summaries include successful calls as the denominator for failure rates.
- Original evidence remains distinguishable from diagnoses and recovery annotations.
- Queries have explicit result limits and link to full evidence instead of injecting it into model context.
- Recording errors do not change tool outcomes or prevent tool execution.
- Sensitive fields are redacted and storage follows a documented retention policy.
- At least one observed failure becomes a reproducible isolated regression case and a verified fix.

## Progress notes

Add implementation decisions, verification results, and remaining issues here as work proceeds. Check off items only after their acceptance criteria are met.
