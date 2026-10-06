# Rocket

One chat, many agents. Rocket is an Electron app that owns the conversation and an embedded
browser, and lends each message to whichever provider you pick: Claude, Codex, Cursor or
Antigravity. You can switch provider on every message; they all share the same chat.

## Run

```sh
npm install
npm run dev        # development, with rebuild on change
npm run preview    # production build, then launch
npm test           # unit tests, beside the files they test
npm run check:ui   # build, unit tests, then the isolated desktop self-check
npm run open -- docs/mockups/turn-changes.html   # open a file or URL inside the running app
```

Rocket runs one instance per profile. `npm run open -- <path or URL>` hands its argument to the
running app, which opens it as a chat link would: a page or HTML file in a browser tab, a text
file in the artifact panel. With no app running it starts one. Mockups and reports made for you
by an assistant belong here, not in an outside browser.

Each provider runs through its own CLI, signed in with your own account. Install and sign in to
the ones you want: `claude`, `codex`, `cursor-agent`, `agy`.

### Linux sandbox

Chromium's sandbox needs its helper to be owned by root with mode `4755`. Electron updates
can replace that helper and reset its permissions. `npm run dev`, `npm run preview`, and
`npm run open` check it before launching and automatically repair it using `sudo -n` when
passwordless sudo is available. Correct permissions require no sudo calls.

If automatic repair is unavailable, the launcher prints these manual repair commands:

```sh
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

`ROCKET_NO_SANDBOX=1 npm run dev` starts without the sandbox instead. Use that only for a quick
look: the embedded browser then renders web pages unsandboxed.

## How it fits together

```
renderer (React)  ⇄ MessagePort ⇄  agent host (utility process)  ⇄  provider CLIs
        │                               └─ SQLite transcript
        └─ ipc ─ main (window, browser tabs)
