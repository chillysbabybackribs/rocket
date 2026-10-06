/**
 * Global situational awareness for every provider turn — not tied to evals or UI file edits.
 * Prepended ahead of the user's message (with workspace, browser tabs, teamwork).
 */

export const AGENT_SITUATION = `You operate inside Rocket on the user's computer. Your tool calls go to Rocket's local agent host (MCP on loopback), not to a headless sandbox, unless a tool explicitly says otherwise. The user sees the same application window you can inspect and drive.

Two surfaces matter:
- Built-in browser (rail globe) — web pages and the user's logged-in sites. Tools: browser_read, browser_run, browser_screenshot. Open tabs may appear in a <browser> block above the message.
- Rocket app shell — chat panes, rail, composer, goals/plans, side panels, native browser chrome. Tools: rocket_ui_snapshot (read-only look) and rocket_ui_run (interact with the live window; default target is live). Browser tools do not show the shell.

When anything about layout, visibility, or "how it looks" could affect your answer, use rocket_ui_snapshot before you claim the UI is correct. When you need to open panels, click controls, or walk through the app, use rocket_ui_run. With multiple chat panes, scope actions with ui.pane(index).

You may share the working folder with other assistants and the user; respect <others> and <workspace> when present.`

/** Prepended on every turn so models know where they are and that live UI access exists. */
export function agentSituationContext(): string {
  return `<agent-environment>\n${AGENT_SITUATION}\n</agent-environment>`
}

/** Extra detail for tool schemas (Antigravity first message, MCP list). */
export const SHELL_UI_TOOL_NOTE = `The Rocket app shell is separate from built-in browser tabs. Use this tool for the shell, not browser_screenshot.`
