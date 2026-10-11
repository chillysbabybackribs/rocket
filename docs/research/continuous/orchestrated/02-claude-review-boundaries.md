# 02 — Claude review: browser and tool boundaries

**Reviews:** `docs/research/continuous/round-0001/research-cursor.md` (C1, C4, C5, C6 in depth; C2, C3, C7, C8 not re-verified here)
**Date:** 2026-10-08
**Evidence:** `docs/research/continuous/orchestrated/evidence-02-claude/` (README there lists each experiment and how to rerun it)
**Method:** read-only code inspection, primary sources opened this turn, and isolated Electron / Node experiments in fresh `/tmp` profiles. Nothing was run against Rocket's live profile except one read-only `GET /json/version` and one read of its `DevToolsActivePort` file.

## Summary of verdicts

| Claim | Observation | Inference | Proposed fix | Verdict |
|---|---|---|---|---|
| C1 live UI discovery trusts a stale file | Supported | Partly right; root cause not identified | Right direction, wrong identity check, misses the cause | **Supported, upgraded.** The stale file is written by the losing second instance that `npm run open` starts. Reproduced in isolation. |
| C4 scripts are Node programs; locator allowlist is no boundary | Supported | Correct that there is no confinement; "host re-evaluates" adds no privilege | `vm` with frozen global is **contradicted** by Node's own docs and by experiment | **Supported as a robustness item, not security.** One real code smell to fix. |
| C5 `page.evaluate` on the shell reaches `window.rocket.window.close` | Supported | Correct capability, overstated as a boundary | Isolated-world evaluate is costly; bridge trimming is cheap hygiene | **Supported, downgraded.** Any model already holds stronger ways to close the app. |
| C6 site-scoped cookie import matches public-suffix hosts | Supported for the matcher | **Contradicted**: such cookies cannot exist in a Chromium jar and are rejected on import | Registrable-domain matching needs a PSL dependency for no gain | **Downgraded to a correctness nit.** No security effect. |

## C1 — Live UI discovery: the stale file has a cause, and it is `npm run open`

### What the report got right

`liveUiConnection` reads `userData/DevToolsActivePort`, validates only the shape, and returns `ws://127.0.0.1:${port}${path}` (`src/main/ui-connection.ts:18-19,26`). Main picks the port with `freeLoopbackPort()` and then forgets it (`src/main/index.ts:37-48`). Chromium writes the file as `"%d\n%s"` only after the server binds, and the handler destructor does not delete it (Chromium `content/browser/devtools/devtools_http_handler.cc`, main, opened 2026-10-08). All confirmed.

### What it missed: the second instance writes the file

Startup order in `src/main/index.ts`:

1. line 31: `app.setPath('userData', …)` when `ROCKET_USER_DATA` is set.
2. lines 32-37: `remote-debugging-address` and `remote-debugging-port` are appended, with a top-level `await freeLoopbackPort()`.
3. line 288: `app.requestSingleInstanceLock()`; the loser calls `app.quit()` (line 289). The comment at 286-287 already knows `ready` still fires on the way out.

`scripts/open.mjs:26-29` spawns `electron <app root> <href>` with no `ROCKET_USER_DATA`, so it shares the running app's default profile (`~/.config/Rocket`, the profile I read). That second process runs steps 1-3 in the same order: the debugging switch is on its command line before it learns it lost the lock.

Electron starts the HTTP handler in `ElectronBrowserMainParts::PreMainMessageLoopRun` whenever `--remote-debugging-port` is present and `--remote-debugging-pipe` is not, and only afterwards calls `Browser::Get()->PreMainMessageLoopRun()` (Electron `shell/browser/electron_browser_main_parts.cc`, main, opened 2026-10-08). The handler writes the port file into `DIR_SESSION_DATA` (Electron v44.5.1 `shell/browser/ui/devtools_manager_delegate.cc:97-102`, saved in the evidence folder), which "by default … points to `userData`" (Electron `app` docs, opened 2026-10-08). `app.quit()` is not immediate: it tries to close windows and emits `before-quit` first (same docs). So the loser binds a fresh port, overwrites the file, and exits, leaving the file pointing at a closed port. That is exactly "connection refused on a stale `DevToolsActivePort`" from `PROTOCOL.md`, and it explains the orchestrator's observation that `npm run open` disturbs live automation.

### Isolated reproduction (observation)

`evidence-02-claude/second-instance/run.sh rocket` runs a 25-line Electron main that mirrors steps 1-3 twice against one fresh `/tmp` userData (results in `result-rocket-order.txt`):