```

- **Main** (`src/main`) owns the window and the browser view, forks the agent host, and hands the
  renderer a MessagePort to it. Chat traffic never passes through main.
- **Agent host** (`src/host`) owns the transcript (`store.ts`), decides what each provider is told
  (`hub.ts`, `handoff.ts`), and runs one adapter per provider (`providers/`).
- **Renderer** (`src/renderer`) subscribes per transcript row, so a token stream re-renders one
  row. The host batches events to one message per frame.

### Switching providers

The app's SQLite log is the conversation. Each provider's own session is a cache of the part it
has seen: per chat and provider, the store keeps the session id and the last turn that session
contains. A message to a provider resumes its session and hands over only the turns after that
mark; the handoff names the files those turns read and edited, so the next provider need not search
for them. Codex receives them as real history (`thread/inject_items`); the other three receive a
tagged block in front of the message. If a provider has lost its session, it gets a new one and
the whole conversation.

A handoff stays in the receiving session's history, read again with every later message, so it
carries what each turn concluded and not how it got there (`handoff.ts`): the user's words, the
reply after the turn's last tool call (the narration between calls is left out), and the files it
touched. The newest three turns go whole with a line per other tool call; older ones keep their
files and the head and tail of their request and reply. The whole block is held to 30,000
characters, cutting the middle of the longest older replies first.

What a session is told once (the git rules, the workspace map) goes to it when it starts, not
again when a session is resumed after the app restarts. The browser research guidance is in
`browser_read`'s description, which every session has, so it is not repeated ahead of a message.

### Tokens

Each turn keeps what it cost (`Turn.tokens`): input tokens across its model calls with how many
came from the prompt cache, output tokens, and `context`, the input of its last call, which is how
full the session is. Claude reports them in its `result` and `message_start` events, Codex in
`thread/tokenUsage/updated`. Cursor's agent sends no usage over ACP and Antigravity's stream has
shown only thinking counts, so their turns carry none. The readings go into the journal with each
turn's timing, and `rocket_diagnostics` summarizes them per provider and model.

### Chat panes

The chat card holds one to four chats at once. The add-chat button in the composer's text line
(a speech box with a plus, left of where the text starts; the `+` among the tabs is a new tab in
the same pane) splits the card: two side by side, three as two above one across the bottom, four
as quadrants, and no more for now. A new pane opens on the new-chat screen and takes the focus.
Every pane is a whole chat with its own tabs, transcript, composer, folder and model, and a turn
streams into every pane that shows its chat. The pane last clicked or typed in is the focused one:
the rail's history and goals open chats there, Ctrl+1–4 picks its provider, and its chat is the
one marked in the history. Closing a pane's last tab closes the pane (the only pane shows the
new-chat screen instead); the others take the room in the same order of layouts. The goal pane
and the plan drawer show only while the chat has the card to itself. The panes and their tabs
come back after a restart.

In the renderer (`src/renderer/src/store.ts`) `panes` says what each pane shows and `views`,
keyed by chat, holds what a shown chat has loaded, so two panes on one chat share a copy. The
components inside a pane read their chat through `PaneContext` (`pane.ts`); every store action
that means "in this chat" takes the pane it was asked in.

### The rail

The left edge holds the window lights, the usage notch (one ring per provider) and the goals,
history and browser buttons. The button under them folds the rail to a 24px strip, giving the
chat the width; the fold is remembered. The strip keeps the lights, a dot per provider in its
usage colour and the goals count, and resting the pointer on it slides the whole rail out over the
chat as an overlay (the chat never moves) until the pointer leaves, so usage, history and goals
stay a hover away. The button at the strip's foot, or at the peek's, opens the rail again.

### Messages sent while a turn runs

The composer stays open while a turn runs; Esc or the Stop button beside Send stops it. A message
to the provider that is answering joins its turn (`Hub.post`, `ProviderAdapter.steer`): Claude
Code gets it as a streamed user message with priority `next`, Codex through `turn/steer`. The
message is wrapped in an instruction to carry on without acknowledging it, so no "Got it" reply.
The model reads it only at its next step, which can be many seconds away, so until then it shows
dashed under the turn ("Claude reads this at its next step"). The adapter calls `steer`'s `taken`
callback when the model reads it: Claude Code echoes it (`--replay-user-messages`) and reports
`command_lifecycle` `started`; Codex reports a `userMessage` item. Only then is it stored as a
user item marked `steer` inside the same turn, at the point it was read, and the transcript splits
the turn there, folding the earlier steps into their own summary. Words a turn never said it read
are recorded in it when it ends, not sent again; a stopped turn dropped them, so Send now sends
them first and Stop returns them to the composer. Cursor and Antigravity cannot take
words mid-turn, and a message to a different provider must wait for the turn anyway: those queue
in the hub, show under the turn with Send now (stop, then send) and Edit (back to the composer),
and go out together as one message to the last picked provider when the turn ends. Stop returns
queued text to the composer instead of sending it. Answers to a question card in a plain chat go
through the same queue. Stop cancels a Claude message still queued inside Claude Code
(`interrupt({ cancelQueued: true })`), so it does not run as a turn of its own; only a CLI too old
to cancel it has its process retired instead, which ends its background work.

### Turns a provider starts by itself

Claude Code can start a turn with no message from the app: when a subagent or shell it ran in
the background finishes, it answers on its own. A turn whose reply ends while such tasks still
run is therefore held open: it keeps its working state, its head reads "Waiting for 2 background
tasks" instead of "Thinking" (`Turn.activity`, set through the sink and never stored), and the
follow-up lands in it (Stop ends the wait). A follow-up with no turn open,
after a restart for instance, gets a turn of its own through `onUnprompted` (`provider.ts`), with
a notice saying what finished. Before this, those replies were dropped. While background tasks are
live, the Claude Code process is not retired for idleness, since that would kill them.

### Browser

The browser panel has Chromium's tab strip and shortcuts (Ctrl+T, W, Shift+T, Tab, 1–9, L) and a
Safari-style address field. Each tab is a native view owned by main (`src/main/browser-pane.ts`);
only the active one is on screen. The address field's dropdown is a view of its own
(`browser-suggest.ts`, `src/renderer/suggest.html`) stacked above the page, so it overlays the
page and never moves it. Tabs, history and the last session are kept in the profile folder.

Background tabs are hidden with `setVisible(false)`, so Chromium stops drawing them.
`ROCKET_BROWSER_HIDE=park npm run dev` moves them off screen instead, the older way, in case a
tab ever comes back blank; see the note in `src/main/browser-url.ts`.

Chat links open beside the conversation: HTTP(S) URLs and local HTML, images, PDFs, and media
open in a new browser tab. Text and source files open in a closable artifact preview; Markdown
renders as a document. Relative file links use the chat's working folder (or the containing
artifact's folder), and `:line` / `#Lline` references highlight the source line. Markdown links,
bare URLs, and recognizable file paths, including inline-code paths, are clickable. Text previews
are limited to 2 MB; missing files and unsupported binary formats show an actionable error.

