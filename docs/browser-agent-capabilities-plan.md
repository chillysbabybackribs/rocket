# Browser tools and agent capabilities — optimization plan

> **Status note (2026-10-09), checked against the code.**
> **Done:** WS1.1 a11y snapshot (`browser-a11y.ts`, `focus: 'a11y'`), WS1.2 find as `query` on read
> (`browser-agent.ts`, `browser-a11y.ts`), WS1.3 read header (`readHeader`), WS1.4 run delta
> (`browser-run-delta.ts`), WS2.1 goto settle with `hash`, `title`, `request` (`GotoUntil` in
> `shared/types.ts`), WS2.2 pushState hook on agent tabs (`browser-spa-hook.ts`), WS2.3
> `tab.follow` (`script-worker.ts`), WS2.4 stale-ref retry (`browser-agent.ts` `locate`), WS3.1 JSON
> attach (`browser-json-attach.ts`), WS3.3 HAR (`browser-har.ts`), WS4.1 scroll only if needed
> (`browser-page-lib.ts` `scrollIfNeeded`), WS4.3 SoM (`browser-som-composite.ts`), WS5.1 client
> hints and `window.chrome` (`browser-pane.ts`, `browser-url.ts`, `chrome-object.ts`; see
> `browser-realism-audit.md`), WS6.1 tool copy. Harness cases are in `tests/ui/browser-capabilities.spec.ts`;
> unit tests exist for a11y, JSON attach, HAR and SoM.
> **Open:** WS3.2 `tab.waitForRequest` (no such method in `script-worker.ts`); WS2.1 function
> predicate for `goto` (not in `GotoUntil`); WS5.3 Critical-CH restart; WS6.2 CRM session hint;
> WS6.4 turn-budget copy (not in `browser.ts`); WS5.2 cookie-import eval and docs (not found in
> `tests/ui`); Phase 0 Espo matrix and baseline LLM pass rate; Phase 2 find token eval; WS1.5 policy
> matrix is written but not run; WS4.4 deferred as planned. WS6.3 (sources for SPA partial loads) not confirmed.
> **Open decisions:** default focus is still `all` (`browser.ts`); JSON attach is on for every JSON
> response with a fixed truncation limit and no size gate (`browser-agent.ts`, `browser-json-attach.ts`).
> **Changed:** `browser_find` was not built; `query` on `browser_read` is the find (decision 2).

**Status:** draft, 6 October 2026; status note 9 October 2026 above  
**Scope:** Everything that affects how models use the web in Rocket — browser tools, main-process browser, observation format, agent prompts, evals, and optional shell integration. Nothing is off the table.

---

## Why this plan exists

Live work (EspoCRM demo, CRM research, Cloudflare realism) showed:

1. **Speed-first browser use works** for read-heavy tasks when models use links, batched `browser_run`, and visible XHR hints.
2. **SPAs break the “document ready = page ready” assumption** — hash routes update the URL without a main-frame navigation, so reads can lag the address bar.
3. **Industry direction** (Playwright MCP, accessibility snapshots, find-in-page, snapshot-after-act) is ahead of Rocket’s current **markdown digest + flat control list** in some dimensions, while Rocket is ahead on **session cookies, network log, and single-call scripts**.

This plan sequences upgrades so we gain capability **without** turning every step into click, scroll, or network-idle waits.

---

## Principles

| Principle | Meaning |
|-----------|---------|
| **Few round-trips** | Prefer one `browser_run` or one enriched `browser_read` over chains of micro-calls. Tool count stays small unless a new tool removes whole classes of scripts. |
| **Data before pixels** | When the page (or our log) exposes JSON APIs, the host should make that path easier than re-scraping the DOM. |
| **Opt-in heaviness** | SPA settle, full a11y tree, screenshots, scroll — all **explicit or triggered by failure**, not default on every navigation. |
| **Same harness, all providers** | Browser tools are shared; observation policy may vary by provider in **evals**, not in forked code paths per vendor. |
| **Prove in evals** | Every behavioral change gets a scenario in `tests/ui/` or a fixture under `docs/evals/` / mock HTML — not “feels better on Espo once.” |
| **User session is a feature** | Cookie import, `persist:browser`, and logged-in CRMs are first-class; benchmarks that assume cold headless profiles are secondary. |

