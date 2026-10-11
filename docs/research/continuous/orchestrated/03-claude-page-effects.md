# 03 — Claude: what a page can cause on its own, against what only an agent can invoke

**Reviews:** C2, C3, C7, C8 of `docs/research/continuous/round-0001/research-cursor.md`; builds on `02-claude-review-boundaries.md`
**Date:** 2026-10-08
**Evidence:** `docs/research/continuous/orchestrated/evidence-03-claude/` (its README lists every experiment, its result file and how to rerun it)
**Method:** read-only code inspection; primary sources opened this turn (Chromium, Blink, Electron v44.5.1 source, Electron docs, DevTools protocol JSON); four isolated Electron 44.5.1 / Chrome 152 fixtures on a private Xvfb display with a throwaway userData under `/tmp` and a local HTTP server standing in for a hostile site. The only "local file" ever read was one the fixture wrote into its own temp directory. Rocket's live window, profile and user files were not touched.

## Three kinds of claim, kept apart

- **Security boundary:** something a remote page can do without any agent action, or something an agent can do that it could not already do with the shell every provider gets (02 review: `bypassPermissions`, `danger-full-access`, `--dangerously-skip-permissions`).
- **Product policy promise:** what Rocket's own text promises the user or the model (tool descriptions in `src/host/tools/browser.ts`, comments in `src/main/browser-agent.ts`, the README) and whether the code keeps it.
- **Reliability defect:** behaviour that misleads the model or the user, or leaves the app in a confusing state, without changing who can do what.

## Verdicts

| Claim | Page alone | Agent op with page-supplied input | Agent op, explicit | Kind | Verdict |
|---|---|---|---|---|---|
| C2 `file:` is a first-class read | **No.** `location.href`, `<iframe>`, HTTP 302, `window.open`, and a real click on a `file:` link are all blocked (E3–E7) | **Yes.** `tab.follow(href)` loads the page's `file:` href (E8); `browser_download url:` copies the file to Downloads (E9); `browser.fetch(url)` returns its bytes (E2) | Yes (E1) | Policy gap, not a boundary | **Supported, reclassified.** The model is the authority; the page only supplies the string. |
| C3 dialogs accepted before the model sees them | **Yes.** A page's `confirm()` on load is accepted and the gated request goes out (E12); an `onbeforeunload` page loses its draft when the agent navigates away (E15, 6/6) | — | — | Policy defect + reliability defect | **Supported, extended.** Two new findings: the native box lingers after the accept (A1), and `prompt()` cannot happen in Electron at all (E13). |
| C7 shared MCP URL drops chat identity | — | — | — | Reliability (reviewed from code only) | **Supported as described;** one concrete consequence added: a relative `saveTo` lands under `$HOME`. |
| C8 SPA hook is page-controlled state | **Yes.** The page sees `__rocketSpaHook` and bumping the counter makes `waitSpa` return with the URL unchanged (E16) | — | — | Reliability | **Supported.** |

Nothing here is a new operating-system privilege for a model. The security-relevant line is clean: a remote page has no path to a local file and no path to a tool call. Everything a page *can* do (raise a dialog, start a download, poison the SPA counter) lands on the agent's side of that line as a worse-than-necessary default.

## C2 — `file:` reads: exact call path and trust assumptions

### Where the scheme passes through

- `toUrl` returns `https?`, `file:` and `about:` text unchanged (`src/main/browser-url.ts:31-34`). It serves both the user's address bar (`browser-pane.ts:578-586`) and every agent navigation (`browser-agent.ts:357-371`, `navigate()`), which calls `webContents.loadURL`.
- `follow` resolves the page's `href` against the tab URL with `new URL(op.href, base)` and hands the result to `navigate()` with no scheme check (`browser-agent.ts:154-164`).
- `download` resolves `op.url` the same way and calls `contents.downloadURL(url)` (`browser-agent.ts:176-194`); `browser_download` passes the model's `url` argument straight in (`src/host/tools/browser.ts:160-168`).
- `fetch` calls `session.fromPartition('persist:browser').fetch(op.url, …)` (`browser-agent.ts:795-811`). Electron's session docs, opened this turn: "By default, requests made with `net.fetch` can be made to custom protocols as well as `file:`".

### Why a page cannot get there on its own (observations, E3–E7)

