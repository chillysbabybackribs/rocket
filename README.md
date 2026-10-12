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
running app (or starts one), which opens it as a chat link would: a page or HTML file in a
browser tab, a text file in the artifact panel. Mockups and reports made for you belong here,
not in an outside browser.

The title strip has a 32px Linux penguin SVG at the top left, from
[Icons8 Flat Color Icons](https://icon-sets.iconify.design/flat-color-icons/linux/).
It uses Orbit book and Chromium icons for Library and Browser, outside the left and
right edges of the subscription tab. Hover shows their tooltips; keyboard access and accessible names are preserved. The selected
panel has a subtle filled background.
The icons gently tilt on hover and keyboard focus, and respect reduced-motion preferences.

Each provider runs through its own CLI, signed in with your own account. Install and sign in to
the ones you want: `claude`, `codex`, `cursor-agent`, `agy`.

### Linux sandbox

Chromium's sandbox needs its helper owned by root with mode `4755`, and Electron updates can
reset that. `npm run dev`, `preview` and `open` check it and repair it with `sudo -n` when
passwordless sudo is available. Otherwise the launcher prints the manual commands:

```sh
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

`ROCKET_NO_SANDBOX=1 npm run dev` starts without the sandbox. Use it only for a quick look: the
embedded browser then renders pages unsandboxed.

## How it fits together

```
renderer (React)  ⇄ MessagePort ⇄  agent host (utility process)  ⇄  provider CLIs
        │                               └─ SQLite transcript
        └─ ipc ─ main (window, browser tabs)
```

- **Main** (`src/main`) owns the window and the browser views, forks the agent host, and hands the
  renderer a MessagePort to it. Chat traffic never passes through main.
- **Agent host** (`src/host`) owns the transcript (`store.ts`), decides what each provider is told
  (`hub.ts`, `handoff.ts`), and runs one adapter per provider (`providers/`).
- **Renderer** (`src/renderer`) subscribes per transcript row, so a token stream re-renders one
  row. The host batches events to one message per frame.

### Continuous orchestration

Ask a chat to run a continuous task with the `orchestrator` tool. That chat assigns fresh workers,
reviews their evidence and chooses deeper follow-ups, using provider default models. The host
keeps review turns going while `docs/orchestrator/<run-id>/progress.md` records progress,
findings, worker reports and next questions. Message the chat or edit the file's User notes
section to steer it. Stop is available while workers run; asking to wrap up drains current work
and writes a final review. Interrupted runs pause until explicitly resumed after a restart. See
[the orchestration guide](docs/orchestrator.md).

### Switching providers

The SQLite log is the conversation. A provider's own session is a cache of the part it has seen:
per chat and provider the store keeps the session id and the last turn that session contains. A
message resumes the session and hands over only the turns after that mark, naming the files those
turns read and edited. Codex receives them as real history (`thread/inject_items`); the other
three receive a tagged block in front of the message. A provider that lost its session gets a new
one and the whole conversation.

A handoff stays in the receiving session's history, so it carries what each turn concluded, not
how it got there (`handoff.ts`): the user's words, the reply after the turn's last tool call, the
files touched, and each generated picture (Rocket's copy path and prompt, not pixels). The newest
three turns go whole with a line per other tool call; older ones keep their files and the head and
tail of request and reply. The block is capped at 30,000 characters: the middle of the longest
older replies is cut first, then the oldest turns are left out with a line saying how many.
Missed turns and their items are read in one query (`turnsWithItems`).

What a session is told once (git rules, workspace map) goes to it at start, not again on resume
after a restart. Browser research guidance lives in `browser_read`'s description, so it is not
repeated ahead of messages.

### Tokens

Each turn keeps what it cost (`Turn.tokens`): input tokens across its model calls with how many
were cached, output tokens, and `context` (the input of its last call, i.e. how full the session
is). Claude reports them in `result` and `message_start`, Codex in `thread/tokenUsage/updated`.
Cursor sends no usage over ACP and Antigravity shows only thinking counts, so their turns carry
none. Readings go into the journal with each turn's timing; `rocket_diagnostics` summarizes them
per provider and model.

### Chat panes

The chat card holds one to four chats. The add-chat button in the composer's text line (a speech
box with a plus; the `+` among the tabs is a new tab in the same pane) splits the card: two side
by side, three as two above one, four as quadrants. A new pane opens on the new-chat screen and
takes the focus. Each pane is a whole chat with its own tabs, transcript, composer, folder and
model, and a turn streams into every pane that shows its chat.

The focused pane is the one last clicked or typed in: chat history opens chats there, Ctrl+1–4
picks its provider, and its chat is marked in the history. Closing a pane's last tab closes the
pane (the only pane shows the new-chat screen instead). The plan drawer shows only while the chat
has the card to itself. Panes and tabs come back after a restart.

In the renderer (`store.ts`), `panes` says what each pane shows and `views`, keyed by chat, holds
what a shown chat has loaded, so two panes on one chat share a copy. Components read their chat
through `PaneContext` (`pane.ts`); every store action meaning "in this chat" takes its pane.

### The title strip and toolbar

There is no rail: the chat card starts at the window's left edge. The 48px strip above the cards
(`TitleStrip.tsx`, design in `docs/mockups/usage-in-titlebar.html`) holds the window controls at
its start and the usage notch at its centre: a tab hanging from the top edge with **Library** and
**Browser** as plain text on its left and right, then one ring per provider and its percentage.
Hovering a ring opens its flyout (each limit, when it resets, refresh). Library and Browser toggle
the side column. Chat history is a history icon above the composer, top right. Every menu and
popover is pulled left to end inside the chat card, since the browser page is a native view that
would paint over it.

### Images and files in chat

Paste a screenshot, choose **Attach files**, or drop files anywhere in a chat pane. A thumbnail
tray keeps images beside the draft: click to enlarge, cross to remove, or drag into another chat
to copy. Images may be sent without text; attaching never sends automatically. Accepted: PNG,
JPEG, WebP and GIF, up to 5 MB each, 8000 px per side, 32 megapixels, and ten images totalling
20 MB per message.

Rocket copies image bytes and thumbnails into the profile's `attachments/` directory and keeps
metadata in SQLite. Draft references survive restarts in renderer preferences; sent and queued
ones live in SQLite. Originals may be moved after import. Unreferenced images older than a day are
collected when the renderer reconnects, keeping any still in drafts, queues or transcripts.

Image messages wait for the active turn to finish, even with providers that support text steering;
**Edit** and **Stop** restore the whole message. Claude receives image content blocks, Codex local
image paths, and Cursor ACP image blocks only when its handshake advertises support. Antigravity
does not take images. Provider image formats have unit coverage, but real image model turns have
not yet been exercised. On a provider switch or lost session the handoff sends current and recent
images within the message budget and stored paths for older ones, so files must stay available to
the local provider processes.

**PDFs and text or code files** use the same paperclip, paste and drop, shown as cards with name,
type and size (`docs/mockups/file-attachments.html`). Clicking one opens it in the side panel:
text as text, a PDF as its first 12 pages as images. The host decides what a file is from its
bytes: `%PDF-` is a PDF, UTF-8 without NUL bytes is text, anything else is refused with a message.
Limits: 25 MB a file, 50 MB and ten attachments of any kind per message. PDFs are read with
poppler-utils (`pdfinfo`, `pdftotext`, `pdftoppm`) outside the app; a password-protected or damaged
PDF is refused at import, and nothing in a file is rendered as a page or executed. The stored copy
keeps its extension, with extracted text beside it (`<id>.extracted.txt`) and preview pages in
`<id>.pages/`.

Every provider gets files the same way (`src/host/providers/images.ts`): the message names each
file's stored path and the text follows in `<file>` blocks, up to 60,000 characters a file and
120,000 a message, current files first. Past the budget, or for a PDF with no text, the model is
told to read the stored file. Because files travel as text, Antigravity takes them.

Every attachment has a ⋯ menu (also right-click, Shift+F10 or the context-menu key;
`AttachmentMenu.tsx`, `docs/mockups/attachment-reuse.html`):

- **Copy to chat** lists New chat, chats open in panes, then recent chats with a search, and
  appends the attachment to that chat's draft. Nothing is sent; a notice offers Undo. Dragging an
  attachment onto another pane does the same. A copy is the same stored file referenced twice, so
  deleting the source chat leaves it working.
- **Save as** opens the system save dialog in main; the host copies the stored original there.
- **Reveal stored file** shows the host's copy (`<id>.<ext>`); main refuses paths outside the
  profile's `attachments/` folder.

The camera beside the paperclip (`Capture.tsx`, `docs/mockups/screen-capture.html`) captures into
that composer's draft: **Browser page**, **Rocket window**, **Another app's window…**, **Entire
screen** (under the pointer) or **Select a region…**. Main does the capturing
(`src/main/capture.ts`) through Electron's `desktopCapturer`, which on X11 lists every window and
screen (Rocket finds itself by `getMediaSourceId()`, so its capture includes the native browser
view). Under PipeWire (Wayland) it returns only the one source picked in the system dialog. A
region capture hides Rocket, freezes the screen into a frameless sandboxed window and crops source
pixels from the drag. Every capture opens a review dialog with a pen (red, yellow, blue, white),
an eraser that removes paint only, and Clear; drawing is flattened into the image at capture
resolution. Add to draft imports it like any image (JPEG if a busy screen exceeds 5 MB) with an
Undo notice; Retake and Cancel change nothing. The destination is fixed when the camera is
pressed.

#### Generated images

Codex makes pictures with its built-in image generation, asked for in plain words or with
`$imagegen` (on by default in codex-cli 0.161.0; image turns use limits faster than text). Its
`imageGeneration` thread item becomes an `image` item in the transcript at the point in the reply
where it was made: `generating`, then `done` or `failed` with a sentence saying why (such as a
used-up limit and when it resets). Codex sends both the saved file (`savedPath`, under
`~/.codex/generated_images/`) and base64 PNG (`result`); the hub keeps Rocket's own copy in the
attachments folder, with an ImageMagick thumbnail when installed, so the picture survives Codex
cleaning its folder. The item then carries the stored `ImageAttachment` and none of the provider's
bytes. A turn that made pictures ends after they are saved, and one still `generating` at turn end
is marked failed. Codex's `imageView` item is a small step, "Viewed <file name>".
`ROCKET_CODEX_TRACE=<file>` appends every app-server notification, long strings cut; the header of
`codex.ts` records what one live image turn sent.

**For every provider**, `generate_image` (`src/host/tools/image.ts`, `src/host/image.ts`) lends
Codex's generation to Claude, Cursor and Antigravity. Arguments: `prompt`, optional `aspect`
(square, landscape, portrait) and up to four `reference_images` (absolute paths). `ImageRunner`
runs one hidden Codex turn per call, as a fill does (`fill.ts`): a chat of its own in a folder
under `image-chats/` in the profile, hidden from the chat list, window events and library, deleted
when the turn ends (`recover` clears any a crash left). The calling chat gets its own `image` item
through `hub.addItem`, so it shows the same placeholder and picture, and that item is what puts it
on the library shelf (maker: the calling provider). The picture is also copied to
`generated-images/` in the profile and the tool answers with that path, not pixels: a model reads
the file to look, or open it from the library. Codex's own steps and tokens do not join the
calling chat. Limits: two pictures at once, five minutes a run; a used-up limit, a refusal or
Codex not being signed in come back as readable sentences. The description tells models to use it
only when the user asks for a picture or generative edit, never to crop, zoom or resize. As with
any tool, restart the app and use fresh provider sessions before a session sees it.

The picture appears where it was made (`GeneratedImage` in `Transcript.tsx`, designs in
`docs/mockups/generated-images.html` and `generating-image-variants.html`). It is not folded into
the turn's steps and moves rather than remounts when the final reply arrives. While generating, a
field of dots ripples from the centre with no label or clock (screen readers hear "Generating
image"; reduced motion holds it still). The finished picture comes into focus in place, up to
520 px wide, with the prompt as a two-line caption. Clicking opens the full-size viewer
(`useImagePreview` in `Attachments.tsx`); its ⋯ menu offers Preview, Copy to chat, Save as… and
Reveal stored file. A failure is its sentence in the error colour. `tests/ui/generated-images.spec.ts`
drives it through `UI check: image` in `ui-test.ts`.

### Library

The toolbar's Library section opens every file the chats have touched, beside the chat
(`LibraryPanel.tsx`, `docs/mockups/document-library.html`, plan in `docs/library-plan.md`). Only
five sources fill it:

- attachments a chat has sent (drafts are not listed until sent);
- pictures a model generated ("Made by a model", with the provider as origin);
- files a model downloaded with the browser (indexed at turn end from main's download record);
- Markdown files a turn wrote (from the turn's changed files);
- files opened from a chat (a link or `npm run open`).

Attachments and generated pictures are read live from the store; the rest are rows in
`library_files`, keyed by path, so a file keeps the source it first arrived with. Eval chats'
files stay off it. On the first start with a library, Markdown files earlier turns wrote are added
once from the stored turn patches, dated by the last turn that wrote them; deleted files are
skipped.

The panel has a filter rail (source, kind, chat, added; each option shows how many files it
would leave), a search over names, folders, paths and chat titles, and a grid or list. Cards show
host-made previews (`src/host/library.ts`): a PDF's first page (`pdftoppm`), a picture thumbnail
(the attachment's own, or ImageMagick's), the start of a text or Markdown file, or an Office
file's embedded thumbnail. Previews are cached under `library-previews/` by path, size and time,
at most two are made at once, and a card asks only as it scrolls near. A missing tool or failed
preview leaves the type mark; a moved file shows as missing. Clicking a card opens it in the side
panel (text, rendered Markdown, a PDF's first 12 pages, or the picture) with **Library** to go
back.

Filters, search and opening go through the app map (`library` place, `library.clear`,
`library.open`), and `library_list` (`src/host/tools/library.ts`) lists the same shelf with the
same filters (`src/shared/library.ts`), so a model and the user see one answer. Viewers a model
can mark (PDF.js, CodeMirror 6) are later slices of the plan.

### Messages sent while a turn runs

The composer stays open while a turn runs; Esc or Stop stops it. A message to the answering
provider joins its turn (`Hub.post`, `ProviderAdapter.steer`): Claude Code gets a streamed user
message with priority `next`, Codex uses `turn/steer`. It is wrapped in an instruction to carry on
without acknowledging it. The model reads it only at its next step, so until then it shows dashed
under the turn ("Claude reads this at its next step"). The adapter calls `steer`'s `taken`
callback when the model reads it (Claude Code echoes it with `--replay-user-messages` and reports
`command_lifecycle` `started`; Codex reports a `userMessage` item). Only then is it stored as a
user item marked `steer` inside the same turn, at the point it was read, and the transcript
splits the turn there, folding earlier steps into their own summary. Words a turn never read are
recorded when it ends, not sent again; a stopped turn dropped them, so Send now sends them first
and Stop returns them to the composer.

Cursor and Antigravity cannot take words mid-turn, and a message to a different provider must
wait anyway. Those queue in the hub, show under the turn with **Send now** (stop, then send) and
**Edit**, and go out together as one message to the last picked provider when the turn ends. Stop
returns queued text to the composer. Answers to a question card in a plain chat use the same
queue. Stop cancels a Claude message still queued inside Claude Code
(`interrupt({ cancelQueued: true })`); only a CLI too old to cancel has its process retired, which
ends its background work.

### Turns a provider starts by itself

Claude Code can start a turn with no app message: when a background subagent or shell finishes it
answers on its own. A turn whose reply ends while such tasks still run is held open in its
working state, its head reading "Waiting for 2 background tasks" (`Turn.activity`, set through the
sink, never stored), and the follow-up lands in it (Stop ends the wait). A follow-up with no turn
open, after a restart for instance, gets a turn of its own through `onUnprompted` (`provider.ts`)
with a notice saying what finished. While background tasks are live the Claude Code process is
not retired for idleness, since that would kill them.

### Browser

The browser panel has Chromium's tab strip and shortcuts (Ctrl+T, W, Shift+T, Tab, 1–9, L) and a
Safari-style address field. Each tab is a native view owned by main (`src/main/browser-pane.ts`);
only the active one is on screen. Background tabs are hidden with `setVisible(false)`; set
`ROCKET_BROWSER_HIDE=park` to move them off screen instead if one ever comes back blank (see
`src/main/browser-url.ts`). Tabs, history and the last session are kept in the profile.

The address dropdown is a view of its own (`browser-suggest.ts`, `src/renderer/suggest.html`)
stacked above the page, so it overlays the page and never moves it; so is the Fill with Rocket
chip. While typing, the field fills in the most visited matching site with the added part
selected, as Chrome does (`completeAddress` in `browser-url.ts`): Enter opens it, Backspace or
Escape takes it back. Pages are made with `focusOnNavigation: false`, since Electron would
otherwise steal keyboard focus from the address field mid-word on each navigation.

Closing tabs keeps Rocket and its chats open; the last tab leaves one home tab. Agent tab-close
calls remove restored tabs without loading them and wait for native page cleanup before returning.
Every provider is told that only an explicit request to quit authorizes closing the app or its
process, including restarts after source edits.

**Pages see an ordinary Chrome.** Login pages and managed challenges read Electron's defaults as a
bot. The browser session therefore presents as the bundled Chrome: its own user agent (no
`Rocket/` or `Electron/` tokens, `plainUserAgent` in `browser-url.ts`), no `navigator.webdriver`
(main picks a free loopback debugging port itself rather than port 0, which makes Chromium set
the flag; the port is still loopback-only and read from `DevToolsActivePort`), client hints
(`Sec-CH-UA*` headers and `navigator.userAgentData`, built by `userAgentMetadata` in
`browser-url.ts`), a filled `window.chrome` (`chrome-object.ts`) and Chrome's `navigator.languages`.
The fill rides on a per-tab debugger session attached as each tab is made (opening DevTools
detaches it; it is restored when they close). Because protocol commands need a renderer, a new tab
loads a blank document first and the entry is removed from history once the next page is in.
Known gaps: `Critical-CH` restarts are not emulated, a page's synchronous first-tick read of a new
iframe's `chrome` sees it empty, and Notification permission cannot show Chrome's "default" state.
Details and the fingerprint audit are in `docs/browser-realism-audit.md`.

**Hands-free reading** scrolls the page at a steady pace (double chevron at the right of the
toolbar, or Alt+S; `docs/mockups/reading-scroll.html`). While a tab reads, the button opens into a
pill (`ReadingControl.tsx`): play/pause in a ring that fills with the page, a log-scale speed
slider from ¼× to 8× (1× is 30 px/s; `src/shared/reading.ts`), the time the rest of the page takes,
and stop. Scrolling runs in the page in an isolated world (`src/main/reading-scroll.ts`) so it
sees the reader's input: wheel, scrollbar and scroll keys move the page and reading resumes half a
second later; Space, a click or typing pauses; at the foot it waits a few seconds for a feed to
load more before calling the page done. Main starts and stops it, pauses a tab that leaves the
screen, forgets it on navigation, takes Esc and Alt+↑/↓ (slower, faster), and polls progress four
times a second. One speed is shared by every tab and kept in `browser-tabs.json`.

The file panel beside the chat has the same reading in its header for whatever it shows (plan,
Markdown, library document, PDF, attachment, turn diff; `PanelReader.tsx`,
`src/renderer/src/panel-reader.ts`, which mirrors the page's because it cannot share code). It
scrolls `.artifact-content` and starts at rest for each file. The speed is shared with the
browser: the renderer keeps it in preferences and passes it to main.

**Logged-in sessions.** The embedded browser can share the user's sessions from their OS browser
(`src/main/cookie-import.ts`). On first launch, cookies from the default OS browser are copied
into the persistent `persist:browser` session, once (a `cookies-imported` marker records it).
Later, the page's right-click menu has **Import login cookies**, listing each detected browser
with "This site" and "All sites". Chrome, Chromium, Brave, Edge and Vivaldi are read from their
profile's Cookies database and decrypted with the key in the login keyring ("<Browser> Safe
Storage", via `secret-tool`); Firefox's `cookies.sqlite` is read as-is. Only the user's profile is
read, never written, and the database is copied first so a running browser cannot block it.

**Chat links** open beside the conversation: HTTP(S) URLs and local HTML, images, PDFs and media
open in a browser tab; text and source files open in a closable artifact preview (Markdown
renders as a document, `:line` / `#Lline` highlights a source line); a folder opens as a list of
links. Markdown links, bare URLs and recognizable file paths, including inline-code paths, are
clickable. Relative links use the chat's working folder (or the containing artifact's). Text
previews are limited to 2 MB; missing files and unsupported binaries show an actionable error.
Nothing opened from inside the app is handed to a system app, and links that try to open a new
window take the same path.