- Instance A (lock holder) wrote `42677\n/devtools/browser/4d12…`; `/json/version` on 42677 answered.
- Instance B (same userData) logged `lock lost`, then `ready` 0.1 s later, then exited 0. The file now read `42029\n/devtools/browser/5dfd…`. `/json/version` on 42029: connection refused. A was still answering on 42677.
- The stale content survived B's clean quit and A's later termination: Electron deletes nothing.

`run.sh lock-first` (lock requested before the switch is appended; the loser appends nothing) left the file at A's port throughout (`result-lock-first-order.txt`). Both runs are deterministic apart from the port numbers.

Read-only check of the live profile: the file names 46303 and `ss` shows the Electron browser process listening there. It is correct now only because setup rewrote it by hand.

### Defects in the proposed fix

- "Use `webSocketDebuggerUrl` only when `Browser` identifies this app": `Browser` is `"Chrome/152.0.7977.130"` on the live app (`evidence-02-claude/live-json-version.json`). The app name appears only in the `User-Agent` field (`Rocket/0.1.0 … Electron/44.5.1`). A second Rocket under another profile would pass that check too, so it is not an identity check; the port main chose is.
- Probing with retries treats the symptom. Without fixing the second-instance write, every `npm run open` while the app runs corrupts the file again until the next real restart.
- The report assumes the output directory is `userData`; it is `sessionData`, which coincides unless someone sets it separately. Worth a comment, not a bug.

The `freeLoopbackPort()` race the report names is real but secondary: if another process grabs the port before Chromium binds, Chromium logs and writes nothing, and the previous run's file would be read. The probe covers that case.

### Minimum useful fix

1. Move `app.requestSingleInstanceLock()` ahead of the `remote-debugging-*` switches and the `await freeLoopbackPort()`. `app.setPath('userData', …)` must stay first because the lock is per profile. The loser then never starts a DevTools server, never writes the file, and starts no host.
2. Keep the chosen port in a module variable and have `liveUiConnection` take the endpoint from `GET http://127.0.0.1:<chosen>/json/version` (`webSocketDebuggerUrl`), falling back to the file only when its first line equals the chosen port. The file is then informational.

### Regression checks

- Unit: factor a pure `resolveLiveEndpoint(chosenPort, fileText, probe)` and test: file port ≠ chosen port → probe wins; probe fails and file port ≠ chosen → error; probe fails and file port = chosen → file.
- UI (`tests/ui`): with the isolated app up, spawn a second `electron <app root> /tmp/note.md` with the same `ROCKET_USER_DATA` (what `open.mjs` does), await its exit, then assert `DevToolsActivePort` is byte-identical and a `rocket_ui_run` live call still succeeds. `tests/ui/ui-live.spec.ts` already exercises the live path from that profile, so the handler runs under the harness.
- Smoke: `evidence-02-claude/second-instance/run.sh rocket` against the mirror must behave like `lock-first` once the real ordering changes; a Rocket-based variant needs a built `out/` and a temp `ROCKET_USER_DATA`.

## C4 — Scripts are Node programs: true, but `vm` is not the answer

### Observations confirmed

- `scripts/ui-run-worker.mjs:62-64` and `src/host/tools/script-worker.ts:110-121` compile the model's code with `AsyncFunction` in a worker thread of the host process. My worker check (`evidence-02-claude/vm-escape/worker-side.mjs`): a function body with only `page, ui` as parameters gets `parentPort` back via `import('node:worker_threads')`, reads `/` with `fs`, and sees `process`. Deleting `parentPort` from scope would change nothing.
- `src/host/tools/ui-live.ts:114` invokes `new Function(\`return (${expression})\`)()` in the host thread when a locator chain is present. The expression normally comes from `ui-run-worker.mjs:33` as `(element) => (…)`, so the host call only builds a closure. A forged `call` message can make the host evaluate anything.

### Where the inference overreaches

Running code in the host thread instead of the worker thread adds no privilege: same process, same user, same `process`, `fs`, `child_process`. And the model already has a provider shell with no sandbox (`src/host/providers/claude.ts:116` `bypassPermissions`, `codex.ts:283` `danger-full-access`, `antigravity.ts:94` `--dangerously-skip-permissions`). The report says this itself and then still calls the host evaluation "the open hole". It is a robustness smell, not a hole.

### The `vm` proposal is contradicted

Node's documentation, opened 2026-10-08: "The `node:vm` module is not a security mechanism. Do not use it to run untrusted code." Experiment (`evidence-02-claude/vm-escape/`): a frozen null-prototype context with no helpers did resist the one-line `({}).constructor.constructor('return process')` on Node 24.13.1, but a context that receives any helper object, which Rocket must pass (`tab`, `page`, `ui`), yields the outer realm at once: `page.read.constructor('return process.pid')()` returned the host pid (`result-with-helper.json`). The Node Permission Model (stable since v22.13/v23.5) is also explicit: it "does not protect against malicious code" and "does not inherit to a worker thread" unless its flags are re-listed in `execArgv` (Node permissions docs, opened 2026-10-08). Neither is a boundary; an OS-level sandbox (separate process under a different user or namespace) would be, and it would be pointless while the provider shells are unsandboxed.