| Route the page tried | Result | Where it is blocked |
|---|---|---|
| `location.href = 'file://…'` | stays on the page; console `Not allowed to load local resource` | Blink `FrameLoader::AllowRequestForThisFrame` → `SecurityOrigin::CanDisplay`: local schemes need `CanLoadLocalResources()` (`sources/blink-main-frame_loader.cc:600-630`, `sources/blink-main-security_origin.cc:448-473`) |
| `<iframe src="file://…">` | frame URL empty, same console error | same |
| HTTP 302 `Location: file://…` | `ERR_UNSAFE_REDIRECT (-311)` | `URLRequestHttpJob::IsSafeRedirect`: only `http`/`https` or what the job factory allows (`sources/chromium-main-url_request_http_job.cc`) |
| `window.open('file://…')` | same console error; the pane's `setWindowOpenHandler` was never called | renderer, before Electron's handler (`browser-pane.ts:537-552` would deny it too) |
| Agent's real click (`Input.dispatchMouseEvent`) on `<a href="file://…">` | same console error, page unchanged | renderer-initiated navigation, same Blink check |

The Blink check skips itself when the navigation has no origin document ("If no origin Document\* was specified, skip remaining security checks", `frame_loader.cc:603-606`). `webContents.loadURL` is a browser-initiated navigation and therefore loads `file:` (E1, E8), as does `downloadURL` (E9) and `session.fetch` (E2).

### The trust assumption

Every `file:` read in this app is an agent op. The page's influence is limited to supplying a string the model then passes on: an `href` the model follows, a download link it copies from `browser_read`, a URL in page text it feeds to `browser.fetch`. The model holds the authority, and the model already holds a shell that can read any file. So this is **not a security boundary**. It is a **policy gap**: `browser_read`, `browser_run` and `browser_download` are described as web tools ("Read a web page", "Save a file from the web", "session cookies, no CORS"), and nothing says they also read the local disk when handed a `file:` string. A model that follows "the report link" on a hostile page gets a local file in its context without having decided to read a local file. There is a second, smaller policy wrinkle: a successful `file:` fetch is recorded as a page the turn "opened" (`browser.ts:79-82` calls `onOpen` for any 2xx textual body), so a citation of a local path would be marked as an opened source.

`about:` also passes `toUrl`; `chrome:` does not (it becomes a search). Not tested further.

### Minimal regression design

1. One pure helper, say `webUrl(input)` beside `toUrl`, returning the URL only for `http:`, `https:` and `about:blank`, with a tested error sentence for anything else ("Rocket's browser tools read web pages; `file:` is not a web address. Read the file with your own tools."). Use it in `navigate()` (agent path only; the user's address bar keeps `toUrl` because a person typing `file:` into their own browser is a product decision, not this review's), in `follow`, in `download`'s URL branch and in `fetch`.
2. Unit tests next to `browser-url.test.ts`: `file:///x`, `about:config`, `javascript:` and `data:` rejected; relative `href` resolved against an `http` base accepted; `file:` `href` resolved against an `http` base rejected (the E8 case).
3. Fixture test: `evidence-03-claude/page-effects/main.cjs` E2, E8 and E9 become "expect an error" once the helper is in; the rest of that fixture is unchanged and still documents what a page alone can do.

## C3 — dialogs: who raises them, who answers them, and what the answer costs

### How the answer reaches the page (primary sources)

Chromium's `WebContentsImpl::RunJavaScriptDialog` first notifies every enabled DevTools page handler (`DidRunJavaScriptDialog`), then calls the embedder's dialog manager, and wraps the result in a `CloseDialogCallbackWrapper` that runs once (`sources/chromium-main-web_contents_impl.cc:9703-9830`). `RunBeforeUnloadConfirm` does the same (`:9842-9920`). The DevTools `Page.handleJavaScriptDialog` runs the stored callback and then asks the manager's `HandleJavaScriptDialog` to clean up its UI; the base implementation of that returns `false` (`sources/chromium-main-javascript_dialog_manager.cc`).

Electron's manager is a helper inside `WebContents` that forwards only `RunJavaScriptDialog`, `RunBeforeUnloadDialog` and `CancelDialogs` (`sources/electron-v44.5.1-electron_api_web_contents.cc:2036-2082`); it does not override `HandleJavaScriptDialog`. `RunJavaScriptDialog` emits `-run-dialog`, and the JavaScript side shows `dialog.showMessageBox` with OK/Cancel, answers `false` at once when `disableDialogs` is set, and answers `false` for `prompt` ("We don't support prompt() for some reason", `sources/electron-v44.5.1-web-contents.ts:822-860`). The renderer replaces `window.prompt` with a function that throws (`sources/electron-v44.5.1-window-setup.ts:17-21`). `RunBeforeUnloadDialog` emits `will-prevent-unload`, and when nothing prevents it, emits `did-fail-load ERR_ABORTED` and answers "stay" (`electron_api_web_contents.cc:4610-4625`). Rocket has no `will-prevent-unload` listener.

