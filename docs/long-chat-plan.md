# Long chats: audit and plan

How Rocket handles a chat with a long history, what it costs today, and the changes that would
make a 1,000-turn chat open as fast as a short one. Measured 6 October 2026.

## How a chat reaches the screen today

1. **Host** (`src/host/store.ts:181`, `snapshot`): one query reads every item of the chat, parses
   every row's JSON and returns the whole chat to `hub.openChat`.
2. **Port**: the whole snapshot crosses the MessagePort to the renderer.
3. **Renderer** (`src/renderer/src/store.ts:410`, `showChat`): every item goes into the item map,
   and `Transcript` mounts a `TurnBlock` for every turn. Every final reply is parsed as markdown.
   `.turn { content-visibility: auto }` skips layout and paint for off-screen turns, but not the
   React render or the markdown parse.
4. **Tab switch**: `pruneViews` drops the chat that is no longer shown, along with its items, so
   switching back repeats steps 1 to 3 in full.

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

## Findings, worst first

1. **Full handoffs are quadratic, and they block the host.** `turnItems` (`store.ts:258`) filters
   on `turn_id`, but the only index is `items_by_chat (chat_id, seq)`, so each call scans every
   item in the chat. A full handoff calls it once per turn: 1.6 s of the 1.9 s at 250 turns, and
   27 s at 1,000. It runs synchronously on the host thread, so every chat freezes, streaming
   included. It happens on a lost session and on the first message to a provider that has seen
   little of a long chat. `teamwork.ts` and `goals.ts` make the same call each turn, at a smaller
   cost. `buildHandoff` itself also grows faster than linear: 280 ms at 250 turns.
2. **Opening a chat renders all of it.** The window freezes for 0.2 s on your largest real chat,
   0.8 s at 250 turns and 2.5 s at 1,000. The cost grows with every turn ever sent, while the
   screen only ever shows the last few.
3. **Switching tabs throws the chat away.** Switching back costs the same as a cold open.
4. **The open payload is mostly hidden tool output.** At 1,000 turns 39 MB crosses the port,
   about 35 MB of it folded tool output.
5. **The attachment sweep parses every item of every chat** (`store.ts:133`) each time the
   renderer reconnects. It grows with all history, not with one chat: 240 ms at 40 MB.
6. **Small full scans.** `store.turns(chatId).findLast(running)` runs on every tool call in the
   ledger's context (`index.ts:151`) and in `waitForTurn` (9 ms at 1,000 turns). In a goal's chat,
   `roundOf` runs once per turn on every transcript render, which is O(turns²).

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
3. **Page the transcript.** `chat.open` returns the last 30 turns and their items, plus
   `hasOlder`. A new `chat.older { chatId, beforeSeq, limit }` returns the 30 before that. The
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

Once steps 1 to 3 land, the targets above become assertions in the spec, so a regression fails
`npm run check:ui`.
