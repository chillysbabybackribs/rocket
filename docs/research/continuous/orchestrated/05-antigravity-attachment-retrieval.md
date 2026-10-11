# Bounded Searchable Attachment Manifest and Retrieval Analysis

**Date:** 2026-10-08  
**Author:** Antigravity Worker  
**Context:** Follow-up to `docs/research/continuous/orchestrated/05-codex-review-recovered-evidence.md` and `evidence-04-antigravity/experiment-attachments.ts`.  
**Evidence directory:** `docs/research/continuous/orchestrated/evidence-05-antigravity/`  
**Deterministic reproduction:**  
```bash
node --experimental-transform-types --disable-warning=ExperimentalWarning \
  docs/research/continuous/orchestrated/evidence-05-antigravity/experiment-retrieval.ts
```

---

## 1. Executive Summary

1. **Current Manifest Bloat is Linear $O(N)$:**  
   In `src/host/providers/images.ts:22-48`, while file body injection is bounded by `MESSAGE_FILE_CHARS = 120_000` (`src/host/providers/images.ts:12`), the attachment manifest itself lists **every single historical attachment** without any count or character budget. In measured testing across 7 history depths ($N = 1$ to $1,000$ files), manifest text grew from 182 characters ($N=1$) to 184,889 characters ($N=1,000$), imposing ~46,000 tokens of prompt overhead per turn on every model.

2. **Naive Manifest Truncation Destroys Discoverability:**  
   If the manifest in `attachmentInput` is naively capped at $K$ recent entries (e.g. $K=15$ or $K=20$):
   - Any attachment older than $K$ is completely omitted from the model prompt.
   - If the user or task refers to the file by content (e.g. "find the budget allocation for Apollo" or "find the memo authorizing ZEUS"), fallback to `library_list` **fails completely (0% discovery)** because `matchesFilters` (`src/shared/library.ts:99-100`) only matches against `[entry.name, entry.origin, entry.path, chatTitle]` and does **not** search attachment content.
   - If the chat has more than 200 attachments ($N > 200$), unfiltered `library_list` calls hit `LIMIT_MAX = 200` (`src/host/tools/library.ts:12, 47`). Because `library_list` has **no pagination (`offset` or `cursor`)**, the oldest $N - 200$ attachments become **strictly unreachable**.
   - For PDF attachments, `library_list` only returns `entry.path` (`.pdf`), omitting `textPath` (`.extracted.txt`), forcing external re-extraction.

3. **Validated Solution — Bounded Catalog Manifest Prototype:**  
   An isolated prototype (`buildBoundedCatalogManifest`) in `evidence-05-antigravity/experiment-retrieval.ts` demonstrates that keeping the top 15 recent attachments in the prompt manifest while indexing older attachments into an on-disk session catalog file (`.attachments-catalog.json`) achieves:
   - **$O(1)$ Bounded Prompt Footprint:** 4,798 characters at $N=1,000$ files (a **97.4% reduction** from 184,889 characters).
   - **100% Retrieval Success:** Both mid-history (offset 125) and ancient (offset 249) files were successfully resolved by content keyword and distinctive tokens.
   - **Pre-Extracted PDF Access:** The catalog provides `textPath` directly, enabling direct single-step reading without external `pdftotext` execution.

---

## 2. Code Inspection & System Grounding

### 2.1 Attachment Injection Pipeline
- **Collection across turns:** `src/host/handoff.ts:80` extracts all attachments from historical user turns:
  ```ts
  const attachments = turns.flatMap(turn => turn.items.flatMap(item => item.type === 'user' ? item.attachments ?? [] : []))
  ```
  Note: In `handoff.ts:99`, the handoff narrative only lists `[File: name; attachment id]`, omitting filesystem paths. Furthermore, `fit(blocks, budget)` in `src/host/handoff.ts:178-184` drops older turns once history exceeds `HANDOFF_BUDGET_CHARS = 30_000`.
