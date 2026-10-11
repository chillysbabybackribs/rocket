# Round 0001 — Cursor: browser and tool boundaries

**Marker:** `[rocket-research:2026-10-08T04-03-41-819Z:1:research:cursor:1]`
**Date:** 2026-10-08
**Scope:** Browser and tool correctness, security boundaries, automation reliability, and adversarial failure. Evaluation scoring and provider lifecycle are left to the other round-1 assignments.

This is the first continuous-research round, so there is no prior round report to correct. It starts from the 2026-10-06 browser realism audit and the browser-capabilities plan, plus a live failure recorded in `docs/research/continuous/PROTOCOL.md` during supervisor setup: `rocket_ui_run` connected to a stale `DevToolsActivePort` and was restored only after that file was rewritten from the running process’s `/json/version`.

Settled and not re-argued here: client-hint metadata for Chrome 152 (`src/main/browser-url.ts`, unit-tested), the missing Electron client-hints delegate, the script-backed `window.chrome` object, and the observation work that the capabilities plan marks landed (a11y read, find query, SPA settle, JSON attach, HAR, SoM). Critical-CH restart is still the comment in `sendClientHints`; no new site was shown this round to require it.

## What changed in the picture

The audit asks whether a page can tell Rocket from Chrome. This round asks a different question: once a model, a page, or another local process is already talking to Rocket, which boundaries are actually enforced? Several are comments or tool descriptions, not checks. One of them matches the setup failure that blocked live UI automation.

Isolated checks (no live Rocket process, no network) are in `docs/research/continuous/round-0001/evidence-cursor/boundary-checks.json`.

## Claims

### C1 — Live UI discovery trusts a file Chromium may not have updated

**Observation.** `liveUiConnection` reads `userData/DevToolsActivePort`, splits it into a port and a `/devtools/browser/…` path, and returns `ws://127.0.0.1:${port}${path}`. It does not open the socket, does not fetch `/json/version`, and does not compare the port with the one main put on the command line.

```17:19:src/main/ui-connection.ts
export async function liveUiConnection(window: BrowserWindow): Promise<LiveUiConnection> {
  const [port, path] = (await readFile(join(app.getPath('userData'), 'DevToolsActivePort'), 'utf8')).trim().split('\n')
  if (!/^\d+$/.test(port) || !path?.startsWith('/devtools/browser/')) throw new Error('The live UI connection is not ready. Restart Rocket and try again.')
```

The endpoint is returned on line 26 as `ws://127.0.0.1:${port}${path}` with no further check.

Main chooses that port, then drops it. The comment in between says the live UI connection still reads the file:

```32:37:src/main/index.ts
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
// Chromium takes a remote debugging port of 0 as a sign of automation and sets
// navigator.webdriver in every page (content/child/runtime_features.cc), which login pages read as
// a bot. So the free port is found here and passed by number; the live UI connection still reads
// it from DevToolsActivePort.
app.commandLine.appendSwitch('remote-debugging-port', String(await freeLoopbackPort()))
```

`freeLoopbackPort` binds `127.0.0.1:0`, reads the port, and closes the socket before Chromium starts. Anything else can take the port in between. The comment above the switch says port `0` would set `navigator.webdriver`, which is why the port is chosen in JavaScript.

**Primary source.** Current Chromium `content/browser/devtools/devtools_http_handler.cc` (main, read 2026-10-08) writes `DevToolsActivePort` only after `GetLocalAddress` succeeds, as `"%d\n%s"` (actual bound port, then browser guid). If the socket cannot be created it logs `Cannot start http server for devtools` and does not replace the file. If `WriteFile` fails it logs and still keeps the server. The destructor path read in that file does not delete the file. `/json/version` returns `Browser` and `webSocketDebuggerUrl` with no separate auth token. WebSocket upgrades that carry an `Origin` are rejected unless that origin is the server’s own or listed in `--remote-allow-origins`. Rocket does not set that switch. Requests that omit `Origin` skip that check. This round did not capture Playwright’s handshake; a Node client that omits `Origin` would be allowed.

**Inference.** A tool call that runs before Chromium’s write, or after a failed write, uses the previous process’s port. Connection refused is what the setup notes describe. The chosen port is already known in main and would have answered `/json/version` on the live process. Rewriting the file, which is what setup did, papers over a discovery bug rather than fixing it.

**Not shown.** This round did not attach to the running app, so it did not reproduce the stale file in this process. Electron’s exact `output_directory` argument was not opened; the inference assumes it is `app.getPath('userData')`, which is the path Rocket reads.