### Tools

The app owns its tools and every provider sees the same ones. The agent host keeps them in one
registry (`src/host/tools/registry.ts`) and serves them over a single MCP server on loopback
(`channel.ts`), the one channel all four CLIs accept. Each session is given a URL that names its
chat. Antigravity is the exception: its MCP config is global, so the app registers itself there
as `rocket` (`agy mcp add`) and works out the chat from the turn that is running. Its CLI also
leaves MCP tools out of the model's prompt, so the adapter opens a new conversation's first
message with the tools, their arguments and how to call them.

There are three browser tools (`src/host/tools/browser.ts`). For research, models are told to use
their provider's native web search to find and vet URLs first, then open only a few validated
destinations in the browser—not to scrape search-result pages or gather many live sources from
the open web. `browser_read` returns a page as text with links, its controls with short refs, and
the data requests it made. `browser_screenshot` returns a tab as a small JPEG, for what text
cannot say. `browser_run` runs a
script the model writes against a small Playwright-shaped API (`tab.goto`, `tab.eval`,
`tab.click`, `tab.fill`, `tab.waitFor`, `browser.fetch`), so a whole task is one call; the script
runs in a worker thread of the host and each step is a request to main
(`src/main/browser-agent.ts`), which drives the tab over the DevTools protocol. A model works in tabs of its own, marked with a dot in the tab strip. Opening one or navigating it
to a URL switches the browser view to that tab so you can follow along; the page does not take
keyboard focus from the composer. The model touches your tabs only by id. The open tabs ride at the
head of the user's message when they have changed, so listing them costs no call. A page counts as
loaded when its document is ready, not when its last ad is. While a turn uses a tab, its page runs
at full speed even when concealed; when the turn ends it goes back to being an ordinary background
tab, and a deleted chat's own tab is closed.

Rocket's Codex process disables the bundled `unified-computer-use`, `browser` and `chrome`
plugins through process-local configuration overrides, so `cua_repl` and the related browser
skills and hooks do not compete with Rocket's browser tools. The overrides apply to new and
resumed chats when that process starts; restart Rocket after updating to apply them. Native web
search and other plugins retain their configured settings, as do Codex sessions outside Rocket.

`rocket_ui_snapshot` (`src/host/tools/ui-snapshot.ts`, `src/main/ui-snapshot.ts`) shows the
currently running Rocket window without clicking, switching tabs or changing focus. It returns
images directly to the model, visible shell control names and panel bounds, native view bounds,
and the running process, start time, app version and main bundle fingerprint. It captures the
composed window through ImageMagick on X11, including native browser pages and dropdowns; if
that is unavailable, it returns separate shell and native-view images with a warning that they
cannot verify overlap or stacking. Full-resolution PNGs and `snapshot.json` are retained under
`<profile>/ui-snapshots/`; images sent to the model are JPEGs limited to 1600 pixels wide.
Snapshots show the running instance, so source edits may still require a rebuild or reload.
This read-only tool is always available to all providers; it does not require self-check mode.

`rocket_ui_run` drives the **live Rocket window by default**. It attaches to the running
Electron app through a Chromium debugging endpoint bound to loopback, identifies the shell
and visible native views by their target IDs, and disconnects after each script. It does
not build or launch another app. Actions affect the user's actual panes, drafts, history and
browser session. The same live window is shared by all chats and providers; one script runs
at a time. Restart Rocket after installing this change to enable the endpoint and new schema.

