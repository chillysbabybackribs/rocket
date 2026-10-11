# Long chats: audit and plan

How Rocket handles a chat with a long history, what it costs today, and the changes that would
make a 1,000-turn chat open as fast as a short one. Measured 6 October 2026.

> **Status, 9 October 2026.** All five steps are built, and the budgets are assertions in
> `tests/ui/long-chat.spec.ts`. Done: the turn index `items_by_turn` (`src/host/store.ts`) and
> `turnsWithItems`, which `handoffFor` uses (`src/host/hub.ts`); `runningTurn`; the paged
> `chat.older` / `olderTurns`; `outputLength` with `item.output` (`src/host/hub.ts`,
> `Transcript.tsx`); `pruneViews` keeping open tabs (`src/renderer/src/store.ts`); the parsed
> markdown cache of 600 texts (`ChatMarkdown.tsx`); the README's Long chats section. Open: nothing
> in steps 1 to 5. Corrections: the page size built is 20 (`TURN_PAGE` in `src/shared/types.ts`),
> not 30; `turnItems` is indexed now, but `teamwork.ts`, `goals.ts` and `fill.ts` still call it
> once per turn. The measurements below are the 6 October runs and were not repeated.

## How a chat reached the screen on 6 October (before the steps below)

This is the baseline, kept as measured. The code now differs: the host sends one page, and the
renderer keeps open tabs (see the status note above).

1. **Host** (`src/host/store.ts`, `snapshot`, then at 6 October `store.ts:181`): one query read
   every item of the chat, parsed every row's JSON and returned the whole chat to `hub.openChat`.
2. **Port**: the whole snapshot crossed the MessagePort to the renderer.
3. **Renderer** (`src/renderer/src/store.ts`, `showChat`, then at `store.ts:410`): every item went
   into the item map, and `Transcript` mounted a `TurnBlock` for every turn. Every final reply was
   parsed as markdown. `.turn { content-visibility: auto }` skipped layout and paint for off-screen
   turns, but not the React render or the markdown parse.
4. **Tab switch**: `pruneViews` dropped the chat that was no longer shown, along with its items, so
   switching back repeated steps 1 to 3 in full. It now keeps the chats of every open tab.

Streaming is already handled well. Deltas are not written to SQLite, each one re-renders one row
(`useItem`), and the host batches events to one message per frame. None of the problems below
come from streaming.

## Real data

From the live profile's store: 58 chats, 262 turns, 5,215 items, 9.4 MB. The largest chat has
45 turns, 960 items and 2.0 MB. Tool output makes up 85 to 90% of the bytes (`command` 3.1 MB,
`edit` 2.8 MB, `read` 1.5 MB). The transcript shows that output only when a step is expanded.
The synthetic chats in the benchmark copy this shape: about 20 items and 36 KB per turn.

## Baseline

Host (`npm run bench:transcript`, median of 5):

| turns | items | stored | open: store read | open: sent | open: clone | attachment sweep | full handoff |
|---|---|---|---|---|---|---|---|
| 45 | 837 | 1.7 MB | 28 ms | 1.7 MB | 8 ms | 17 ms | 106 ms |
| 250 | 4,710 | 9.8 MB | 64 ms | 9.8 MB | 21 ms | 48 ms | **2,333 ms** |
| 1,000 | 18,849 | 39 MB | 245 ms | 39 MB | 171 ms | 240 ms | **27,032 ms** |

Window (`npm run check:ui -- long-chat`, isolated app, timed in the page from the click to two
frames after every turn is in the DOM):

| turns | open | longest task | switch back | longest task | scroll to top | DOM nodes |
|---|---|---|---|---|---|---|
| 45 | 249 ms | 207 ms | 338 ms | 285 ms | 23 ms | 1,387 |
| 250 | 994 ms | 827 ms | 916 ms | 762 ms | 8 ms | 6,981 |
| 1,000 | 3,023 ms | 2,563 ms | 2,948 ms | 2,499 ms | 12 ms | 27,447 |