**Upgrade.** Keep the port passed to `--remote-debugging-port`. After ready, `GET http://127.0.0.1:<that port>/json/version` and use `webSocketDebuggerUrl` only when the host is loopback and `Browser` identifies this app. If that probe fails, do not fall back to a `DevToolsActivePort` whose port disagrees. Retry the probe for a short startup window before returning `UI_CONNECTION_FAILED`. Add a unit test with a fixture file whose port is closed and a fake `/json/version` on the command-line port.

### C2 — `file:` is a first-class browser read, including `session.fetch`

**Observation.** `toUrl` returns `file:` and `about:` URLs unchanged. `javascript:`, `chrome:`, and `data:` become Google searches. Checked by importing `toUrl` (evidence file): `file:///etc/passwd` and `file:///home/dp/.ssh/config` pass through; `javascript:alert(1)` does not.

```31:34:src/main/browser-url.ts
export function toUrl(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  if (/^(https?|file|about):/i.test(text)) return text
```

`navigate` loads that string with `webContents.loadURL`. Popup handling is stricter: `setWindowOpenHandler` allows only `https?` and `about:blank` (`browser-pane.ts` around the handler). A page cannot open `file:` itself; a model `goto` / `browser_read` can.

`browser.fetch` does not use `toUrl` at all. It calls `session.fromPartition(PARTITION).fetch(op.url)` (`browser-agent.ts` `fetch`). Electron’s session docs, read 2026-10-08, say `ses.fetch` uses Chromium’s network stack for that session and that “requests made with net.fetch can be made to custom protocols as well as file:”. The tool text tells models this path has “session cookies, no CORS”.

**Inference.** Prompt injection on a page can ask for a `file:` read through a tool described as a web reader. That is a different path from a provider shell, and it is not limited to the chat folder. `session.fetch` also sends the partition’s cookies for the request URL (Chromium network stack; Rocket’s own description). HttpOnly cookies that page JavaScript cannot read still go out on `browser.fetch`.

**Limitation.** No live `session.fetch('file:///…')` was issued against the running partition.

**Upgrade.** Reject non-`http(s)` in `navigate` and in `fetch` unless a future tool is explicitly a local-file tool. For `browser.fetch`, default to same-site as the tab, or require an explicit `credentials: 'omit'` for other sites. Record scheme denials in the tool ledger.

### C3 — JavaScript dialogs are accepted before the model sees them

**Observation.** After a tool attaches, `Page.javascriptDialogOpening` is handled by accepting the dialog and remembering a 200-character note for the next read.

```453:458:src/main/browser-agent.ts
if (method === 'Page.javascriptDialogOpening') {
  // An open dialog stops the page, and with it every tool call; nobody may be watching this
  // tab to answer it. It is accepted, and the next reading says so.
  state.dialogs.push(`${String(params.type)}: ${String(params.message).slice(0, 200)}`)
  void contents.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
```

`Page.enable` is part of `attach`, so this runs for agent-driven tabs. `Runtime.evaluate` is called with `userGesture: true`, so those evaluations count as user activation.

**Inference.** A page can put the real action behind `confirm(...)` or `beforeunload`. The model learns the message only on a later read, after the accept. That is the opposite of a safeguard. The comment explains a real deadlock (a modal dialog stalls CDP); the safe default for an unattended tab is dismiss, not accept.

**Upgrade.** `accept: false` unless the script passed an explicit `dialogs: 'accept'`. Put the dialog text in the tool error either way. Add a fixture page with `confirm` and a UI test that the following navigation did not happen.

### C4 — Browser and live-UI scripts are Node programs; the locator allowlist is not a boundary

**Observation.** `browser_run` compiles the model script with `AsyncFunction` inside a worker thread (`script-worker.ts`). `rocket_ui_run` does the same (`scripts/ui-run-worker.mjs`). Worker threads share the host process. The function parameters are `tab` / `browser` / `ui`, but the body can `import('node:fs')` and see `parentPort`. An isolated worker using that pattern returned Node 24.5.0 and `hasFs: true` (evidence file).

The live runner then special-cases `evaluate` when a locator chain is non-empty:

```113:115:src/host/tools/ui-live.ts
if (op.type === 'evaluate') {
  const fn = chain.length ? new Function(`return (${stringOf(op.expression)})`)() : new Function(`return (${stringOf(op.expression)})`)
  return (target as Page).evaluate(fn)
}
```

The same expression shape, run in this check, executed a comma-operator side effect in the caller (`hostSide: true`) and returned a function. The worker’s usual wrapper puts the model function inside an arrow, so that ordinary call does not run the function body in the host. A message whose expression has a side effect outside the returned function does run it in the host. This check did not show a breakout through that arrow wrapper; the open hole is that the host evaluates the expression at all, and that the script can already import Node.

