# Round 1 research (Claude): host architecture, provider lifecycle, cancellation, crash recovery

Marker: `[rocket-research:2026-10-08T04-03-41-819Z:1:research:claude:1]`
Written 2026-10-08 (times below are UTC unless marked EDT). Research only; no application
source was changed. Evidence files are in `evidence-claude/`.

Environment inspected (`evidence-claude/versions.txt`): Claude Code 2.1.293, Agent SDK 0.3.293,
codex-cli 0.161.0, cursor-agent 2026.10.01, agy 1.3.1, Electron 44.5.1, Node 24.13.1, git 2.55.0.

## 1. Summary of claims

Each claim has a stable id for reviewers. **O** = observed (code, data, or an experiment);
**H** = hypothesis or inference not yet shown.

| Id | Claim | Kind |
| --- | --- | --- |
| C1 | The project repository has been unusable for commits since the machine's unclean shutdown on 2026-10-06 15:00:26Z, which struck in the middle of Rocket's own per-turn commit. HEAD points at an empty object; 13 loose objects are zero bytes; every Rocket commit attempt since the reboot (15 journal warnings, 2026-10-08 02:37Z onward; one earlier warning on 2026-10-06 was an unrelated temp-file pathspec) failed with `bad object HEAD`. Work since the last intact commit (85 files) is on disk but uncommitted. | O |
| C2 | Git's default `core.fsync` excludes loose objects and, per its own documentation, "risks losing recent work in the event of an unclean system shutdown". Rocket's `git.ts` passes no fsync setting, so the app's automatic commits inherit that risk. | O |
| C3 | Commit failures reach only the journal. Nothing in the window says commits have stopped; the self-check nudge needs `ROCKET_SELF_CHECK=1`. | O |
| C4 | In the same shutdown, the SQLite transcript (WAL, `synchronous=NORMAL`) kept the last turn's end, its changes record and its session mark, while the journal's last append was zero-filled. SQLite documents that NORMAL in WAL mode may lose the last transactions on power loss; this instance did not. | O |
| C5 | A host crash does not leave orphaned provider CLIs: codex app-server, cursor-agent acp and agy all exit within one second of their spawner's SIGKILL (isolated experiment). My prior hypothesis, based on the detached process groups, was wrong. | O |
| C6 | Main restarts a dead host immediately with no backoff or limit; a host that dies at startup would loop. Never seen in practice (zero `restart` entries in the journal). | O code / H behaviour |
| C7 | With two Antigravity chats answering at once, every tool call from either arrives with `chatId: null`: `ask_user` refuses, `remember` saves to no folder, sources and downloads are not attributed, the ledger loses the turn. Cause: the shared MCP URL is resolved through `Hub.runningChat`, which returns null unless exactly one chat of that provider is live. | O code |
| C8 | Stop has no escalation. Cursor's stop is a notification and the prompt request waits up to 60 minutes; Codex's turn waits for `turn/completed` with no deadline, and a rejected `turn/interrupt` ends the turn locally while the server may still run it; the hub never retires a process that ignores a stop. | O code / H behaviour |
| C9 | A Claude Code follow-up (after background work) is dropped when its chat is busy with another provider's turn. | O code |
| C10 | A turn's end is written as several separate SQLite statements (turn, items, session mark, patch); no transaction groups them. After a power loss the session mark can lag the turn, and the provider would then be handed its own turn as a missed one. | O code / H effect |
| C11 | Three adapter headers cite CLI or SDK versions older than what is installed (Claude 2.1.289 vs 2.1.293, SDK 0.3.285/0.3.289 vs 0.3.293, codex 0.160.0 vs 0.161.0, agy 1.2.17 vs 1.3.1). Their contracts have not been re-verified since the upgrades. | O |
| C12 | Of the nine items in `docs/research/provider-updates-2026-10.md`, six have landed (steering, Cursor extension replies, plan items, images, undo, token readings); reasoning-effort control, hunk comments and Codex's reviewer have not; the context meter is recorded but not shown in the window. | O |
| C13 | `endTurn` forces a fresh usage read after every turn; for Antigravity that spawns `agy -p /quota` each time. | O code |

## 2. What this round adds or corrects

- `docs/research/provider-updates-2026-10.md` (5 October) is the only prior research on this
  area. It described the composer as disabled during a turn and listed nine proposals. Six are
  now implemented (C12), so that document is partly historical; see §9 for the mapping.
