# ArtCraft and the Craft apps: how well can AI agents drive them?

Recon of the `storytold` GitHub org, 2026-10-10. Read-only code audit of shallow clones in
`~/craft-recon/` (nothing built or run). Every claim below has a file reference in the repo
named; key claims (LightCraft/DeckCraft retry, PhotoCraft token, GridCraft/SoundCraft
non-JSON handling, free-text command params) were re-read by hand.

## What "ArtCraft" is

Two different kinds of product share the brand:

1. **ArtCraft / ArtCraftX** — the AI image/video studio (Tauri 2 + React). Paid credits for
   Nano Banana, GPT-Image, Seedance, Kling etc. (getartcraft.com/pricing), source on GitHub.
2. **The Craft apps** — about a dozen pure-Rust (egui/wgpu, also WASM) clean-room clones of
   pro tools: PhotoCraft (Photoshop), LightCraft (Lightroom), VectorCraft (Illustrator),
   DesignCraft (InDesign), FilmCraft (Premiere), EffectCraft (After Effects), SoundCraft
   (Pro Tools), DeckCraft (PowerPoint), WordCraft (Word), GridCraft (Excel), PdfCraft
   (Acrobat), CADCraft (AutoCAD). Most repos were created 2026-09-30 to 10-07; each has an
   `AGENTS.md` written for coding agents, and the code base is plainly agent-written.

## Verdict

- **The AI studio (ArtCraft) is not built for agents to drive.** No MCP server, no control
  port, no CLI. Its 61 (ArtCraftX: 43) Tauri commands are reachable only from its own webview.
  Canvas, 3D scene, layers, undo and save are frontend-only. The "LLM edits the scene"
  promptbox is a stub (`PromptBox3D.tsx:321-339`, `TODO(scene-builder)`), and
  `pagescene/AGENTS.md` says "MCP not ready". The backend (`artcraft-services`) has MCP
  *session-token* auth for the generate endpoints but no MCP server in the code; the usable
  agent path is the API-key HTTP API (`/v1/omni_api`: upload, generate image/video, poll job
  status), with OpenAPI docs. Agents can make generations; they cannot compose a scene.
- **The Craft apps are genuinely agent-first.** "Everything is a command" is a repo rule:
  one engine command registry behind the menus, the CLI, a JSON control channel and an MCP
  server. Every one has a stdio MCP server that runs either headless (in-process, no window)
  or bridged to the running app (`<app> --control PORT`, loopback). Every one has a generic
  "run any command by id" tool, so agents reach essentially the whole app rather than a
  hand-picked subset. Most can render the canvas/page/frame to a PNG so the agent can see
  its work, and all expose undo/redo and open/save/export.

## Scorecard

| App | Commands reachable | Sees output headless | Live-port auth | Sandbox | Progress/cancel | Grade |
|---|---|---|---|---|---|---|
| PhotoCraft | ~700 via `command_run`/`batch` | PNG ≤2048 px | 64-hex token | folder grants | jobs list/cancel; progress for video only | 5 |
| EffectCraft | ~640, + JS (ExtendScript-like) | PNG frames w/ alpha | none | opt-in folders | headless render only | 5 |
| FilmCraft | ~580 (official `rmcp`) | PNG frames | none (closes on HTTP) | none | export only | 5 |
| VectorCraft | ~710; prompts, templates, logging | PNG / base64 export | none (closes on HTTP) | opt-in folders | none | 4.5 |
| WordCraft | all 460 | page PNG | per-run key file | none | none | 4.5 |
| PdfCraft | ~143 typed tools; 61/139 registry ids headless | page PNG | token (not wired to MCP) | `--root` | none | 4 |
| LightCraft | ~300 auto `cmd_*` tools + develop sliders | PNG/JPEG ≤4096 px | none | none | batch export | 4 |
| GridCraft | all 212, strict arg checks | **no** (screenshot needs app, returns path) | **none, and port vulnerable** | none | none | 3.5 |
| CADCraft | ~297 + AutoCAD command line | PNG | none | none | none | 3.5 |
| DeckCraft | ~180 | slide PNG | **none, and port vulnerable** | none | none | 3.5 |
| DesignCraft | 446 (+99 UI-only commands not headless) | page PNG | none | none | none | 3 |
| SoundCraft | ~370 | **no** (no waveform/mixer render; transport dropped headless) | **none, and port vulnerable** | none | none | 3 |
| ArtCraft / X | generation only, via HTTP API | n/a | API key | n/a | poll only | 1 |

## Limitations common to the suite

1. **Command parameters are untyped.** Every registry stores a command's params as a prose
   string (e.g. PhotoCraft `CommandSpec.params: &'static str`, `crates/engine/src/commands.rs:23`).
   The outer MCP tools have JSON Schemas; the inner params of the generic route don't, so
   agents learn them by trial and error. EffectCraft is the exception (derives a schema from
   the doc string).
2. **No change notifications or subscriptions.** Agents poll `inspect` calls; nothing tells
   them when the user edits the document.
3. **Mostly no progress or cancel.** Long exports, OCR, bounces block a single-threaded stdio
   loop, typically with a 60–90 s timeout to the live app.
4. **One session per MCP process**, one active document for most tools.
5. **No agent control in the web (WASM) builds**, except FilmCraft and EffectCraft's
   `window.<app>` JS API. (Rocket's PhotoCraft fork adds a `?control` bridge for this.)
6. **No in-app AI assistant** in any Craft app. They are built to be driven by an outside
   agent, not to host one.

## Defects worth knowing before you point an agent at them

- **Duplicate edits on retry.** LightCraft, DesignCraft, VectorCraft and DeckCraft's bridge
  clients resend a request once on a fresh connection after *any* error, including a read
  timeout after the app already applied it (`lightcraft/crates/mcp/src/backend.rs` `call`,
  `deckcraft/crates/mcp/src/backend.rs:81-86`). FilmCraft resends after a 90 s timeout.
  CADCraft and EffectCraft deliberately never resend.
- **Browser-reachable control ports.** GridCraft, SoundCraft and DeckCraft skip a non-JSON
  line and keep reading (`gridcraft/apps/gridcraft/src/control_server.rs:41-45`), so the
  JSON body of a web page's text/plain POST to `127.0.0.1:<port>` would run as a command
  while `--control` is on. VectorCraft and FilmCraft close the connection on an HTTP line
  and have a test for exactly this. CADCraft also has no auth or line limit.
- **No file confinement** in LightCraft, DesignCraft, GridCraft, CADCraft, SoundCraft,
  DeckCraft, FilmCraft: an agent's open/save/import can touch any path.
- **Port clash.** GridCraft and VectorCraft and CADCraft all suggest 7979.
- **Paid generations have no agent spend guard** in ArtCraft: cost estimates exist, nothing
  enforces a cap or confirmation.

## Best patterns to copy

PhotoCraft (token + folder grants + jobs), EffectCraft (typed per-command params, confinement
that also blocks code-running commands, no-resend bridge), PdfCraft (`--compact` with
`tool_search`/`tool_call` to keep tool lists small, hostile-args tests), VectorCraft (MCP
prompts, resource templates, `$N.path` result references in batches).
