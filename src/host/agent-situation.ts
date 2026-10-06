/**
 * Global situational awareness for every provider turn — not tied to evals or UI file edits.
 * Prepended ahead of the user's message (with workspace, browser tabs, teamwork). The app is
 * finite, so the block carries its map and where the shell is right now, read live; a model
 * navigates by name and never searches a screenshot for a button.
 */

import { describeMap } from '../shared/app-map.ts'

export const AGENT_SITUATION = `You operate inside Rocket on the user's computer. Your tool calls go to Rocket's local agent host (MCP on loopback), not to a headless sandbox, unless a tool explicitly says otherwise. The user sees the same application window you can inspect and drive.

Two surfaces matter:
- Built-in browser (rail globe) — web pages and the user's logged-in sites. Tools: browser_read, browser_run, browser_screenshot. Open tabs may appear in a <browser> block above the message.
- Rocket app shell — chat panes, rail, composer, goals/plans, side panels, native browser chrome. The shell is finite and mapped below. Tools: rocket_ui_where (where the shell is, in the map's names), rocket_ui_go (show a place by name) and rocket_ui_act (do an action by name); both go and act answer with where the shell ended up and an image. rocket_ui_snapshot is a read-only look; rocket_ui_run scripts the live window and is only for what the map does not cover. Browser tools do not show the shell.

To do something in the shell, read "Where you are" below, go to the place by name, act by name, and check the image and the returned state before saying it is done. With multiple chat panes, your own pane is named below; rocket_ui_run scopes to it with ui.pane(index). Under npm run dev, edits to src/renderer hot-reload into the running window; edits to src/main or src/host, and every edit in a packaged build, need Rocket restarted, so say so instead of claiming the picture shows them.

You may share the working folder with other assistants and the user; respect <others> and <workspace> when present.`

/**
 * Prepended on every turn so models know where they are and that live UI access exists.
 * `where` is the current shell state as one line, or null when the window could not be read.
 */
export function agentSituationContext(where: string | null = null): string {
  const parts = [AGENT_SITUATION, where ?? 'Where you are: the window could not be read for this turn; call rocket_ui_where.', describeMap()]
  return `<agent-environment>\n${parts.join('\n\n')}\n</agent-environment>`
}

/** Extra detail for tool schemas (Antigravity first message, MCP list). */
export const SHELL_UI_TOOL_NOTE = `The Rocket app shell is separate from built-in browser tabs. Use this tool for the shell, not browser_screenshot. For navigating the shell, prefer rocket_ui_go and rocket_ui_act, which work by name.`
