# Rocket research runs: results and next steps

Date: 2026-10-08. This document is the handoff from the multi-provider research session. Findings below are research results and proposed changes, not implemented application fixes.

## How the session worked

The initial approach used an external research-loop script. It stalled and did not deliver the continuous supervision requested. That controller was stopped. The Codex chat then stayed active as the orchestrator: it watched worker completion, read reports and experiments, challenged unsupported conclusions, and opened fresh worker chats with narrower follow-up assignments. Workers advanced independently rather than waiting for an entire round.

Claude, Cursor, Antigravity and the Codex orchestrator all contributed. Some worker reports were challenged and superseded; more output was not treated as stronger evidence. Provider errors and a quota limit interrupted some assignments. The final instruction was to let running workers finish, dispatch no more work, and leave this handoff.

The user requested each provider's default model near the end. All four pane selections were reset to defaults: Claude reported Opus 5.5, Cursor composer-2.5, Codex GPT-6.1-Sol, and Antigravity its configured default. Existing turns retained their starting models; changing the picker did not retroactively replace them. Earlier runs used several explicit models. Preserve the default policy if research resumes.

## Strongest findings

| Finding | Evidence and practical meaning | Next change to consider |
| --- | --- | --- |
| Opening an artifact can break live UI discovery | Claude reproduced a second Electron instance overwriting `DevToolsActivePort` before it exits after losing the single-instance lock. The original instance remains alive. Reordering the lock in an isolated mirror avoided the overwrite. | Acquire the profile lock before enabling remote debugging; retain the main instance's selected port and verify its endpoint. Add a real-app isolated regression. |
| Eval timeout does not cancel provider work | Codex and Cursor independently used the real Hub/EvalRuns with held fixture adapters. A timed-out cell leaves a running turn. The next trial waits; the last timeout can leave a run marked done with work still active. | Make timeout cancellation and provider ownership explicit. Do not equate locally settled UI state with a stopped provider. |
| Long turns can lose early tool failures from exports | One failure followed by 50 successes exported only the newest 50 calls, and clean-tool grading passed. The exporter applies the turn filter after its global limit and omits completeness. | Filter by turn before pagination; preserve all retained evidence and report incompleteness. |
| Headless evals have no tool ledger | The real headless runtime returned a real `PAGE_UNREADABLE` tool error, but exported no ledger and passed `no_tool_error_codes`, even with a failed transcript item. | Add the ledger observer to the headless runtime; distinguish unavailable evidence from no failures. |
| Tool identity is inferred from display labels | Real adapter translation of synthetic command notifications made `echo goal_report`, searches mentioning the name, and another tool's arguments pass the required-tool grader. | Use exact structured identities. Separate attempted calls from successful calls. |
| Score denominators omit some unsuccessful runs | A fixture with one graded pass and one timed-out/error cell was scored as one pass out of one cell. Historical cohorts are pooled; a requested zero weight is replaced by a default. | Show attempted, graded, missing and cancelled counts separately; validate weights and identify score cohorts. |
| Shared Antigravity tool routing can lose or misassign ownership | With two live fixture chats, shared calls have no chat identity. With only one live chat, every shared call is attributed to it. A late call from another real process remains a hypothesis, not an observed event. | Bind tool calls to a session/chat identity, or explicitly constrain concurrency where the provider cannot do so. |
| Attachment manifests grow outside the body budget | File bodies already have 60,000-per-file and 120,000-per-message character budgets; images are bounded too. A 1,000-file fixture produced about 197,000 manifest characters. Consecutive same-provider turns did not replay everything. | Measure a searchable, bounded attachment index while preserving access to old relevant files. Do not blindly reduce context. |

Source reports and runnable evidence are linked below. These are isolated reproductions and code observations; they are not measurements of production incidence or model quality.

## Claims corrected during review

- A Node `vm` context is not an appropriate security boundary for untrusted code, especially with host helpers injected. The proposed fix was rejected; the underlying host-evaluation path remains a robustness concern.
- A permissive cookie matcher did not establish public-suffix cookie leakage: the isolated Chromium experiment rejected those Domain cookies. Host-only matching remains a narrower product/correctness question.
- Shell automation's access to the app bridge should not be presented as a new sandbox escape when provider shells already have the user's authority. Policy, reliability and security guarantees need separate wording.
- Attachment references surviving text trimming does not prove end-to-end attachment understanding. Conversely, manifest growth does not mean every complete file is reinjected on every turn.
- A successful invocation, a completed turn, and a correct user outcome are different things. Current proxies sometimes conflate them.
- Cursor returned error-shaped assistant text with an apparently normal completion. This occurred during research. Treat the recorded completion as insufficient proof of a delivered report; do not generalize to all provider failures or classify arbitrary quoted error text as transport failure.

## Work products