The tool accepts `code`, the body of an async function, with `page`, `ui`, `sleep` and
`console`. Await every action. `page.getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`,
`getByTestId` and CSS `locator` support locator chaining, clicks, filling, keys, hovering,
visibility waits and reads. Locator option names/text must be strings, not regular expressions.
Use DOM evaluation for inspection, never to mutate renderer state to manufacture a passing UI.
For example, to add a chat pane to the current window:

```js
await page.getByRole('button', { name: 'Add a chat beside this one', exact: true }).first().click()
return await page.locator('.pane').count()
```

`ui.surface('browser' | 'suggestions')` returns the page API for the currently visible native
view, including when multiple tabs have identical URLs. `ui.resize(width, height)` resizes
the live window (880×560 through 4000×2400); `ui.read()` returns shell controls and panels;
`ui.snapshot()` includes a capture in the result. A final snapshot is included by default;
`capture=false` skips it on success, while script failures still capture. Results include the
live process identity, logs and saved paths under `<profile>/ui-runs/`, with full-resolution
captures under `<profile>/ui-snapshots/`. Source edits require rebuilding and restarting the
live app. The default script timeout is 30 seconds (maximum 120). Scripts run in worker threads,
so an infinite loop can be stopped. Timeout disconnects automation and leaves Rocket open;
completed actions remain in the app. Live mode rejects `build`, `reset`, `close` and the
controlled-test helpers `ui.request()`, `ui.release()` and `ui.restart()`.

Use **`target: "isolated"` explicitly** for regression tests. This mode builds current source
into a private app folder under `.artifacts/ui-run/`, then launches Electron on a private Xvfb
display with a marked fresh profile, scratch workspace, controlled providers and the desktop
self-check network filter. Providers in the same chat share this isolated inspection session.
Select its scratch folder through the normal folder button before sending `UI check:` prompts.
`ui.request()` reads the latest controlled turn; `ui.release()` completes a held response or
plan; `ui.restart()` restarts its profile and build. Ordinary prompts fail instead of starting
real provider CLIs. Isolated resize limits are 880×560 through 2400×1400.

For isolated calls, `reset=true` discards the session and rebuilds; `build=false` uses the
existing `out/` build for a new session; `close=true` closes it without a script. Initial build
and startup have a separate three-minute deadline. Timeout discards the isolated session.
Four sessions may be open at once, idle sessions close after ten minutes, and chat deletion
and host shutdown close their sessions. Subprocess cleanup covers detached Electron descendants.
Captures, per-call JSON results, `runner.log` and traces remain in the session directory.

### The app map

The shell is finite, so a model navigates it by name rather than hunting for buttons in a
screenshot. `src/shared/app-map.ts` is a hand-written map of every **place** the shell can show
(`chat`, `browser`, `evals.overview` … `evals.tools`, with the parameters a place takes, such as
the playground's scenario) and every **action** a model can take (`pane.add`, `chat.open`,
`evals.playgrounds.run`, `evals.runSheet.run`, `evals.tools.refresh` …), each naming the component
file that renders it. The renderer's dispatcher (`src/renderer/src/app-map.ts`) implements the map:
`where()` reads the shell's state in the map's words, `go(place, params)` shows a place and
`act(action, params)` does an action, going to its place first when that is not on screen. The
dashboard's own buttons call the same `go` and `act`, so what a click does and what a model does is
one path, and the tables are typed against the map so a missing handler fails the typecheck. The
eval dashboard's navigation and run state live in the store (`evals` in `store.ts`) for this reason.
Mapped controls carry `data-nav="<place>"`, which `rocket_ui_snapshot` reports as `nav`.

The host serves the map as three tools (`src/host/tools/ui-map.ts`), run in the renderer through
main's `uiMap` op: `rocket_ui_where` (no image; the panes, which one is the asking chat's, the
side panel and what it shows, running cells, open dialogs), `rocket_ui_go` and `rocket_ui_act`
(both return where the shell ended up and an image, `capture=false` to skip it). A wrong place,
action or parameter is refused with the valid choices (`UI_MAP_REFUSED`) and nothing moves. Run
actions start real provider turns in eval chats; they return when the run ends or after `wait`
seconds (default 100, at most 120) with it still running, and `rocket_ui_where` then follows the
cells. `tests/ui/app-map.spec.ts` walks every place through the dispatcher and the tools.