- The README's architecture sections match the code everywhere I traced (§3). The one place the
  README is silent is the failure path of its own commits (C1, C3).
- The protocol's setup notes asked for `src/main/index.ts` and `src/main/ui-connection.ts` to be
  examined for the `DevToolsActivePort` discovery problem. That belongs to the product and
  reliability track; I did not take it on.

## 3. Architecture as verified in code

The README's picture holds: renderer and host talk over a MessagePort that main brokers once
(`src/main/index.ts:124-129`, `src/renderer/src/host.ts:17-33`), the host owns the store and
adapters (`src/host/index.ts:70`, `:188-198`), and main does browser work on the host's behalf
over `parentPort` (`src/host/index.ts:126-137`, `src/main/index.ts:65-107`).

Turn lifecycle (`src/host/hub.ts`):

- One turn per chat, enforced synchronously before any await (`hub.ts:218`), so two sends in one
  tick cannot both start. Turns of different chats run concurrently, including on one provider.
- The provider's session id is saved the moment the adapter reports it (`hub.ts:592-597`), and
  what the session has seen moves only at the turn's end (`hub.ts:647-649`): a failed turn that
  produced any assistant, reasoning or tool item counts as seen, so it is not handed back.
- A lost session is retried once with a full handoff built from turn 0 up to the current turn
  (`hub.ts:524-533`); a second loss becomes a failed turn (`hub.ts:537`).
- Queued messages drain in a microtask after the end event (`hub.ts:655`), and each end forces a
  usage read (`hub.ts:667`, C13).
- Unprompted turns are opened only for an idle chat (`hub.ts:548`), with a notice item saying
  what woke the provider (`hub.ts:560`).

Process model per provider:

| Provider | Process | Session unit | Stop | Session-lost detection |
| --- | --- | --- | --- | --- |
| Claude | one SDK `query()` per chat, plus a spare and a probe; idle 15 min, at most 3 idle (`claude.ts:66-75`) | `resume` id | `interrupt({cancelQueued:true})`; on rejection the process is retired (`claude.ts:345-353`) | regex on stderr and error text (`claude.ts:609`, `:831`) |
| Codex | one app-server for all chats (`codex.ts:14-15`) | thread | `turn/interrupt` request (`codex.ts:185-192`) | `thread/resume` rejected while connected (`codex.ts:291-297`) |
| Cursor | one ACP process for all chats | ACP session | `session/cancel` notification (`cursor.ts:225-228`) | `session/load` rejected while connected (`cursor.ts:323-329`) |
| Antigravity | one `agy` per chat plus a spare (`antigravity.ts:53-57`) | conversation id, resumed by a fresh process | kill the process group (`antigravity.ts:217-222`) | exit before any event on a resumed conversation (`antigravity.ts:349-351`) |

Every CLI is spawned in its own process group (`process-tree.ts:15-17`) so a stop reaches the
worker behind a wrapper, and all tracked groups are SIGKILLed when the host exits normally
(`process-tree.ts:42-51`, `src/host/index.ts:441`). The SDK spawns `claude` without detaching: in
the live process list it shares the host's group (`evidence-claude/provider-processes.txt`).

Shutdown order (`src/host/index.ts:413-427`): goals, fills, UI runs, then the hub's stops raced
against 1.5 s, then SIGKILL of every group. Main gives the host 3 s before killing it
(`src/main/index.ts:304-317`).

## 4. Crash recovery: a natural experiment and the designed paths

### 4.1 The 2026-10-06 unclean shutdown (C1, C2, C4)

Evidence: `evidence-claude/git-state.txt`, `journal-summary.txt`, the two read-only scripts.

- `journalctl --list-boots` shows boot −1 ending 2026-10-06 11:00:15 EDT and the next boot on
  2026-10-07 14:16:57 EDT; `last -x` records no shutdown between them. The machine stopped
  uncleanly.
- The transcript holds a Cursor turn that ended 15:00:25.904Z with its `changes` record and the
  Cursor session's `seen_turn_seq` equal to that turn's `seq` (`session-after-crash.mjs`). All
  three writes after the turn's end survived.
- `.git/COMMIT_EDITMSG` is that turn's commit message, and the 13 empty object files were created
  15:00:25.97Z to 15:00:26.12Z, that is while `commitPaths` (`src/host/git.ts:109-119`) was
  writing the commit. `refs/heads/main` was updated to the new commit id, whose object is empty.
  The reflog's final record is a block of NUL bytes; the last readable entry (10:57:24 EDT) is
  commit `75c152d1`, which is intact.
