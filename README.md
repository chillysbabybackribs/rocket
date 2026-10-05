# Rocket

One chat, many agents. Rocket is an Electron app that owns the conversation and an embedded
browser, and lends each message to whichever provider you pick: Claude, Codex, Cursor or
Antigravity. You can switch provider on every message; they all share the same chat.

## Run

```sh
npm install
npm run dev        # development, with rebuild on change
npm run preview    # production build, then launch
npm test           # unit tests (hub, handoff, store, Claude stream, markdown blocks)
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
mark. Codex receives them as real history (`thread/inject_items`); the other three receive a
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
as `rocket` (`agy mcp add`) and works out the chat from the turn that is running.

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

### Permissions

All four providers run unattended with full access to the chat's working folder and your shell,
as in the reference build. There are no approval prompts yet.

## Development hooks

- `ROCKET_USER_DATA=<dir>` uses another profile folder, so test runs never touch real chats.
- `ROCKET_CAPTURE=<file.png>` saves a picture of the UI after load; `ROCKET_CAPTURE_SCRIPT`,
  `ROCKET_CAPTURE_DELAY_MS` and `ROCKET_CAPTURE_EXIT=1` script a flow first and quit after.
- `npm run check:live -- claude codex cursor antigravity` runs a real conversation across
  providers without the UI. It uses a little of each subscription.
