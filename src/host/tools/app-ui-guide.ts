import type { Working } from '../teamwork.ts'

/**
 * Shipped in tool descriptions and in `<rocket-app>` message context so models do not
 * treat the built-in browser as the Rocket shell, or ship UI claims without looking.
 */
export const APP_UI_GUIDE = `Rocket exposes two different surfaces:

1. Built-in browser (rail globe) — pages the user opened on the web. Tools: browser_read, browser_run, browser_screenshot. Open tabs may appear in a <browser> block above the user's message.

2. Rocket app shell — chat panes, rail, eval panel (flask), goal/plan drawers, composer, and the native browser chrome around tabs. Tools: rocket_ui_snapshot (read-only; returns JPEG images, control names, bounds, instance info) and rocket_ui_run (clicks, fills, scripts; default target="live" on the user's window).

Use rocket_ui_snapshot when you change or verify UI (src/renderer, eval panel, rail, layouts), when the user asks how something looks, or before saying a UI fix is done. browser_screenshot does not show the app shell.

Use rocket_ui_run for multi-step shell interaction (open eval panel, add a pane, drive the playground). One script per call; await every action. With several chat panes, scope with ui.pane(index).

Use target="isolated" only for automated regression (private build/profile), not for the user's live window.`

const UI_EDIT = /(?:^|[\\/])(src[\\/]renderer[\\/]|docs[\\/]mockups[\\/]|docs[\\/]evals[\\/]mock-ui[\\/])/

/** True when this chat's in-flight turn is editing renderer or eval mock UI. */
function editingAppUi(working: Working[], chatId: string): boolean {
  return working.some((row) => row.chatId === chatId && row.edited.some((file) => UI_EDIT.test(file)))
}

/**
 * Context block for the hub, like browser tabs: fresh provider sessions and turns that
 * touch app UI code get a short reminder to use rocket_ui_snapshot / rocket_ui_run.
 */
export function appUiContext(
  working: () => Working[],
  chatId: string,
  fresh: boolean
): string | null {
  if (!fresh && !editingAppUi(working(), chatId)) return null
  return `<rocket-app>\n${APP_UI_GUIDE}\n</rocket-app>`
}