---

## Current architecture (baseline)

| Layer | Location | Role |
|-------|----------|------|
| Tool surface | `src/host/tools/browser.ts` | `browser_read`, `browser_run`, `browser_screenshot`, `browser_download` |
| Script API | `src/host/tools/script-worker.ts` | Playwright-shaped `tab` / `browser` in a worker thread |
| Execution | `src/main/browser-agent.ts` | CDP: navigate (dom-ready + grace), click, fill, wait, fetch, network log, body |
| Page observation | `src/main/browser-page-lib.ts` | Markdown text, links with hrefs, `eN` refs, weak-ref heal, `scrollIfNeeded` on locate/click/fill (2026-10-09: was `scrollIntoView` always) |
| Chrome / session | `src/main/browser-pane.ts`, `browser-url.ts`, `cookie-import.ts` | Tabs, client hints, realism |
| Agent context | `src/host/agent-situation.ts`, tool descriptions | Research guide, sources rules, tab list in user message |
| Quality | `tests/ui/*`, `evals/`, tool ledger | Regression and provider matrix |

**Known gaps (from practice + comparison to Playwright MCP):**

- ~~No hierarchical **accessibility snapshot**; no **`find`**.~~ Done 2026-10-09 check: `focus: 'a11y'` and `query` on read.
- No **automatic re-read** after `goto` / click when same-document routing changes the view. Still open: the pushState hook and `waitForNavigation` exist, but nothing re-reads on its own.
- ~~**`goto` does not wait** on SPA-specific signals.~~ Done: `until` takes `hash`, `title` or `request`.
- ~~**Network bodies** require the model to write `tab.body(rN)`.~~ Partly done: read attaches truncated JSON from the log; `tab.body` remains for the full body.
- ~~**Click path always scrolls**.~~ Done: `scrollIfNeeded` scrolls only when the element is outside the viewport.
- ~~**Bot realism** (client hints, `window.chrome`) — in progress elsewhere.~~ Implemented 2026-10-06; Critical-CH restart still open. See `browser-realism-audit.md`.

---

## Target capability model

Four **tiers** models should be taught (tool copy + optional host helpers):

| Tier | Mechanism | When |
|------|-----------|------|
| **0 Observe** | `browser_read` (text, links, controls, network tail) | Default |
| **1 Navigate / extract** | Full URL from read (incl. `#…`), `browser.fetch`, in-page `fetch`, optional **host JSON attach** | SPAs, CRMs, dashboards |
| **2 Settle** | Bounded wait: hash/title/DOM predicate **or** first matching XHR from log | After hash `goto` or when read disagrees with URL |
| **3 Act** | `click` / `fill` on refs; scroll only if element not visible | Forms, create/save, drag UIs |

**North star observation:** Playwright MCP–compatible **a11y snapshot + find + ref lifecycle** (re-snapshot on stale ref), **plus** Rocket’s **network log and session** — not a second browser product.

---

## Workstreams

### WS1 — Observation upgrade

**Goal:** Better grounding and lower tokens on large pages, without mandatory screenshots.

