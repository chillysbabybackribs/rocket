import { nativeSurfaceKind } from './native-layers.ts'
import { app, WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LiveUiConnection } from '../shared/types.ts'

// Chromium chooses a loopback port at startup. Main identifies its own surfaces by target id,
// so a model cannot accidentally drive a different app or a concealed tab with the same URL.
async function targetId(contents: WebContents): Promise<string> {
  const attached = contents.debugger.isAttached()
  if (!attached) contents.debugger.attach('1.3')
  try {
    const result = await contents.debugger.sendCommand('Target.getTargetInfo') as { targetInfo: { targetId: string } }
    return result.targetInfo.targetId
  } finally { if (!attached) contents.debugger.detach() }
}

export async function liveUiConnection(window: BrowserWindow): Promise<LiveUiConnection> {
  const [port, path] = (await readFile(join(app.getPath('userData'), 'DevToolsActivePort'), 'utf8')).trim().split('\n')
  if (!/^\d+$/.test(port) || !path?.startsWith('/devtools/browser/')) throw new Error('The live UI connection is not ready. Restart Rocket and try again.')
  const surfaces: LiveUiConnection['surfaces'] = { shell: await targetId(window.webContents) }
  for (const view of window.contentView.children) {
    if (!(view instanceof WebContentsView) || !view.getVisible()) continue
    const kind = nativeSurfaceKind(view)
    surfaces[kind] = await targetId(view.webContents)
  }
  return { endpoint: `ws://127.0.0.1:${port}${path}`, pid: process.pid, surfaces }
}