**Inference.** The locator and action sets in `ui-live.ts` never confine a script that can import Node or post its own ops. Provider shells are already unsandboxed (Claude `bypassPermissions`, Codex `danger-full-access`, Antigravity `--dangerously-skip-permissions`, Cursor running commands itself). This is not a new operating-system privilege. It is a false boundary: a page that says “run this browser script” gets a host-process program, and the host re-evaluates locator expressions.

**Upgrade.** Run scripts in `vm` with a frozen global, or keep the worker but delete `parentPort` from the function’s scope and reject messages whose `op` was not built by the worker’s own `call()`. Pass locator functions to Playwright without calling `new Function(...)()`. Do not describe these scripts as DOM-only.

### C5 — `page.evaluate` on the shell can call `window.rocket`, including close

**Observation.** The shell window sets `sandbox: false` because an ESM preload cannot be sandboxed, with `contextIsolation: true` and `nodeIntegration: false` (`index.ts` `webPreferences`). The preload exposes `window.rocket` in the main world: window minimize / maximize / close, folder picker, capture, chat links, and `browser.send` (`newTab`, `closeTab`, `navigate`, `fill`, …). `will-navigate` blocks the shell from leaving its own URL. `rocket_ui_run` still runs `page.evaluate` in that page (`ui-live.ts`).

**Inference.** Context isolation stops the page from touching Node directly. It does not stop `page.evaluate(() => window.rocket.window.close())`. The tool description says evaluate is for inspecting the DOM. Nothing in the runner checks the function. This round did not call `close`.

**Upgrade.** Evaluate shell scripts in an isolated world that cannot see `window.rocket`, or wrap `evaluate` so the function receives only the element and a DOM helper. Keep `window.close` off the bridge the page can see; the title-bar buttons can call preload-internal functions that are not `exposeInMainWorld`.

### C6 — Site-scoped cookie import also matches public-suffix hosts

**Observation.** First run imports the default browser’s entire cookie jar into `persist:browser` with no host filter (`firstRunCookieImport` in `index.ts`). Later, the page menu can pass a host. `hostMatches` is true when the names are equal, or either is a dotted suffix of the other:

```266:270:src/main/cookie-import.ts
export function hostMatches(cookieHost: string, site: string): boolean {
  const bare = cookieHost.replace(/^\./, '').toLowerCase()
  const want = site.replace(/^\./, '').toLowerCase()
  return bare === want || want.endsWith(`.${bare}`) || bare.endsWith(`.${want}`)
}
```

The unit tests require both `.claude.ai` matching `app.claude.ai` and `app.claude.ai` matching `claude.ai`, and they reject `notclaude.ai`. They never try a public suffix. Importing the function: `hostMatches('com', 'bank.com')`, `hostMatches('ai', 'claude.ai')`, and `hostMatches('co.uk', 'example.co.uk')` are all true (evidence file).

**Inference.** A cookie stored for host `com` or `ai` is imported whenever the user imports a site under that suffix. First run already copies everything; this bug is the “this site only” path.

**Upgrade.** Match registrable domains (or at least require a dot-boundary and reject a cookie host that is a public suffix). Keep the existing subdomain tests. Add `hostMatches('com', 'bank.com') === false`.

### C7 — Antigravity’s shared MCP URL drops chat identity when two turns overlap

**Observation.** Antigravity registers one global URL with the `SHARED` key (`antigravity.ts`). The channel then does `chatId = key === SHARED ? this.runningChat(provider) : …`. `runningChat` returns a chat id only when that provider has exactly one live turn (`hub.ts`). Otherwise it returns null, and the tool still runs. Browser ops with a null chat use the key `''`. A read with no URL and no tab prefers the user’s active tab (`browser-agent.ts` `resolve`, `preferActive`).

**Inference.** Two Antigravity chats at once share a work tab and can read the user’s visible tab. The research supervisor’s “one turn per provider” rule avoids this; the app does not. Cursor’s own header already notes a related hole: `cursor/update_todos` has no session id, so with several chats it cannot be placed.

**Upgrade.** When `runningChat` is null, fail the MCP call with a clear error instead of running it as chat `''`. Give Antigravity a per-chat URL when the CLI allows it.

### C8 — The SPA hook is page-controlled state

**Observation.** On agent tabs, `SPA_HOOK` is evaluated in the page’s main world (no isolated `contextId`) and registered for new documents. It wraps `history.pushState` / `replaceState` and sets `globalThis.__rocketSpaHook` and `__rocketSpaNavigation`. `waitSpa` treats an increase of that counter as a route change.