A CPU profile of the 1,000-turn open (`LONG_CHAT_PROFILE=1`) shows the app's time going to the
markdown parser (micromark's `consume`, `check`, `splice` and `subtokenize`), then DOM creation,
then link detection (`isFilePath`).

## After steps 1 and 2 (6 October 2026)

Steps 1 and 2 below are done: the turn index, the single-query handoff read and an incremental
handoff `fit` that holds to its budget, the small scans, and a paged transcript.

Host, 1,000 turns: a full handoff went from 27,032 ms to **293 ms**, the attachment sweep from
240 ms to 40 ms, and finding the running turn from 9 ms to 0.3 ms. At 250 turns the full handoff
went from 2,333 ms to 59 ms.

Window:

| turns | open (before → after) | longest task on open | switch back | page above | shift | reading to the first turn |
|---|---|---|---|---|---|---|
| 45 | 249 → 174 ms | 207 → 138 ms | 338 → 133 ms | 125 ms | 0 px | 86 ms, longest task 0 |
| 250 | 994 → 126 ms | 827 → 88 ms | 916 → 149 ms | 170 ms | 0 px | 1.3 s over 12 pages, longest task 101 ms |
| 1,000 | 3,023 → 180 ms | 2,563 → 85 ms | 2,948 → 197 ms | 176 ms | 0 px | 7.4 s over 49 pages, longest task 118 ms |

Opening no longer depends on the chat's length. Reading a long chat right back to its start costs
about 150 ms a page, and never freezes the window for more than about 120 ms. The spec now
fails if a chat opens with more than one page, if opening, switching back or any page freezes the
window for 250 ms or more, or if a page put in above moves the reader by more than 2 px. The
paging itself is in the README's Long chats section.

## After steps 4 and 5 (6 October 2026)

Step 4: a page leaves finished tool output out (`outputLength`) and opening a step fetches it
(`item.output`). Reading a page now goes through `items_by_turn`, ordered by turn, instead of
walking the chat's items. Host, 1,000 turns: open read 225 ms → **3 ms**, sent 39 MB → **184 KB**
(the same at every length; 786 KB with the output).

Step 5: the window keeps the chat of every open tab, so going back to one asks the host for
nothing, and a chat read far up goes back to its newest page as it returns. Parsed markdown is
kept for the last 600 texts, so a chat shown again parses nothing.

| turns | first open | its longest task | open again (median of 3) | switch back | its longest task | switch back after reading all | its longest task |
|---|---|---|---|---|---|---|---|
| 45 | 143 ms | 93 ms | 70 ms | 44 ms | 0 | 37 ms | 0 |
| 250 | 106 ms | 86 ms | 63 ms | 87 ms | 0 | 64 ms | 0 |
| 1,000 | 132 ms | 108 ms | 69 ms | 34 ms | 0 | 106 ms | 68 ms |

Against the first baseline at 1,000 turns: open 3,023 ms → 132 ms, switch back 2,948 ms → 34 ms,
and the window never freezes for more than about 110 ms in any of it. Switching back after
reading the whole chat costs a little more, since its other 980 turns are let go then.

Budgets in the spec: one page on open; the median open under 600 ms with no task of 250 ms or
more, the first open's longest task under 400 ms; switching back under 300 ms with no task of
120 ms or more (400 ms after reading everything); no page above freezing for 250 ms or more or
moving the reader more than 2 px; and an opened step showing its output.

All five steps are done.

## Findings, worst first

1. **Full handoffs are quadratic, and they block the host.** Done (step 1). `turnItems`
   (`store.ts:362`) now uses `items_by_turn`, and `handoffFor` reads the missed turns in one query
   (`turnsWithItems`, `hub.ts`). The 6 October finding read: `turnItems` filtered on `turn_id`
   with only `items_by_chat`, so each call scanned the chat. `teamwork.ts` (three calls) and
   `goals.ts` and `fill.ts` still call `turnItems` once per turn; each is now an indexed read.
2. **Opening a chat renders all of it.** Done (step 3). A chat opens with its newest 20 turns
   (`TURN_PAGE`), and older pages come in on scroll (`chat.older`). The 6 October finding read:
   the window froze for 0.2 s on your largest real chat, 0.8 s at 250 turns and 2.5 s at 1,000.
3. **Switching tabs throws the chat away.** Done (step 5). `pruneViews` keeps every open tab's
   chat, and a kept chat goes back to its newest page.
4. **The open payload is mostly hidden tool output.** Done (step 4). A finished tool call crosses
   the port with `outputLength` and an empty `output`; opening the step fetches it. The 6 October
   finding read: at 1,000 turns 39 MB crossed the port, about 35 MB of it folded tool output.
5. **The attachment sweep parses every item of every chat.** Done (step 2). The sweep selects only
   user rows that carry attachments (`src/host/store.ts`, lines 156 to 166). The
   6 October finding read: it parsed every item of every chat (`store.ts:133`), 240 ms at 40 MB.
6. **Small full scans.** Done (step 2). `runningTurn` (`store.ts`) is one query on
   `turns` with a `status` filter, called from the ledger context at `index.ts:166`. Goal rounds
   are precomputed once per render by `roundsOf` (`Transcript.tsx`). The 6 October finding read:
   `store.turns(chatId).findLast(running)` ran on every tool call (`index.ts:151`), and `roundOf`
   ran once per turn on every render.

## Plan

Each step re-runs both benchmarks and records the numbers here.

1. **Index items by turn.** Add `CREATE INDEX items_by_turn ON items(chat_id, turn_id, seq)`, and
   have `handoffFor` read the missed turns' items in one query (`turn_id IN (…)` or
   `seq > first item`) instead of one per turn. Then check `buildHandoff`'s own growth. This is a
   few lines with no protocol change. Target: a full handoff at 1,000 turns under 300 ms.
