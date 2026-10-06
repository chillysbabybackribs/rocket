import { app, BrowserWindow, session } from 'electron'
import { ACCEPT_LANGUAGES, clientHintHeaders, parseAcceptCh, plainUserAgent, userAgentMetadata } from './src/main/browser-url.ts'
import { CHROME_OBJECT_SCRIPT } from './src/main/chrome-object.ts'
app.on('window-all-closed', () => {})
const step = <T,>(label: string, p: Promise<T>, ms = 25000) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT at ${label}`)), ms))])
const origin = (u: string) => { try { return new URL(u).origin } catch { return '' } }
app.whenReady().then(async () => {
  try {
    const PART = 'persist:verify-full'
    const pages = session.fromPartition(PART)
    pages.setUserAgent(plainUserAgent(pages.getUserAgent(), app.name), ACCEPT_LANGUAGES)
    // sendClientHints
    const metadata = userAgentMetadata(pages.getUserAgent())!
    const askedFor = new Map<string, Set<string>>()
    pages.webRequest.onBeforeSendHeaders({ urls: ['https://*/*'] }, (d, done) => done({ requestHeaders: { ...d.requestHeaders, ...clientHintHeaders(metadata, askedFor.get(origin(d.url)) ?? []) } }))
    pages.webRequest.onHeadersReceived({ urls: ['https://*/*'] }, (d, done) => { const a = Object.entries(d.responseHeaders ?? {}).find(([n]) => n.toLowerCase() === 'accept-ch')?.[1]; if (a) { const k = origin(d.url); const w = askedFor.get(k) ?? new Set<string>(); for (const n of parseAcceptCh(a)) w.add(n); askedFor.set(k, w) } done({}) })
    const w = new BrowserWindow({ show: false, webPreferences: { partition: PART, sandbox: true, contextIsolation: true } })
    const c = w.webContents
    const userAgent = pages.getUserAgent()
    // presentAsChrome (as the pane now does it)
    const presenting = (async () => {
      if (!c.debugger.isAttached()) c.debugger.attach('1.3')
      await c.debugger.sendCommand('Page.enable')
      await c.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: CHROME_OBJECT_SCRIPT, runImmediately: true })
      await c.debugger.sendCommand('Network.setUserAgentOverride', { userAgent, acceptLanguage: ACCEPT_LANGUAGES, userAgentMetadata: metadata })
    })()
    const load = (url: string) => step(`load ${url}`, new Promise<void>((r) => { c.once('did-finish-load', () => r()); void c.loadURL(url) }))
    // loadPresented
    const t0 = Date.now()
    await load('about:blank'); await presenting
    await load('https://httpbin.org/headers')
    const first = await c.executeJavaScript(`(async () => {
      const h = JSON.parse(document.body.innerText).headers
      const f = document.createElement('iframe'); f.src = 'about:blank'; document.body.appendChild(f); await new Promise(r => setTimeout(r, 200))
      return { chromeKeys: Object.keys(window.chrome), iframeChromeKeys: Object.keys(f.contentWindow.chrome), loadTimesKeys: Object.keys(chrome.loadTimes()).length, csiTran: chrome.csi().tran,
        brands: navigator.userAgentData.brands.map(b=>b.brand).join('|'), languages: navigator.languages, secChUa: h['Sec-Ch-Ua'] ?? null, acceptLanguage: h['Accept-Language'], ua: navigator.userAgent }
    })()`)
    console.log(`RK first real page (${Date.now() - t0}ms):`, JSON.stringify(first))
    const hist = c.navigationHistory
    while (hist.getActiveIndex() > 0 && /^about:blank$/.test(hist.getAllEntries()[0]?.url ?? '')) { if (!hist.removeEntryAtIndex(0)) break }
    console.log('RK history after cleanup:', JSON.stringify(hist.getAllEntries().map(e => e.url)), 'canGoBack:', hist.canGoBack())
    // the detector page
    await load('https://bot.sannysoft.com/'); await new Promise(r => setTimeout(r, 5000))
    const bot = await c.executeJavaScript(`(() => { const rows = Array.from(document.querySelectorAll('table tr')); const failed = []; let passed = 0; for (const tr of rows) { const cls = (tr.className + ' ' + Array.from(tr.querySelectorAll('td')).map(td => td.className).join(' ')).toLowerCase(); const cells = Array.from(tr.querySelectorAll('td,th')).map(x => (x.innerText||'').trim().slice(0, 60)); if (/failed|warn/.test(cls)) failed.push(cells.join(' | ')); else if (/passed/.test(cls)) passed++ } return { failed, passed } })()`)
    console.log('RK sannysoft:', JSON.stringify(bot))
  } catch (e) { console.log('RK FAILED:', (e as Error).message) }
  app.exit(0)
})