Three checks keep the map and the UI the same thing. The typecheck fails on a map entry the
dispatcher does not implement. `src/shared/app-map.test.ts` reads the renderer source and fails
on a `go('…')`, `act('…')` or `data-nav` naming something the map lacks, on a map entry no control
uses, and on a place whose `file` is gone. The UI spec fails on a place the running app cannot
reach. Adding UI a model may need is therefore: a map entry, a handler (the typecheck says where),
state in the store, and a control that calls `go` or `act`; the tools and the turn context follow.

Every turn's `<agent-environment>` block (`src/host/agent-situation.ts`) says where the model runs,
carries one live "Where you are" line read through `rocket_ui_where` as the turn starts, and prints
the map, so a prompt such as "run a tool eval" is three named calls rather than a search.

Besides the browser and UI tools there is `remember` (see Workspace and memory), `ask_user` (below),
`goal_report` (see Goals) and, with `ROCKET_SELF_CHECK=1`, the three self-check tools. Every
tool's schema is in every session's prompt, so what a model should simply know goes ahead of the
user's message instead (tabs, the file map, notes, trouble reports), and a tool is added only for
something a model must do.

`ask_user` (`src/host/tools/ask.ts`) is how a model asks the user something, and it never holds
the chat up. The call posts a card in the transcript and returns at once; the model is told to
carry on with everything the answer does not change and end its turn as usual, so no CLI is left
holding a connection open for a human. A question must carry two to four options, each with a
short label and what picking it means, and the index of the option the model would take itself;
the card marks that one "Suggested", so taking the model's word is one click, and an unanswered
question costs nothing. One question per turn; a second call, a question without real options,
or one without the model's own pick is refused with a message saying what to do instead. An
answer, clicked or typed under "Something else", is sent as the chat's next message with the
question quoted above it, to the provider picked in the composer; clicked while the turn that
asked is still running, it goes the moment that turn ends. In a goal's chat the answer is a note
for the next round instead. A handoff names a question that is still open, so another provider
knows what the user has not yet decided.

Cursor has blocking questions and plan approvals of its own over ACP (`cursor/ask_question`,
`cursor/create_plan`). Nobody would answer them, so its adapter skips the question with a
pointer to `ask_user` and accepts the plan, as an unattended session would.

### Plans

