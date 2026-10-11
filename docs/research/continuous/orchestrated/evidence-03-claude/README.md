# Evidence for 03-claude-page-effects

Isolated, deterministic experiments on the repo's Electron (44.5.1, Chrome 152, Node 24.21 inside
Electron). Each `run.sh` starts a private `Xvfb` display, a fresh `mktemp -d` userData under `/tmp`
and a local HTTP server that plays the hostile site, runs `main.cjs`, then copies `results.json`,
`stdout.txt` and any screenshots back here. Nothing touched Rocket's live window, its profile or
any real user file: the only `file:` target is `secret.txt`, which the fixture writes into its own
temp directory first.

The tab in every fixture is built the way `src/main/browser-pane.ts` builds one (`persist:browser`,
`sandbox`, `contextIsolation`, no node integration) and driven the way `src/main/browser-agent.ts`
drives one (`Network.enable`, `Page.enable`, `Runtime.evaluate` with `userGesture`, real
`Input.dispatch*` clicks, `loadURL` without awaiting it, `ERR_ABORTED` ignored). The dialog handler
is a copy of `onProtocol`'s with the answer made switchable.

| Folder / file | What it shows | Rerun |
|---|---|---|
| `page-effects/` | E1–E16: `file:` by every page-side route (location, iframe, 302, window.open, real click) and every agent-side route (goto, follow, downloadURL, session.fetch); page-started downloads; `confirm`/`alert`/`prompt`/`beforeunload` under accept, dismiss and no answer; the page-controlled SPA counter. `confirm-none-dialog.png` is Electron's native box with nobody answering; `beforeunload-none.png` also shows the orphan box left by E14's accepted `alert('one')`. Filter `stdout.txt` on `[result]` for the per-experiment lines. | `./run.sh` |
| `stale-dialog/` | S1–S4: three accepted alerts leave a native box on screen (`after-alerts.png`) while the page is responsive; a dismissed confirm (`after-confirm.png`); `beforeunload` with a typed draft and an accepting handler leaves the page 6 runs out of 6 (`S3`). `xwininfo -tree` did not list the box, so screenshots are the evidence. | `./run.sh` |
| `alert-timing/` | A1–A3: one accepted alert; screenshots at 0.3, 1, 2, 4 and 7 s (`t*.png`) all show the box while the title keeps ticking; `xdotool` clicking its OK closes it with no effect on the page (`after-click.png`, `window.after` already `'yes'`); a second alert adds a second box (`second.png`). The `nativeBoxVisible` numbers in `results.json` are wrong: the sampled region overlaps the window, so the brightness means nothing. Use the pictures. | `./run.sh` |
| `disable-dialogs/` | D1–D3: the same tab created with `webPreferences.disableDialogs: true`. No native box (`confirm-accept.png`, `confirm-none.png`, `alert.png`); with the handler accepting, the page still gets `true` and sends its POST; with nobody answering, it gets `false` at once; `beforeunload` is unchanged and follows the handler's answer. | `./run.sh` |
| `sources/` | Primary sources fetched this turn: `browser_protocol.json` (DevTools protocol, with `cdp-page-dialog-excerpt.json` pulled from it), Chromium `web_contents_impl.cc`, `url_request_job.cc`, `url_request_http_job.cc`, `javascript_dialog_manager.{h,cc}`, Blink `frame_loader.cc` and `security_origin.cc` (all `main`, 2026-10-08), Electron v44.5.1 `electron_api_web_contents.cc`, `lib/browser/api/web-contents.ts`, `lib/renderer/window-setup.ts`, `lib/renderer/init.ts`. The 14-byte `electron-v44.5.1-electron_javascript_dialog_manager.cc` is a GitHub 404 body kept to show that file no longer exists at that tag; the manager lives inside `electron_api_web_contents.cc`. | n/a |

Results referenced by the report, by experiment id:

| Id | One line |
|---|---|
| E1 | agent `loadURL('file://…')` shows the file's text |
| E2 | `session.fetch('file://…')` returns 200 `text/plain` with the file's bytes |
| E3–E7 | page-side `location`, iframe, 302 (`ERR_UNSAFE_REDIRECT`), `window.open`, real click: all blocked, `Not allowed to load local resource` |
| E8 | agent `follow` of the page's `file:` href loads the file |
| E9 | agent `downloadURL('file://…')` saves a copy to Downloads |
| E10 | page's own `<a download>` click saves `planted-by-page.txt` with no agent action after `goto` |
| E11 | page navigation to an attachment named `../../.bashrc` saves `_.._.bashrc` |
| E12 | `confirm` on load: accept → 1 POST; dismiss → 0; none → stalls behind the native box, 0 |
| E13 | `prompt()` throws in Electron; no dialog event |
| E14 | two `alert`s accepted; page continues |
| E15 | `beforeunload` with typed draft: accept → leaves; dismiss/none → stays, `ERR_ABORTED` |
| E16 | page sees `__rocketSpaHook`; its own bump of `seq` satisfies `waitSpa` with the URL unchanged |
| S3 | `beforeunload` accept leaves 6/6 |
| A1–A3 | native box persists ≥ 7 s after accept; user click closes it harmlessly; second alert stacks |
| D1–D3 | `disableDialogs: true` removes the box, keeps the handler's answer authoritative |
