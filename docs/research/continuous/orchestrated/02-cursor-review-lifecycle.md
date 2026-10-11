# Review of round-0001 lifecycle claims C5–C10 and C13, with cancellation and tool-attribution evidence

Written 2026-10-08 by the Cursor worker (retry after the grok-4.7 attempt ended with a transport
error). Research only: no application source, configuration or dependency was changed. Nothing
here restarted Rocket, sent to other chats, or drove the live window.

Evidence lives in `evidence-02-cursor/`:

- `run.ts`: isolated experiments that import Rocket's real `Hub`, `Store`, `CursorAdapter`,
  `CodexAdapter`, `ToolChannel`, `ToolLedger`, `EvalRuns` and handoff code, with fake adapters,
  fake JSON-RPC peers, in-memory or temp databases, and no provider CLI or model call.
  Run: `node --experimental-transform-types --disable-warning=ExperimentalWarning docs/research/continuous/orchestrated/evidence-02-cursor/run.ts`
- `results.json`: the output of the final run (10 s, exit 0; no fake processes were left alive).
- `store-transport-errors.mjs` / `.json`: a read-only query of the live `rocket.db` that prints
  metadata and the error line only.
- `peers/`: fake child processes and a JSON-RPC peer that never answers.

## 0. What I inherited and changed in the evidence

The previous attempt left `run.ts` and `peers/` but no results. They didn't produce valid
evidence as written. I fixed four defects before any result in this report was produced:

1. The wrapper used to model a host read `process.argv` one slot off (under `node -e` the first
   extra argument is `argv[1]`), so it never started.
2. `Hub` was constructed without its required `emit` callback, so it threw at the first
   `createChat`.
3. The fake `HoldAdapter` kept only one pending finish, so with two concurrent chats it ended
   the wrong chat's turn. It now holds one run per chat.
4. The EOF peers only attached an `'end'` listener. A side test (below) shows that alone never
   fires, because stdin stays paused. Both peers now call `process.stdin.resume()`.

```
endOnly exitedOnEof= false
endOnlyAfterSpawn exitedOnEof= false
endWithResume exitedOnEof= true
```

I added three experiment groups: the real `CursorAdapter` against a fake ACP client, an
`EvalRuns` timeout run, and a follow-up on misattribution when a late call arrives on the shared
URL.

## 1. Headline findings

1. **A Cursor turn can be recorded `completed` with `error: null` even when it ended on a
   transport failure. This has happened three times in the live store.** cursor-agent itself
   turns a backend failure into assistant text and then reports a normal end. Rocket trusts the
   stop reason. This is how the previous worker's turn got marked completed while its only final
   output was `Error: RetriableError: [unavailable] PING timed out`. Observed in the bundle, the
   store, and an experiment (§2).
2. **Stop has no escalation, and an eval timeout doesn't stop the turn at all.** A cell that
   times out is marked `error`, but its turn keeps running. The next trial of that provider then
   waits for that orphaned turn with no limit. A run can report `done` while its last turn is
   still running (§4).
3. **Calls on Antigravity's shared tool URL are misattributed, not only lost.** With two chats
   live, calls get `chatId: null`, which confirms C7. With exactly one chat live, any call on the
   shared URL is credited to that chat, including one sent by another chat's process: it lands in
   that chat's memory folder, ledger turn and opened-sources list (§5).

## 2. Error-shaped assistant text versus the prompt's stop reason (Cursor)

### Observed in cursor-agent 2026.10.01 (local bundle, read-only)

`~/.local/share/cursor-agent/versions/2026.10.01-14929f9/6136.index.js` is the ACP session
implementation. `handlePrompt` is roughly:

```
try { await this.processPrompt(e, t, o) } catch (e) { if (!t.canceled) throw e } ...
return t.canceled ? (... await a, { stopReason: "cancelled" }) : { stopReason: "end_turn" }
```

`processPrompt` catches errors from the model run itself before `handlePrompt` sees them:

```
catch (e) {
  if (e instanceof r.cc || t.canceled) return;
  if (e instanceof r.ao) { ... return void await this.sendAgentMessageChunk(`\n\n${t}`) }
  if (e instanceof m.T && e.code === f.C.Unauthenticated) return void await this.sendAgentMessageChunk("\n\nError: [unauthenticated] ...");
  await this.sendAgentMessageChunk(`\n\nError: ${String(e)}`)
}
```

So a non-cancel failure of the agent run becomes an `agent_message_chunk` reading
`\n\nError: <Kind>: <message>`. `processPrompt` then returns normally and the prompt answers
`{stopReason: "end_turn"}`. In `index.js`, `class N extends Q { get kind() { return "RetriableError" } }`
and the error base sets `name` from `kind`. The message `PING timed out` with code `Unavailable`
comes from the bundled Connect HTTP/2 session manager's keep-alive ping. Together those produce
exactly the string seen in the store.

The ACP specification (opened: https://agentclientprotocol.com/protocol/v1/prompt-turn) defines
`end_turn` as "The language model finishes responding without requesting more tools". It has no
error stop reason, so the protocol's way to report a failure is a JSON-RPC error on
`session/prompt`. cursor-agent's behaviour is therefore a deviation, and the client can't tell
failure from success from the stop reason alone.

### Observed in Rocket

`src/host/providers/cursor.ts:189-200`: only `cancelled` and `refusal` are mapped. Any other stop
reason is `{status: 'completed'}`, and only a rejected request becomes `failed`. The hub then
stores `completed` with no error (`hub.ts:639-640`) and advances the session mark
(`hub.ts:647-649`).

The live store (`store-transport-errors.json`, read-only) has 127 completed, 8 interrupted and
1 failed Cursor turns. Three of the completed ones end in this error form:

| seq | model | duration | tool calls | text before the error | error line |
| --- | --- | --- | --- | --- | --- |
| 307 | composer-2.5 | 62 s | 34 | 4480 chars | `RetriableError: [unavailable] PING timed out` |
| 308 | composer-2.5 | 0 s | 0 | none | `RetriableError: [unavailable] getaddrinfo EAI_AGAIN agentn.global.api5.cursor.sh` |
| 418 | grok-4.7 | 474 s | 111 | none in the last message | `RetriableError: [unavailable] PING timed out` |

Seq 418 is the turn this assignment replaces. The next attempt in a new chat (seq 422) failed
after 60 s with `Cursor request timed out: session/new`. That matches `loadOrCreate`'s 60 s
timeout (`cursor.ts:332`). That the shared ACP process was wedged at that point is a hypothesis;
I didn't test it.

Experiment (`results.json` → `cursorOutcomes`): the real `CursorAdapter` and `Hub`, with the
ACP client replaced by a fake that answers the way the bundle code above does.

| fake agent behaviour | turn status | error | session mark advanced |
| --- | --- | --- | --- |
| partial text, then `\n\nError: RetriableError: [unavailable] PING timed out`, `end_turn` | completed | null | yes |
| error text only, `end_turn` (seq 308's shape) | completed | null | yes |
| `session/prompt` rejected with a JSON-RPC error | failed | the message | no |
| Stop: agent answers `cancelled` | interrupted | null | yes |
| Stop: agent answers `end_turn` after the cancel | completed | null | yes |
| Stop: agent never answers | still running after 1.5 s | — | no |

### Why this matters (code, not measured)

- Goals retry only `failed` turns (`goals.ts:256-269`). A transport-failed work turn is treated
  as finished work and goes straight to the check step.
- The default eval grader `turn_completed` passes on `status === 'completed'`
  (`eval-grade.ts:49-50`). A transport failure scores as a pass on that grader.
- `scripts/research-loop.mjs:123-131` treats a non-failed, non-interrupted turn as done if the
  report and receipt exist. Otherwise it errors on the report, not the transport.
- The journal's timing line records `status: completed`, so failure counts read from the journal
  (round-0001 cited "no `turn-failed` entries") undercount Cursor failures.

Whether these three turns did *useful* work before failing is a separate question: seq 307 has
4480 characters of real answer before the error. "Completed" is wrong as a statement about the
transport, but the turn isn't always worthless.

## 3. Cancellation (C8)

| Claim part | Verdict | Evidence |
| --- | --- | --- |
| Hub stop awaits the adapter and nothing else | **Proven** | `hub.ts:446-451`. A fake adapter whose `stop` resolves and whose `run` never settles leaves the turn `running` 300 ms after `stop` returned, and a new send is refused: "This chat is still answering the last message" (`hubStopLeavesTurnRunning`). |
| Cursor stop is a notification; nothing settles the prompt but the agent or the 60-minute timeout | **Proven for Rocket's side** | `cursor.ts:51`, `:225-228`. With the real `StdioJsonRpcClient` against a peer that ignores cancel, the pending `session/prompt` stays pending after the cancel and rejects only at its own timeout (250 ms → 251 ms; 700 ms → 701 ms) (`cancelDoesNotSettlePrompt`). With the real adapter it stays `running` (§2 table). |
| cursor-agent does honour cancel | **Code-read, not measured live** | `6136.index.js`: `cancel(e)` calls the session's `pendingPromptCancel`, which `handlePrompt` sets synchronously before awaiting. On cancel it aborts subagent work and waits for subagents up to `Y=1e4` (10 s) before answering `cancelled`. Whether `processPrompt` and its background-work `finally` actually return promptly mid-tool-call is unmeasured. |
| Codex: rejected `turn/interrupt` ends the turn locally, a late `turn/completed` is ignored, and a new `turn/start` is sent while the server may still run the old one | **Proven for Rocket's side** | `codex.ts:185-191`. Reject: status `interrupted` within 1 ms. A later `turn/completed` leaves it unchanged (`endedAt` too). A second send issues a second `turn/start` (`codexInterruptRejected`). What the app-server does with that second start is unknown. |
| Codex: accepted interrupt with no `turn/completed` stays running with no deadline | **Code-proven, experiment bounded** | Still `running` 400 ms after stop. It ends only when the notification is injected (`codexInterruptAcknowledgedWithoutCompletion`). There is no timer in `codex.ts` on this path. |
| ACP's client-side SHOULD: mark unfinished tool calls cancelled when sending cancel | **Not done** | Rocket marks them only at turn end (`cursor.ts:385-394`, as `failed`). Spec: https://agentclientprotocol.com/protocol/v1/prompt-turn (Cancellation). |

Additional result: if the agent answers `end_turn` after a Stop, the hub records `completed`
(`hub.ts:639`: interrupted only when the result is not completed). That's correct when the Stop
raced a real finish. Rocket can't tell that apart from an agent that ignored the cancel.

## 4. Eval timeout versus provider cancellation (lead from 03-codex-score-semantics.md)

The lead intersects directly. Code: `finishEvalCell` awaits `hub.waitForTurn(...)` with the cell
timeout (`eval-run-cell.ts:93`). `waitForTurn` only rejects its waiter on timeout
(`hub.ts:138-142`). `EvalRuns.runCell` catches that as a cell `error` (`eval-runs.ts:150-152`) and
never calls `hub.stop`. Only `EvalRuns.stop` does (`eval-runs.ts:87-95`). The next cell first
loops while its provider has any turn running (`eval-runs.ts:111-114`), with no limit.

Experiment (`evalTimeout`): one provider, two trials, a 300 ms cell timeout, and an adapter that
never finishes on its own.

- 1.5 s after the timeout, cell 0 is `error`, but its turn is `running` in the store and the hub.
  The adapter's `stop` was called 0 times, and cell 1 is still `queued`.
- Cell 1 started only when the orphaned first turn was finished by hand. Cell 0 stayed `error`
  although its turn then ended `completed`, and it was never exported or graded.
- When cell 1 timed out the run became `done`, with the second turn still running and 0 stop
  calls.

So a timeout in a provider lane leaves a turn running that the panel no longer tracks. It blocks
the rest of that lane for as long as the turn lasts (Cursor's own ceiling is 60 minutes; Codex's
is none). Minor: the error text rounds, and 300 ms printed as "within 0s". At the real 15-minute
cell timeout that is cosmetic.

This also refines the score finding in `03-codex-score-semantics.md`. The missing denominator
isn't only about scoring: the timed-out turn may later finish and change the workspace copy
after the cell was closed as an error.

## 5. Shared-MCP chat attribution (C7)

Code: `channel.ts:110` maps the `shared` key through `runningChat`, which returns a chat only
when exactly one turn of that provider is live (`hub.ts:105-108`). Only Antigravity uses the
shared key (`antigravity.ts:265`). Claude binds a per-runtime key (`claude.ts:296`), and Codex
and Cursor put the chat id in the URL (`codex.ts:287`, `cursor.ts:321`).

Experiment (`toolOwnership`): real `ToolChannel` over HTTP on loopback, real `ask_user` and
`remember` tools, real `ToolLedger`, and two live Antigravity turns.

**Two chats live (C7 confirmed):**

- `ask_user` refused: "Rocket could not tell which chat this call came from…". No question item
  was posted in either chat.
- `remember` refused: "…the note has no folder to go with". No note was stored anywhere. That
  corrects C7's "saves to no folder": the tool declines rather than saving a folderless note.
- A page-open call recorded `chatId: null`. Chat A then cited that page, so its settled
  `sources` list shows it as unopened, and the next turn's preamble would falsely accuse it of
  citing an unopened page.
- Ledger rows have `chatId: null, turnId: null`.

**One chat live (new, beyond C7):** after chat A ended, a call on the shared URL was credited to
chat B in full:

- `remember` saved note m1 to `/repo/b` with B's chat id.
- The ledger recorded B's turn id.
- The opened URL appeared in B's opened-sources list.

The experiment proves the channel does this for any shared-URL call while one chat is live.
Whether real agy processes send calls outside their own chat's turn is **conjecture**. Plausible
sources are a stopped process during the 3 s SIGTERM grace (`process-tree.ts:10`, `:30-39`), a
warmed spare, or a tool call still in flight when its turn's result arrives. None was observed.

Per-chat and unknown keys: a URL naming a chat id is credited to that id even after its turn
ended. An unbound non-chat key (`not-a-chat`) is passed through as a `chatId` verbatim, and
`probe_open` "succeeded" under it. The channel doesn't validate that a key is a real chat.

## 6. Verdicts on C5–C10 and C13

| Id | Verdict | Proven | Conjecture or open |
| --- | --- | --- | --- |
| C5 orphans | **Weaker than stated** | Rocket has no crash-time cleanup: `stopAllProcessGroups` runs only in shutdown or Node's `exit` event (`src/host/index.ts:422`, `:441`), neither of which runs on SIGKILL. Whether a child survives depends entirely on its own EOF handling. Fakes: an EOF-honouring child dies at once; a child that ignores EOF survives 8/8 samples; a grandchild in its own session survives after its parent exits (`processFate`). | The prior `orphan-check.mjs` polled only the launcher pid. `process-tree.ts:3-6` says `cursor-agent` is a shell script that execs node, which forks another node, and `codex` is a node wrapper around a Rust binary. So the workers' fate after a host crash is unobserved, as are busy (mid-turn, child shell) CLIs and `claude`. |
| C6 restart loop | **Code confirmed** | `src/main/index.ts:108-118` restarts on every exit, with no count or delay. | Behaviour under a crash-at-startup is untested (it needs Electron); prior evidence of zero `restart` journal lines is unchanged. |
| C7 shared MCP | **Confirmed and extended** | §5. Correction: `remember` refuses rather than saving folderless. | Real agy calling outside its own turn. |
| C8 stop escalation | **Confirmed for Rocket's side** | §3, §4. | Real cursor-agent cancel latency mid tool call; app-server behaviour on a second `turn/start`. |
| C9 Claude follow-up | **Confirmed at the hub** | `openUnprompted` returns null while another provider's turn runs. The follow-up text is not stored, and an identical call after the chat goes idle opens a turn (`claudeFollowUpDropped`). | In the real adapter, `unprompted` is retried per stream message (`claude.ts:572-580`, `runtime.turn` stays null). So a follow-up whose stream spans the busy-to-idle transition would likely be captured from mid-stream onward: a truncated reply, not a dropped one. Not tested. |
| C10 split turn end | **Consequence proven; frequency unknown** | With a second SQLite connection, the turn reads `completed` while the session mark is still 0. If the mark write never happens, reopening hands Cursor its own reply under "other assistants answered the turns below" / "Turn answered by Cursor". `changes` and `turn_patches` are also separate statements (`turnEndSplit`). Extra: a turn cut off by a crash reopens as `interrupted` (`store.ts:139`), and the handoff describes it as "stopped by the user before it finished" (`handoff.ts:97`), which is false for a crash. | The experiment models the crash by omitting the second write. It doesn't inject a power loss, so how often the window is hit is unknown. |
| C13 usage after every turn | **Confirmed, with nuance** | `endTurn` calls `usage(provider, true)` (`hub.ts:667`), bypassing the 60 s reuse. Antigravity's read is `execFile(agy, ['-p', '/quota', ...])` (`antigravity.ts:231`). Nuance: concurrent ends coalesce on the pending read. Two ends during one pending read made 1 call; the next end after it settled made a 2nd (`usageForce`). | Cost per `agy -p /quota` run was not measured. |

## 7. What is not proven by anything here

- No real provider CLI was started and no model was called, so all live-latency statements
  (cursor-agent cancel, Codex interrupt) are code readings.
- The cursor-agent behaviour in §2 is read from a minified bundle. The identifier mapping
  (`N` → `RetriableError`, the `catch` in `processPrompt`) is direct text. The claim that the
  three store turns took exactly this path is an inference, though the strings match exactly
  and the fake reproduces Rocket's recorded outcome.
- Nothing about the user's live chats was changed. The only live data read was the store query,
  which is limited to Cursor turn metadata and error lines.

## 8. Next questions, in evidence order

1. **How should Rocket classify a Cursor turn whose last assistant chunk matches cursor-agent's
   `\n\nError: <Kind>: [code] …` form?** It could be marked `failed`, or a new
   "completed with transport error" status, keeping the partial text either way. That decides
   whether goals retry and graders fail. A unit test can use the fake in `run.ts`
   (`cursorOutcomes`). Check whether newer cursor-agent versions changed `processPrompt`.
2. **Do cursor-agent's and codex's worker processes outlive a host crash?** Rerun the prior
   orphan check, but poll every member of the CLI's process group and session (`/proc/*/stat`),
   idle and with a long-running shell tool active. That needs authorization for an idle
   CLI start and, for the busy case, a model turn.
3. **Should an eval cell timeout call `hub.stop`, and what bounds the next cell's wait?** The
   orphaned-turn behaviour in §4 is proven. The choice is between stopping the turn and marking
   the cell `timeout`, or keeping the cell open until the turn settles.
4. **What does the Codex app-server do on `turn/start` while an earlier turn on the thread is
   still active after a rejected interrupt?** This needs the rest of the app-server docs or a
   controlled live check.
5. **Does any real agy process call the shared URL outside its own chat's turn?** The ledger
   could answer it after the fact: look for shared-URL calls whose credited turn's agy pid isn't
   the caller's. Today's ledger doesn't record the caller pid, so this may need an instrumented
   isolated run.
6. **How long does cursor-agent take to answer `cancelled` mid tool call in practice?** The
   bundle allows up to 10 s for subagents alone. A bounded hub-level escalation would need that
   number.
