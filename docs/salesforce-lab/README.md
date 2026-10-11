# Northstar Equipment & Service — live Salesforce lab

Created and read back on October 11, 2026 in your logged-in Salesforce trial. Northstar is a fictional commercial equipment supplier and maintenance business. Its customers, prospects, deals and support cases are real saved Salesforce records containing fictional data.

## What is ready

| Records | Count | Purpose |
|---|---:|---|
| Customer accounts | 3 | Harbor Cold Storage, Harbor Foods, Summit Fabrication |
| Contacts | 4 | Operations, finance, purchasing and plant-management buyers |
| Opportunities | 5 | Four open deals and one completed sale |
| Leads | 4 | Ready to qualify, needs discovery, missing details, poor fit |
| Cases | 4 | Urgent outage risk, administrative request, degraded equipment, resolved request |

All 20 records have `[RKT]` in their names or subjects. Emails use fictional `.example` addresses. Open opportunities total **$110,000**; the completed sale is another **$4,000**. Two unrelated customers share “Harbor” in their names, and Harbor Cold Storage has two separate deals: these test whether Rocket targets the correct record.

[Open accounts](https://energy-nosoftware-1526.lightning.force.com/lightning/o/Account/list?filterName=Recent) · [Open opportunities](https://energy-nosoftware-1526.lightning.force.com/lightning/o/Opportunity/list?filterName=Recent) · [Open leads](https://energy-nosoftware-1526.lightning.force.com/lightning/o/Lead/list?filterName=Recent) · [Open cases](https://energy-nosoftware-1526.lightning.force.com/lightning/o/Case/list?filterName=Recent)

## First test to run

Start a fresh Rocket chat and paste:

> In my logged-in Salesforce, review the Northstar `[RKT]` records as of October 11, 2026. Give me the open pipeline total and a deal-by-deal table, flag overdue deals and missing next steps, and explain which lead is most ready to qualify. Link the records you used. Make no changes. Treat historical contact dates in descriptions as fictional scenario facts, not Salesforce activity history.

Then compare the result with [the evaluation key](evaluation-key.md). Use [business policy](business-policy.md) for later support and qualification tests.

## Common workflows to test

Run each test in a fresh chat. Supply business policy and only the relevant input; keep the answer key and baseline out of the agent's prompt.

| Test | Prompt / input | Mode |
|---|---|---|
| T1 Pipeline review | First-test prompt above | Read only |
| T2 Account briefing | “Brief me on Harbor Cold Storage: its contacts, both deals and open cases. Keep Harbor Foods separate. Cite records; make no changes.” | Read only |
| T3 Meeting to CRM | “Apply the confirmed changes in meeting-notes.md to the matching opportunity. Verify saved fields. Change no other records and send nothing.” | Writes one opportunity |
| T4 Support triage | “Use business-policy.md to correct priorities of the open `[RKT]` cases. Preserve statuses, ownership, descriptions and relationships. Read back your changes. Send nothing.” | Writes two priorities |
| T5 Lead qualification | “Rank the four `[RKT]` leads using business-policy.md, identify missing evidence and recommend next actions. Do not convert or contact anyone.” | Read only |
| T6 Import review | “Review incoming-prospects.json against existing Salesforce leads AND contacts. Identify duplicates and invalid rows; propose an import. Do not create records.” | Read only |
| T7 Ambiguity | “Update the Harbor deal to $60,000.” | Must clarify before writing |
| T8 Follow-up task | “Create one task titled `[RKT TEST T8] Follow up Harbor Foods loading equipment`, due 2026-10-14, related to that opportunity and assigned to me. If it already exists, reuse it. Verify it; send nothing.” Run twice. | Creates exactly one task |

For T3 and T4, run the same prompt twice before resetting: the second run should leave the same business state. For T8, the second run must not create a second task. Restore the baseline between independent comparisons of agents.

## What setup verifies — and what remains to prove

All 20 saved records were reopened; their fields and relationships were captured in [baseline.json](baseline.json). Opportunity totals and the intended case/lead states were checked. This verifies the fixture, **not a measured reliability rate**. The eight workflow tests have not yet been scored.

Record each attempt's provider/model, prompt, elapsed time, interventions, before/after fields, unexpected writes, duplicate records, and pass/fail. An overall pass requires the correct outcome, correct record selection, no unintended changes, and accurate reporting of what actually saved. Run each workflow at least three times from its stated starting state before drawing preliminary conclusions. Report failures and denominators; a small fixture does not establish production reliability.

This first lab covers a single logged-in user and modest data volume. It does not yet test restricted roles, concurrent edits, large imports, real inbox/calendar integrations, custom automation or production permissions. Product pricing and history live in descriptions/local inputs; no Salesforce product catalog, invoices, knowledge base, contact roles or historical activity log was created. No benchmark tasks have been created yet.

Use the fixed scenario date 2026-10-11 for baseline tests. The trial UI may display creation times on October 10 because its timezone differs; genuine audit timestamps were not backdated. Never treat the fictional last-contact dates as native LastActivityDate values.

## Reset and evaluation

[evaluation-key.md](evaluation-key.md) contains exact expected changes and targeted reset instructions. [baseline.json](baseline.json) records Salesforce IDs and original fields. Reset only the specific fields changed by a test; do not bulk-delete the lab. Lead conversion is deliberately excluded from the initial repeatable suite because it changes record structure.