- **Deduplication and Ordering:** `src/host/hub.ts:520` resolves attachments:
  ```ts
  const resolved = (history: Handoff | null): ProviderAttachment[] =>
    this.resolveAttachments([...new Set([...attachments, ...(history?.attachments ?? []).toReversed()].map(image => image.id))])
  ```
  Current turn attachments come first, followed by historical attachments in reverse chronological order (newest first).
- **Manifest & Body Assembly:** `src/host/providers/images.ts:22-48` builds the text payload:
  - Capped body injection: `MESSAGE_FILE_CHARS = 120_000`, `FILE_CHARS = 60_000` (lines 11-12). Once budget is exhausted, `bodies.push()` stops.
  - Uncapped manifest lines: Every attachment generates a manifest line (`lines 32-45`):
    `[File attachment <id>: "<name>"; <description>; file "<path>"; <status>]`
  - All adapters (`ClaudeAdapter`, `CursorAdapter`, `CodexAdapter`, `AntigravityAdapter`) consume `attachmentInput` (`src/host/providers/antigravity.ts:201`, `src/host/providers/codex.ts:151`).

### 2.2 Available Discovery and Reading Tools
- **Tool Catalog Truth:** In `src/host/index.ts:169-185`, the active MCP tools are registered:
  - `browserTools`: `web_read`, `web_search`, `browser_read`, `browser_run`, `browser_download`, `browser_screenshot`
  - `uiSnapshotTools` / `uiMapTools` / `uiRuns`: `rocket_ui_snapshot`, `rocket_ui_where`, `rocket_ui_go`, `rocket_ui_act`, `rocket_ui_run`
  - `toolHistoryTools` / `toolReviewTools`: `rocket_tool_history`, `rocket_tool_review`
  - `memoryTools`: `remember`
  - `libraryTools`: `library_list` (`src/host/tools/library.ts:22`)
  - `askTools`: `ask_user`
  - `goalTools`: `goal_report`
- **Critical Finding — No Attachment Resolution Tool:**  
  There is **no MCP tool** in Rocket (`src/host/tools/`) to resolve an `attachmentId` to a filesystem path or to search attachments by ID.
- **`library_list` Tool Capabilities and Constraints:**
  - Registered in `src/host/tools/library.ts:22`.
  - Filter parameters: `source`, `kind`, `chat`, `added`, `q`, `limit`.
  - Bounded results: Default `LIMIT = 50`, `LIMIT_MAX = 200` (`src/host/tools/library.ts:11-12, 47`).
  - Search logic (`src/shared/library.ts:99-100`):
    ```ts
    const haystack = [entry.name, entry.origin, entry.path, entry.chatId ? chatTitle(entry.chatId) : ''].join('\n').toLowerCase()
    return q.split(/\s+/).every((word) => haystack.includes(word))
    ```
    Matches **only** against filename, origin (`"attachment"`), path, and chat title. Attachment bodies and extracted PDF text are completely excluded from `haystack`.
  - Lack of pagination: Does not accept `offset` or `cursor`.
  - Path limitation: Returns `entry.path` (`.pdf`), not `textPath` (`.extracted.txt`).

---

## 3. Measured Experimental Findings

The deterministic fixture `docs/research/continuous/orchestrated/evidence-05-antigravity/experiment-retrieval.ts` executed with real SQLite `Store`, real `AttachmentStore`, real `Hub`, real `Library`, real `libraryTools`, and real `attachmentInput`. All numbers below are measured directly from `evidence-05-antigravity/experiment-retrieval.json`.

### 3.1 Scaling: Manifest Growth vs History Depth

| History Attachments ($N$) | Baseline Manifest Chars | Baseline Entries | Naive $K=15$ Manifest Chars | Prototype Prompt Chars | Catalog Disk Size |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **1** | 182 | 1 | 182 | 303 | 0 B |
| **10** | 1,829 | 10 | 1,829 | 3,039 | 0 B |
| **50** | 9,189 | 50 | 2,759 | 4,750 | 16.1 KB |
| **100** | 18,389 | 100 | 2,759 | 4,751 | 39.2 KB |
| **250** | 46,139 | 250 | 2,774 | 4,797 | 108.6 KB |
| **500** | 92,389 | 500 | 2,774 | 4,797 | 224.3 KB |
| **1,000** | 184,889 | 1,000 | 2,774 | 4,798 | 455.8 KB |