| Item | Action | Files (indicative) |
|------|--------|-------------------|
| **1.1 A11y snapshot mode** | Add `focus: 'a11y'` (or default migration path) using CDP accessibility tree → compact tree with `ref=eN`, roles, states, names. Keep existing digest as `focus: 'all' \| 'text' \| 'elements'`. | `browser-page-lib.ts`, `browser-agent.ts`, `browser.ts` schema |
| **1.2 Find-in-page** | New tool **`browser_find`** or `read` arg `query` / `regex`: return matching subtree + refs (Playwright MCP parity). | Same + tests |
| **1.3 Read header** | Always prefix read with `hash`, `title`, optional `route hint` (list vs detail heuristic). | `browser-agent.ts` `read()` |
| **1.4 Observation diff** | After actions inside `browser_run`, optional diff mode: changed lines in tree + new network rows since `pageStart`. | `browser-agent.ts`, script-worker |
| **1.5 Provider policies (eval only at first)** | Matrix: compact a11y vs full text vs a11y+text slice for strong vs fast models. Document in eval scenarios; promote winner to default. | `docs/evals/`, scenario messages |

**Remove / avoid:** Shipping full raw HTML by default (token bomb); global `networkidle` waits.

---

### WS2 — SPA and navigation correctness

**Goal:** Hash and `pushState` apps reach the right view before the model acts, with minimal latency.

| Item | Action | Files |
|------|--------|-------|
| **2.1 Opt-in `goto` settle** | `tab.goto(url, { until: 'none' \| 'title' \| 'hash' \| 'request' \| fn })` with **cap timeout** (e.g. 3–5s). `request` matches substring against network log (method GET, status 200). | `BrowserAgentOp`, `browser-agent.ts`, `script-worker.ts`, `types.ts` |
| **2.2 Same-document navigation hook** | On agent tabs only: inject wrapper on `history.pushState` / `replaceState` (and `popstate`) that sets a flag or fires a custom event main can await. Complements 2.1 when no XHR. | Done in `browser-spa-hook.ts` (used by `browser-agent.ts`) |
| **2.3 `tab.follow(href)`** | Resolve relative/hash href from last read or argument → single `goto` + default settle. | script-worker |
| **2.4 Stale ref recovery** | On locate failure: one automatic re-digest + retry; error text matches Playwright MCP (“capture new snapshot”). | `browser-page-lib.ts`, `browser-agent.ts` |

**Do not change:** Main-frame navigate still uses dom-ready + grace (fast path for MPA).

---

### WS3 — Network and API-first extraction

**Goal:** CRM-style apps answer from JSON when the UI is slow or redundant.

| Item | Action | Files |
|------|--------|-------|
| **3.1 Attach last JSON** | When read shows a record GET (e.g. `…/api/v1/Account/{id}` 200 json), optionally append **truncated** body or `body(rN)` hint with one-click host fetch in read path (size cap). | `browser-agent.ts` |
| **3.2 `tab.waitForRequest(substring)`** | Script API: wait for log line matching URL fragment (implements 2.1 from script side). | script-worker, browser-agent |
| **3.3 HAR-style export (debug)** | Dev/eval only: dump recent requests for a tab to artifact folder. | optional, `browser_run` helper |

---

### WS4 — Action path (click / fill / scroll)

**Goal:** Reliable Tier-3 without slowing Tier-0–2.

| Item | Action | Files |
|------|--------|-------|
| **4.1 Scroll policy** | **`locate`:** scroll only if element outside viewport (product aligns with “escape hatch”). | `browser-page-lib.ts` |
| **4.2 Locator-style refs** | Consider Playwright-style **snapshot-scoped refs** (invalidate on navigation) vs current weak-ref heal — measure flakiness on Espo eval. | `browser-page-lib.ts` |
| **4.3 Optional SoM screenshot** | Composite numbered badges on JPEG for vision models when digest detects canvas/chart or N consecutive action failures. | main process + renderer or offline PNG |
| **4.4 Kanban / drag** | Defer until eval needs it; document as known limitation. | — |

---

### WS5 — Browser realism and reachability

**Goal:** Same sites work in embedded browser as in OS browser (Cloudflare, OAuth, etc.).

