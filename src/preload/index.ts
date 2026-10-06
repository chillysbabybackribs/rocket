import { contextBridge, ipcRenderer } from 'electron'
import { homedir } from 'node:os'
import type { BrowserState, RocketBridge, SuggestionList } from '../shared/types.ts'
import { HOST_PORT_MESSAGE } from '../shared/types.ts'

// The renderer's only way out. Chat traffic does not go through here at all: main sends a
// MessagePort to the agent host, and this file forwards it into the page, which then talks to
// the host directly.

ipcRenderer.on(HOST_PORT_MESSAGE, (event) => {
  window.postMessage({ type: HOST_PORT_MESSAGE }, '*', event.ports)
})

function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: unknown, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}

const bridge: RocketBridge = {
  requestHostPort: () => ipcRenderer.send('rocket:request-host-port'),
  window: {
    minimize: () => ipcRenderer.send('rocket:window', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('rocket:window', 'toggleMaximize'),
    close: () => ipcRenderer.send('rocket:window', 'close')
  },
  pickFolder: (current) => ipcRenderer.invoke('rocket:pick-folder', current),
  saveAttachmentAs: (name) => ipcRenderer.invoke('rocket:save-attachment-as', name),
  revealAttachment: (path) => ipcRenderer.invoke('rocket:reveal-attachment', path),
  openChatLink: (href, cwd) => ipcRenderer.invoke('rocket:chat-link', href, cwd),
  onOpen: (listener) => listen<{ href: string; cwd: string }>('rocket:open', listener),
  homeDir: homedir(),
  browser: {
    send: (command) => ipcRenderer.send('rocket:browser', command),
    onState: (listener) => listen<BrowserState>('rocket:browser-state', listener),
    onSuggestions: (listener) => listen<SuggestionList>('rocket:browser-suggestions', listener),
    onFocusAddress: (listener) => listen<void>('rocket:browser-focus-address', listener)
  },
  evalPanelUrl: () => ipcRenderer.invoke('rocket:eval-panel-url') as Promise<string>,
}

contextBridge.exposeInMainWorld('rocket', bridge)
