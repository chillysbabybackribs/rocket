# Agent situational awareness in Rocket

## Problem

Models often behave as if they were a generic cloud assistant: they guess UI state, confuse the **built-in browser** with the **Rocket app shell**, and skip live inspection even when the user is staring at the same window.

That is a **global positioning** issue, not an eval feature or a one-off prompt tweak.

## Design

Every user message sent through the hub is prefixed with context blocks (see `hub.ts` → `context` callback in `index.ts`):

| Block | When | Purpose |
|-------|------|---------|
| `<agent-environment>` | **Every turn** | Where the agent runs, local MCP host, shell vs browser, when to snapshot/drive UI |
| `<workspace>` | Fresh session (+ notes delta) | Cwd, file map, remember notes |
| `<others>` | When relevant | Parallel assistants, recent edits |
| `<browser>` | When tabs change | Open browser tabs |
| `<git>` | Fresh session | Commit rules |

Implementation: `src/host/agent-situation.ts` — `agentSituationContext()`.

Tool descriptions for `rocket_ui_snapshot` / `rocket_ui_run` add a short shell-vs-browser note for MCP-only discovery (e.g. Antigravity `<app-tools>` on first message).

## What models should internalize

1. **Embedded in Rocket on the user's machine** — tools hit loopback MCP, not a remote sandbox.
2. **Two visual surfaces** — browser tabs vs app shell; different tools.
3. **Look before claiming UI** — `rocket_ui_snapshot` when layout/visibility matters.
4. **Act on the live app** — `rocket_ui_run` (default live), not isolated, for normal tasks.

Eval panel, tool ledger, and playground are just parts of the shell; they are not called out separately in `<agent-environment>`.

## Eval UI Tools tab

The eval panel **Tools** view (`EvalToolsPanel`) surfaces registered MCP tools and `rocket_tool_history` for humans and debugging. It does not replace message-level `<agent-environment>` for models.

## Verification

- Unit: `src/host/agent-situation.test.ts`
- Matrix: `tool-ui-readonly` scenario in `goal-draft-minimal.jsonl`
- Manual: new chat → first user message in host/journal should include `<agent-environment>`

Restart Rocket after host changes.
