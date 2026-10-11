# Context Verification & Validation (Round 2: Antigravity)

## 1. Context Budget & Truncation Heuristics

**Correction of Round 1 Findings:**
The previous report claimed that the `HANDOFF_BUDGET_CHARS = 30_000` limit was unnecessarily restrictive for modern context windows and recommended a dynamic or substantially increased limit. This recommendation failed to measure the actual capacity of the 30k budget and incorrectly assumed that "larger context is better" without considering the precise checkpointing strategy Rocket employs.

**Measured Behavior:**
1. **Precise Checkpointing vs. Replay Size:** `src/host/handoff.ts` drops internal reasoning and tool outputs (`replyOf`), keeping only the final text conclusion of each turn and the files touched.
2. **Payload Capacity:** A synthetic fixture (`test-attachments.ts`) demonstrated that even with heavily truncated turns (1,000 chars of user text, 1,000 chars of reply), the `buildHandoff` logic prioritizes recent turns and dynamically elides older ones. With a standard 400-character reply conclusion, roughly 65 turns fit within the 30K budget (`HANDOFF_BUDGET_CHARS`). 
3. Increasing the replay size is inefficient and risks diluting the model's focus with obsolete reasoning loops. The current strategy of maintaining files touched and exact conclusions is a superior state-retrieval mechanism.

## 2. Attachment Retention in Truncated Handoffs

**Correction of Round 1 Findings:**
The previous report raised an unresolved question about whether the aggressive truncation of user messages (`OLDER_USER_CHARS` = 1,500) corrupts or drops attachments passed inside `<file>` blocks in earlier user prompts.

**Measured Behavior:**
Attachments are fully segregated from text truncation logic. 
- In `src/host/handoff.ts` (lines 80-81), the attachment collection maps directly over the raw `turns` array (`turns.flatMap(turn => turn.items.flatMap(item => item.type === 'user' ? item.attachments ?? [] : []))`), operating completely independently of the `fit(blocks, budget)` text truncation.
- A synthetic test was executed in `docs/research/continuous/orchestrated/evidence-02-antigravity/test-attachments.ts`, submitting 100 turns (each with an attachment) and severely restricting the text budget. While 94 out of 100 turns were dropped from the text handoff, **100% of the attachments were preserved and returned** in the handoff object.
- Furthermore, `src/host/hub.ts` and provider adapters (e.g., `src/host/providers/claude.ts`) deduplicate these attachment IDs and explicitly rebuild them as image blocks in the provider payload. No attachment loss occurs during deep conversation history.

## 3. Local Source Verification

**Correction of Round 1 Findings:**
The previous report noted that `pageKey` (`src/shared/sources.ts`) returns `null` for non-HTTP URLs, flagging it as a limitation because local file citations are not tracked as "verified sources". It implied an upgrade was needed to support local artifact verification.

**Refined Assessment:**
- Rocket’s source verification is "deliberately dumb" (`src/shared/sources.ts:6`), strictly tracking whether a URL was opened via `web_read` or `browser_read`. 
- Expanding this to local files fundamentally conflates two separate concepts: "the file was opened" and "the claim about the file is supported." 
- A semantic matching tool would be required to verify if a local codebase claim is accurate. Rocket intentionally avoids using LLM calls for source verification (as it would introduce latency and cost).
- Current user workflows do not require rigid citation enforcement for local codebase files; the workspace context and Git history (`patchBetween`) provide implicit and reliable state management. Therefore, adding semantic verification for local files is a non-goal.

## 4. Unresolved Questions for Next Phase
1. How does `rocket_ui_run` handle cross-contamination or concurrent task scheduling when `target: "isolated"` is invoked by multiple simultaneous chats? (Needs verification of `src/main/browser-agent.ts` isolation boundaries.)
2. How resilient is `HANDOFF_BUDGET_CHARS` when the conclusion text itself (`replyOf`) contains massive raw data dumps that the user explicitly requested, rather than reasoning steps?