| Area | Report |
| --- | --- |
| Initial provider investigations | [Claude](round-0001/research-claude.md), [Cursor](round-0001/research-cursor.md), [Antigravity](round-0001/research-antigravity.md) |
| Page-triggered effects and dialogs | [Claude page-effects review](orchestrated/03-claude-page-effects.md) |
| Live discovery and boundary review | [Claude review](orchestrated/02-claude-review-boundaries.md) |
| Lifecycle, cancellation and tool ownership | [Cursor review](orchestrated/02-cursor-review-lifecycle.md) |
| Export and grader counterexamples | [Codex evaluation evidence](orchestrated/02-codex-evaluation-evidence.md) |
| Tool score interpretation | [Codex score semantics](orchestrated/03-codex-score-semantics.md) |
| Timeout reproduction | [Codex timeout evidence](orchestrated/04-codex-timeout-evidence.md) |
| Recovered attachment and adapter experiments | [Orchestrator review](orchestrated/05-codex-review-recovered-evidence.md) |
| Attachment retrieval prototype | [Antigravity experiment report](orchestrated/05-antigravity-attachment-retrieval.md), qualified below |
| Headless runtime evidence gap | [Codex headless evidence](orchestrated/06-codex-headless-evidence.md) |

Earlier Antigravity reviews (`02-antigravity-verify-context.md` and `03-antigravity-evidence-review.md`) remain for provenance. Use the recovered-evidence review for the corrected interpretation. Its later quota-limited assignment did not produce the intended `04-antigravity-bounded-context.md`, but its experiments were saved and rerun successfully.

## Recommended next work, in order

1. **Make verification trustworthy.** Fix export completeness, headless ledger recording, exact tool identity, negative invocation semantics and evidence-aware grades. Add regressions that currently give false passes. Otherwise subsequent improvement claims rest on unreliable measurements.
2. **Fix the reproducible live-discovery defect.** Keep the single-instance lock ahead of debugging startup, retain the chosen endpoint, and verify opening an artifact does not break automation. Test in an isolated built Rocket instance; the existing experiment used a mirror.
3. **Define cancellation ownership before implementing it.** Timeouts need bounded handling, explicit unresolved/quarantined state and protection against late events. Shared adapters cannot be killed casually while another chat is using them. Then test ignored/rejected cancellation and natural-completion races.
4. **Correct tool attribution and score coverage.** Bind identities wherever supported; show ambiguity explicitly. Separate reliability, task success and coverage rather than compressing missing evidence into a favorable score.
5. **Measure context retrieval quality.** Use deterministic old-relevant-file tasks amid irrelevant history. Compare the current manifest with a bounded index; preserve current attachments and discoverability. Pick budgets from results, not generic model-context advice.
6. **Resume focused research only for unresolved questions.** Keep the live orchestrator pattern: one assignment per fresh worker, default models, a report plus reproducible evidence, independent review, and a next question derived from the accepted result. Check both terminal status and actual deliverables. Respect provider quota/reset signals and user stop requests.

No app-source fixes from these reviews were implemented during the live research phase. After the stop request, the user separately requested a reusable orchestration tool; that implementation is described in docs/orchestrator.md. Initial controller work exists separately; it is stopped and should not be mistaken for the requested live orchestrator. Reproduction scripts use temporary stores/profiles and fixture adapters unless their reports explicitly say otherwise.

## Final worker outcomes and validation

- Cursor's bounded-cancellation follow-up ended with `RetriableError: [unavailable] PING timed out`; the app recorded completion, but no intended report was delivered. Its earlier lifecycle review is complete. The proposed cancellation design remains unfinished; no replacement was launched after the stop instruction.
- Antigravity's default-model attachment follow-up completed. It measured the library's metadata-only search and 200-item result cap, and built an isolated catalog prototype. Accept the fixture measurements; reject the report's broad “strictly unreachable,” “per turn on every model,” and general “100% retrieval” language. Filename filters can still find older files, same-provider turns do not necessarily carry a handoff, and the catalog test searched two deliberately seeded exact tokens. Its 160-character snippets and first 20 keywords do not guarantee retrieval of arbitrary later content. Character-to-token estimates were not measured. The prototype is a research candidate, not a validated production solution.
- Claude completed the final page-effects review. Isolated Electron fixtures showed page-triggered confirms being auto-accepted, draft loss on navigation, and lingering native dialogs. Remote page-only routes to local files were blocked in the tested cases; explicit agent operations could read local files. These finite tests do not establish that all possible remote-page routes are blocked. Proposed dialog defaults and scheme restrictions remain product decisions and unimplemented fixes.
- Typecheck passed. All 246 existing tests passed (zero failures). These checks establish baseline consistency, not implementation of the proposed fixes. The orchestrator also reran the recovered attachment/grader experiments and the new headless-runtime reproduction successfully.


The research loop is stopped: all three workers settled, and no replacements were dispatched after the drain request. The later orchestration-tool implementation is a separate task.
