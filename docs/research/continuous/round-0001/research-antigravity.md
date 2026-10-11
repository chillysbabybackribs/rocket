# Product Capabilities and Context Workflows (Round 1: Antigravity)

## 1. Context and Memory Workflows

### 1.1 Chat Handoff Mechanism
**Observation:**
When a session is switched between providers, or an old session is resumed, `src/host/handoff.ts` (`buildHandoff()`, lines 51-82) manages the context. It provides a tagged block (`<conversation_handoff>`) representing missed turns. 
To control token usage, older turns (beyond the newest 3) are severely truncated:
- `user` text is elided to 1,500 characters (`OLDER_USER_CHARS`).
- `reply` text is elided to 1,200 characters (`OLDER_REPLY_CHARS`).
- Reasoning/narration (text before tool calls) is excluded completely (`replyOf` in `src/host/handoff.ts:125`).
- The total handoff block is capped at 30,000 characters (`HANDOFF_BUDGET_CHARS`), after which oldest turns are dropped entirely, replacing them with a note about missing turns.

**Limitations & Upgrades:**
A fixed 30K character limit (~7,500 tokens) is unnecessarily restrictive for modern context windows (e.g., 200K+ tokens for Claude 3.5 Sonnet / Gemini 1.5 Pro). This aggressive truncation deletes context and intermediate reasoning, potentially causing cascading failures in long research/coding loops.
*Actionable Upgrade:* Make `HANDOFF_BUDGET_CHARS` dynamic based on the active provider's known context limit and the user's available token budget, or simply raise the default budget substantially for models with larger context windows.

### 1.2 Cross-Agent Workspace Context (Teamwork)
**Observation:**
Agents share workspace state implicitly through Git snapshots and explicitly through `<others>` and `<workspace>` blocks.
- `src/host/workspace.ts:130` injects `git ls-files` output into the first message of a session, showing the tree structure.
- The `remember` tool (`src/host/tools/memory.ts`) enables cross-agent persistence by storing small facts (`m<seq>`) visible to all sessions in the folder.
- `src/host/teamwork.ts:57` calculates file deltas between the start and end of a turn (`patchBetween`) and commits them automatically, attributing the commit to the agent. Concurrent modifications by other agents are detected and excluded from the turn's commit (lines 128-131).

## 2. Sources and Verification

**Observation:**
Rocket employs a strict heuristic to verify citations. `src/shared/sources.ts:39` cross-references URLs cited in the agent's reply against URLs explicitly opened (e.g., via `web_read` or `browser_read`). If a cited URL was not opened, `sourcesNotice` generates a harsh prompt warning for the next turn: `"The last reply in this chat cited X pages its turn never opened... A search result is a lead, not a source."` (lines 68-73).

**Limitations:**
The matching algorithm in `pageKey` (`src/shared/sources.ts:9`) strips subdomains like `www.`, tracking parameters, and trailing slashes. While robust for standard HTTP URLs, it returns `null` for non-HTTP links (e.g., local files, `file://` URIs). This means citations to local artifacts or library files aren't tracked as "verified sources".

## 3. Library and Attachments

**Observation:**
The library shelf (`src/host/library.ts:53`) acts as a persistent project index, distinct from the workspace files. It tracks attachments, browser downloads, generated Markdown plans, and manually opened files.
- Previews are generated asynchronously using `pdftoppm` for PDFs and `ImageMagick` (`convert`) for images (lines 188-219), strictly limited to 2 concurrent background tasks (`PREVIEW_SLOTS = 2`, line 30).
- Text and Markdown previews are limited to 3,000 characters (`PREVIEW_TEXT`, line 25).
- If ImageMagick is missing, small images act as their own preview, but images >2MB fallback to an unhelpful type mark (line 207).

**Limitations & Upgrades:**
Office files (`kind === 'office'`) only show a preview if a `docProps/thumbnail.jpeg` exists within the zip container (`src/host/library.ts:214`). If absent, it fails gracefully. 
*Actionable Upgrade:* If `libreoffice` or `unoconv` is installed on the host, use it to generate reliable Office file previews instead of solely relying on embedded zip thumbnails.

## 4. Extensibility & UI Integration

**Observation:**
The UI is heavily mapped and explicitly accessible via the `app-map.ts` architecture, served to agents via loopback MCP (`src/host/tools/ui-map.ts`). The live window runs over the DevTools protocol (`src/main/browser-agent.ts`). Isolated test targets create a scratch workspace and use Xvfb.

**Unresolved Questions for Next Rounds:**
1. Does the aggressive truncation of `user` messages in the handoff block (`OLDER_USER_CHARS` = 1,500) corrupt attachments passed inside `<file>` blocks in earlier user prompts, or are attachments completely segregated from this truncation logic?
2. How resilient is `rocket_ui_run` isolated mode (`target: "isolated"`) to concurrent research runs? The README notes "Providers in the same chat share this isolated inspection session," but what if multiple chats invoke isolated runs simultaneously?
3. Should the strict `sourcesNotice` validation apply to local library files, and if so, how do we distinguish between general external citations and internal project references?
