# A chat panel inside PhotoCraft, on your own subscriptions

Mockup: [mockups/photocraft-chat-panel.html](mockups/photocraft-chat-panel.html)

## Status (2026-10-10)

Built in the personal fork at `~/src/photocraft` and running: **Window › Chat**. Launch it from the
app menu entry *PhotoCraft (Chat)* or `~/src/photocraft/target/release/photocraft`.

| Part | State |
|---|---|
| Panel (column beside the dock), provider picker, Attach canvas, Stop, New chat, Undo this reply | Built; drawn and typed into in the live app |
| Control server started by the app itself on a free loopback port, token in `~/.config/photocraft/chat/` | Built; the MCP bridge reaches it (`doc_inspect` answered) |
| Claude adapter (`crates/assistant/src/claude.rs`) | Built and unit-tested; no real turn sent yet |
| Codex adapter: thread setup verified live, `photocraft` tools ready, the user's other MCP servers and computer-use plugins off | Built; no real turn sent yet |
| Cursor adapter: `session/new` with the `photocraft` server verified live | Built; no real turn sent yet |
| Antigravity | Not started |
| Tests | assistant 14/14; ui-egui chat, menu, i18n and dock tests 92/92 |

Code: `crates/assistant` (runner and one translator per CLI), `crates/ui-egui/src/chat_panel.rs`,
`apps/photocraft/src/chat.rs`, plus small registrations (`Panels.chat`, `window.toggle.chat`, the
"Chat" menu label in 16 catalogs, `control_server::start_on`).

## What you get

A **Chat** panel in PhotoCraft's dock (Window › Chat). You pick Claude, Codex, Cursor or
Antigravity and a model, type what you want, and the model edits the open document while you
watch. Each edit shows as a step in the reply. A whole reply can be undone at once. Sign-in is
the CLI you already use (`claude`, `codex`, `cursor-agent`, Antigravity), so it runs on your
subscriptions with no API keys.

## Why a fork, not a plug-in

PhotoCraft's plug-ins are sandboxed WebAssembly *filters*: no network, no processes, no panels
(`docs/plugins.md`). A panel has to live in PhotoCraft's own Rust code. So this is a fork of
`storytold/photocraft`, cloned at `~/src/photocraft`. The project's own guide says AI features
"need owner decisions" (`ROADMAP.md`), so we build it in the fork first and offer it upstream
later, if you want.

## How it fits together

```
PhotoCraft window
 ├─ Chat panel (crates/ui-egui/src/chat_panel.rs)       egui only; talks to a ChatBackend trait
 └─ apps/photocraft wires the backend:
     ├─ starts the control server on a free loopback port with a private token (only while chat is used)
     └─ crates/assistant: one adapter per CLI, a pure stream translator each (tested without a CLI)
          └─ each CLI gets one MCP server: photocraft-cli mcp --bridge 127.0.0.1:<port> --control-token-file <file>
```

- **Tools are PhotoCraft's own.** The model works through the MCP bridge that already ships in
  0.6.0 (21 tools: run any of the 851 commands, inspect the document, screenshot the window,
  menus, pointer). Nothing new is invented on the editing side.
- **Rust only, no webview.** The project's guide forbids JavaScript UI and webviews, and the
  panel follows its theme tokens and its "never crash" rules (no `unwrap`, errors as sentences).
- **The panel stays free of process code.** `ui-egui` also builds for the browser, so it only
  sees a `ChatBackend` trait. The desktop app supplies the real one. The web build shows a note
  that chat needs the desktop app.
- **What the model is told each message:** the document name, size, mode and layer tree, the
  selected layer, the selection and the active tool. A picture of the canvas goes along when
  *Attach canvas* is on.
- **Files:** the bridge only reads and writes in the open document's folder plus a chat scratch
  folder.
- **Undo:** the panel notes the history position when a reply starts. *Undo this reply* steps
  back to it.
- **Chats are kept** per document in PhotoCraft's config folder, and each provider's session is
  resumed, as Rocket does.

What carries over from Rocket: the provider behaviour already verified in
`src/host/providers/*.ts` (stream shapes, resume, cancel, steering, usage), ported to Rust. The
code itself does not carry over: the craft repos don't share code.

## Phases

| Phase | What | Done when |
|---|---|---|
| 0. Check ✓ | Read each CLI's current docs and run it: how to pass one MCP server, how to turn off its own shell and file tools, how to stream JSON, how to resume. Note version and date in each adapter's header. | One page of verified flags per CLI |
| 1. Claude, end to end (built, awaiting a real turn) | The panel, the backend trait, control server autostart, the Claude adapter, steps, Stop, undo-this-reply | You ask for an edit in PhotoCraft and Claude makes it |
| 2. The other three (Codex and Cursor built; Antigravity not started) | Codex (`app-server`), Cursor (`acp`), Antigravity, the model picker, the usage meter | All four work from the same panel |
| 3. Polish | Attach canvas, chat history per document, the theme in all eight looks, tests, a release build | A build you use daily |

Rough size: phase 1 is the bulk (a day or two of agent time); phases 2–3 a day or two more.
Every phase ends with a build you can run and a capture of it working.

## Open questions

- **Fork only, or aim upstream?** Upstream needs the maintainers to agree to AI in the app. A
  personal fork is faster and needs no one's permission.
- **The CLIs' own tools.** By default the model gets only PhotoCraft's tools, not a shell. Do you
  want a switch that also lets it run commands, so it can batch-process a folder for example?