- The journal's last entry before the gap is a Claude timing line at 14:57:23Z; the next bytes
  are one NUL-filled line, exactly where the Cursor turn's timing line would have been
  (`journal.ts:56` appends without fsync). `parseEntries` skips it (`journal.ts:62-70`).
- Since the reboot, every commit attempt in this repository failed: 15 journal warnings from
  2026-10-08 02:37Z to 04:11Z, all `fatal: bad object HEAD` or `unable to read tree`. Snapshots,
  diffs and undo still work, because `write-tree` through `rocket-index` never reads HEAD
  (`git.ts:46-57`); only `git status` and `git commit` fail. The working tree differs from
  `75c152d1` by 85 files, 2457 insertions and 1078 deletions, all uncommitted.

Why git lost the objects: the opened git source documentation for `core.fsync` says the default
"on most platforms is equivalent to `core.fsync=committed,-loose-object`, which has good
performance, but risks losing recent work in the event of an unclean system shutdown". Loose
objects were created but their data never reached disk (ext4 delayed allocation leaves
zero-length files), while the ref rename did. `git.ts:17-27` sets no `-c core.fsync`.

Why SQLite survived: the opened SQLite pragma page says WAL mode "is always consistent with
synchronous=NORMAL, but WAL mode does lose durability. A transaction committed in WAL mode with
synchronous=NORMAL might roll back following a power loss or system crash." Here the WAL writes
landed before the crash; that is luck of timing, not a guarantee. `store.ts:132` sets NORMAL.