| Item | Action | Files |
|------|--------|-------|
| **5.1 Client hints + chrome object** | Complete and verify per `docs/browser-realism-audit.md`. | `browser-pane.ts`, `chrome-object.ts` |
| **5.2 Cookie import UX** | Document + eval: “import login for this site” flows. | `cookie-import.ts`, docs |
| **5.3 Critical-CH / restarts** | Track gap; implement only if real sites require it. | audit doc |

---

### WS6 — Agent process (beyond tools)

**Goal:** Models consistently pick the fast tier; app surfaces the right context.

| Item | Action | Files |
|------|--------|-------|
| **6.1 Tool descriptions** | Short decision tree: read → link goto → fetch → waitFor → click. Espo/CRM as canonical example. | `browser.ts` descriptions |
| **6.2 Session block** | When browser tab list includes logged-in app URLs, one-line hint (“CRM session likely warm”). | `agent-situation.ts` or hub |
| **6.3 Sources integration** | Every `goto`/`fetch` in scripts already opens sources; ensure SPA partial loads still count; blocked pages visible in transcript marks. | `sources.ts`, ledger |
| **6.4 Turn budget hints** | Optional soft cap in description: “prefer ≤2 browser tool calls for read-only questions.” | tool copy only |
| **6.5 Remove?** | Do **not** add granular MCP tools (click, type, …) unless evals prove `browser_run` hurts a specific provider; would increase round-trips. | — |

**Shell (`rocket_ui_*`):** Keep browser for **external** web; shell map for Rocket itself. Cross-surface tasks (capture, chat links) documented in `docs/archive/agent-ui-access.md` — no merge of tool namespaces.

---

### WS7 — Evals and regression

**Goal:** Ship WS1–4 with measurable pass rates.

| Scenario | Grader idea |
|----------|-------------|
| **SPA hash route** | Fixture or Espo demo: `goto` account view URL → read contains account name, not list header |
| **API extract** | Mock page with XHR → model returns field from JSON without click |
| **Stale ref** | Fixture re-renders controls → ref heal or re-read succeeds |
| **Find** | Large list → `browser_find` locates row with fewer tokens than full read (token metric optional) |
| **CRM smoke** | Espo: Janeville summary + one opportunity amount (live or recorded mock) |
| **Realism** | `bot.sannysoft.com` or openai.com challenge page — pass/fail reachability, not agent IQ |

Wire into `npm run check:ui` where stable; fixture HTML for CI, live Espo as optional manual matrix.

**Tool ledger:** Score new behaviors (settle used, find used, fetch vs click ratio) for eval-tools panel.

---

## Phased rollout

### Phase 0 — Measure (1–2 days)

**Status (6 Oct 2026): harness baseline landed.**

- [x] SPA fixture: `tests/fixtures/browser/spa.html` (+ `/spa/api/records/*` on UI test server).
- [x] Deterministic baseline: `tests/ui/browser-capabilities.spec.ts` (hash gap, waitFor, fetch, stale ref, network log).
- [x] Report script: `node scripts/browser-phase0-baseline.mjs` → `.artifacts/browser-phase0/*/summary.json`.
- [x] Optional LLM eval scenarios: `docs/evals/scenarios/browser-phase0-baseline.jsonl` (`runsAlone`, `targetTool: browser_run`).
- [ ] Espo manual matrix (live demo): document in eval panel or ad-hoc turn; not in CI.
- [ ] Baseline **LLM** pass rate + tool-call counts from eval runs (after you run scenarios once).

### Phase 1 — Fast wins (low risk)

**Status (6 Oct 2026): landed in main + harness.**

- [x] Read header (hash, title, route hint) — WS1.3 (`browser-agent.ts` `readHeader`)
- [x] Stale ref retry — WS2.4 (re-digest + one retry; Playwright-style error)
- [x] Scroll-only-if-needed — WS4.1 (`browser-page-lib.ts` `scrollIfNeeded`)
- [x] Tool copy refresh — WS6.1 (`browser.ts` decision tree + `tab.goto` until)
- [x] Opt-in `goto` settle (`hash` | `title` | `request`) — WS2.1 (`GotoUntil`, `script-worker.ts`)
- [x] Harness: Phase 1 cases in `tests/ui/browser-capabilities.spec.ts`