Rocket's handler accepts every `Page.javascriptDialogOpening` and records 200 characters for the next read (`browser-agent.ts:454-459`). The note is surfaced only by `read` (`:573`); `goto`, `click`, `follow`, a `browser_run` result and its delta say nothing about a dialog.

### What happens (observations)

| Case | Rocket today (`accept: true`) | `accept: false` | Nobody answers (Page enabled) | Evidence |
|---|---|---|---|---|
| Page calls `confirm('Delete your account?')` on load and POSTs when true | **POST sent**, page continues | nothing sent | page stalls behind Electron's native OK/Cancel box; nothing sent until a person answers | E12, `page-effects/confirm-none-dialog.png` |
| `alert()` twice | page continues | page continues | page stalls behind a native box | E14 |
| `prompt()` | no dialog event; page throws `prompt() is not supported.` | same | same | E13 |
| `onbeforeunload` page with typed draft, then an agent `goto` elsewhere | **leaves; draft gone; 6/6 runs** | stays; `goto` reports no problem (`ERR_ABORTED` is filtered at `browser-agent.ts:365-368`), `info().url` still the old page | same as dismiss, Electron answers "stay" itself | E15, `stale-dialog` S3 |
| After any accepted/dismissed `alert`/`confirm` | **Electron's native box stays on screen** (7 s and counting) while the page already continued; a person's click on its OK closes it and changes nothing; the next dialog adds another box | same | — | `alert-timing/t300.png … t7000.png`, `after-click.png`, `second.png` |

Three things follow.

1. **Policy defect.** The comment in `onProtocol` says nobody may be watching the tab, so the dialog is accepted. The experiment shows the opposite premise is also false in the other direction: Electron *does* show a native box (`hasBrowserHandler: true` on every event), so with no DevTools answer a person could answer it; and with Rocket's answer the person still sees a box whose buttons do nothing. Accepting removes the one check a site placed in front of a destructive action, for an action the model did not ask for (the page raised it on load; after the `goto` the fixture issued no further op). The model learns about it only if it later reads the page.
2. **Reliability defect, visible to the user.** A leftover OK/Cancel box per dialog. On the user's desktop these are window-modal message boxes over Rocket's window; in the fixture they sit at the display origin because Xvfb has no window manager.
3. **Reliability defect, hidden from the model.** When a `beforeunload` is dismissed (or if the default changes to dismiss), the agent's navigation is silently cancelled and `navigate()` reports no problem.

A related inference from code, not reproduced: the handler is registered once per `WebContents` and never removed, and a tab stays in `enabled` after a turn rests (`browser-agent.ts:400-445`, `rest()` only throttles). `read` with no `url` and no own tab takes the user's active tab (`:165-170`, `:319-332`). From then on a `confirm()` the *user* triggers in their own tab is accepted by Rocket's handler before they can read it, with the orphan box described above as the only trace. The fixture's E12 shows the mechanism (the handler answered a dialog no op asked for); the user-tab variant differs only in who caused the dialog.

### Does auto-accept cross a security line?

No. The gated request goes out with the tab's cookies, and the model could have clicked the same button; a page cannot raise a dialog in a tab the agent never touched, because `Page.enable` happens only on the first tool call to that tab (`:440-443`). What it crosses is the policy line: the app answers for the model, in the affirmative, without telling it.

### Minimal regression design (checked in `disable-dialogs/`)

- Create agent tabs (`browser-pane.ts:450-453`, when `agent` is true) with `webPreferences.disableDialogs: true`. Electron's docs, opened this turn: "Whether to disable dialogs completely. Overrides `safeDialogs`." Observed effect: no native box at all (`disable-dialogs/confirm-accept.png`); with Rocket's handler answering, its answer still decides (`confirm-true`, 1 POST); with no handler answer, dialogs resolve to cancel at once (`confirm-false`, 0 POSTs) and `alert` continues. `beforeunload` is unaffected by the preference and still follows the handler's answer (D3). User-created tabs keep Electron's native box, and the handler should not answer on a tab the pane does not mark as an agent tab (`isAgentTab`, already used for the SPA hook at `:432`).
- Change the handler's default: `alert` → accept (nothing to lose); `confirm` → dismiss; `beforeunload` → accept only when the agent itself asked to leave (a `goto`/`follow`/`close` in flight on that tab), otherwise dismiss. Put the dialog text into the result of the op that caused it, and into `browser_run`'s delta, not only into the next `read`. Let a script opt in with something like `tab.goto(url, { dialogs: 'accept' })` for sites that gate ordinary flows behind `confirm`.
- Make a dismissed `beforeunload` visible: when `will-prevent-unload` fires for an agent navigation, `navigate()` should return a problem sentence ("The page asked to stay because of unsaved changes; pass `dialogs: 'accept'` to leave anyway") instead of swallowing `ERR_ABORTED`.
- Tests: a UI fixture in `tests/ui` with the three pages from `page-effects/main.cjs` (`/confirm`, `/unload`, `/alerts`), asserting no POST after a `goto` to `/confirm`, the draft intact after a plain `goto` away from `/unload`, and the dialog text present in the `goto` result. No model turn needed.

