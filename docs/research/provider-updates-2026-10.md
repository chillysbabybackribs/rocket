# What Claude Code, Codex and Cursor now offer Rocket

Research of 5 October 2026 against the installed CLIs: Claude Code 2.1.290 through Agent SDK
0.3.289 (0.3.290 is out), codex-cli 0.160.0 (`app-server`), cursor-agent 2026.10.01 (`acp`).
Sources: the Claude Code changelog and Agent SDK TypeScript reference (code.claude.com), the
Codex app-server reference (developers.openai.com/codex/app-server), Cursor's CLI changelog and
ACP page (cursor.com/docs/cli), the ACP announcements (agentclientprotocol.com), and the
installed SDK's `sdk.d.ts`. Cursor's capabilities were read from a live `initialize`.

## Worth doing first

### 1. Let the user steer a running turn

The composer is disabled while a turn runs (`Composer.tsx`, `busy`). All three tools now let a
message join a turn already running:

- **Claude**: an `SDKUserMessage` written to the open input stream takes
  `priority: 'now' | 'next' | 'later'` (`sdk.d.ts`). `'now'` lands at the next safe point;
  since 2.1.287 it no longer cancels a running web fetch or search.
- **Codex**: `turn/steer {threadId, input, expectedTurnId}` appends to the active turn without a
  new `turn/started`. It takes no model/cwd override.
- **Cursor**: ACP has no steer. The CLI does it in its own UI (Aug 11 release), not over ACP.
  Queue the message until `session/prompt` returns, or cancel and resend.

The adapter interface would need an optional `steer(chatId, text)`, and the hub would fall
back to queueing. The renderer keeps the composer live and shows the message as queued until
the provider takes it.

### 2. Stop rejecting Cursor's own requests

`AcpClient.serve` answers anything except permission and fs calls with -32601. Cursor sends:

| Method | Kind | Today |
| --- | --- | --- |
| `cursor/ask_question` | blocking request | error |
| `cursor/create_plan` | blocking request | error |
| `cursor/update_todos` | notification | dropped |
| `cursor/task` | notification (subagent done) | dropped |
| `cursor/generate_image` | notification | dropped |

Answer `ask_question` with `{outcome: {outcome: 'skipped', reason: 'Ask with the ask_user tool'}}`
so it matches Rocket's non-blocking questions. Answer `create_plan` with `accepted`, since
sessions run unattended. Render todos and subagent completions. How the agent reacts to the
current errors is unverified; a live check would show it.

### 3. One plan/todo item for all providers

Each provider already reports a plan: Claude's `TodoWrite` tool calls, Codex's `plan` item
plus `turn/plan/updated`, and Cursor's `cursor/update_todos`. Rocket shows the first two as
generic tool rows and drops the third. A shared `plan` item in `types.ts` would give every turn
a live checklist. A goal's pane could show the worker's plan beside the brief.

### 4. A context-window meter

- Claude: `query.getContextUsage()` (the `/context` breakdown) and `result.usage`.
- Codex: `thread/tokenUsage/updated` notifications.
- ACP: `usage_update` (used/size/cost), stable since June 2026. Cursor didn't announce it in
  `initialize`, and since it's a notification, only a live run will show whether it's sent.

This tells the user when a provider's session is nearly full. Handoff and goals could use it
too, for example to prefer a fresh session over a session that's nearly full.

## Worth doing next

### 5. Images in the message

All three take images: Claude image content blocks, Codex `{type: 'localImage', path}`,
Cursor `promptCapabilities.image: true`. Rocket's messages are text only. Pasting or dropping
a screenshot, and "send this tab's screenshot", would cover most uses. Goal workers and
checkers could get the design references as real images instead of paths.

### 6. Undo a turn from the Changes panel

Rocket already keeps both snapshots per turn (`turn_patches`), so reverting can stay
provider-independent. Claude's `rewindFiles` (needs `enableFileCheckpointing`) works only for
Claude, and Cursor's `/rewind` isn't on ACP. After reverting, the next handoff should say the
files went back.

### 7. Comment on a hunk, send it back

Vibe Kanban, Conductor and Nimbalyst all let the user comment on a diff line. The comment goes
back to the agent as its next message. `ChangesView` is read-only; comments quoted with
`file:line` would fit Rocket's existing link handling.

### 8. A reasoning-effort control

- Codex `model/list` returns `supportedReasoningEfforts` and `defaultReasoningEffort`, and
  `turn/start` takes `effort`.
- Claude takes `effort` (`low` to `max`) as an option, or mid-session through
  `applyFlagSettings({ effortLevel })`.
- Cursor encodes effort in the model id's `[key=value]` parameters and session config options.

This is read live, which fits the rule against hardcoded model lists.

### 9. Codex's reviewer as a goal checker

`review/start` with `target: {type: 'uncommittedChanges'}` or `custom`, and
`delivery: 'detached'`, runs Codex's built-in reviewer in its own thread. It could be a
checker mode when Codex is the checking provider, alongside the checklist verdicts.

## Keep an eye on

- **Forking a chat**: Codex `thread/fork {lastTurnId}` and Claude `forkSession` branch natively.
  ACP fork is still unstable, and Cursor doesn't advertise it. Rocket's transcript can fork
  itself, using a native fork where there is one and a full handoff elsewhere.
- **Cursor `session/resume`**: stable in ACP since April. It would avoid the history replay
  that `session/load` does, which the adapter has to drop. Cursor doesn't advertise it yet; it
  announces `loadSession` and `sessionCapabilities.list` only.
- **Approvals**: Claude `canUseTool`, Codex permission profiles and approval requests, and
  Cursor's `request_permission` options are all available. Rocket still runs everything
  unattended.
- **Worktree per chat or goal**: every comparable app isolates tasks this way. Claude and
  Cursor both have `--worktree`. Rocket's shared-folder model with teamwork notices is a
  deliberate choice. An opt-in worktree for goals is the likely middle ground.
- **Subagent detail**: Claude `forwardSubagentText` and `agentProgressSummaries`, Cursor
  `cursor/task`, Codex `collabToolCall` items.
- **Native goals**: Codex `thread/goal/*`, Claude `/goal`, Cursor `/goal` (gated). Rocket's
  cross-provider loop does more; it only needs to make sure a provider's own goal never
  overlaps Rocket's.
- **Claude handoff**: `shouldQuery: false` adds a user message to the transcript without a
  model call. Missed turns could go in as their own message instead of a prefix on the user's.
  The gain is small.
- **Housekeeping**: Cursor's CLI is now `agent`, with `cursor-agent` kept as an alias.
  Codex's `thread/rollback` is deprecated (Rocket doesn't use it). Agent SDK 0.3.290 and
  Codex 0.162 alphas are out.