- Baseline manifest growth is linear: $\Delta \approx 184.8$ characters per attachment.
- At $N=1,000$, baseline injects **184,889 characters** of manifest text alone before any message content or tool definitions.
- The isolated Prototype caps prompt overhead at **4,798 characters** ($N=1,000$), storing the 985 older file descriptors in a 455 KB JSON catalog.

### 3.2 Reachability & Discovery Analysis ($N = 249$ Attachments)

We evaluated retrieval of 4 target files placed at distinct historical depths:
1. `contract-recent.txt` (Recent: turn 248, offset 2)
2. `memo-mid.txt` (Mid-history: turn 125, offset 124, content: `ZEUS_SECRET_789`)
3. `report-ancient.txt` (Ancient: turn 0, offset 249, content: `APOLLO_BUDGET_123`)
4. `spec-ancient.pdf` (Ancient: turn 1, offset 248, extractable PDF text)

| Retrieval Mechanism | Recent Target (turn 248) | Mid Target (turn 125) | Ancient Target (turn 0) | Ancient PDF (turn 1) | Prompt Cost (chars) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Current Baseline** (`attachmentInput`) | Found (path & body in prompt) | Found (path in prompt) | Found (path in prompt) | Found (path in prompt) | 76,950 |
| **Naive Truncation** ($K = 20$) | Found (path & body in prompt) | **LOST (not in prompt)** | **LOST (not in prompt)** | **LOST (not in prompt)** | 3,745 |
| **`library_list(q: filename)`** | Found | Found | Found | Found (gives `.pdf` path only) | Extra tool turn |
| **`library_list(q: content_keyword)`** | N/A | **FAILED (0 matches)** | **FAILED (0 matches)** | **FAILED (0 matches)** | Extra tool turn |
| **`library_list(limit: 200)` (unfiltered)** | Found (in top 200) | Found (in top 200) | **FAILED (cut off at #200)** | **FAILED (cut off at #200)** | Truncated |
| **Bounded Catalog Prototype** | Found (in prompt manifest) | Found via Catalog index | Found via Catalog index | Found via Catalog (provides `.extracted.txt`) | 5,185 |

### 3.3 Key Breakdown of Failure Modes under Naive Truncation

1. **Content Undiscoverability (The Semantic Query Blindspot):**  
   When a user query does not cite the exact filename (e.g., "Review the memo approving Project Zeus" or "What did the ancient budget report allocate?"), `library_list` with `q: "ZEUS_SECRET_789"` or `q: "APOLLO_BUDGET_123"` returned `No files match those filters`. Because older files are excluded from the prompt manifest under naive truncation, the agent has no reference to the file ID or path, making the file **completely undiscoverable**.
2. **The 200-Item Unfiltered Cliff:**  
   In a chat with 249 attachments, `library_list` with `limit: 200` returned entries for turns 50 through 249. Turns 0 through 49 were omitted. In the absence of an `offset` parameter, an agent cannot paginate to retrieve items 201–249.
3. **Missing PDF Text Path:**  
   `library_list` reports `entry.path` (`.../attachments/<id>.pdf`). `AttachmentStore.resolve` creates `textPath` (`.../attachments/<id>.extracted.txt`), but `library_list` omits it. Under naive truncation, an agent must re-extract PDF text via `pdftotext` or `web_read`.

---

## 4. Architecture of the Bounded Catalog Manifest Prototype

The reference prototype in `evidence-05-antigravity/experiment-retrieval.ts` demonstrates an architectural pattern that resolves context bloat without sacrificing discoverability:

```
+-------------------------------------------------------------------------+
| Prompt Manifest (Top K=15 Recent Attachments)                           |
| - Full manifest lines with direct disk paths (/tmp/.../att-1.txt)        |
| - Inlined text bodies for newest files (within 120,000 char budget)     |
|                                                                         |
| Directive for Older Attachments:                                        |
| [Earlier attachments: 234 historical files indexed in catalog           |
|  "/tmp/rocket/.../catalog.json"; search with view_file or grep if needed]|
+-------------------------------------------------------------------------+
                                    |
                                    v (Agent searches on demand via view_file)
+-------------------------------------------------------------------------+
| On-Disk Catalog (.attachments-catalog.json)                             |
| - id: "d0ab1b4f-..."                                                    |
| - name: "report-ancient.txt"                                            |
| - format: "text", size: 98                                              |
| - path: "/tmp/rocket/.../d0ab1b4f.txt"                                  |
| - textPath: "/tmp/rocket/.../d0ab1b4f.extracted.txt" (for PDFs)         |
| - snippet: "Ancient report details: APOLLO_BUDGET_123 = $4.2M..."       |
| - keywords: ["APOLLO_BUDGET_123", "telemetry", "lunar", "orbital"]      |
+-------------------------------------------------------------------------+
```

### Measured Benefits:
1. **Constant Context Scaling:** Regardless of whether the history holds 50 or 1,000 files, the prompt manifest stays between 4,750 and 4,800 characters (~1,200 tokens).
2. **Preserves Recent Flow:** Active work in recent turns continues to have immediate inline bodies and zero-tool-call path availability.
3. **Deterministic Discovery for Deep History:** An agent needing older content can inspect `.attachments-catalog.json` using its existing file-reading tools (`view_file`, `cat`, grep) in a single tool call.

---

## 5. Session Loss & Recovery Robustness

In `exp4_sessionLost` of `experiment-retrieval.ts`:
- A chat with 30 historical files underwent a simulated provider session drop on `codex`.
- On retry, Hub correctly reconstructed the full chat replay: `retryAttemptAttachments = 30`, `retryHandoffTurns = 30`.
- The bounded catalog approach operates deterministically on the resolved attachment set during prompt assembly, avoiding session replay payload blowup.

---

## 6. Unresolved Questions for the Codex Orchestrator

1. **Catalog Storage Location & Lifecycle:**  
   Should the `.attachments-catalog.json` file be written inside the chat's project workspace directory (e.g. `<cwd>/.rocket/attachments-catalog.json`), or inside the private app data directory (`<dataDir>/attachments/catalog-<chatId>.json`)? Workspace storage makes it visible to workspace search tools like `git grep` and native grep, but risks repository pollution unless ignored.
2. **Tool-Driven vs. File-Driven Search:**  
   Should older attachments be discovered via an on-disk JSON file (zero changes to MCP tool catalog schemas, accessible by all agent types via standard file reading), or by adding an `offset` parameter and full-text search (SQLite FTS5) to `library_list`?
3. **Indexing Scope for Non-Text Media:**  
   For historical image attachments where `pixels` are omitted, should the catalog store vision model captions or OCR text, or is metadata (name, dimensions, thumbnail path) sufficient?

---

## 7. Artifact Links & Deliverables

- Report: [docs/research/continuous/orchestrated/05-antigravity-attachment-retrieval.md](file:///home/dp/Desktop/rocketv1/docs/research/continuous/orchestrated/05-antigravity-attachment-retrieval.md)
- Evidence Directory: [docs/research/continuous/orchestrated/evidence-05-antigravity/](file:///home/dp/Desktop/rocketv1/docs/research/continuous/orchestrated/evidence-05-antigravity/)
  - [make-fixtures.py](file:///home/dp/Desktop/rocketv1/docs/research/continuous/orchestrated/evidence-05-antigravity/make-fixtures.py)
  - [experiment-retrieval.ts](file:///home/dp/Desktop/rocketv1/docs/research/continuous/orchestrated/evidence-05-antigravity/experiment-retrieval.ts)
  - [experiment-retrieval.json](file:///home/dp/Desktop/rocketv1/docs/research/continuous/orchestrated/evidence-05-antigravity/experiment-retrieval.json)