**Note:** Restart Rocket (or re-run UI tests) after main-process changes; `npm run dev` hot-reloads renderer only.

### Phase 2 — Observation parity

**Status (6 Oct 2026): landed.**

- [x] A11y snapshot — `focus: 'a11y'` via CDP + `pinRef` for clicks — WS1.1 (`browser-a11y.ts`, `browser-agent.ts`)
- [x] Find-in-page — `query` on `browser_read` / `tab.read` (substring or `/regex/`) — WS1.2
- [x] `tab.follow(href)` — resolve + goto + default hash settle — WS2.3
- [x] Harness + unit tests (`browser-a11y.test.ts`, `browser-capabilities.spec.ts`)
- [ ] Eval scenario for token savings on find (optional LLM matrix) — still open
- [ ] WS3.2 `tab.waitForRequest(substring)` — not built (2026-10-09 check)

### Phase 3 — Host intelligence

**Status (6 Oct 2026): landed.**

- [x] Last JSON attach on read (truncated, opt-out `attachJson: false`) — WS3.1
- [x] pushState hook on agent tabs + `tab.waitForNavigation()` — WS2.2
- [x] `browser_run` mark/delta (network, location, new control lines) — WS1.4
- [x] Harness + `browser-json-attach.test.ts`

### Phase 4 — Optional / research

**Status (6 Oct 2026): landed.**

- [x] SoM screenshot — `browser_screenshot` / `tab.screenshot({ som: true })` — WS4.3 (`browser-som-composite.ts`, `browser-som-svg.ts`; 2026-10-09 correction: not `browser-page-lib`)
- [x] Observation policy eval matrix — WS1.5 (`docs/archive/evals/` (eval matrix, archived), scenarios jsonl; written, not yet run)
- [x] HAR export — `tab.exportHar({ saveTo })` since script mark — WS3.3 (`browser-har.ts`)
- [x] Harness: Phase 4 cases in `browser-capabilities.spec.ts`

---

## Explicit non-goals (for now)

- Replacing the embedded browser with headless Playwright MCP as the only path (we keep Electron session + CDP).
- Scraping search engine result pages at scale (unchanged research policy).
- Fully autonomous CRM writes without user approval gates.
- **networkidle** as default wait.
- Vision-first agent loop (screenshot every step).

---

## Risks

| Risk | Mitigation |
|------|------------|
| A11y mode breaks Espo/custom widgets | Dual mode; default `all` until evals pass |
| pushState inject breaks sites | Agent tabs only; feature flag |
| JSON attach leaks PII into context | Truncate; opt-in per read; redact in ledger |
| More code in main | Keep heavy logic in tested modules; unit tests for page-lib and settle predicates |

---

## Success metrics

- **Task success rate** on SPA + CRM eval scenarios (primary).
- **Median browser tool calls** per successful read-only task (down).
- **Median tokens** in browser_read output for fixed scenario (down with find/diff).
- **Stale-ref error rate** in evals (down).
- **Reachability** on realism fixture (up, separate track).

---

## Related docs

- `docs/browser-realism-audit.md` — WS5  
- `docs/sources-plan.md` — research citations  
- `docs/archive/agent-ui-access.md` — shell vs browser  
- `docs/archive/agent-evals-rocket.md` — eval philosophy  
- `README.md` — browser tools overview  

---

## Open decisions (for you)

1. **Default observation:** migrate everyone to a11y-first or keep `all` until Phase 2 evals complete?  
2. **New tool `browser_find`** vs extending `browser_read` with `query` — **decided:** `query` on read for Phase 2; separate tool only if evals show confusion.  
3. **Espo in CI:** live demo URL vs checked-in mock that mimics hash + XHR.  
4. **Auto JSON attach:** on by default for `json` responses under N KB?
