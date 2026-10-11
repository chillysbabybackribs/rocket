# Model efficiency audit (Rocket host + providers)

Audit of **rocketv1** for changes that could make models **faster**, **smarter**, or **more token- and latency-efficient**. Scope: provider adapters, context assembly, tools, browser, orchestration, and UI paths that affect what models see or how long they wait. Not a performance audit of Electron rendering except where it blocks the agent loop.

Related artifacts already in the repo:

- [Provider updates (Oct 2026)](research/provider-updates-2026-10.md) — steer, Cursor ACP gaps, context meter, images, effort.
- [Long chats plan](long-chat-plan.md) — host/UI transcript cost (implemented).
- [Browser agent capabilities plan](browser-agent-capabilities-plan.md) — observation token budget, a11y default eval.

---

## Executive summary

Rocket already invests heavily in **efficiency where it hurts most**: indexed handoffs, paged transcripts, lazy tool output, session **prepare** on compose, **steer** for Claude/Codex, Codex **thread/inject_items** for cross-provider history, handoff **budgets**, tool output **clipping**, and browser results **spilled to disk**. The largest remaining **systematic** costs are:

1. **~5k characters of `<agent-environment>` prepended on every turn** (static map + rules + live “where you are”), while workspace/browser/teamwork blocks are mostly incremental.
2. **Cross-provider handoff text re-entering provider session history** on Claude and Cursor (documented in `handoff.ts`) — smart for correctness, expensive when users rotate providers often.
3. **Provider parity gaps** that force queueing, dropped signals, or extra turns (Cursor steer, Cursor todos → plan, missing usage on Cursor turns, Antigravity images/steer).
4. **Browser observation defaults** still biased toward large text digests unless models choose `focus: 'a11y'` or narrow selectors — eval not promoted to default.
5. **Tool surface area** (~29 MCP tools, long browser tool descriptions) with Claude **tool search disabled** — good for latency to first tool, costly in fixed prompt size.

Recommendations below are ordered by **impact × feasibility**. None require product rewrites; most are adapter/context policy changes or finishing work already specified in research docs.

---

## What already helps (keep / extend)

| Area | Mechanism | Where |
|------|-----------|--------|
| Cold start | `Hub.prepare` + Composer warm-up on focus/first keystroke/turn end | `hub.ts`, `Composer.tsx` |
| Mid-turn input | Steer for Claude (`priority: 'next'`) and Codex (`turn/steer`) | `hub.ts`, `claude.ts`, `codex.ts` |
| Cross-provider memory | Handoff with 30k char budget, 3 full recent turns, file lists without re-search | `handoff.ts`, `hub.handoffFor` |
| Codex history | `thread/inject_items` instead of repeating handoff in every user string | `codex.ts` |
| Tool output | `clipOutput` (6k tail), browser `RESULT_LIMIT` 12k → file | `json.ts`, `browser.ts` |
| Long chats | Indexed `items_by_turn`, paged open, on-demand tool output | `long-chat-plan.md` |
| Streaming UI | Delta coalescing ~16ms frame batch to renderer | `host/index.ts` |
| Browser | Tab list only when changed; research guide in tool schema not duplicated in context | `browser.ts` |
| Workspace | File map once per **fresh** session; notes incremental | `workspace.ts` |
| Teamwork | Concurrent editors + git snapshot diff; git rules once per fresh session | `teamwork.ts` |
| Codex noise | Bundled browser/UC plugins disabled at app-server start | `codex.ts` |
| Claude tools | `ENABLE_TOOL_SEARCH: 'false'` — no extra lookup hop for ~29 tools | `claude.ts` |
| Images | Hidden Codex turn per picture; max 2 parallel | `image.ts` |
| Orchestrator | Cap 3 concurrent workers; one provider slot per orchestration | `orchestrator.ts` |

---

## Findings and opportunities

### 1. Per-turn context prefix (tokens + latency)

**Current behavior:** `Hub.runTurn` prepends assembled context to the provider payload every message (`told(fresh)` only gates workspace/teamwork/browser sub-blocks). **`agentSituationContext()` runs every turn** and includes the full static `AGENT_SITUATION`, **`describeMap()`** (~1.6k chars), and live shell line — **~5k chars total** (measured in-process, Oct 2026).

**Why it exists:** Models navigate the finite shell by name; tests require the block every turn (`agent-situation.test.ts`).

**Cost:**

- **Tokens:** Every user message in a long Claude/Cursor session re-carries static instructions + full place/action map unless the provider deduplicates (often it does not).
- **Latency:** Each turn awaits `askWhere` (browser round-trip) with no short timeout in the success path; photocraft brief races 400ms-style timeouts elsewhere.

**Smarter / cheaper options (pick one strategy):**