### Fill with Rocket

Right-click a text field in the browser: **Fill with Rocket** writes the answer straight into the
page; **Fill with instructions…** asks first; right-clicking in a form with two or more text
fields offers **Fill this form with Rocket**. No chat opens and nothing is kept
(`docs/mockups/fill-with-rocket.html`).

- **Main** (`src/main/page-fill.ts`) asks the page, through an isolated-world script
  (`fill-page.ts`, world 1208), what is under the pointer: the field, its form (the `<form>`, or
  the nearest ancestor with two or more fields), each field's label, value and selector, and the
  nearby text. Passwords and payment fields are never filled; dropdowns, checkboxes and fields in
  embedded frames are left alone.
- **The host** (`src/host/fill.ts`) runs one turn in a hidden chat in `<profile>/fill/<id>`, with
  the model last sent from the composer (kept in `fill/model.json`; the menu names it), and every
  tool a chat turn has. `fillPrompt` (`src/shared/fill.ts`) tells it to read the user's tab but
  never act in it, check facts at their source, write as the user, leave fields needing the user's
  own details, and never submit. Its reply ends with a ```` ```rocket-fill ```` JSON block that
  `parseFillReply` reads. The chat never reaches the window (`FillRunner.observe` swallows its
  events; `chats.list` and the library skip its folder) and is deleted with its folder at turn end
  (a fill cut off by an exit is cleared at next start). Tabs the model opens stay in the
  background (`BrowserAgent.setQuiet`).
- **The chip** (`src/renderer/fill.html`) is a transparent 500 px view over the page, above the
  field's top right corner, following it as it scrolls. Working, it shows the current step
  (`describeStep`), time, Sources (live count and list) and Stop (or Esc). Done, it offers Sources,
  **Another go** (Sound like you, Shorter, More detail, Friendlier, A different take, With
  instructions…) and **Undo**, and goes away when the user types in the field or clicks elsewhere.
  A failure says why and offers Try again, with another provider when one has usage left. The tab
  being filled wears a turning ring.
- **Text goes in as typing would**: `insertText` for text boxes (Ctrl+Z undoes it), a paste for
  rich editors (Lexical, ProseMirror, other contenteditables). Undo restores what the fields held
  before the last fill; in a rich editor that is the text without formatting.
- **Sound like you** rewrites the fill in the user's voice from up to 40 of their own messages
  (`Store.userMessages`, skipping goal prompts, eval and fill chats, pasted text and very short or
  long messages). Those messages go to the provider doing the rewrite.

### Sources

Search results are leads. Rocket records a page as a source only after a reader returns usable
content. Navigation, a download alone, empty output, search pages and recognized access challenges
do not count, and provider fetches with textual failures are marked failed even when their
protocol omits an error flag. Detection is conservative and heuristic: an "opened" mark means
readable content came back, not that a claim is true. The source record and citation notices are
shared by all four providers (`src/shared/sources.ts`).

### Tools

The app owns its tools and every provider sees the same ones. The host keeps them in one registry
(`src/host/tools/registry.ts`) and serves them over a single loopback MCP server (`channel.ts`),
the one channel all four CLIs accept; each session's URL names its chat. Antigravity is the
exception: its MCP config is global, so the app registers itself there as `rocket` (`agy mcp add`)
and works out the chat from the running turn. Its CLI also leaves MCP tools out of the model's
prompt, so the adapter opens a new conversation's first message with the tools, arguments and how
to call them.

Besides the browser and UI tools there are `library_list`, `generate_image`, `remember`, `ask_user`,
the history tools, and with `ROCKET_SELF_CHECK=1` the three
self-check tools. Every tool's schema is in every session's prompt, so what a model should simply
know goes ahead of the user's message (tabs, file map, notes, trouble reports); a tool is added
only for something a model must do.

#### Research

`web_search` and `web_read` (`src/host/tools/research.ts`) sit beside the browser tools; native
search stays available. `web_search` uses the app browser with Google/Bing fallback, needs a live
browser, and can hit engine challenges. `web_read` fetches source text directly, extracts HTML
with Readability and PDFs with `pdftotext`, falls back to the browser when an HTTP read fails, and
accepts downloaded PDF paths. It keeps extracted text on disk, paginates, reports attempts and
retrieval time, and bounds downloads, time and output size. It never passes source content through
a summarizing model. Access challenges stay explicit failures; no bypass is promised.

#### Browser tools

- `browser_read` returns a page as text with links, controls with short refs, and the data
  requests it made.
- `browser_screenshot` returns a tab as a small JPEG, for what text cannot say.
- `browser_run` runs a model-written script against a small Playwright-shaped API (`tab.goto`,
  `tab.eval`, `tab.click`, `tab.fill`, `tab.waitFor`, `browser.fetch`), so a task is one call. The
  script runs in a host worker thread and each step is a request to main
  (`src/main/browser-agent.ts`), which drives the tab over the DevTools protocol.
- `browser_download` saves a file with the user's sign-ins and no save dialog, from a `url`
  (absolute or relative to the tab's page) or a `click` target. It waits for the file (default
  120 s, max 600) and returns path, size and type, or how far it got. Files go to Downloads unless
  `saveTo` names a folder or file (relative paths start in the chat's folder); an existing file is
  never overwritten (`report (1).pdf`). A click in `browser_run` that starts a download is saved
  the same way and listed in the result. Because a model cannot answer Electron's save dialog,
  main (`src/main/browser-downloads.ts`) sets the path for any download from a tab a model is
  working in; a download you start in another tab still opens the usual dialog.

A model works in tabs of its own, marked with a dot in the tab strip, and touches yours only by
id. Opening one or navigating it switches the browser view to follow along, but the page never
takes keyboard focus from the composer. Open tabs ride at the head of the user's message when
they change, so listing them costs no call. A page counts as loaded when its document is ready.
While a turn uses a tab it runs at full speed even when concealed; afterwards it is an ordinary
background tab, and a deleted chat's own tab is closed.

Rocket's Codex process disables the bundled `unified-computer-use`, `browser` and `chrome`
plugins through process-local overrides, so `cua_repl` and related skills and hooks do not
compete with Rocket's browser tools. They apply to new and resumed chats when that process
starts; restart Rocket after updating. Native web search, other plugins, and Codex sessions
outside Rocket keep their settings.

#### UI tools

`rocket_ui_snapshot` (`src/host/tools/ui-snapshot.ts`, `src/main/ui-snapshot.ts`) shows the
running window without clicking, switching tabs or changing focus. It returns images, visible
shell control names and panel bounds, native view bounds, and the process, start time, app version
and main bundle fingerprint. On X11 it captures the composed window through ImageMagick, including
native pages and dropdowns; otherwise it returns separate shell and native-view images with a
warning that they cannot verify overlap or stacking. Full PNGs and `snapshot.json` are kept under
`<profile>/ui-snapshots/`; model images are JPEGs at most 1600 px wide. It shows the running
instance, so source edits may need a rebuild. Always available; no self-check mode needed.

`rocket_ui_run` drives the **live window by default**, attaching to the running app through a
loopback Chromium debugging endpoint, identifying the shell and visible native views by target
ID, and disconnecting after each script. It builds or launches nothing; actions affect the user's
actual panes, drafts, history and browser session. One script runs at a time across chats. The
endpoint and schema need a restart after install.

It takes `code`, the body of an async function with `page`, `ui`, `sleep` and `console`. Await
every action. `page.getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`, `getByTestId` and
CSS `locator` support chaining, clicks, filling, keys, hovering, visibility waits and reads;
option names and text must be strings, not regular expressions. Use DOM evaluation to inspect,
never to mutate renderer state and manufacture a passing UI. For example:

```js
await page.getByRole('button', { name: 'Add a chat beside this one', exact: true }).first().click()
return await page.locator('.pane').count()
```

- `ui.surface('browser' | 'suggestions')` returns the page API for the visible native view.
- `ui.resize(width, height)` resizes the live window (880×560 to 4000×2400).
- `ui.read()` returns shell controls and panels; `ui.snapshot()` adds a capture.
- A final snapshot is included by default; `capture=false` skips it on success (failures always
  capture). Results include process identity, logs and saved paths under `<profile>/ui-runs/`.
- The default timeout is 30 s (max 120). Scripts run in worker threads, so an infinite loop can
  be stopped; a timeout disconnects automation, leaves Rocket open and keeps completed actions.
- Live mode rejects `build`, `reset`, `close` and the test helpers `ui.request()`, `ui.release()`
  and `ui.restart()`. Source edits need a rebuild and restart of the live app.

Use **`target: "isolated"` explicitly** for regression tests. It builds current source into
`.artifacts/ui-run/` and launches Electron on a private Xvfb display with a marked fresh profile,
scratch workspace, controlled providers and the self-check network filter. Providers in the same
chat share one isolated session. Select its scratch folder through the folder button before
sending `UI check:` prompts. `ui.request()` reads the latest controlled turn, `ui.release()`
completes a held response or plan, and `ui.restart()` restarts its profile and build. Ordinary
prompts fail instead of starting real provider CLIs. Resize limits are 880×560 to 2400×1400.

For isolated calls, `reset=true` discards the session and rebuilds, `build=false` reuses `out/`,
and `close=true` closes it without a script. Build and startup have a separate three-minute
deadline, and a timeout discards the session. Four sessions may be open at once; idle ones close
after ten minutes, and chat deletion and host shutdown close theirs (cleanup covers detached
Electron descendants). Captures, per-call JSON, `runner.log` and traces stay in the session
directory.

#### The app map

The shell is finite, so a model navigates it by name rather than hunting for buttons.
`src/shared/app-map.ts` is a hand-written map of every **place** the shell can show (`chat`,
`browser`, `library`, with their parameters) and every **action** (`pane.add`,
`chat.open`, `library.open`, …), each naming the component file that renders it. The renderer's
dispatcher (`src/renderer/src/app-map.ts`) implements it: `where()` reads the shell's state in the
map's words, `go(place, params)` shows a place, and `act(action, params)` does an action, going to
its place first if needed. Toolbar and panel controls call the same `go` and `act`, so a click and
a model take one path. Mapped controls carry `data-nav="<place>"`, which `rocket_ui_snapshot`
reports as `nav`.

The host serves the map as three tools (`src/host/tools/ui-map.ts`), run in the renderer through
main's `uiMap` op: `rocket_ui_where` (no image: the panes, which is the asking chat's, the side
panel and what it shows), `rocket_ui_go` and `rocket_ui_act` (both return where the shell ended
up plus an image; `capture=false` skips it). A wrong place, action or parameter is refused with
the valid choices (`UI_MAP_REFUSED`) and nothing moves.

Three checks keep the map and the UI one thing: the typecheck fails on a map entry the
dispatcher does not implement; `src/shared/app-map.test.ts` fails on a `go`, `act` or `data-nav`
naming something the map lacks, a map entry no control uses, or a place whose `file` is gone; and
`tests/ui/app-map.spec.ts` fails on a place the running app cannot reach. Adding UI a model may
need is therefore: a map entry, a handler (the typecheck says where), state in the store, and a
control that calls `go` or `act`.

Every turn's `<agent-environment>` block (`src/host/agent-situation.ts`) says where the model
runs, carries one live "Where you are" line from `rocket_ui_where`, and prints the map.

#### `ask_user`

`ask_user` (`src/host/tools/ask.ts`) is how a model asks the user something without holding the
chat up. The call posts a card in the transcript and returns at once; the model carries on with
everything the answer does not change and ends its turn as usual. A question needs two to four
options, each with a short label and what picking it means, plus the index of the option the
model would take; the card marks that one "Suggested". One question per turn; a second call, a
question without real options, or one without the model's own pick is refused with a message
saying what to do. An answer (clicked, or typed under "Something else") is sent as the chat's next
message with the question quoted, to the provider picked in the composer; if the asking turn is
still running it goes the moment that turn ends. A handoff names a still-open question so another
provider knows what is undecided.

Cursor has blocking questions and plan approvals of its own over ACP (`cursor/ask_question`,
`cursor/create_plan`). Nobody would answer them, so its adapter skips the question with a pointer
to `ask_user` and accepts the plan, as an unattended session would.

### Plans

The plan a model keeps while it works is shown beside the chat, not in it. Each adapter turns its
provider's list into one `plan` item per turn (`<turnId>:plan`, `PlanStep[]` with `todo` /
`doing` / `done`), replaced whole on every update: Claude Code's `TodoWrite` calls (no longer shown
as tool rows), Codex's `turn/plan/updated`, Cursor's ACP `plan` update. The turn's head line reads
`Planning · 2 of 5` instead of "Thinking" while it works, and `Planned · 5 of 5` after. That line
opens and closes the plan drawer (`PlanDrawer.tsx`): a side column with the request as title and
the steps under a count, done ones ticked and dim, the current one in the accent. The drawer opens
by itself on a running turn's first plan; closing it is remembered per chat (`planClosed` in
preferences), after which only the head line opens it. The handoff does not carry the plan: the
reply says what was done. States are in `docs/mockups/plan.html`.

### Workspace and memory

A new provider session starts already knowing the folder (`src/host/workspace.ts`): its files, one
line per folder from `git ls-files`, cut to a budget by listing upper folders and counting what
lies deeper; and the notes earlier sessions saved about it. So a session's first calls are not
spent listing and searching. Notes are the project's memory, shared by all four providers: a
model saves one with `remember` (`src/host/tools/memory.ts`), they are kept per folder in the
store, and a running session is told the ones others save. Reading notes is not a tool, so it
costs no call or schema.

### Several assistants, one folder

Chats can run at once in the same project, and the user and other programs change files too. Ahead
of a message, a model is told (`src/host/teamwork.ts`) who else is working in the folder and on
what, what other chats finished there since its last turn, and which files changed under it, so
it re-reads those before touching them.

Git is the app's job, not the models'. When a turn completes, the files that changed during it are
committed on the current branch, alone, with the user's request as the message (`src/host/git.ts`).
Changes come from comparing folder snapshots at the turn's start and end, so shell-made changes
count; what the user had already changed and files another running turn edited are left out. A
stopped or failed turn commits nothing: its files go in with the turn that finishes the work.
Nothing is pushed, hooks are not run, and no commit is made mid-merge or off a branch. Models are
told not to commit or bring git up. `ROCKET_AUTO_COMMIT=0` turns committing off, and a folder that
is not a git repository is left alone. Claude Code sessions on this repository outside the app are
covered by a Stop hook (`.claude/settings.json`, `scripts/auto-commit.sh`).

The same snapshots show the user what a turn did. A finished turn that changed files carries a
line under its reply, `Changed 3 files +184 −12` with a balance bar, which opens the turn's
unified diff in the artifact panel (`ChangesView.tsx`) with a strip of files to jump between. The
patch is `git diff` between the snapshots of the turn's own files (`patchBetween`), parsed by
`src/shared/patch.ts`, stored with the turn (`turn_patches`, cut at 2 MB on a file boundary) and
served by `turn.changes`. It needs no commit, so it works with committing off.

The panel's header offers **Undo this turn**: a strip names the files, and on Undo they are put
back from the turn's start snapshot (`restoreFrom`: working tree only, index untouched; files the
turn made are removed). With committing on, the reversal is committed as `Undo: <request>`. The
turn stays in the chat with its diff dimmed and its line tagged `undone`, and the next model in
the folder is told the files changed under it. Undo is not offered while a turn runs in that
folder or when one of the files has changed since; the note names the file (`teamwork.undoable`).
There is no redo: the diff is still there, and a model can be asked to redo it. States are in
`docs/mockups/turn-changes.html`.

### Continuous research loop

For ongoing codebase research across four live provider chats, see
[the protocol](docs/research/continuous/PROTOCOL.md). `node scripts/research-loop.mjs start`
starts a local supervisor against the existing panes; `status`, `pause`, `resume` and `stop`
manage it. Each round runs four research turns, four independent reviews and a rotating synthesis
that informs the next. Reports stay in `docs/research/continuous/`, supervisor state in
`.artifacts/research-loop/`. This spends real provider usage with no round or token cap, needs
Rocket to stay open, and does not implement proposed upgrades. Historical eval scenarios and the
in-app eval panel are archived in `docs/archive/evals/` (see `docs/archive/README.md`).

### Transcript zoom

Ctrl + wheel (or a touchpad pinch) zooms the transcript (`transcript-zoom.ts`) from 50 % to 250 %.
The wheel moves a target and each frame eases toward it in log space, so zooming in and out feel
alike. It is CSS `zoom` on `.transcript-inner`, so text reflows. Each frame holds the block under
the pointer in place (the middle of the view in other panes), and a transcript at the bottom stays
there. The level is shared by every pane (`localStorage` `rocket.transcriptZoom`), and the turn
that fills the view divides the view height by the zoom (`--turn-view`, `--chat-zoom`).
`tests/ui/zoom.spec.ts` checks easing and anchoring.

### Long chats

A chat opens with its newest 20 turns (`TURN_PAGE`, `store.snapshot`). `ChatView.hasOlder` says
earlier ones exist; scrolling within a screen and a half of the top calls `loadOlder`, which
fetches the 20 before the first loaded (`chat.older`) and puts them above. `Transcript` keeps the
reader in place by the distance from the bottom, and tells a page put in above from a turn just
sent by the last turn's id. A `turn` event for a turn above the loaded ones waits until it is
fetched. Pages read items through `items_by_turn`, ordered by turn, so a page costs the same in
any chat.

A page leaves out the output of finished tool calls (most of a chat's bytes); a call carries
`outputLength`, and opening its step fetches the output (`item.output`, `loadOutput`). The turn in
flight keeps its output as it streams.

The window keeps the chat of every open tab, in any pane, current from live events, so returning
to a tab asks the host for nothing (`pruneViews`, `openChat`). A kept chat read far up returns to
its newest page when it comes back on screen (`newestPage`). `ChatMarkdown` caches its parse by
folder and text for the last 600 texts; a reply's last block is not cached while it streams.

Two benchmarks use seeded synthetic chats shaped like real ones (`tests/fixtures/long-chat.ts`).
`npm run bench:transcript` times the host: opening a chat, the payload, the attachment sweep and a
full handoff. `npm run check:ui -- long-chat` times the isolated app (first open and median of
three, opening a step's output, switching tabs, bringing in the page above while checking the
reader does not move, reading to the first turn), with `LONG_CHAT_PROFILE=1` for a CPU profile.
Its budgets fail the check if a chat's length shows up in its open time. Both write to
`.artifacts/bench/`; the audit and baseline are in `docs/long-chat-plan.md`.

### Design reference library

An editable reference catalog and preparation skill for design work. See
[the library guide](design-library/README.md) to add references, edit notes and images, search
tags, or validate paths with `npm run design -- validate`. Catalog edits need no rebuild.
[DESIGN.md](DESIGN.md) records Rocket-specific conventions; other projects keep their own. Set
`ROCKET_DESIGN_LIBRARY` to use another folder. There is no in-app editor.

### Permissions

All four providers run unattended with full access to the chat's working folder and your shell.
There are no approval prompts yet.

### Self-check

The host keeps a journal, `journal.jsonl` in the profile folder (one JSON object per line, rotated
at 2 MB; `src/host/journal.ts`). It always records uncaught host errors, uncaught page errors
(sent over the renderer's port, once per message), host restarts seen by main, failed turns, tool
failures, and turns far slower than usual for their provider and model; every other turn is kept
as a timing line with its tokens when reported.

With `ROCKET_SELF_CHECK=1` the app serves three more tools to every provider
(`src/host/tools/self-check.ts`):

- `rocket_check` runs the chat folder's `typecheck` and `test` scripts and returns what failed (a
  failure also lands in the journal as a tool error).
- `rocket_diagnostics` reads the journal and the timing and token averages.
- `rocket_note` files what a model saw, why it thinks it happened and the change it would make.

Each chat is also told once, ahead of its next message, when new warnings or errors have arrived.
Notes edit nothing; changing code is still the user's request or the model's judgement about a
clear defect, as `CLAUDE.md` says.

The profile folder is `~/.config/Rocket` (Electron's `userData`), so the journal is
`~/.config/Rocket/journal.jsonl`; `tail -f` it to watch. `npm run simulate:slow-turn` writes a
fake slow turn from a `sim` provider to check detection. Those rows stay in the journal and the
timing averages, so set `ROCKET_DATA_DIR=<dir>` to use a scratch folder.

### Tool-call history

Rocket records calls to its shared MCP tools in `<profile>/tool-calls.db`, independent of
self-check mode. Each call has a start and an immutable finish, version and build fingerprints,
provider and any model/turn identity, redacted arguments, duration, outcome, structured error and
artifact references. Unfinished calls from a previous host are marked interrupted, and recording
failures cannot change tool behavior.

- `rocket_tool_history` returns bounded call lists or deterministic failure groups (default: last
  24 hours, 10 results). Filter by tool, version, error code or dates; pass a call ID for redacted
  arguments and artifact references. Failure rates include successes in the same version and
  operation scope. UI operation failures are distinct from script-authored exceptions.
- `rocket_tool_review` records investigator annotations apart from the evidence: lifecycle stage,
  cause notes, proposed fix, optional retry links. `action=queue` lists failures needing review.

History stays out of session prompts, and tool descriptions are not rewritten automatically.
Records are pruned after 30 days or beyond 10,000 finished or previous-instance calls, at startup
and every 100 starts; active calls and captures/traces are kept. Format, redaction, retention and
queries are in [tool-failure-history.md](docs/tool-failure-history.md).

### Desktop self-check

`npm run check:ui` builds the current source, runs unit tests and drives the real Electron app with
Playwright. By default it uses a private Xvfb display so it cannot steal your keyboard. On Linux it
needs `Xvfb`, `xvfb-run` and `xauth`; ImageMagick's `import` adds full-window screenshots. No
Playwright browser download is needed: it uses the project's Electron binary. Use
`npm run check:ui -- --visible` to watch on your desktop, or `-- --repeat-each=3` to run every
scenario three times with fresh profiles.

Each run keeps a timestamped directory under `.artifacts/ui/` with `runner.log`, `summary.json`,
`results.json` and an HTML report (`report/index.html`) holding named steps, screenshots, native
view bounds, the app log, the isolated journal and a Playwright trace. Open it with
`npx playwright show-report <run-directory>/report`. Failed runs exit nonzero and capture the UI
before closing; windows and the local web server close automatically, and profiles stay with the
report. SIGINT/SIGTERM stops the owned subprocess tree, including detached Electron processes
(TERM-resistant children are killed after a grace period); interrupted runs exit 130/143 and record
the failure in `summary.json`.

The checks cover composer input, folder selection, usage, model selection, streaming, completion,
tool output, provider handoff, cancellation, failure recovery, drafts, history, chat panes
(splitting to four, streaming into one, closing, layout after restart), the title strip (no rail,
centred usage notch, flyout inside the chat card), renderer reload, full restart, recovery from a
host crash mid-response, minimum window size, browser navigation and tabs, the address dropdown
and inline completion (focus kept while a page navigates), chat links, and `ask_user` question
cards. The shell, embedded page and dropdown are separate Playwright targets, with screenshots and
bounds kept separately; on X11 a whole-window capture also records how native views overlap (the
report says so if that capture is unavailable). Assertions check native page bounds and dropdown
visibility, overlap and stacking order, so misplaced or hidden native views fail without a visual
comparison.

The fixture (`tests/ui/app.ts`) uses a fresh marked profile and scratch workspace. All four
provider adapters are replaced by `src/host/ui-test.ts`, so real CLIs are never started. Before any
restored tab loads, the app and `persist:browser` sessions block HTTP/WebSocket origins outside the
local fixture, and new-tab home redirects to it. Responses wait for the test to observe the
stream, avoiding timing-dependent sleeps. The host, SQLite store, MessagePort and renderer are
real; the folder dialog returns the scratch workspace. This checks app behavior, not provider
authentication, CLI translation or native OS dialogs; `check:live` is the separate, explicitly
authorized provider integration check.

The safeguards scenarios deliberately remove the browser filter and damage native view layout,
then require the same assertions to reject those faults. A subprocess unit test checks ordinary
and detached descendants, including ones that ignore SIGTERM.

Add scenarios in `tests/ui/` (`rocket.spec.ts`, `safeguards.spec.ts`, `recovery.spec.ts`,
`question.spec.ts`, `chat-links.spec.ts`). Prefer accessible controls and observable state; do
not mutate renderer state to manufacture a passing UI. `ROCKET_UI_TEST=1` is reserved for this
runner and requires the marked profile before main or host opens the store; the runner supplies
`ROCKET_UI_TEST_ORIGIN` for its loopback server, and the hook is inactive outside UI test mode.

## Development hooks

- `ROCKET_SELF_CHECK=1` serves the self-check tools and nudges described above.
- `ROCKET_DATA_DIR=<dir>` moves the host's data (transcript, journal, tool channel). Main sets it
  to the profile folder; set it by hand only for scripts that run the host without the app.
- `ROCKET_USER_DATA=<dir>` uses another profile folder, so test runs never touch real chats.
- `ROCKET_CAPTURE=<file.png>` saves a picture of the UI after load; `ROCKET_CAPTURE_SCRIPT`,
  `ROCKET_CAPTURE_DELAY_MS` and `ROCKET_CAPTURE_EXIT=1` script a flow first and quit after.
- `npm run check:live -- claude codex cursor antigravity` runs a real conversation across
  providers without the UI. It uses a little of each subscription.
- `npm run demo:video` records a demo (`.artifacts/demo/run/demo.mp4`) of sending messages,
  switching between Claude, Codex and Cursor, and the browser tools filling a form in one
  `browser_run` script. Like `check:ui`, it runs an isolated app on a private display with a fresh
  profile and a local site, and calls no model. Turns are scripted in `src/host/ui-demo.ts`, but
  their tool calls go through the real MCP channel. `scripts/demo-video.mjs` records at 2× and
  logs where each action happened; `scripts/demo-edit.py` adds camera zooms, the pointer, outlines
  on filled fields and captions, only cropping and resampling the recorded frames.
