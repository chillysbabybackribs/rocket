# PhotoCraft inside Rocket

Mockup: [mockups/photocraft-in-rocket.html](mockups/photocraft-in-rocket.html)

## What you get

PhotoCraft becomes a section of Rocket beside Browser and Library. Its editor runs in a panel
next to the chat. Any provider (Claude, Codex, Cursor, Antigravity) can run every PhotoCraft
command, place images it found on the web or had Codex generate, and save or export real files.
You can click into the same canvas at any time, take over, and hand back.

This replaces the chat panel inside PhotoCraft (`docs/photocraft-chat-plan.md`): Rocket's chat
is the chat.

## How it fits together

```
Rocket window
 ├─ chat pane (as today)
 └─ PhotoCraft panel: a view of its own in main (like a browser tab), loading the PhotoCraft
    web build from a Rocket-served protocol
       └─ window.photocraft.call(method, params)   ← added by our fork, Rust only
             └─ the same control handler the desktop --control channel uses
agent host (src/host)
 └─ tools/photocraft.ts: photocraft_* tools on Rocket's one MCP server, for every provider
       └─ asks main to call into the PhotoCraft view (as the browser tools do, browser-agent.ts)
```

Facts this rests on, read in `~/src/photocraft` (0.6.0) on 2026-10-10:

- The control handler lives in `crates/ui-egui/src/control.rs` (`control::handle`), which already
  compiles for the web. The desktop app only adds a TCP transport (`apps/photocraft/src/control_server.rs`)
  that feeds `PhotocraftApp::with_control(rx)`. So the web build needs a transport, not a new API.
- File access in control (`app.open`, `app.save`) goes through two hooks,
  `Services::automation_read` and `automation_write` (path in, bytes out and back). On the web they
  are unset. The fork backs them with an in-memory file store that Rocket fills before an open and
  empties after a save, so nothing in PhotoCraft needs disk access.
- Screenshots (`ui.screenshot`) use egui's own viewport screenshot, which works in the browser.

## The fork's change (`apps/photocraft-web` only)

Behind a URL flag (`?control`), so the public web build is unchanged:

1. A channel attached with `with_control(rx)`.
2. `window.photocraft`, built from Rust with wasm-bindgen closures (no hand-written JavaScript,
   per the project's rules):
   - `call(method, paramsJson) → Promise<replyJson>`: queues a `ControlRequest` and resolves when
     the app replies, asking egui for a repaint so the request is drained.
   - `put(path, bytes)` and `take(path) → bytes | undefined`: the in-memory file store behind
     `automation_read` / `automation_write`.
3. Tests beside the change, and `cargo xtask wasm` green.

## Rocket's side

| Piece | Where |
|---|---|
| Serve the web build from a privileged `photocraft://` protocol (secure context, so WebGPU is allowed, with cross-origin isolation headers ready for threads) | `src/main` |
| The PhotoCraft view: made, placed and resized like a browser tab; never moves the page | `src/main/photocraft-pane.ts` |
| Its hands: `call`, `put`, `take` through `webContents`; files read and written by Rocket under the chat's working folder | `src/main/photocraft-agent.ts` |
| Seven tools: `photocraft_run`, `_batch`, `_commands`, `_control` (any other control method), `_open` (as a document or a layer), `_save`, `_screenshot`. Fewer than PhotoCraft's own MCP tools, since every tool's schema is in every prompt | `src/host/tools/photocraft.ts`, protocol in `src/shared/types.ts` |
| What the model is told ahead of each message: open document, size, layer tree, selection, active tool | `src/host/agent-situation.ts` |
| App map: place `photocraft {doc?}`; actions `photocraft.open`, `.export`, `.takeOver`, `.handBack`, `.stop` | `src/shared/app-map.ts`, `src/renderer/src/app-map.ts`, state in `store.ts` |
| Panel UI: document tabs, Open, Export, the driver badge, Take over / Stop, Undo the reply, the image tray, status line | `src/renderer` |
| `image_generate`: any provider asks Codex for an image; the file lands in the Library and the tray | `src/host/tools`, after the Codex image fix in another chat lands |

## Phases

| Phase | What | Done when |
|---|---|---|
| 0. Spike | Build the web build here (wasm target, Trunk); load it in Rocket's browser; check WebGL2 / WebGPU and speed on a real PSD | It runs in Rocket and we know which renderer it got |
| 1. Bridge in the fork | `?control`, `window.photocraft.call/put/take`, tests | From Rocket's browser tools: open a PNG, run a command, save, take the bytes back |
| 2. Rocket panel and tools | Protocol, view, hands, `photocraft_*` tools, the situation block, the app map | A model in each provider makes a poster from a prompt and exports it to disk |
| 3. Panel UI | Header, tray, take over, undo the reply, status; `npm run check:ui` scenario | Matches the agreed mockup |
| 4. Comfort | System fonts through the web build's `fonts/manifest.txt`; autosave to `.pcraft`; WebGPU switches if they help | Daily use without losing work |
| 5. Speed (only if needed) | WebAssembly threads: nightly toolchain, atomics, wasm-bindgen-rayon, ungated rayon paths | Big filters measurably faster |

## Status

**2026-10-10: phases 0 and 1 done.**

- Built with `trunk build --release` in `~/src/photocraft/apps/photocraft-web` (wasm target and
  Trunk 0.21.14 installed for it): `dist/web`, 25.0 MB of wasm, under PhotoCraft's 24 MiB gate.
- The bridge is `apps/photocraft-web/src/control_bridge.rs` in the fork, wired in `web.rs`,
  documented in the fork's `docs/development.md`. Its 4 tests and the crate's other 12 pass;
  clippy (`-D warnings`, wasm target) and rustfmt are clean.
- Served on `http://127.0.0.1:8765/?control` and loaded in Rocket's browser: `put` a PNG drawn in
  the page, `app.open` (5.6 s the first time, while the app warms up; 42 ms after), Gaussian blur
  (66 ms), `ui.inspect` (33 ms, sees the 640×400 document and its layer), `app.save` (85 ms),
  `take` returned a valid 51 KB PNG and cleared it from the store. An unknown method answers
  `{"ok": false, "error": "unknown method …"}`.
- Renderer: WebGL2. WebGPU still returns no adapter in Rocket on this machine.

**2026-10-10: phase 2 built, tested in a separate Rocket instance.**

- Fork: `app.place {path}` added to the control handler (File › Place Embedded without its file
  picker; test beside it, `docs/control-protocol.md` updated), and the bridge now answers a
  request after 60 s with the desktop channel's own timeout message instead of polling forever.
- Rocket: `src/main/photocraft-pane.ts` (scheme, view, file crossing), `photocraft-files.ts`,
  the `PhotocraftOp` / `PhotocraftCommand` / `PhotocraftState` protocol, seven tools in
  `src/host/tools/photocraft.ts`, the `photocraft` place and toolbar section, and
  `PhotocraftPanel.tsx` (header, reload, close; the full panel UI is phase 3). Typecheck and the
  287 tests pass, with new tests for the tools and the file paths.
- In a separate instance (`/tmp/rocket-photocraft`, its own profile): first tool call 30 s
  (PhotoCraft starting), then `file.new` 4.7 s, each `photocraft_open` as a layer under 300 ms, a
  three-step batch 184 ms. The panel showed the poster with its layers.
- Found: PhotoCraft's own `ui.screenshot` never answers in the web build, so
  `photocraft_screenshot` now uses Electron's capture of the view.
- Not done yet in phase 2: the PhotoCraft line in the `<agent-environment>` block.

**2026-10-10: first real use.** Claude, in the test instance, ran ~50 commands, found and opened
a photo from Wikimedia Commons, removed a log with `paint.remove` (clean result), and composited
a bird in. Rocket-side fixes from its report, all re-checked: screenshots through Electron's
capture (325 ms); PhotoCraft requests wait up to 20 min instead of 150 s, since a long filter
holds the page's one thread; a save to a folder Rocket can't write is refused first (Node's
recursive mkdir never returns under /proc, so the nearest existing folder is checked); command
search looks in ids and labels first, pages with `offset`, and lists params only for a few
matches; `photocraft_open` says placed layers are Smart Objects to rasterize before pixel edits.
A layered PSD of that work round-tripped with its smart filter.

PhotoCraft's own issues it found (for the fork, or upstream):
- Values outside a documented range are accepted: `opacity: 5` is clamped to 1, `opacity: "abc"`
  and a 0×0 `select.rect` answer ok, `foreground: "red"` is taken despite `#rrggbb`.
- `layer.removeBackground` and `select.subject` answer ok but do nothing in the web build (an
  empty mask, the whole layer); maybe their model is not in the wasm build.
- `app.place` reports bounds as `[x0, y0, x1, y1]`; `document.inspect` as `[x, y, w, h]`.
- Saving with a new name renames the document (`qa-test` became `out.psd`).

Next: phase 3, the panel UI from the mockup.

**2026-10-10: smoother ⌥-scroll zoom (fork, `crates/ui-egui/src/wheel_nav.rs`).** In Rocket a
wheel notch arrives as 120 px (Electron 44, measured with xdotool on Xvfb), which PhotoCraft
counted as three 40-pt notches: every notch jumped ×1.33 in one frame. The web build now counts
120 px as one ×1.1 notch, and on the canvas each notch glides in over about a tenth of a second
(`read_gliding`), with quick notches running together. The wheel tests, including a new glide
test, pass.

## Known limits that stay

- WebAssembly has 32-bit addresses: 4 GiB at most. Very large PSB files stay a desktop-app job.
- Without phase 5 the editor is single-threaded and long filters pause the panel.
- On this machine, Rocket's Chromium 152 exposes WebGPU but returns no adapter (tested
  2026-10-10); PhotoCraft falls back to WebGL2 until the switches in phase 4 are tried.
- Every PhotoCraft update is merged into the fork and rebuilt.

## Open questions

- Fork only, or offer the web control bridge upstream? It is small, Rust only, off by default,
  and useful to anyone automating the web build.
- Should `image_generate` ask before spending Codex usage? Image turns use it 3–5× faster.
