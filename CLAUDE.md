# Rocket

An Electron app (Linux, personal tool) that owns one chat, its tools and an embedded browser, and
lends each message to Claude, Codex, Cursor or Antigravity through their CLIs. `README.md` has
the architecture; read it before changing how the processes talk to each other.

## Commands

```sh
npm run typecheck   # tsc, no emit
npm test            # host/renderer unit tests and UI subprocess cleanup regression tests
npm run check:ui    # build + unit tests + isolated Electron UI check, no real model turns
npm run dev         # the app, rebuilding on change (ROCKET_NO_SANDBOX=1 if the sandbox helper is not set up)
npm run open -- <path or URL>   # open it inside the running app (browser tab or artifact panel)
```

Anything made for the user to look at (a mockup, a capture, a report) is opened with
`npm run open`, never `xdg-open` or an outside browser. Show a mockup in `docs/mockups` and get
it agreed before building a UI change, and make checks visible: `npm run check:ui -- --visible`,
or open the captures afterwards.

Run typecheck and tests after every change. To check against the real CLIs without the UI:

```sh
USAGE=1 TURNS=0 npm run check:live -- claude cursor   # usage readings only, no model turns
npm run check:live -- claude codex                    # a real conversation; spends subscription usage
```

Ask before running a check that sends model turns. Prefer `npm run check:ui` for UI checks;
it uses controlled responses, fresh profiles and a private display (see README). For manual UI checks, use `ROCKET_USER_DATA=<dir>`
so real chats are never touched, and `ROCKET_CAPTURE` (see the README) for a picture of the UI.

## Where things are

- `src/shared/types.ts`: every type that crosses a process boundary. Change the protocol here first.
- `src/host/`: the agent host, a utility process. `hub.ts` runs turns, `store.ts` is the SQLite
  transcript, `handoff.ts` builds what a provider is told about turns it missed.
- `src/host/providers/`: one adapter per provider behind `provider.ts`. Each file's header lists
  the CLI behaviour it depends on, with the version and date it was verified.
- `src/host/journal.ts`: the journal of errors, slow turns and model notes (`journal.jsonl`); see Self-check.
- `src/host/tools/`: the app's tools, served to all providers by one loopback MCP server.
- `src/shared/app-map.ts`: the hand-written map of the shell's places and actions;
  `src/renderer/src/app-map.ts` is the one dispatcher behind both the UI's buttons and the
  `rocket_ui_where` / `go` / `act` tools. A new panel or button that a model may need goes in the
  map, with its state in `store.ts`, not in component state.
- `src/host/agent-situation.ts`: the `<agent-environment>` block ahead of every message: where
  the shell is right now, and the map.
- `src/host/workspace.ts`: the file map and saved notes a new session is told about its folder.
- `src/host/teamwork.ts`, `git.ts`: what a model is told about others working in the folder, and
  the commit the app makes of a turn's changes.
- `src/host/goals.ts`: goals, the loop of work and check turns until a brief's checklist is met
  (`docs/goals-phase1.md`); `tools/goal.ts` is how models report to it.
- `src/main/`: the window, the browser tabs (`browser-pane.ts`) and the browser tools' hands
  (`browser-agent.ts`, `browser-page-lib.ts`). `cookie-import.ts` brings the user's logged-in
  sessions in from their OS browser (first-run and the page's right-click menu).
- `src/renderer/`: React UI. `store.ts` is the client state.

## Rules

- User preference: crop, zoom, resize, and inspect screenshots with deterministic tools such as
  Python Pillow or ImageMagick. Preserve source pixels for crops; use ordinary resampling for
  zooms, never generative reconstruction, OCR re-rendering, or invented missing text. Keep the
  original, save a separate output, inspect it, and open it with `npm run open`. Use generative
  editing for these tasks only when the user explicitly requests it.
- The app's SQLite transcript is the conversation. A provider's session is a cache: resume it and
  hand over only the turns it missed. No full-history replay except after a lost session.
- Agent work stays in the host process. Nothing that talks to a provider or the store runs in
  main or the renderer, and chat traffic never passes through main.
- An adapter knows nothing about other providers, the store or the renderer. The hub knows
  nothing about how any provider works.
- In the browser, anything that opens near the page (dropdowns, menus) overlays it in a view of
  its own. Never move or resize the page to make room.
- Model lists and usage are read live from the provider, never hardcoded.
- Every tool's schema is in every session's prompt. What a model should simply know goes ahead of
  the user's message (tabs, the file map, notes); add a tool only for something a model must do.
- Browser research: native web search to vet URLs first; Rocket's browser opens a few chosen
  destinations, not search-engine pages or live source-gathering across the web.
- Provider payloads are `unknown`: read them through `recordOf` / `stringOf` in `src/host/json.ts`.
- When a CLI's behaviour is learned or re-verified, record it in that adapter's header with the
  CLI version and date. When it changes, fix the header with the code.
- Keep the README current with the code in the same change.
- Git stays out of the chat. Do not commit, stage, branch or push, and do not mention git or
  commits in replies unless asked. Inside Rocket the app commits each turn's changes itself.
- Other assistants may be editing this folder at the same time. Read a file again before changing
  it if it may have moved, and say so if someone else's change looks wrong rather than undoing it.

## Style

- TypeScript, ES modules, imports with the `.ts` extension, no semicolons, single quotes.
- Comments say why, in plain sentences, at the head of a file and above anything surprising.
- Stream translation is a pure class (`TurnTranslator`, `UpdateTranslator`, `StepTranslator`) so
  it can be tested without a CLI. Tests sit beside the file they test.
- User-facing errors are full sentences that say what to do next.

## Self-check

With `ROCKET_SELF_CHECK=1` you have `rocket_check`, `rocket_diagnostics` and `rocket_note`. When the app misbehaves,
runs slow, or a `<self-check>` line appears ahead of a message, read the journal before guessing.
Anything you notice but were not asked to fix goes in `rocket_note` with what you saw, the likely
cause and the change you would make. Edit code only for what was asked or a clear defect in code
you are already changing; propose anything larger in the chat. After a self-edit, call `rocket_check` (typecheck and
tests), and read `rocket_diagnostics` for anything the change caused. Keep this section and the
README's Self-check section current when the journal, its tools or its nudges change.
