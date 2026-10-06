# Handoff: build the plan drawer

Written 2026-10-05 at the end of a long session. Read `CLAUDE.md` and `README.md` first; this
only says what that session decided and left unbuilt.

## Shipped this session (all tested, all green: `npm run typecheck`, `npm test`, `npm run check:ui`)

- `ask_user` tool (`src/host/tools/ask.ts`): a model asks one question per turn with 2–4 options
  and its own pick; never blocks; the card is in `Transcript.tsx`; the answer is the next message.
- `npm run open -- <path or URL>` (`scripts/open.mjs`, single-instance lock in `src/main/index.ts`):
  opens a file or page inside the running Rocket. **Always use this to show the user anything;
  never `xdg-open`** (on this machine `text/html` is mapped to the ChatGPT app).
- Turn changes: `Changed N files +a −r` line under each finished turn, opening the unified diff in
  the artifact panel (`ChangesView.tsx`, `src/shared/patch.ts`, `teamwork.ts` records the patch
  between the turn's start/end snapshots). **Undo this turn** in the panel header, committed as
  `Undo: <request>`; not offered while a turn runs in the folder or a file changed since.
- Mockups live in `docs/mockups/`; serve them with
  `cd docs/mockups && python3 -m http.server 8765 --bind 127.0.0.1` and give the user
  `http://127.0.0.1:8765/<file>` links (http goes to Chrome; local .html would not).

## The user's working rules (learned the hard way)

- Mockup first, agreed, then build. Make it in `docs/mockups/*.html` in Rocket's palette
  (copy the head of `turn-changes.html`), render it, and give the http link.
- Make checks visible: open captures for the user or run `npm run check:ui -- --visible`.
  A headless run with images only the assistant saw counts as nothing shown.
- Clean and minimal UI. They rejected: a "Working" header, a "Doing now" section, steps and
  files lists in the drawer, timings on plan lines, and a horizontal pill/chip ("absolutely
  horrendous"). Keep to what was agreed below.

## Next: the plan drawer — agreed design (`docs/mockups/plan.html`, all three tabs)

What the drawer is: **the task name and the plan's bullet points, nothing else.** A pane beside
the chat in the goal pane's exact clothes (split layout, draggable divider, `gp-*` classes),
with only a hide arrow in its top-right corner.

- Bullets: done items dim with a tick; the current one bright with the accent-outlined box and
  pulsing dot; the rest hollow. A `2 of 5` count above the list. No timings, no "now" labels.
- In the chat: **the shimmering `Thinking` in the turn head becomes `Planning · 2 of 5`**, the
  number updating as steps complete. It is clickable and **toggles** the drawer open/closed.
  With no plan it stays `Thinking`. Once the turn ends it reads `Planned · 5 of 5`, no shimmer,
  still clickable. Nothing else is added to the transcript (no separate plan line, no chip).
- The drawer opens itself the first time a running turn reports a plan; closing it is remembered
  per chat (like `goalPaneOpen`); the arrow in the drawer closes it. A turn with no plan never
  opens it.
- In a goal's chat there is no second drawer: the goal pane gains a **"This round's plan"**
  section between "Done means" and "Rounds", same bullet style.

## Where the plan comes from (one shape for all providers)

- **Claude Code** (`src/host/providers/claude.ts`): `TodoWrite` tool_use blocks; `input.todos`
  is the whole list each time: `{content, status: 'pending'|'in_progress'|'completed', activeForm}`.
  Today it becomes a generic tool row (`startTool`/`relabelTool` around line 636–700).
- **Cursor** (`src/host/providers/cursor.ts:486`): `cursor/update_todos` (params.todos) and
  `cursor/create_plan` requests; accepted and content dropped today.
- **Codex**: the app-server protocol has a todo-list item type; not seen in our translator
  (`codex.ts` item switch ~line 336). Verify live (`npm run check:live -- codex`, costs usage;
  ask first) and record the finding in the adapter header with version and date, per CLAUDE.md.
- **Antigravity**: nothing known.

Suggested protocol: a `plan` item in `Item` (`src/shared/types.ts`), one per turn, id
`${turnId}:plan`, `{ steps: [{ text, status: 'todo'|'doing'|'done' }] }`, replaced whole on each
update (`putItem` upserts by id, the renderer re-renders the row). Translators are pure classes
with tests beside them (`claude.test.ts`, `cursor.test.ts`); add cases there. The handoff
(`handoff.ts`) should not carry the plan (the reply says what was done).

Renderer: `TurnHead` in `Transcript.tsx` draws the head line; the split layout and divider are in
`App.tsx` (`GoalChat`) and `GoalPane.tsx`; `goalPaneOpen` in `store.ts` is the pattern for
remembering open/closed. Add a UI scenario in `tests/ui/` with a controlled response in
`src/host/ui-test.ts` (see `UI check: ask` and `UI check: edit` for the pattern) and capture
the states; copy the captures into `docs/mockups/plan/` and add a "built" tab to `plan.html`
like `turn-changes.html` has.

## Open question to confirm with the user before building

Whether the drawer opens by itself on the first plan, or only on click. The session's proposal
was "opens itself, remembers closed per chat"; the user did not object but did not confirm.

## Housekeeping

- Another assistant was editing `src/host/hub.ts` (unprompted turns) and `provider.ts` during
  the session; re-read before editing, and do not undo their work.
- The user's running Rocket predates this session's builds; they need to restart it to see
  `ask_user`, `npm run open`, the changes line and undo.