The plan a model keeps while it works is shown beside the chat, not in it. Each adapter turns
its provider's own list into one `plan` item per turn (`<turnId>:plan`, `PlanStep[]` with
`todo` / `doing` / `done`), replaced whole on every update: Claude Code's `TodoWrite` calls, which
no longer appear as tool rows; Codex's `turn/plan/updated` notifications; the ACP `plan` session
update from Cursor. The turn's head line, which reads "Thinking" while it works, reads
`Planning · 2 of 5` instead, the count moving as steps finish, and `Planned · 5 of 5` once the
turn is over. The line opens and closes the plan drawer (`PlanDrawer.tsx`): the goal pane's
layout with only a hide arrow for chrome, the request as its title and the plan's lines under a
count, done lines ticked and dim, the one under way marked with the accent. The drawer opens by
itself on the first plan of a running turn; closing it is remembered per chat (`planClosed` in
the renderer's preferences), after which only the head line opens it. Nothing else is added to the
transcript, and the handoff does not carry the plan: the reply says what was done. In a goal's
chat there is no drawer; the goal pane gains a "This round's plan" section under the checklist,
showing the latest work turn's plan in the same style. The agreed states are in
`docs/mockups/plan.html`.

### Workspace and memory

A new provider session starts already knowing the folder (`src/host/workspace.ts`): its files, one
line per folder, from `git ls-files`, cut to a budget by listing upper folders and counting what
lies deeper; and the notes earlier sessions saved about it. So a session's first calls are not
spent listing and searching. Notes are the project's memory, shared by all four providers: a model
saves one with the `remember` tool (`src/host/tools/memory.ts`), they are kept per folder in the
store, and a session already going is told the ones others save. Reading notes is not a tool, so
it costs no call and no schema. A handoff names the files the missed turns edited and read, each
once and relative to the chat's folder, so the next provider goes straight to them.

### Several assistants, one folder

Chats can run at once in the same project, and the user and other programs change its files too.
Ahead of a message, a model is told (`src/host/teamwork.ts`) who else is working in the folder
right now and on what, what other chats finished there since its last turn, and which files
changed under it, so it reads those again before touching them.

Git is the app's job, not the models'. When a turn completes, the files that changed during it
are committed on the current branch, alone, with the user's request as the message
(`src/host/git.ts`). Changes are found by comparing a snapshot of the folder at the turn's start
and end, so files changed by a shell command count; what the user had already changed, and files
another running turn has edited, are left out. A stopped or failed turn commits nothing: its
files go in with the turn that finishes the work. Nothing is ever pushed, hooks are not run, and
no commit is made mid-merge or off a branch. Models are told not to commit or bring git up.
`ROCKET_AUTO_COMMIT=0` turns the committing off. A folder that is not a git repository is left
as it is.

The same two snapshots give the user what the turn did. Each finished turn that changed files
carries one line under its reply, `Changed 3 files +184 −12` with a bar of the balance, and the
line opens the turn's unified diff beside the chat in the artifact panel (`ChangesView.tsx`): a
strip of its files to jump between, each under a heading that stays while its hunks scroll. The
patch is `git diff` between the snapshots of the turn's own files (`patchBetween`), read into
files and lines by `src/shared/patch.ts`, kept with the turn in the store (`turn_patches`, cut at
2 MB on a file boundary) and served by `turn.changes`; the totals sit on the turn itself. This
needs no commit, so it works with committing off too.

The panel's header offers **Undo this turn**: one question in a strip under the header naming
the files, and on Undo the turn's files are put back from its start snapshot (`restoreFrom`:
working tree only, the user's index untouched; files the turn made are removed). With committing
on, the reversal is committed as `Undo: <request>` so the history says what happened. The turn
stays in the chat with its diff dimmed as a record, its line tagged `undone`, and the next model
in the folder is told the files changed under it. Undo is not offered while a turn runs in that
folder, or when one of the files has changed since; the note names the file, so the user knows
what to look at (`teamwork.undoable`). There is no redo: the diff is still there to read, and a
model can be asked to do it again. The states are in `docs/mockups/turn-changes.html`.

Claude Code sessions working on this repository outside the app are covered by a Stop hook
(`.claude/settings.json`, `scripts/auto-commit.sh`) that commits what a turn left changed.

### Goals

A goal is something the user wants done end to end. They describe it in their own words (the
target button on the rail, then New goal); the provider picked in the composer drafts a brief from
it: the goal restated, two to six lines that define done, and at most one question. The user
edits and confirms the brief, and the work starts. The design and its reasons are in
`docs/goals-phase1.md`.

A goal is a chat with a goal beside it (`src/host/goals.ts`). Each round is one ordinary turn by
the worker, run however its CLI runs best, for as long as it takes; when it ends, a second
provider (another signed-in one, with the most usage left) checks every line in a turn of its own
in the same chat, so the handoff already gives it the worker's turns and files. Unmet lines and the
checker's findings become the worker's next message, until every line is met. There are no step,
time or token limits: the models decide. The goal pauses and asks the user only when the worker
asks a question, when two checks in a row find the same gap, when a turn fails twice, or when a
usage window reaches the goal's pause level (90% unless changed under Advanced); then it carries on
by itself when the window resets. A goal cut off by the app closing waits for Resume.

For a visual result the brief also carries a design: the concept (the one idea that makes it
belong to its product, not a list of styles) and two to five references the drafting model
opened, each with the screenshot it saved. Rocket rejects a design whose screenshots do not
exist, shows them as cards in the brief and the pane (`GoalDesign.tsx`, served by
`goal.referenceImage` since the window only loads its own images), adds a design-quality line to
the checklist, and tells the worker to build against the screenshots and the checker to judge
the result side by side with them. Without that line, functional checks pass a competent template.

Models report through one tool, `goal_report`: the brief when drafting, done or needs-you when
working, a verdict per line when checking. A worker that forgets to call it goes to the checker
anyway; a checker that forgets is asked once more. A goal's turns are marked with their role
(`goalRole`), so the transcript shows "Round 2 · Codex checks" instead of the app's prompt. In the
window the chat splits like an artifact: the conversation, a divider to drag, and the goal's
checklist and rounds laid out like a Linear issue (`GoalPane.tsx`). A goal's chat is a tab like any
other, marked with the goal's status; its composer becomes a note for the next round. While the
new-goal dialog is open the browser's page is hidden, since it would paint over the dialog.

### Design reference library

Goal drafting now points agents to an editable preparation skill and shared reference catalog.
See [the library guide](design-library/README.md) to add references, edit notes and images,
search tags, or validate paths with `npm run design -- validate`. The initial Linear entry
includes the supplied Refero source and a local screenshot. Catalog edits need no rebuild.
[DESIGN.md](DESIGN.md) records Rocket-specific conventions; other projects retain their own.
Set `ROCKET_DESIGN_LIBRARY` to use another library folder. Library management currently uses
files and commands; there is no in-app editor.

### Permissions

All four providers run unattended with full access to the chat's working folder and your shell,
as in the reference build. There are no approval prompts yet.

### Self-check

The host keeps a journal of its own trouble, `journal.jsonl` in the profile folder (one JSON
object per line, rotated at 2 MB; `src/host/journal.ts`). It always records: uncaught errors in the
host, uncaught errors in the page (sent over the renderer's port, once per message), host restarts seen by main, failed turns, tool failures, and turns far slower than usual for
their provider and model; every other turn is kept as a timing line with its tokens, when its
provider reports them. With `ROCKET_SELF_CHECK=1` the app also serves three tools to every
provider (`src/host/tools/self-check.ts`): `rocket_check` runs the chat folder's `typecheck` and
`test` scripts and returns what failed (a failure also lands in the journal as a tool error);
`rocket_diagnostics` reads the journal and the timing
and token averages, and `rocket_note` files what a model saw, why it thinks it happened and the change it
would make. Each chat is also told, ahead of its next message, when new warnings or errors have
arrived, once. Notes edit nothing; changing code is still the user's request or the model's
judgement about a clear defect, as `CLAUDE.md` says.

The profile folder is `~/.config/Rocket` (Electron's `userData`), so the journal is
`~/.config/Rocket/journal.jsonl`; `tail -f` it to watch. `npm run simulate:slow-turn` writes a
fake slow turn from a `sim` provider to check detection; those rows stay in the journal and show
in the timing averages, so use `ROCKET_DATA_DIR=<dir>` to point it at a scratch folder instead.

### Tool-call history

Rocket records calls to its shared MCP tools in `<profile>/tool-calls.db`, independently of
self-check mode. Each call has a start and immutable finish, version/build fingerprints,
provider and available model/turn identity, redacted arguments, duration, outcome, structured
error and artifact references. Unfinished calls from a previous host are interrupted.
Recording failures cannot change tool behavior.

`rocket_tool_history` returns bounded call lists or deterministic failure groups. Default:
last 24 hours, 10 results. Filter by tool/version, error code or dates; use a call ID for
redacted arguments and artifact references. Failure rates include successes in the same
version/operation scope. UI operation failures are distinct from script-authored exceptions.
History stays out of session prompts; tool descriptions are not automatically rewritten.

`rocket_tool_review` records investigator annotations separately from call evidence: lifecycle
stage, cause notes, proposed fix and optional retry links. Use `action=queue` to list failures
still needing review.

Records are pruned after 30 days or beyond 10,000 finished/previous-instance calls, at startup
and every 100 starts. Active calls are preserved. Captures and traces are not deleted by ledger
pruning. See [tool-failure-history.md](docs/tool-failure-history.md) for format, redaction,
retention and query details, and [the implementation plan](docs/tool-failure-history-plan.md)
for milestone progress.

### Desktop self-check

`npm run check:ui` builds the current source, runs unit tests, and drives the actual Electron
app with Playwright. The default uses a private Xvfb display so the test cannot steal your
keyboard input. On Linux it requires `Xvfb`, `xvfb-run` and `xauth`; ImageMagick's `import`
adds full-window screenshots. No Playwright browser download is needed: it uses the project's
Electron binary. Use `npm run check:ui -- --visible` to watch on your desktop, or
`npm run check:ui -- --repeat-each=3` to run every scenario three times with fresh profiles.

Each run keeps a timestamped directory under `.artifacts/ui/`, printed at start and finish.
It contains `runner.log`, `summary.json`, the machine-readable `results.json`, and an HTML
report in `report/index.html`. The report includes named check steps, screenshots, native
view bounds, the app log, the isolated journal, and a Playwright trace. Open it with
`npx playwright show-report <run-directory>/report`; traces can be inspected from the report.
Failed runs exit nonzero and capture the UI before closing. Test windows and the local web
server close automatically; profiles remain with the report for investigation.
SIGINT/SIGTERM stops the owned subprocess tree, including detached Electron processes;
TERM-resistant children are killed after a grace period. Interrupted runs exit with status
130/143 and record failure in `summary.json`.

The checks exercise composer input, folder selection, usage, model selection, streaming,
completion, tool output, provider handoff, cancellation, failure recovery, chat drafts,
history, chat panes (splitting to four, a turn streaming into one pane, closing, and the layout
after a restart), the folding rail (its strip, the hover peek, and the fold after a restart), renderer reload, full app restart, recovery from a host crash during a response,
minimum window size, browser navigation/tabs, the address dropdown, chat links (browser tabs
and local artifact preview), and model question cards from `ask_user`. The shell, embedded
page and dropdown are separate Playwright targets. Their
screenshots and bounds are retained separately; on X11, a whole-window capture also records
how the native views overlap. If that optional capture is unavailable, the report says so.
Assertions also check the native page bounds and dropdown visibility, overlap and stacking
order, so misplaced or hidden native views fail even without visual screenshot comparison.

The test fixture (`tests/ui/app.ts`) uses a fresh marked profile and scratch workspace. All
four provider adapters are replaced by `src/host/ui-test.ts`; real provider CLIs are never
started. Before any restored tab loads, the app and `persist:browser` sessions both block
HTTP/WebSocket origins outside the local fixture; new-tab home navigation redirects to it.
Responses wait for the test to
observe the stream before finishing, which avoids timing-dependent sleeps. The host, SQLite
store, MessagePort, and renderer are real. The folder dialog returns the scratch workspace.
This checks app behavior, not provider authentication, CLI translation, or native OS dialogs;
`check:live` remains the separate, explicitly authorized provider integration check.

The safeguards scenarios deliberately remove the browser filter and damage native view
layout, then require the same assertions to reject those faults. The subprocess unit test
checks ordinary and detached descendants, including ones that ignore SIGTERM.

Add scenarios in `tests/ui/` (`rocket.spec.ts`, `safeguards.spec.ts`, `recovery.spec.ts`,
`question.spec.ts`, `chat-links.spec.ts`).
Prefer accessible controls and observable state;
do not mutate renderer state to manufacture a passing UI. `ROCKET_UI_TEST=1` is reserved for
this runner and requires the marked profile before either main or host opens the store.
The runner supplies `ROCKET_UI_TEST_ORIGIN` for its loopback server; this hook is inactive
outside UI test mode.

## Development hooks

- `ROCKET_SELF_CHECK=1` serves the self-check tools and nudges described above.
- `ROCKET_DATA_DIR=<dir>` moves the host's data (transcript, journal, tool channel) and is set by main to the profile folder; set it by hand only for scripts that run the host without the app.
- `ROCKET_USER_DATA=<dir>` uses another profile folder, so test runs never touch real chats.
- `ROCKET_CAPTURE=<file.png>` saves a picture of the UI after load; `ROCKET_CAPTURE_SCRIPT`,
  `ROCKET_CAPTURE_DELAY_MS` and `ROCKET_CAPTURE_EXIT=1` script a flow first and quit after.
- `npm run check:live -- claude codex cursor antigravity` runs a real conversation across
  providers without the UI. It uses a little of each subscription.
