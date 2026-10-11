# Review of evidence recovered from the quota-limited Antigravity worker

2026-10-08. The worker reached its provider quota before writing its report. This is the orchestrator's review of saved experiments, not a completed Antigravity report. Both `evidence-04-antigravity/experiment-attachments.ts` and `experiment-grader.ts` were rerun successfully by the orchestrator using Node's type transformation. They use temporary stores and recorder adapters, with no live model calls. Source files were read directly to check interpretation.

## Context findings accepted

`src/host/providers/images.ts:11` caps extracted body content at 60,000 characters per file and 120,000 per message. Wrappers and the manifest are outside that budget. `src/host/handoff.ts:80` collects attachment references from all input turns independently of the trimmed text blocks. `src/host/hub.ts:520` deduplicates and resolves current attachments followed by reversed historical attachments.

The experiment's 1,000 historical text files produced 317,813 attachment-text characters, of which 196,769 were manifest characters. Only 12 file bodies were included; their content plus wrappers was 121,044 characters. This supports a manifest-growth finding, not unbounded full-file reinjection. Exact lengths depend on generated names and paths and are fixture results, not token counts.

A consecutive second Codex turn had zero historical attachments. Alternating providers after the initial switch carried one missed turn plus the current attachment, not the entire history. A simulated lost session retried with the full history. Any upgrade should preserve these distinctions.

Image selection is also bounded: ten small images, or four of the fixture's approximately 4.4 MB images under the 20 MiB aggregate cap. These are local assembly checks, not proof of successful delivery or model understanding at a provider. Antigravity receives historical image paths with pixels disabled; the current-image send is rejected locally.

Deleting a historical attachment database row in a synthetic fault causes repeated pre-adapter failure for a provider needing that history; the already-current provider continues. The fixture explicitly notes this is not reachable through ordinary collection for a live chat. Treat it as recovery robustness, not evidence that normal cleanup loses attachments. A missing text file on disk instead receives a missing-copy marker.

Useful next investigation: design a bounded, searchable attachment manifest with stable references, preserving recent/current attachments and a discoverable index. Measure retrieval success before choosing a budget. A universal smaller context cap has not been justified.

## Grader findings accepted with limits

The grader experiment injects synthetic notifications through the real CodexAdapter notification handler, then the real Hub, Store, exporter and grader. It does not run the Codex CLI. A completed `echo goal_report` notification becomes a done command labelled `echo goal_report`; `goal_report_called` passes with no corresponding ledger call. A search command mentioning the same name and a different MCP tool whose arguments contain it also pass. Claude label generation shows the same class of problem.

This is stronger than a hand-written final export: ordinary supported adapter paths create misleading labels. It establishes an incidental false-positive mechanism as well as a possible deliberate one. It does not establish that an actual model attempted to exploit the grader.

Reject overinterpretation of the fixture row assigning `status: completed` to exit code 1: upstream reachability of that combination was not independently verified here. It is unnecessary to prove the defect, because successful echo and matching search examples already suffice. Also, the fixture's `correct` column judges the positive grader; it must not be read as validating the negative grader. A failed real call still passes `tool_not_called`, which is the separate semantics defect recorded in the earlier Codex report.

Suggested regression contract: exact structured tool identity for invocation checks, outcome checked separately for success, and an explicit unknown result where structured evidence is incomplete. Labels are presentation text and should not establish tool identity. Verify both the live ledger path and the headless export path before removing fallbacks.

## Still open

- Provider-end delivery and task quality under manifest growth have not been measured.
- Normal-path attachment deletion reachability needs a separate audit before prioritizing recovery behavior.
- The upstream command status combination above remains unverified.
- The worker's intended report `04-antigravity-bounded-context.md` was not produced; these accepted findings supersede unsupported runaway-body and synthetic-only interpretations in its earlier reports.
