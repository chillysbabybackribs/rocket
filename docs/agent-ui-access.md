# Agent access to Rocket’s live UI — audit (2026-10-06)

## Question

How do models learn that they can **see and drive the Rocket app shell** (not just the built-in browser), and when should they use it?

## Current architecture

| Surface | User sees | Agent tools | How the model learns |
|--------|-----------|-------------|----------------------|
| **Web pages** (globe) | Built-in browser tabs | `browser_read`, `browser_run`, `browser_screenshot` | Tool descriptions; **`<browser>` injected** when tabs change (`browserContext`) |
| **Rocket shell** (chat, rail, eval flask, drawers) | Electron UI | `rocket_ui_snapshot`, `rocket_ui_run` | Tool descriptions only (until this audit) |
| **Braintrust / external** | Browser tab | Same browser tools | Same as web |

MCP tools are served from one registry (`src/host/tools/registry.ts`) on loopback. Providers differ:

- **Claude / Codex / Cursor:** MCP tools in session; descriptions visible in tool list.
- **Antigravity:** MCP tools **not** in model prompt — first message includes `<app-tools>` with full descriptions (`toolBrief` in `antigravity.ts`).

## Gaps found

1. **No message-level context for the app shell** — Browser tabs ride on every user message when they change; nothing equivalent reminded models about `rocket_ui_*`.
2. **Easy confusion** — `browser_screenshot` sounds generic; models often treat “screenshot the app” as browser tools.
3. **Weak “when” triggers** — Old `rocket_ui_snapshot` description said *what*, not *when* (layout work, eval panel, post-CSS verification).
4. **Live vs isolated** — `rocket_ui_run` defaults to live (correct) but descriptions led with long isolated/regression text; models under-use live snapshot.
5. **No eval loop** — Playground UI work was documented for humans (`docs/evals/README.md`) but not in tool copy; scenario `tool-ui-readonly.jsonl` exists for matrix grading only.
6. **Codex plugin conflict** — README notes Codex disables competing browser plugins; shell tools are separate and must be named explicitly.

## Changes made

1. **`APP_UI_GUIDE`** (`src/host/tools/app-ui-guide.ts`) — Shared copy: two surfaces, which tool for which job, when to snapshot, live vs isolated.
2. **Tool descriptions** — Prepended to `rocket_ui_snapshot` and `rocket_ui_run`.
3. **`<rocket-app>` context** — Injected on **fresh provider sessions** and when the **in-flight turn edits** `src/renderer/`, eval mock UI, or mockups (same hook as `<browser>` / `<workspace>` in `hub` context).

## Recommended agent behavior

| Task | Tool |
|------|------|
| “Does the eval panel look right?” | `rocket_ui_snapshot` |
| After editing `src/renderer` CSS/components | `rocket_ui_snapshot` (user may need restart) |
| Open flask → Playgrounds → Run | `rocket_ui_run` live script, or user runs manually |
| Read a docs page on braintrust.dev | `browser_read` / `browser_screenshot` |
| Playwright regression of Rocket | `rocket_ui_run` with `target: "isolated"` |

## Verification

- **Matrix scenario:** `docs/evals/scenarios/goal-draft-minimal.jsonl` row `tool-ui-readonly` — graders `turn_completed`, `no_tool_error_codes`; expects snapshot or `ui.read` use.
- **Harness:** `tests/ui/snapshot.spec.ts`, `tests/ui/ui-run.spec.ts`, `tests/ui/ui-live.spec.ts`.
- **Manual:** In any Rocket chat, ask the model to “describe the eval panel using rocket_ui_snapshot”; transcript should show an MCP call and image result.

## Future (optional)

- Inject `<rocket-app>` when user message mentions layout / “looks wrong” / eval panel (needs hub to pass message text into context).
- Cheap shell flags over IPC (evalsOpen, pane count) without a full snapshot.
- Cursor rule or repo `AGENTS.md` pointing here for non-Rocket agents editing the repo.