### Minimum useful fix

- Never call model-derived source in the host. Playwright's `locator.evaluate` and `page.evaluate` take `function | string`, and a string is evaluated as an expression that cannot receive the element (Playwright `Page` and `Locator` API docs, opened 2026-10-08), so a `Function` object is needed. Build it without invoking it: have the worker send the function source and `arg` separately, and let the host do `new Function('element', 'arg', \`return (${source})(element, arg)\`)` and pass it with `arg` to `locator.evaluate(fn, arg)`. Playwright serialises `fn.toString()` into the page; the host executes nothing. The `page.evaluate` and `waitForFunction` paths at `ui-live.ts:100,114` (no-chain case) already follow that shape.
- Validate `op` by a schema in `operate` (type, surface, chain methods, args as JSON) rather than trusting the worker's shape.
- Describe the scripts honestly in the tool text: they run in Rocket's agent host with Node available; only the page and locator objects stay host-side. Do not call them DOM-only.

### Regression checks

- Unit test on the chain evaluate: a forged message `{ type: 'evaluate', chain: [...], expression: 'globalThis.__hit = 1, (e) => 1' }` must leave `globalThis.__hit` undefined in the host (needs the `operate` function factored out of `run`).
- Existing `tests/ui/ui-live.spec.ts` keeps covering the legitimate `locator.evaluate` with an argument.

## C5 — `window.rocket` from `page.evaluate`: real, minor

### Observations confirmed

`src/preload/index.ts:21-48` exposes `window.rocket`, including `window.close`, with `contextBridge.exposeInMainWorld`, which puts the API on the main world's `window` (Electron `contextBridge` docs, opened 2026-10-08). `ipcMain.on('rocket:window')` at `src/main/index.ts:218-223` checks only that the sender is the shell's `webContents`, which a Playwright `page.evaluate` on the shell page satisfies, since `page.evaluate` runs "in the page context" (Playwright docs). So `page.evaluate(() => window.rocket.window.close())` would close the window. Not executed here.

### Why it is not a boundary

The same model script can read `DevToolsActivePort` (world-readable in the profile), connect its own CDP client and send `Browser.close`; the provider shell can `kill` the process. `ui-live.ts:15-16` promises only that worker *termination* cannot close the window, which stays true. "Keep Rocket running" (`agent-situation.ts` text) is a policy for cooperative models, like every other instruction in that block. Application automation policy and OS sandbox guarantees must not be mixed up: Rocket has the first and, by design, none of the second.

### Fix review

- Isolated-world evaluate: Playwright exposes no public isolated-world `evaluate`; it would need a CDP session per call (`Page.createIsolatedWorld`, `Runtime.callFunctionOn`) and, for locator-scoped evaluate, the element's remote object id. Large change for a policy benefit.
- Taking `close` off the bridge and letting the preload bind the title-bar button directly is cheap, but CDP-dispatched clicks are trusted events, so an automation click on "Close window" still closes. Value: it removes the one-liner, nothing more.

Minimum useful change: say in the `rocket_ui_run` description that `evaluate` runs in the main world with the app bridge visible, and that closing the window is out of bounds. Optional hygiene: move `minimize/toggleMaximize/close` to preload-bound DOM listeners and drop them from `RocketBridge`; a UI spec then asserts `typeof window.rocket.window === 'undefined'` and that the title-bar buttons still work.

## C6 — Public-suffix cookie hosts: Chromium already refuses them

### Observations confirmed

`hostMatches` (`src/main/cookie-import.ts:267-270`) is symmetric and returns true for `('com', 'bank.com')` and `('co.uk', 'example.co.uk')`. `importCookies` filters with it and writes through `session.cookies.set(toElectronCookie(cookie))` (lines 90-97), where a dotted source host becomes the `domain` attribute and the URL is built from the bare host (lines 236-253).

### What the report did not check

Chromium's `GetCookieDomainWithString` resolves the cookie domain through `GetEffectiveDomain`, which calls `GetDomainAndRegistry(host, INCLUDE_PRIVATE_REGISTRIES)` and then requires the URL host to be the cookie domain or one of its subdomains (Chromium `net/cookies/cookie_util.cc`, main, opened 2026-10-08). A Domain attribute that is a public suffix has no registrable domain and fails. Observed on Electron 44.5.1 / Chrome 152 (`evidence-02-claude/cookies/result.json`): `.com`, `.co.uk`, `.ai` and `.github.io` (a private-section PSL entry) were all rejected with `EXCLUDE_INVALID_DOMAIN`; host-only cookies for `com` and `github.io` were accepted, as were the `.claude.ai` and `app.claude.ai` controls.

