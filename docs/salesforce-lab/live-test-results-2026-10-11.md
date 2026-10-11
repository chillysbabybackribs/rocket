# Salesforce live test results

October 11, 2026. **Five distinct assignments and one intentional repeat passed their scoped outcome checks** in fresh Rocket chats using Codex GPT-6-Astra and the logged-in Salesforce trial. No corrective prompts were sent during the runs. These are six observed smoke-test outcomes, not a production reliability estimate or a provider comparison.

The agent answered a business question, updated a record, built a real Salesforce page, repaired a Flow, and researched prospects using Rocket's existing tools. This is concrete support for pursuing a broad Salesforce workspace. The tests also exposed avoidable navigation and verification overhead.

| Assignment | Result | Agent time | Tool steps | Recovered failures |
|---|---|---:|---:|---:|
| Pipeline and lead readiness | Pass | 2m 05s | 17 | 0 |
| Apply corrected meeting notes | Pass | 1m 11s | 15 | 1 |
| Create Opportunity page variant | Pass | 6m 07s | 75 | 1 |
| Repair isolated automation and debug both branches | Pass | 3m 18s | 37 | 1 |
| Research three prospects and check CRM matches | Pass | 1m 43s | 23 | 0 |
| Repeat the meeting-note update | Pass | 1m 03s | 11 | 1 |

Times come from Rocket's recorded turn start/end timestamps. They exclude evaluator preparation, independent verification and reporting. The six agent turns total about 15m 26s. No human completion baseline was measured, so these numbers do not establish a speedup.

## What passed

**Business question.** Correctly reported four open opportunities totaling $110,000, excluded the $4,000 closed-won deal, identified Harbor Foods as overdue with a missing next step, and selected Priya as the strongest qualification candidate. Independent reads of the five opportunities and four leads matched the answer.

**Record update.** Correctly applied the final $72,000 amount rather than the superseded $60,000 estimate, stage Negotiate, November 20 close date, and the requested next step. Preserved the original Description and the separate renewal. Read-back of all five opportunities showed changes only to the target's four requested fields, the allowed automatic probability change to 75%, and audit timestamps.

**Page configuration.** Saved [Opportunity Workspace](https://energy-nosoftware-1526.lightning.force.com/visualEditor/appBuilder.app?id=0M0fn000009KUj9CAG), API name `RKT_EVAL_Opportunity_Workspace`. Independent reopening confirmed the exact Northstar note and the two-column arrangement with Details and Activities together. Existing related components remain. The page list showed no org-default, app-default or other assignments. This tested saved configuration and preview, not deployment to users.

**Automation repair.** The evaluator seeded an inactive Case flow assigning Low priority to one exact test subject. The agent located the defect and saved [the corrected draft](https://energy-nosoftware-1526.lightning.force.com/builder_platform_interaction/flowBuilder.app?flowId=301fn00000enhT9AAI). Independent comparison of Salesforce's returned metadata showed only the Low-to-High assignment change; subject equality, create-only trigger and before-save behavior remained intact.

Salesforce's actual debug responses confirmed that the matching case met the condition and received High in the simulated run, with rollback. The unrelated case failed entry conditions and did not run. Independent record reads confirmed both persisted cases retained their original values and timestamps. The Flow remains inactive. This tested a simple repair, not activation or a complex automation dependency graph.

**Prospect research.** The three companies and facility claims checked out on pages opened by the test agent and independently read by the evaluator:

- [Claxton Cold Storage](https://www.claxtoncoldstorage.com/): Georgia cold-storage facilities with ammonia refrigeration and freezer capacity.
- [Dothan Warehouse](https://dothanwarehouse.com/services/warehousing-distribution): refrigerated storage in Dothan, Alabama.
- [Wood Fruitticher](https://woodfruitticher.com/about/our-facility/): Irondale, Alabama foodservice distribution facility with freezer, cooler and ammonia refrigeration infrastructure.

The answer separated facility fit from unknown buying need, budget and timing, and flagged ammonia-service capability as something to confirm. The trace shows Accounts/Leads review plus company-name searches returning no visible matches. This is a shortlist and a visible-record duplicate check, not lead qualification, exhaustive entity resolution, paid-data integration testing or an import.

**Repeat handling.** In another fresh chat, the agent found the requested opportunity values already present and did not save. Independent read-back confirmed the same values and the same last-modified timestamp as the first update.

## Changes left in Salesforce

- Harbor refrigeration expansion retains the requested update. Open pipeline is now **$134,000**.
- One saved, unassigned Opportunity page variant.
- One inactive test Flow with its original faulty draft and corrected draft.
- One evaluator-created test case, `500fn00000J6nnwAAB`, subject `[RKT EVAL4] Cooler alarm`, still Medium/New.

The comparison across the original 20 fixture records found only the intended opportunity changes among returned baseline fields. Lookup IDs and inspected business fields were preserved. No sends or additional business writes appeared in the test traces. This was not a comprehensive org-wide audit of integrations, asynchronous side effects or every field.

## Product findings from actual failures

1. **Navigation and context acquisition cost time.** The page task took 75 tool steps. Missing “Edit Page” in Quick Settings did not mean the capability was unavailable; the agent recovered through Object Manager.
2. **References become stale.** The update and repair runs recovered from invalid/stale element references. The repeat recovered from a missing network-request reference. These are candidates for better tool context and retry handling.
3. **Rocket needed one setup repair.** Before testing, its UI automation endpoint pointed to a dead port. The evaluator restored the discovery file to the verified running instance; Rocket was never restarted.
4. **Source tracking needs a fix.** Rocket marked the research answer's All Open Leads link unopened, although the stored browser trace shows navigation to that exact URL followed by reading the populated list. All three external company citations were correctly recorded as opened.
5. **Shared-workspace change attribution is imperfect.** The research chat displayed two changed files while its trace contained no file-edit tools. Evaluator transcript sanitization ran concurrently. That UI indicator is not sufficient evidence that the tested agent edited files.

No Salesforce-specific application code or connector was built for these runs. The tested chats were explicitly instructed not to read the answer key, lab files or other chats; the shared workspace was not technically isolated. Tests used one model, one administrator session, a small fictional dataset and unusually explicit requirements. Broad capability looks promising; unattended reliability, vague-request interpretation, restricted-user behavior, large datasets and cross-model consistency remain unmeasured.

## Evidence

[Exact prompts and expected outcomes](runs-2026-10-11/manifest.json), [final fixture comparison](runs-2026-10-11/final-fixture-differences.json), [saved page verification](runs-2026-10-11/test3-reopened-page.json), [Flow metadata](runs-2026-10-11/test4-flow-final.json), [Salesforce debug responses](runs-2026-10-11/test4-debug-responses.json), and [repeat read-back](runs-2026-10-11/test2-repeat-after.json).

Full test transcripts and before/after records are in [the evidence folder](runs-2026-10-11/). JWT-shaped resource tokens were redacted from transcript exports. Repository typecheck and all 271 existing tests passed; those checks validate the repository, not Salesforce task reliability.

