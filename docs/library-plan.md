# Library and document viewer: implementation plan

> **Status note (2026-10-09), checked against the code.** Slice 1 is built: `library_files` in
> `src/host/store.ts`, `src/host/library.ts` (sources, previews, backfill), `src/shared/library.ts`,
> `components/LibraryPanel.tsx`, the `library` place and `library.open` / `library.clear` in
> `src/shared/app-map.ts`, `library_list` in `src/host/tools/library.ts`; covered by
> `src/host/library.test.ts`, `src/shared/library.test.ts` and `tests/ui/library.spec.ts`. Slices 2
> to 4 are not built: no `LibraryViewer`, `PdfView`, `TextView`, `ImageView`, `OfficeView` or
> `MarksPanel` component, no `library.file` place, no `library.filter` action, no `library_marks`
> table, no `document_text` / `document_mark` / `document_marks` / `document_unmark` tools, and no
> PDF.js or CodeMirror dependency in `package.json`. Corrected in place below: the table name and
> source values, the preview width, and the tool and app-map lists.

The approved mock is [document-library.html](mockups/document-library.html) (approved 2026-10-06).
Research and the earlier decisions are in
[document-library-viewer-options.md](research/document-library-viewer-options.md). This plan turns
the mock into the app in four slices, each shippable and checked on its own.

The bar from the first request still holds: nothing the user can do in the library should be out of
reach for a model. Every mark, filter and navigation below has a tool or app-map entry, and every
mark a model makes is the same record the user's marks are.

## One decision changed: PDF.js instead of Nutrient

