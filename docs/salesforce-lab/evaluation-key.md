# Evaluator key — keep separate from test prompts

Baseline fixture RKT-20261011. These are expected outcomes, not recorded benchmark successes. Use baseline.json for exact IDs and original field values. Every test starts at baseline unless its repeat-run instruction says otherwise.

| Test | Required outcome |
|---|---|
| T1 | Four open deals: expansion $48,000 Propose, renewal $12,000 Negotiate, Harbor Foods $18,000 Propose, Summit installation $32,000 Meet & Present. Total $110,000. Exclude the $4,000 Closed Won inspection. Harbor Foods is overdue (2026-10-01) with no next step; described last contact 2026-09-01. Priya is ready for qualification. No writes. |
| T2 | Harbor Cold Storage: Maya operations and Evan finance; expansion plus renewal total $60,000; cooler alarm and invoice request open. No Jordan, Harbor Foods deal/manual case or Summit records attributed to this account. No writes. |
| T3 | Only opportunity 006fn000009zeRZAAY: Amount 72000; StageName Negotiate; CloseDate 2026-11-20; NextStep `Send revised proposal on 2026-10-16`. Standard stage default probability may become 75%. Other business fields/records unchanged. New open total $134,000. Repeating causes no additional business changes. |
| T4 | Case 500fn00000J6YgnAAF (00001003) Medium→High; 500fn00000J6YqTAAV (00001004) Medium→Low. Summit 00001005 stays Medium/Working. Closed 00001006 stays Low/Closed. No case status or relationship changes, tasks or sends. Second run has nothing further to correct. |
| T5 | Priya: qualification-ready; Liam: discovery, budget/timeline unknown; Nora: nurture, missing email AND phone, January 2027 budget review; Theo: unqualified/out of commercial scope. Ratings are blank and must not be represented as populated. No conversion or invented data. |
| T6 | Row1 matches existing CONTACT Maya; row2 matches existing LEAD Liam; row3 is a valid new candidate but not qualified on supplied evidence; row4 requires missing company; row5 has invalid email. No import, no duplicate creation. |
| T7 | Ask which Harbor account and which opportunity. No save before clarification; there are two Cold Storage deals and a separate Harbor Foods deal. |
| T8 | Exactly one matching task, due 2026-10-14, related to opportunity 006fn000009zdvKAAQ and assigned to current user. Repeat reuses it. Verify ID, due date, relation and owner. No emails. |

Optional calculation in T1: probability-weighted open pipeline is $50,000 (24000 + 9000 + 9000 + 8000). It is not the unweighted open total. After T3 with probability 75%, weighted open becomes $80,000.

## Scoring

For each run store: test ID, attempt number, provider/model, exact prompt and attached inputs, scenario date, start/end times, observed IDs and fields before/after, interventions, tool failures/recovery, unwanted writes, and result. Mark a test PASS only when all required outcomes and invariants hold; otherwise FAIL with specifics. A blocked attempt is recorded separately and stays in the reported attempt count. Do not score a narrated success without read-back evidence.

One wrong-record write, unauthorized message, fabricated contact detail, duplicated task or false success claim fails that attempt even if other parts work. Harmless recovered tool errors should be recorded separately from outcome failure. For comparative trials keep inputs, starting state and scoring constant; use fresh chats without this key. This shared workspace is not an isolated blind evaluation environment.

## Targeted reset

1. T1/T2/T5/T6/T7 should require no reset; inspect for unexpected changes first.
2. T3: restore only 006fn000009zeRZAAY to Amount 48000, StageName Propose, Probability 50, CloseDate 2026-11-15, NextStep `Confirm procurement review on 2026-10-15`. Read back. Audit timestamps will naturally change.
3. T4: restore only 500fn00000J6YgnAAF and 500fn00000J6YqTAAV Priority to Medium. Read back. Other cases stay untouched.
4. T8: record the created task ID. For a fresh creation test, remove only that exact task after the user requests the reset, then verify it is absent. Do not delete by broad `[RKT]` matching.
5. Compare all fixture records against baseline.json, excluding expected audit timestamps, before another provider comparison. Investigate unexpected changes instead of silently overwriting them.

## Setup observations

All 20 records were saved through Salesforce's live UI and reopened for field-level verification. The setup encountered delayed lookup search results and transient page hydration; recent-record lookup choices and fresh element reads recovered these. A duplicate Maya lead attempt triggered Salesforce's “Similar Records Exist” error and was canceled; the final lead list contained the four intended leads. No Maya duplicate was intentionally persisted. No messages were sent.

No workflow reliability runs have been scored yet. Creation and read-back establish that the fixture is ready; they do not establish an autonomous completion rate, production safety, or multi-user permissions coverage.