| Strategy | Smarter? | Faster/cheaper? | Notes |
|----------|----------|-----------------|-------|
| **A. Split static vs dynamic** | Same | High | First message of a provider session: full block. Later turns: only `<agent-environment>` “Where you are” + diff if place changed. Map/rules move to once-per-session (Claude: system/session; Codex: inject once; Cursor: first prompt only). |
| **B. Hash-gated map** | Same | Medium | Send full `describeMap()` only when `app-map.ts` bundle hash changes or session is fresh. |
| **C. Shorter map in context** | Slightly worse | Medium | Context carries place names only; params stay in tool schemas (already duplicated there today). |
| **D. Status quo** | Best grounding | Worst tokens | Keep for maximum reliability. |

**Recommendation:** Implement **A** behind a flag or provider capability matrix; re-run a small eval (UI map tasks + browser tasks) before defaulting on.

---

### 2. Cross-provider handoff in session history

**Current behavior:** `buildHandoff` produces a tagged block prepended via `withHandoff` for Claude/Cursor (`handoff.ts` lines 18–19). Codex injects equivalent messages once via `thread/inject_items`.

**Cost:** On Claude/Cursor, after switching providers, handoff content can remain in **session history** and be re-read on later turns — multiplies the 30k budget work.

**Smarter / cheaper options:**

- Prefer **inject-once** patterns everywhere the API allows (Claude `shouldQuery: false` user messages — noted in provider-updates doc).
- Track **`seenHandoffHash`** per provider session and skip resending identical handoff text.
- UI nudge: “same provider” default when handoff is large.

**Recommendation:** Medium priority; measure with chats that alternate Claude/Cursor every message.

---

### 3. Provider parity (fewer wasted turns)

| Gap | Effect | Doc / code |
|-----|--------|------------|
| **Cursor no steer** | User messages queue until turn ends; extra wall time | `hub.ts` steer gate; `provider-updates-2026-10.md` §1 |
| **`cursor/update_todos` accepted but not mapped to plan** | Weaker step visibility; model may repeat planning in prose | `cursor.ts` comment vs `plan` update handler |
| **Cursor usage not surfaced** | No token meter; harder to choose fresh session vs continue | `cursor.ts` |
| **Antigravity: no images, no steer** | Forced provider switches or queued messages | `hub.ts`, README |
| **Cursor `session/resume` not advertised** | `session/load` replay drops updates mid-load | `cursor.ts` |

**Recommendation:** Finish **provider-updates** “worth doing first” items 2–4 (Cursor extensions + unified plan item + usage meter). Enables smarter user decisions and fewer duplicate plan/tool turns.

---

### 4. Tool surface and descriptions (prompt size vs first-call latency)

**Current:** ~**29** tools registered in the host; browser tools carry long decision-tree descriptions plus embedded `RESEARCH_GUIDE` (`browser.ts`). Claude explicitly disables tool search.

**Tradeoff:**

- **Tool search on** (Claude): smaller initial prompt, extra round-trip when the model picks wrong tool.
- **Tool search off** (today): faster first tool call, larger fixed prompt.

**Recommendations:**

- Revisit **`ENABLE_TOOL_SEARCH`** when tool count grows (or enable for Antigravity/Cursor-only if schemas differ).
- Split **browser_read** description: keep decision tree in docs/skills; schema holds minimal contract + pointer (browser plan WS1 already aims at eval-driven defaults).
- **`rocket_tool_history`** exists but **does not inject** into prompts (`tool-failure-history.md`) — optional “recent failures for this tool” snippet could reduce retry loops (careful with noise).

---

### 5. Browser observation (smarter grounding, fewer tokens)

**Current defaults** (`browser-page-lib.ts`): `focus: 'all'` uses up to **6k** text + control digest; `text` focus up to **20k**. **`focus: 'a11y'`** exists (plan WS1.1) but is not the default.

**Opportunity:** Run the **provider policy matrix** in browser-agent plan (compact a11y vs text vs hybrid) and promote the winner to default for “fast” models vs “strong” models.

**Already good:** API-first hints in `browser_run` description; network/json attachment on read; result spill at 12k; stale ref retry mentioned in schema.

**Recommendation:** Treat WS1.5 eval as the gate for changing defaults — high leverage for CRM/SPA tasks.

---

### 6. Research and web_read (runaway context)

**`web_read`** allows up to **2M chars** extracted text (`research.ts`). A single call can dominate context.

**Recommendations:**

- Soft cap with “continued in file” pattern (like browser tools).
- Default Readability extract + **max chars** unless `full: true`.
- Stronger coupling to **sources** enforcement (already in `agent-situation` and `sourcesNotice`).

---

### 7. Reasoning effort and model selection (quality per dollar)

**Not exposed in Rocket UI** — effort encoded in Cursor model ids; Codex `turn/start` supports `effort`; Claude supports effort via SDK flags (provider-updates §8).