Nutrient Web SDK is commercial, quoted per component, and evaluation is a 30-day trial that
watermarks documents until a licence key is set
([pricing](https://www.nutrient.io/sdk/pricing/),
[watermark guide](https://www.nutrient.io/guides/web/troubleshooting/license/watermark-still-appearing/)).
That is a bad fit for a personal tool.

**PDF.js** (`pdfjs-dist`, Apache-2.0) replaces it. Its source defines built-in editors for free text,
highlight, stamp, ink and comments (`AnnotationEditorType` in
[src/shared/util.js](https://raw.githubusercontent.com/mozilla/pdf.js/master/src/shared/util.js)).
More importantly, Rocket does not need an SDK's annotation API for agent work: marks live in
Rocket's own store and are drawn as an overlay on PDF.js's page and text layers, so a model can mark
a PDF without the viewer even being open (see Marks below). Text editing uses **CodeMirror 6** (MIT,
[licence](https://raw.githubusercontent.com/codemirror/view/main/LICENSE)) as decided before.

Not yet verified, and spiked in slice 3: whether PDF.js's `saveDocument` can write our marks into
a copy for **Save annotated copy**. If it cannot cleanly, that button ships later; nothing else
depends on it.

## What already exists to build on

- `src/host/attachments.ts`: host-owned copies, image thumbnails, and PDFs read with poppler
  (`pdfinfo`, `pdftotext`, `pdftoppm`). The library reuses this rather than adding a PDF parser to
  the host.
- `src/main/browser-downloads.ts`: browser downloads, the second source of files.
- The artifact panel (`ArtifactPanel.tsx`) and `npm run open`: where plans and mockups open today.
- `src/shared/app-map.ts` and the renderer dispatcher: places and actions shared by the UI's buttons
  and `rocket_ui_go` / `rocket_ui_act`.

## Data model (host, SQLite in `store.ts`)

`library_files` (built; the plan's name was `library_entries`): one row per file known by path. Attachments
are not rows; the shelf reads them live from the store.

| Field | Notes |
| --- | --- |
| `seq` | Built. Autoincrement key; `path` is unique. |
| `path` | Absolute path on disk. |
| `kind` | `pdf`, `markdown`, `text`, `image`, `office`, `other`. Built. |
| `source` | Built as `attachment`, `download`, `plan`, `opened`, `generated`. There is no `capture` source: captures are attachments. `generated` entries are not rows either: they are attachments a model's `image` item holds. |
| `origin` | Built. Host name for downloads, folder for plans. |
| `chat_id` | Built. The chat it arrived in, if any. |
| `size` | Built. `pages`, `width`, `height` are not stored; the viewer reads them when needed. |
| `added_at` | Built. `modified_at` is not stored. |
| `preview` | Not a column. Previews are cached on disk under the profile's `library-previews/`. |

`library_marks` (not built): the user's and models' marks, one table for both.

| Field | Notes |
| --- | --- |
| `entry_id`, `id` | |
| `author` | `user` or a provider id. |
| `type` | `highlight`, `note`, `region`, `ink`. |
| `anchor` | JSON: `{ page, quote, quads }` for PDFs, `{ from, to }` lines for text, `{ x, y, w, h }` (fractions) for images. |
| `body` | The note's text, optional. |
| `created_at` | |

Marks live in the store, not in the file, so downloads and attachments are never rewritten.
This replaces the earlier "sidecar JSON" wording; one store is easier to query and back up. The
mock's note about `react.pdf.marks.json` changes to match.

## Where entries come from

1. **Attachments**: every existing and new attachment (backfilled once on first start).
2. **Downloads**: `browser-downloads.ts` reports each finished download to the host on the
   existing main → host channel (bytes stay on disk; only the path and URL cross).
3. **Plans and opened files**: anything opened in the artifact panel or with `npm run open`, and
   `.md` files a turn creates under the workspace's `docs/`.
4. **Captures**: screen captures saved into a chat. Built as attachments, so they arrive through source 1.
5. **Generated pictures**: images a model made (Codex's image generation). Stored as attachments
   but listed as `generated`, with the provider as their origin: the user did not attach them, and
   "Made by a model" is where someone looks for them again.

The scope is these five only. There's no crawl of the disk, and nothing outside the workspace roots
and the attachment store unless it came in through one of them.

## Previews

Generated by the host on index, cached beside the attachment store, never blocking the UI:

- **PDF**: page 1 with `pdftoppm -singlefile -hide-annotations`, built at 480px wide (`PREVIEW_WIDTH` in `src/host/library.ts`; was 420px in the plan).
- **Image**: a resized JPEG through the existing thumbnail path.
- **Markdown/text**: no image. The card renders the file's first lines with the app's markdown
  renderer inside a scaled page. It stays crisp and needs no browser in the host.
- **Office**: the thumbnail the file carries (`docProps/thumbnail.jpeg` in the zip) when present,
  otherwise a type card.

The card shows a skeleton until its preview arrives; at most two previews render at once.

## Tools (one MCP file, `src/host/tools/library.ts`)

| Tool | Does |
| --- | --- |
| `library_list` | Built. Entries matching `{ source, kind, chat, added, q }`, newest first, with ids. `marked` is not built, since there are no marks. |
| `document_text` | Not built. A file's text, or one page of a PDF (from `pdftotext`), so a model can read before it marks. |
| `document_mark` | Not built. Adds a mark. For a PDF, the model gives a page and the exact quote; the host finds its word boxes with `pdftotext -bbox` and stores the quads. For text, a line range; for an image, a region. |
| `document_marks` / `document_unmark` | Not built. Lists or removes marks, the user's included. |

Showing things is the app map's job, not a tool's:

- **Places**: `library` (`{ source, kind, chat, q, view }`, built; `marked` is not) is built.
  `library.file` (`{ id, page, line, mark }`) is not built.
- **Actions**: `library.clear` and `library.open { id }` are built. `library.filter` is not built:
  filters are parameters of the `library` place instead.

Opening a file at page 4 is `rocket_ui_go library.file`, the same path as a click. Editing a plan
stays an ordinary file edit; the editor follows the file on disk.

## Renderer

- Built: rail button and side panel `library` (added to the `side` union in `types.ts`, state in
  `store.ts`).
- Built: `LibraryPanel.tsx`: filter rail, grid, list, search, as in the mock; previews load as cards
  near the viewport. Not built: grid virtualisation past ~200 entries.
- Not built: `LibraryViewer.tsx`. Opening a card uses the side panel's existing text, Markdown, PDF
  (first 12 pages) and picture views (`library.open`). The per-kind views below are the plan:
  - `PdfView`: PDF.js pages, text layer and marks overlay; filmstrip; highlight, note and ink tools.
  - `TextView`: CodeMirror 6, Source/Preview, outline, line marks as decorations.
  - `ImageView`: fit/zoom, region marks, chat filmstrip.
  - `OfficeView`: preview card and Open in default app.
- `MarksPanel.tsx` (not built): the inspector list; clicking a mark scrolls to it, as `library.file { mark }`
  does.

## Status

**Slice 1 shipped (2026-10-06).** What changed from the plan as written:
- Attachments are not copied into a table: the shelf reads sent attachments live from the store,
  and only files known by path (downloads, plans, opened files) are rows, in `library_files`.
  There is no backfill to run.
- Captures are attachments, so they show as attachments; there is no separate capture source.
- "Opened from chat" is a fourth source: a file a link or `npm run open` showed.
- The app map has the `library` place (filters as parameters) and `library.clear` and
  `library.open {id}` actions. `library.open` uses the existing side panel until the viewers in
  slice 2, which add the `library.file` place.
- No grid virtualisation yet; the cards ask for previews only as they scroll near, which holds up
  to a few hundred files.
- Checked 2026-10-09: the slice 1 check is `tests/ui/library.spec.ts` (filters the shelf and opens a
  file beside the chat). Slices 2 to 4 remain open as listed in the status note above.

## Slices

1. **Index and grid.** Tables, the four sources with backfill, preview generation, `LibraryPanel`
   (filters, search, grid, list), rail button, `library` place and actions, `library_list`.
   Opening a card uses the existing artifact panel for now.
   Check: store and indexer unit tests; a `check:ui` scenario with fixture files that filters to
   PDFs and back.
2. **Viewers.** `PdfView` (PDF.js), `TextView` (CodeMirror 6, follows disk), `ImageView`,
   `OfficeView`, `library.file` place, `document_text`.
   Check: open each kind from the grid and by `rocket_ui_go`, go to a page and a line.
3. **Marks.** `library_marks`, anchoring by quote, the user's mark tools and `MarksPanel`,
   `document_mark` / `document_marks` / `document_unmark`, and the Save annotated copy spike.
   Check: anchoring unit tests against a fixture PDF; a UI scenario where a controlled provider
   marks a quote and the overlay lands on the right words.
4. **Finish.** Keyboard and focus throughout, missing-file and moved-file states, empty states,
   README and app-map docs, and an eval scenario run on real providers (only with the user's
   go-ahead, since it spends usage).

## Risks

- **PDF.js in Electron with Vite**: the worker needs its own entry. This is known territory, but
  slice 2 starts with it.
- **Large PDFs**: render pages lazily and only near the viewport. `pdftotext` per page, not per
  file, for `document_text`.
- **Quote anchoring**: hyphenation and ligatures break exact matches. The plan is to normalise
  whitespace, hyphens and ligatures before matching, and to return the nearest candidates when
  nothing matches, so the model can retry.
- **Moved or deleted files**: the entry stays with a "file not found" state and a Locate button.
  Marks are kept.