## C7 — shared MCP identity, reviewed only as far as it touches the browser

`runningChat` returns a chat only when exactly one turn of that provider is live (`src/host/hub.ts:105-108`); the channel maps the `SHARED` key through it and still answers `tools/call` when the result is null (`src/host/tools/channel.ts:110,145`). `ToolContext.chatId` is documented as nullable (`registry.ts:8-9`), and `ask.ts:82` and `library.ts:43` refuse a null chat with a sentence. The browser tools do not:

- every tab op uses `op.chat ?? ''`, so all unidentified calls share one work tab under the empty key (`browser-agent.ts:130-135, 310-332`), as the round-0001 report said;
- `cwdOf(null)` is null (`src/host/index.ts:170`), so a relative `saveTo` for `browser_download` or `exportHar` resolves against `$HOME` (`browser.ts:166, 195-202`): a file meant for the chat folder lands in the home directory;
- `noteOpened(null, url)` cannot attach the sources record to a turn.

Minimal fix on this side: refuse browser tool calls with a null `chatId` in the same sentence `ask.ts` uses, or refuse at the channel for `SHARED` keys. The Cursor lifecycle work in `02-cursor-review-lifecycle.md` covers the session side; not duplicated here.

## C8 — the SPA counter lives where the page can write it

Confirmed in one run (E16): on a page that received the hook, `fetch('/spa-seen?hooked=' + Boolean(globalThis.__rocketSpaHook))` reported `true`, and the page bumping `__rocketSpaNavigation.seq` made the `waitSpa` predicate true with the URL unchanged. The hook is evaluated in the page's main world and re-added for new documents without a `worldName` (`browser-agent.ts:605-623`; the DevTools `Page.addScriptToEvaluateOnNewDocument` takes `worldName`, "creates an isolated world with the given name", `sources/cdp-page-dialog-excerpt.json`). Minimal fix: either pass `worldName` and read the counter with the same world, or drop the page global and count `Page.navigatedWithinDocument` / `Page.frameNavigated` events in `onProtocol`, which already receives them once `Page.enable` is on. The second removes the bot signal as well.

## Downloads, for completeness (not in the C-list)

Once a tab is a model's (its own, or one it touched), a page can save bytes to the user's Downloads folder with no agent action after the `goto`: a scripted `<a download>` click (E10) and a navigation to a `Content-Disposition: attachment` response (E11) both landed as files. Chromium had already turned `../../.bashrc` into `_.._.bashrc` before `safeFileName` saw it, nothing is overwritten (`src/main/download-path.ts:6-31`), and the model is told about the files at the end of a `browser_run` (`browser.ts:300-303`) but not after a plain `browser_read`. This is the documented policy ("Downloads in the browser that a model causes are saved without a dialog", `browser-downloads.ts:6-13`) applied to a page that caused its own download. Low consequence: junk files under Downloads. Worth a line in the tool text and a note in the `read` header when a download arrived during the call; not worth a dialog.

## Unresolved questions, ranked

1. **Does the orphan native box also appear on the user's real desktop with a window manager, and is it window-modal?** The fixture shows it exists and outlives the DevTools answer; Xvfb cannot show modality or placement. A `tests/ui` run with `--visible` on a `/alerts` fixture page would settle it without a model turn.
2. **Which default for `beforeunload` do users want when the model navigates away from a page with a draft the user typed?** The experiment shows "accept" discards it silently. "Dismiss plus a problem sentence" is proposed above; this is a product call.
3. **Should the user's address bar keep accepting `file:`?** This review scopes the scheme fix to agent ops. If `toUrl` itself is tightened, the user's own browsing changes.
4. **Is `disableDialogs` safe for popups an agent tab opens?** `setWindowOpenHandler` passes `options.webPreferences` into the new `WebContentsView` (`browser-pane.ts:542-546`); whether Chromium copies `disableDialogs` into the child's preferences was not tested.
5. **Does the `read` path record a `file:` URL as an opened source?** The header regex only matches `https?://`, so the fallback is `op.url`; whether `noteOpened` then stores a `file:` path and how the sources panel renders it was not checked.
6. **C7:** after the channel refuses null-chat calls, which Antigravity flows break? Only the Antigravity owner can run that without spending turns on guesswork.