**Recommendation:** Expose **effort** (or “fast / balanced / deep”) per message or per chat default, read from provider APIs (`model/list`, session config) — avoids hardcoded model lists and lets users trade speed for depth.

---

### 8. Orchestration and parallel workers

**Current:** Up to **3** workers; queue when full; worker assignment injects `<rocket-orchestration>` block (`orchestrator.ts`). Orchestrator shell work in **rocket-orchestrator** notes compact-card markdown cost under many workers.

**Smarter:**

- Strip assignment blob from compact worker cards (already in orchestrator progress doc) — saves human + model tokens in board view, not host context.
- **Provider-aware dispatch:** prefer Codex for batch read-only research, Claude for long edits — only if orchestrator prompt includes provider strengths (product choice).

**Faster:** Renderer coalescing for streaming markdown in worker cards (orchestrator progress task 0006).

---

### 9. Design library skill (unused context hook)

**`designPreparationContext()`** in `design-library.ts` is **not wired** into `Hub` context — only tested. For design-heavy goals, injecting goal-preparation skill once per fresh session would reduce rediscovery without bloating every chat.

**Recommendation:** Wire when PhotoCraft / design-library flows are first-class (see `design-library/skills/goal-preparation/SKILL.md`).

---

### 10. Attachments and images

**Files:** PDF text extraction and previews exist; models get attachment references in user messages, not always full text — good.

**Images:** Provider support varies; Antigravity blocked at send. **Pasting screenshots into messages** (provider-updates §5) would reduce “read this path” tool loops.

**Recommendation:** Message-level image blocks for Claude/Codex/Cursor where supported; keep path-based fallback.

---

### 11. Observability → smarter sessions (not yet closed loop)

**Journal** records slow turns (`firstTextMs`, tokens) and optional self-check nudge (`ROCKET_SELF_CHECK=1`). **No automatic** “start new session when context &gt; N%” — provider-updates §4 context meter.

**Recommendation:** Surface **usage_update** / Claude context / Codex token notifications in UI; optionally suggest **new chat** or **fork** when near limit.

---

### 12. Infrastructure / reliability (indirect speed)

| Item | Risk | Notes |
|------|------|-------|
| Single live turn per chat | By design | Parallelism = multi-chat / orchestrator |
| Git snapshot on teamwork context | Up to 1.5s wait (`CONTEXT_WAIT_MS`) | Skips slow git rather than blocking forever |
| Browser ask timeout 150s | Long tail | Main should fail first; already documented |
| Cursor ACP single process | `update_todos` lacks session id | Plan updates dropped under multi-chat |

---

## Prioritized recommendations

### P0 — High impact, contained changes

1. **Split static vs dynamic agent-environment** (§1A) with eval gate. **Done (Oct 2026):** `agentEnvironmentContext(where, fresh)` in `agent-situation.ts`; rollback with `ROCKET_AGENT_SITUATION=full`.
2. **Map Cursor todos → plan item** and render subagent `cursor/task` outcomes (provider-updates §2–3). **Done:** `planFromTodos`, `cursor/update_todos` and `cursor/task` in `cursor.ts`.
3. **Context window meter** in UI (provider-updates §4). **Done:** live `Turn.tokens` updates from hub; Codex/Claude/Cursor `usage_update`; label in turn head via `shared/context-meter.ts`.

### P1 — Strong leverage, moderate work

4. **Browser default observation eval** → promote a11y or hybrid default (browser plan WS1.5).
5. **Cap or spill `web_read` text** (§6).
6. **Handoff dedup / inject-once** for Claude/Cursor (§2).
7. **Effort control** wired to Codex/Claude/Cursor model config (§7).

### P2 — Product / longer horizon

8. **Cursor steer** when ACP supports it, or document queue-only UX.
9. **Optional tool-failure hints** from ledger (§4).
10. **Wire design-library context** for design goals (§9).
11. **Message images** (§10).
12. **Orchestrator worker card / markdown perf** (§8) in orchestrator shell.

---

## Suggested metrics (before/after)

| Metric | How |
|--------|-----|
| Context prefix size | Log chars of `assemble()` in host (debug flag) |
| Time to first token | Already `TurnTiming.firstTextMs` → journal |
| Handoff build time | `npm run bench:transcript` |
| Browser tokens per task | Scenario harness in browser plan |
| Tool calls per user goal | Manual + orchestrator reports |

---

## Out of scope (deliberate product choices)

- **Shared working folder vs git worktree per task** — provider-updates “keep an eye on”; not inefficiency per se.
- **Auto-commit** — reduces model git noise; keep.
- **Tool ledger in prompt** — avoided by design (`tool-failure-history.md`).

---

*Generated from codebase review, Oct 2026. Re-run provider CLI capability checks against [provider-updates-2026-10.md](research/provider-updates-2026-10.md) when upgrading Claude/Codex/cursor-agent.*