Repair recipe (not executed; this is the user's call, and it rewrites a ref):

1. Copy `.git` aside.
2. Delete the 13 zero-byte files listed in `git-state.txt`.
3. `git update-ref refs/heads/main 75c152d1835f942c5afc4547e563132ceb6c9cec`.
4. `git fsck --no-dangling` should be clean; `git status` then lists the 85 files as changes,
   and the next completed Rocket turn (or one manual commit) records them. Nothing on disk is
   lost: the lost commit's content and everything since is in the working tree. What cannot be
   recovered is the lost commit as a separate history entry.

### 4.2 Host crash while a turn runs

Designed path, traced: main hears `exit`, writes a `restart` journal line, forks again and hands
the renderer a new port (`src/main/index.ts:108-119`); the new host marks every `running` turn
`interrupted` as it opens the store (`store.ts:139`); the renderer rejects requests in flight
and reloads from the store (`src/renderer/src/host.ts:22-30`, `src/renderer/src/store.ts:1063-1072`);
goals in a running state pause with a reason (`goals.ts:469-479`); the ledger interrupts calls
left open by the previous host (README, Tool-call history). `tests/ui/recovery.spec.ts:45-75`
exercises this with SIGKILL and expects the `Stopped` notice and exactly one journal entry.

What the test cannot show is the fate of real provider children, since the test adapter spawns
none. `evidence-claude/orphan-check.mjs` spawns each CLI the way Rocket does (own process group,
piped stdio, same arguments, no model turn) from a wrapper process, SIGKILLs the wrapper, and
polls the CLI's pid:

```
codex app-server: pid 75429 pgid 75429; before wrapper SIGKILL: alive; after, per second: gone gone gone gone gone gone gone gone
cursor-agent acp: pid 75501 pgid 75501; before wrapper SIGKILL: alive; after, per second: gone gone gone gone gone gone gone gone
agy stream-json:  pid 75566 pgid 75566; before wrapper SIGKILL: alive; after, per second: gone gone gone gone gone gone gone gone
```

All three exit on stdin EOF (C5). Limitations: idle processes only; a CLI mid-turn with a child
shell running was not tested, and `claude` was not tested because starting it standalone risks a
model call. The live process list shows no orphans from earlier sessions either.

Gap (C6): `src/main/index.ts:108-119` restarts unconditionally. A host that exits during
startup (store unwritable, port in use, a thrown migration) would be respawned in a tight loop,
each pass appending a journal line. Not observed; the journal has no `restart` entries at all.

### 4.3 Durability of a turn's end (C10)

`endTurn` writes the turn (`hub.ts:643`), then the session mark (`hub.ts:649`), and teamwork
later writes the patch; `store.ts` has no transaction wrapper (no `BEGIN` or `transaction` in the
file). A power loss between the first two leaves a completed turn whose provider session is
marked as not having seen it, so the next message to that provider hands it its own reply as
another assistant's. The 6 October crash happened to land after all three writes.

## 5. Cancellation (C8)

- Claude: `interrupt({cancelQueued: true})` is the SDK's documented "Stop-means-stop-everything"
  path (`sdk.d.ts:4624`, capability `interrupt_cancel_queued_v1`, `sdk.d.ts:6013`). A rejected
  interrupt retires the process (`claude.ts:345-348`), which is the escalation the other adapters
  lack. A turn waiting only on background tasks ends at once (`claude.ts:340-344`).
- Codex: `turn/interrupt` is a request; the opened app-server docs say "On success, the turn
  finishes with `status: "interrupted"`", which the adapter waits for (`codex.ts:366-373`). If
  the request is rejected or times out (30 s default, `stdio-json-rpc.ts:111`), the adapter ends
  the turn locally as interrupted (`codex.ts:188-190`) although the server may still be running
  it; a later `turn/completed` for it is ignored (`codex.ts:316-317`), and what `turn/start` does
  on a thread with an active turn is not covered by the documentation I could open. If the
  interrupt request succeeds but no `turn/completed` ever arrives, the turn stays running with
  no deadline.
- Cursor: `session/cancel` must be a notification (adapter header; ACP page opened: the agent
  "MUST respond to the original `session/prompt` request" with `cancelled`). Rocket relies on
  that entirely: the prompt request's own timeout is 60 minutes (`cursor.ts:51`), and nothing
  kills the process if the agent ignores the cancel.
- Antigravity: no protocol interrupt; the process group is killed and the conversation resumes
  in a new process (`antigravity.ts:217-222`, header lines 29-30).
- Hub: `stop` awaits the adapter and nothing else (`hub.ts:446-451`); `shutdown` races all stops
  against 1.5 s before SIGKILL (`src/host/index.ts:421-422`). There is no "stop requested N
  seconds ago and the turn is still running" rule in ordinary operation.

## 6. Concurrency

- Chats: one turn each; many chats per provider at once. Eval cells additionally wait while any
  turn of their provider runs (`eval-runs.ts:111-114`), because of C7.
- Antigravity (C7): its MCP server is registered once in agy's global config at the `shared`
  URL (`antigravity.ts:263-276`, `channel.ts:24`). The channel maps that key through
  `runningChat` (`channel.ts:110`), which returns a chat only when exactly one chat of the
  provider is live (`hub.ts:105-108`). With two, `chatId` is null: `ask_user` returns an error
  (`tools/ask.ts:82`), `remember` stores a note with `cwd` undefined (`tools/memory.ts:30`),
  browser tools pass `chat: null` and `onOpen(null)` so the turn's sources record stays empty
  (`tools/browser.ts:70-82`, `hub.ts:704-707`) and its citations are later reported unopened,
  and the ledger records no turn (`src/host/index.ts:162-165`). No test covers the null path.
- Teamwork serializes git work per repository top (`teamwork.ts:234-238`) and excludes files
  another running turn edited (`teamwork.ts:128-131`), as the README says.
- Codex and Cursor share one process across chats; both clear their per-chat maps when the
  process exits (`codex.ts:388-392`, `cursor.ts:282-285`), and pending requests are rejected by
  the transport (`stdio-json-rpc.ts:204-214`), so every chat's turn fails together. The Codex
  adapter does not handle `thread/closed` or `thread/status/changed`; the app-server docs say a
  thread stays loaded "until it has no subscribers and no thread activity for 30 minutes", and
  Rocket's connection subscribes, so this should not bite while the process lives (H).
- Claude's background follow-ups (C9): when the chat is busy with another provider,
  `openUnprompted` returns null (`hub.ts:548`) and the adapter ignores the stream
  (`claude.ts:578-579`); `runtime.woke` is kept, so a later follow-up names both reasons. The
  README's "gets a turn of its own" holds only for an idle chat.

## 7. Session handoff

Verified against `handoff.ts` and `store.ts:380-392`: the handoff is the turns with `seq` above
the session's mark, built in one query (`hub.ts:671-675`), 30,000 characters, newest three whole.
Two edge cases found:

- A turn cut off by a crash is marked `interrupted` (`store.ts:139`) but its provider's mark is
  not advanced, so that provider receives its own partial turn in the next handoff, under a
  heading that calls it another assistant's turn (`handoff.ts:62-64`). Cosmetic but misleading.
- Session-lost detection is heuristic for Claude (`claude.ts:609` matches stderr text) and for
  Antigravity (`antigravity.ts:351`: any exit before an event on a resumed conversation). The
  opened Claude sessions page confirms sessions live under `~/.claude/projects/<encoded-cwd>/`
  and that since 2.1.223 resume looks beyond the current project directory, which narrows the
  "not found" case to deleted transcripts.

## 8. Long-running orchestration

- Goals (`goals.ts`) are the in-host loop: draft, work, check, with retries (`goals.ts:256-270`),
  usage pauses (`goals.ts:364-381`) and restart recovery (`goals.ts:469-479`). It is driven by
  turn-end events, not by `waitForTurn`.
- `waitForTurn` (`hub.ts:129-151`) defaults to 600 s and is used only by eval cells
  (`eval-run-cell.ts:93`) with their own timeout. Research turns here run far longer (one Claude
  turn in the journal took 1139 s), so any future orchestration must not inherit that default.
- The continuous research loop is an external Node supervisor that drives the composer and reads
  `rocket.db` read-only (`scripts/research-loop.mjs:194`, `:251`). That is consistent with the
  rule that nothing outside the host writes the store. An in-host equivalent would be a
  `GoalHub`-shaped program API (`goals.ts:25-31` already narrows what a loop needs: create,
  send with a role, stop, usage, items).

## 9. Prior research mapped to the code (C12)

| Item (5 Oct) | Now |
| --- | --- |
| 1 steer a running turn | `Hub.post` (`hub.ts:264-290`), `claude.ts:356-366`, `codex.ts:194-209` |
| 2 answer Cursor's own requests | `CURSOR_EXTENSIONS` (`cursor.ts:497-509`) |
| 3 one plan item | `planItem` (`provider.ts:126-137`) used by all three |
| 4 context meter | `Turn.tokens` recorded (`hub.ts:607`), summarized in the journal; no renderer component reads `contextWindow` (grep) |
| 5 images | README "Images and files in chat" |
| 6 undo | `teamwork.undo` (`teamwork.ts:191-219`) |
| 7 hunk comments, 8 effort control, 9 Codex reviewer | no implementation found (`effort` only in Cursor model-id parsing; no `review/start`) |
| approvals | still bypassed everywhere (`claude.ts:116-117`, `codex.ts:282-283`, `cursor.ts:486-491`, agy flag) |

## 10. Adapter headers versus installed versions (C11)

| Adapter | Header says verified against | Installed |
| --- | --- | --- |
| `claude.ts` | SDK 0.3.285 / 0.3.289, CLI 2.1.289 (5 Oct) | SDK 0.3.293, CLI 2.1.293 |
| `codex.ts` | codex-cli 0.160.0 (5 Oct) | 0.161.0 |
| `cursor.ts` | cursor-agent 2026.10.01 (5 Oct) | 2026.10.01 |
| `antigravity.ts` | agy 1.2.17 (5 Oct) | 1.3.1 |

`CLAUDE.md` asks that a header be fixed when a CLI's behaviour is re-verified or changes. Nothing
in the journal suggests breakage (no `turn-failed` entries at all in 382 turns; the store holds
391 completed, 22 interrupted, 0 failed turns), so this is a documentation debt, not a defect.

## 11. Actionable upgrades, with acceptance checks

1. **Repair the repository** (user action, recipe in §4.1). Check: `git fsck --no-dangling`
   clean; the next completed turn's commit appears in `git log`.
2. **Harden Rocket's commits.** Add `-c core.fsync=committed,reference -c core.fsyncMethod=batch`
   to the `git()` invocations that write (`git.ts:17-27`, or only in `commitPaths`). Check: a
   unit test that the commit command line carries the settings; a note in the README's
   "Several assistants, one folder" section. Cost is one batched flush per commit.
3. **Surface repeated commit failures.** When `teamwork.turnEnded` fails for the same top twice
   running, add a `notice` item to the turn (tone `error`) with the first line of git's message
   and, for `bad object`/`is empty`, a pointer to the repair steps. Check: hub or teamwork unit
   test with a fake `git` that fails; the notice appears once per failure streak, not per turn.
4. **Serialize Antigravity turns, or key its tool URL per chat.** Short term: the hub refuses
   or queues a second concurrent Antigravity turn, as eval cells already do. Longer term:
   register one server name per chat (`agy mcp add rocket-<id> <url>`) so the URL carries the
   chat. Check: a `ToolChannel` unit test where `runningChat` returns null must not reach the
   `ask_user` error path; a two-pane Antigravity scenario in `check:ui` with the test adapter
   extended to use the shared key.
5. **Stop escalation in the hub.** After `adapter.stop` resolves, if the turn is still live
   after a bounded wait, call `adapter.forget(chatId)` (retires Claude and agy processes; for
   Codex and Cursor add a forced variant that restarts the shared process) and end the turn
   locally as interrupted. Check: hub unit test with an adapter whose `stop` resolves but whose
   `run` never settles.
6. **Codex interrupt rejection.** On a rejected `turn/interrupt`, keep the turn tracked for a
   bounded time waiting for `turn/completed` instead of ending it at once, and journal the
   case. Check: extend `codex.test.ts` ("early Stop waits for the Codex turn ID").
7. **Group a turn's end in one transaction** (`updateTurn`, `setSession`, final items). Check:
   store unit test reading both after a simulated throw between them; `bench:transcript`
   unchanged.
8. **Restart backoff in main.** Count host exits per minute; after three, wait before the next
   fork and show the renderer an error. Check: isolated run with `ROCKET_DATA_DIR` pointing at
   an unwritable directory ends with one visible error, not a journal flood.
9. **Hold a Claude follow-up for a busy chat.** Keep the unprompted stream in the adapter until
   the chat frees, then open the turn, or at least record a notice in the live turn. Check:
   extend `hub.test.ts` "a turn the provider starts by itself".
10. **Re-verify and update adapter headers** against the installed versions, ideally with
    `USAGE=1 TURNS=0 npm run check:live` (no model turns) plus one authorized live conversation
    per provider.
11. **Consider `synchronous=FULL`** for the store, measured with `npm run bench:transcript`
    first; the gain is durability of the last transaction across power loss, which §4.1 shows
    was not needed once but is not promised.
12. **Reuse the usage reading after a turn** instead of forcing one (`hub.ts:667`), or skip it
    for providers whose read spawns a CLI (Antigravity). Check: journal shows no `agy -p /quota`
    cost per turn; the ring still refreshes within a minute.

## 12. Checks run and their limits

- Read-only SQLite queries over the live profile (`transcript-crash-window.mjs`,
  `session-after-crash.mjs`); the database was open by the running app, so counts include the
  two turns in flight at the time.
- Journal parsed in full; 1 unparseable line (the NUL block).
- `git fsck`, `git cat-file`, `git diff --stat`, `journalctl --list-boots`, `last -x`, `ps`: all
  read-only.
- `orphan-check.mjs`: started each CLI once with no prompt and killed it; no model turn, no
  change to any config. Not run for `claude`.
- No unit or UI suite was run this round (nothing changed; results would repeat the last run).
- Codex app-server documentation: the page is 140k characters; two windows were read. The
  `willRetry` field the adapter relies on (`codex.ts:361`), thread unload details and behaviour on
  client disconnect were not found in what I read, so those remain unverified here.

## 13. Primary sources opened (2026-10-08)

- https://www.sqlite.org/pragma.html#pragma_synchronous
- https://raw.githubusercontent.com/git/git/master/Documentation/config/core.adoc
- https://www.electronjs.org/docs/latest/api/utility-process (says nothing about transferred ports after exit)
- https://learn.chatgpt.com/docs/app-server (redirect target of developers.openai.com/codex/app-server; partially read)
- https://agentclientprotocol.com/protocol/prompt-turn
- https://agentclientprotocol.com/protocol/session-setup
- https://code.claude.com/docs/en/agent-sdk/sessions
- Local: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (0.3.293), installed CLIs' `--version`.

Not opened: https://git-scm.com/docs/git-config (the rendered page exceeded the fetch window; the
source file above is the same text).

## 14. Unresolved questions

1. Does `turn/start` on a Codex thread whose previous turn is still active (after a rejected
   interrupt) fail, queue, or run concurrently? Needs the rest of the app-server docs or a live
   check.
2. What does cursor-agent do when `session/cancel` arrives mid tool call: does the prompt
   request return `cancelled` promptly in practice, and after how long?
3. Does a `claude` process spawned by the SDK exit on stdin EOF the way the other three do, and
   what happens to a shell it had running?
4. Is the `error` notification's `willRetry` field still emitted by codex-cli 0.161.0, and is it
   documented anywhere?
5. How often does the store's non-transactional turn end actually leave a stale session mark?
   A crash-injection unit test (throw between the two writes) would show the consequence.
6. Would agy accept a per-process MCP configuration today (1.3.1), which would remove the shared
   URL and C7 altogether?