2. **Small scans.** Add `runningTurn(chatId)` as one indexed query. Make the attachment sweep
   select only user rows that carry attachments
   (`json_extract(data, '$.type') = 'user' AND data LIKE '%"attachments"%'`). Precompute the
   goal rounds once per render.
3. **Page the transcript.** Done. `chat.open` returns the last 30 turns and their items, plus
   `hasOlder` (built with 20, `TURN_PAGE`). A new `chat.older { chatId, beforeSeq, limit }`
   returns the 20 before that (built as `chat.older { chatId, before }`). The
   renderer prepends them when the reader scrolls near the top, keeping the scroll position
   anchored. The protocol changes go in `types.ts` first. The window then only ever mounts what
   has been read. Target at 1,000 turns: open under 300 ms, with no task over 150 ms.
4. **Send tool output on demand.** A tool item crosses the port with `output` empty and an
   `outputLength`, and `Step` asks for the output (`item.output`) when it is expanded. The live
   turn still streams its output as now. Target: the 1,000-turn open payload under 5 MB.
5. **Keep the chats in open tabs.** `pruneViews` keeps the views of every chat open as a tab in
   any pane, not just the ones on screen. A module-level LRU cache of parsed markdown blocks,
   keyed by text, makes a remount cheap. Target: switch back under 100 ms at any length.

Steps 1 and 2 are small and independent. Step 3 is the main change. Steps 4 and 5 build on it.

## The eval

- `npm run bench:transcript`: host timings at 45, 250 and 1,000 turns. `BENCH_TURNS=45,5000`
  picks other sizes. Results are written to `.artifacts/bench/transcript-host-*.json`.
- `npm run check:ui -- long-chat`: the window timings in the isolated app.
  `LONG_CHAT_TURNS=1000` picks the sizes, and `LONG_CHAT_PROFILE=1` saves a `.cpuprofile` of the
  largest open and prints the functions that took the most time themselves. Results are written
  to `.artifacts/bench/transcript-ui-*.json`.
- The generator is `tests/fixtures/long-chat.ts`. It is seeded, so every run measures the same
  chat.

The targets above are assertions in `tests/ui/long-chat.spec.ts` (done), so a regression fails
`npm run check:ui`. `BENCH_TURNS` picks the host sizes (`src/host/transcript-bench.ts`).