**Inference.** The page can see the hook (a bot signal the realism audit did not list), replace `pushState` again, or bump the counter without routing. `waitForNavigation` then returns for the wrong reason, or never returns. The capabilities plan’s risk note says the inject is agent-tab-only. It does not say the predicate lives where the page can write it.

**Upgrade.** Keep the counter in the isolated world, or have main listen to `Page.frameNavigated` / `Page.navigatedWithinDocument` instead of a page global. Add a fixture that sets `__rocketSpaNavigation.seq` without changing the URL and assert `waitSpa` does not succeed.

## Checked and not promoted to a defect

**Client-hint header rewrite.** `sendClientHints` passes `{ requestHeaders: { ...details.requestHeaders, ...hints } }` from `onBeforeSendHeaders`. Electron’s webRequest doc (read 2026-10-08) says that when `requestHeaders` is provided, the request is made with those headers, and the documented sample copies `details.requestHeaders` the same way. A search for a current Electron bug about that copy dropping `Cookie` did not return a matching issue page. No echo request was sent this round. Whether `Cookie` is present in `details.requestHeaders` on Electron 44 stays open (question below).

**CDP from a web page.** Chromium rejects a WebSocket whose `Origin` is not allowed. Rocket binds `127.0.0.1` and does not pass `--remote-allow-origins=*`. A malicious page’s WebSocket should get 403. A local process that omits `Origin` and can read `DevToolsActivePort` can still drive every target, including the shell. `/json/list` and `/json/new` are unauthenticated aside from the Host check. That is Chromium’s debugging server, not an extra Rocket auth layer.

**Provider shells.** They are intentionally unsandboxed. Cursor’s adapter also answers `session/request_permission` with the broadest allow option (`allowOption` prefers `allow-always`) and serves `fs/read_text_file` / `fs/write_text_file` with `readFile` / `writeFile` on the requested path and no chat-folder check. The adapter header says the agent runs commands itself because `terminal` is not advertised. The ACP file methods are a second, unscoped path Rocket implements. Worth a review, not a new privilege relative to that shell.

## Actionable upgrades (in order)

1. **C1** — Discover the live UI endpoint from the port main selected, confirmed with `/json/version`. This is the failure that already blocked automation.
2. **C3** — Dismiss JavaScript dialogs unless a script opts in.
3. **C2** — Refuse `file:` (and other non-web schemes) in `toUrl` for navigation and in `session.fetch`.
4. **C5** — Keep `window.rocket` out of `page.evaluate`.
5. **C6** — Tighten `hostMatches` and add the public-suffix tests.
6. **C4 / C8** — Stop host-side `new Function` invocation; move the SPA signal out of the page.
7. **C7** — Fail shared MCP calls that are not tied to exactly one chat.

Acceptance for 1–3 can be unit or UI-fixture tests with no model turn. Do not point those tests at the user’s running profile.

## Novelty

No earlier round file exists. Relative to `docs/browser-realism-audit.md` and `docs/browser-agent-capabilities-plan.md`, this round does not reopen client hints or a11y snapshots. It adds the debug-port discovery failure, dialog accept, `file:` / `session.fetch`, the shell bridge, cookie-host suffix matching, shared-MCP chat loss, and the page-owned SPA counter.

## Unresolved

- Reproduce C1 against a disposable `ROCKET_USER_DATA` (not this running profile): stale file, then `/json/version` on the command-line port.
- Confirm Electron passes the user-data dir as Chromium’s `DevToolsActivePort` directory.
- Does `onBeforeSendHeaders` in this Electron build include `Cookie` in `details.requestHeaders` when the callback replaces the header set?
- Does `ses.fetch('file:///…')` on `persist:browser` return file bytes, and does an `https:` fetch attach imported cookies? Docs say file is allowed and the stack is Chromium’s; not replayed here.
- Chrome’s `kWithApprovalOnly` remote-debugging mode would put a user prompt in front of CDP. Not checked against Electron 44’s switches.
- `decryptChromium` still accepts only `v10` and `v11`. The cookie-import header says that matched Chrome 152 on Linux on 2026-10-06. Not re-verified today.

## Sources opened

- Chromium `content/browser/devtools/devtools_http_handler.cc` on main, 2026-10-08: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/devtools/devtools_http_handler.cc
- Electron `webRequest`, 2026-10-08: https://www.electronjs.org/docs/latest/api/web-request
- Electron `session` / `ses.fetch`, 2026-10-08: https://www.electronjs.org/docs/latest/api/session#sesfetchinput-init

Search pages were used only to find those documents. Stack Overflow and Chrome DevTools marketing pages from the same searches were not used as evidence.
