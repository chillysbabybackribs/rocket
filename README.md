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
```

Each provider runs through its own CLI, signed in with your own account. Install and sign in to
the ones you want: `claude`, `codex`, `cursor-agent`, `agy`.

### Linux sandbox

Chromium's sandbox needs its helper to be owned by root. After every `npm install`:

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

### Browser

The browser panel has Chromium's tab strip and shortcuts (Ctrl+T, W, Shift+T, Tab, 1–9, L) and a
Safari-style address field. Each tab is a native view owned by main (`src/main/browser-pane.ts`);
only the active one is on screen. The address field's dropdown is a view of its own
(`browser-suggest.ts`, `src/renderer/suggest.html`) stacked above the page, so it overlays the
page and never moves it. Tabs, history and the last session are kept in the profile folder.

Background tabs are hidden with `setVisible(false)`, so Chromium stops drawing them.
`ROCKET_BROWSER_HIDE=park npm run dev` moves them off screen instead, the older way, in case a
tab ever comes back blank; see the note in `src/main/browser-url.ts`.

### Tools

The app owns its tools and every provider sees the same ones. The agent host keeps them in one
registry (`src/host/tools/registry.ts`) and serves them over a single MCP server on loopback
(`channel.ts`), the one channel all four CLIs accept. Each session is given a URL that names its
chat. Antigravity is the exception: its MCP config is global, so the app registers itself there
as `rocket` (`agy mcp add`) and works out the chat from the turn that is running. Its CLI also
leaves MCP tools out of the model's prompt, so the adapter opens a new conversation's first
message with the tools, their arguments and how to call them.

There are three browser tools (`src/host/tools/browser.ts`). `browser_read` returns a page as text
with links, its controls with short refs, and the data requests it made. `browser_screenshot`
returns a tab as a small JPEG, for what text cannot say. `browser_run` runs a
script the model writes against a small Playwright-shaped API (`tab.goto`, `tab.eval`,
`tab.click`, `tab.fill`, `tab.waitFor`, `browser.fetch`), so a whole task is one call; the script
runs in a worker thread of the host and each step is a request to main
(`src/main/browser-agent.ts`), which drives the tab over the DevTools protocol. A model works in
background tabs of its own, marked with a dot in the tab strip, and touches the user's tabs only
by id. The open tabs ride at the head of the user's message when they have changed, so listing
them costs no call. A page counts as loaded when its document is ready, not when its last ad is.
While a turn uses a tab, its page runs at full speed out of sight; when the turn ends it goes back
to being an ordinary background tab, and a deleted chat's own tab is closed.

Besides the browser tools there is `remember` (see Workspace and memory), `goal_report` (see Goals) and, with
`ROCKET_SELF_CHECK=1`, the three self-check tools. Every tool's schema is in every session's prompt,
so what a model should simply know goes ahead of the user's message instead (tabs, the file map,
notes, trouble reports), and a tool is added only for something a model must do.

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

Models report through one tool, `goal_report`: the brief when drafting, done or needs-you when
working, a verdict per line when checking. A worker that forgets to call it goes to the checker
anyway; a checker that forgets is asked once more. A goal's turns are marked with their role
(`goalRole`), so the transcript shows "Round 2 · Codex checks" instead of the app's prompt. In the
window the chat splits like an artifact: the conversation, a divider to drag, and the goal's
checklist and rounds (`GoalPane.tsx`); the composer becomes a note for the next round. While the
new-goal dialog is open the browser's page is hidden, since it would paint over the dialog.

### Permissions

All four providers run unattended with full access to the chat's working folder and your shell,
as in the reference build. There are no approval prompts yet.

### Self-check

The host keeps a journal of its own trouble, `journal.jsonl` in the profile folder (one JSON
object per line, rotated at 2 MB; `src/host/journal.ts`). It always records: uncaught errors in the
host, uncaught errors in the page (sent over the renderer's port, once per message), host restarts seen by main, failed turns, tool failures, and turns far slower than usual for
their provider and model. With `ROCKET_SELF_CHECK=1` the app also serves three tools to every
provider (`src/host/tools/self-check.ts`): `rocket_check` runs the chat folder's `typecheck` and
`test` scripts and returns what failed (a failure also lands in the journal as a tool error);
`rocket_diagnostics` reads the journal and the timing
averages, and `rocket_note` files what a model saw, why it thinks it happened and the change it
would make. Each chat is also told, ahead of its next message, when new warnings or errors have
arrived, once. Notes edit nothing; changing code is still the user's request or the model's
judgement about a clear defect, as `CLAUDE.md` says.

The profile folder is `~/.config/Rocket` (Electron's `userData`), so the journal is
`~/.config/Rocket/journal.jsonl`; `tail -f` it to watch. `npm run simulate:slow-turn` writes a
fake slow turn from a `sim` provider to check detection; those rows stay in the journal and show
in the timing averages, so use `ROCKET_DATA_DIR=<dir>` to point it at a scratch folder instead.

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
history, renderer reload, full app restart, recovery from a host crash during a response,
minimum window size, browser navigation/tabs, and the address dropdown. The shell, embedded
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

Add scenarios in `tests/ui/` (`rocket.spec.ts`, `safeguards.spec.ts`, `recovery.spec.ts`).
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
