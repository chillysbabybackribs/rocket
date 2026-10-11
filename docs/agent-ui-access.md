# Agent situational awareness in Rocket

**Status (2026-10-09): implemented.** The app map, dispatcher, the three `rocket_ui_*` map tools and the tests below are in the tree.

## Problem

Models often behave as if they were a generic cloud assistant: they guess UI state, confuse the **built-in browser** with the **Rocket app shell**, and skip live inspection even when the user is staring at the same window. Told "run a tool eval" with the eval panel closed, they searched a 1600px screenshot for a button, clicked through `rocket_ui_run` with guessed locators (two `Message` textboxes, `page.waitForTimeout` that does not exist), and wrote paragraphs about CSS instead of doing the four-step thing.

The app is finite. Navigation should be deterministic, by name, with the same code a click runs.

## Design

**The app map** (`src/shared/app-map.ts`) names every place and action, hand-written:

| | Examples |
|---|---|
| Places (`rocket_ui_go`) | `chat`, `browser`, `evals.scenarios`, `evals.scenario {id, run}`, `evals.run {run, provider, trial}`, `evals.tools {section}` |
| Actions (`rocket_ui_act`) | `pane.add`, `pane.close {pane}`, `chat.open {chatId}`, `evals.run.start {scenario, message, wait}`, `evals.run.stop`, `evals.tools.refresh` |

**One dispatcher** (`src/renderer/src/app-map.ts`): `where()`, `go()`, `act()`. The dashboard's buttons call it; main's `uiMap` op calls it for the host's tools. Its handler tables are typed against the map, so a map entry without a handler fails `npm run typecheck`. The eval dashboard's navigation and run state moved into the store so the dispatcher can read and set them.

**Per turn**, `<agent-environment>` (`src/host/agent-situation.ts`) now carries a live line read from the renderer as the turn starts:

```
Where you are: 3 chat panes, this chat is pane 1 (ui.pane(1)) (pane 0: run a research task…; pane 2: hello); evals open at evals.scenario, scenario goal-draft-minimal (run done: 6 of 8 cells passed).
```

followed by the map, so a model knows its pane (no more strict-mode locator failures) and what is on screen before it reads the user's message.

**Tools** (`src/host/tools/ui-map.ts`): `rocket_ui_where` (state only), `rocket_ui_go` and `rocket_ui_act` (state plus an image of the window afterwards). A wrong name or parameter is refused with the valid choices; nothing moves. Long runs return after `wait` seconds as still running; `rocket_ui_where` follows the cells.

`rocket_ui_snapshot` stays the read-only look; `rocket_ui_run` stays for what the map does not cover (UI a model is building that has no name yet).

## The loop a model should run

1. Read "Where you are" (or call `rocket_ui_where`).
2. `rocket_ui_go` to the place by name, with its parameters.
3. `rocket_ui_act` the action by name; read its result and the returned `where`.
4. Check the image against the ask before saying it is done.
5. For UI edits: the place names its component file; edit, then `go` there again and compare the capture. Renderer edits hot-reload; main/host edits need a restart, and the block says so.

"Run a tool eval" is: `rocket_ui_go evals.tools {section: evaluate}` → `rocket_ui_act evals.run.start {scenario}` → report the grades with the capture.

## Verification

- Unit: `src/shared/app-map.test.ts`, `src/host/tools/ui-map.test.ts`, `src/host/agent-situation.test.ts`
- UI: `tests/ui/app-map.spec.ts` walks every place through the dispatcher and the MCP tools in the isolated app
- Manual: new chat → first user message in `journal.jsonl` should include `<agent-environment>` with a `Where you are:` line

Restart Rocket after host or main changes.