Consequences:

- A Chromium source jar cannot hold a `.com`-style domain cookie, because the same code governs setting it there, and Rocket's partition would refuse it on import anyway. The report's "a cookie stored for host `com` or `ai` is imported" describes a cookie that cannot exist.
- The only over-import is a host-only cookie whose host is itself a public suffix (e.g. `github.io`) when the user imports `user.github.io`. Browsers send a host-only cookie only to that exact host, so it never reaches the user's site. Firefox's jar was not examined; Firefox also applies the PSL, but I did not open its source.

### Fix review

"Match registrable domains" needs a public-suffix list; no PSL package is in `package.json`, and adding a dependency for this is disproportionate. Rating: low-severity correctness nit.

Minimum useful change, if any: pin the behaviour with tests, `hostMatches('github.io', 'user.github.io')` documented as true (current) or false (if changed), and add a header comment that Chromium rejects public-suffix Domain cookies on both ends. A one-line tightening that needs no PSL is to let a host-only cookie match only its own host or a parent `site` (`bare === want || bare.endsWith('.'+want) || (cookieHost.startsWith('.') && want.endsWith('.'+bare))`), since browsers never send host-only parent cookies to subdomains; but it would also stop a host-only `claude.ai` cookie importing when the user picks `app.claude.ai`, which may be the user's intent. That is a product call, not a defect.

## Cross-cutting: policy versus sandbox

Three of the four claims reviewed (C4, C5, C6) are framed as boundary failures. None is. Rocket's security perimeter is the user's account: all four provider shells run without a sandbox, so any instruction that reaches a model, including from a page, already has shell-equivalent reach. Locator allowlists, tool descriptions, `will-navigate` on the shell and "keep Rocket running" are policies that make cooperative models predictable, and they are worth keeping accurate. The backlog should label them robustness or policy items. C1 is different: a reliability defect with a confirmed cause and a two-line fix.

## Unresolved

- Reproduce C1 with the built Rocket rather than the mirror: `ROCKET_USER_DATA=<tmp> electron . &` then `ROCKET_USER_DATA=<tmp> electron . /tmp/x.md`. Needs a built `out/`, which I did not touch during this batch.
- Whether Playwright's `_electron.launch` adds `--remote-debugging-pipe`, which would make Electron skip the HTTP handler. `tests/ui/ui-live.spec.ts` connecting live from the test profile says the file exists there; not run this turn.
- Firefox source jars: does `readFirefox` ever yield a host-only public-suffix row? Not examined.
- Observed while finishing, not investigated: `git status` in this checkout failed with `object file .git/objects/00/5ae9… is empty` and `fatal: bad object HEAD`. Rocket commits each turn itself, so that commit will fail until the repository is repaired; the orchestrator should know before dispatching more work.
- C2, C3, C7, C8 were not re-verified here; C3 (dialog auto-accept) and C2 (`file:` through `session.fetch`) are the two remaining items in the cursor report that change what a page can make happen without model intent, and deserve their own review.

## Sources opened

- Electron v44.5.1 `shell/browser/ui/devtools_manager_delegate.cc`: https://raw.githubusercontent.com/electron/electron/v44.5.1/shell/browser/ui/devtools_manager_delegate.cc (copy in evidence folder)
- Electron main `shell/browser/electron_browser_main_parts.cc`: https://raw.githubusercontent.com/electron/electron/main/shell/browser/electron_browser_main_parts.cc
- Electron `app` API (requestSingleInstanceLock, second-instance, quit, getPath sessionData): https://www.electronjs.org/docs/latest/api/app
- Electron `contextBridge`: https://www.electronjs.org/docs/latest/api/context-bridge
- Chromium `content/browser/devtools/devtools_http_handler.cc` (main): https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/devtools/devtools_http_handler.cc
- Chromium `net/cookies/cookie_util.cc` (main): https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/cookies/cookie_util.cc
- Node `vm`: https://nodejs.org/api/vm.html
- Node Permission Model: https://nodejs.org/api/permissions.html
- Playwright `Page.evaluate`: https://playwright.dev/docs/api/class-page#page-evaluate
- Playwright `Locator.evaluate`: https://playwright.dev/docs/api/class-locator#locator-evaluate

Code cited: `src/main/index.ts`, `src/main/ui-connection.ts`, `scripts/open.mjs`, `src/host/tools/ui-live.ts`, `scripts/ui-run-worker.mjs`, `src/host/tools/script-worker.ts`, `src/preload/index.ts`, `src/main/cookie-import.ts`, `src/host/providers/{claude,codex,antigravity}.ts`, `tests/ui/ui-live.spec.ts`.
