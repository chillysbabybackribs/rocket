// Two follow-ups to page-effects: (1) after the DevTools-protocol accept that browser-agent.ts
// sends, does Electron's own native dialog box stay on screen? (2) is the beforeunload race
// (DevTools accept against Electron's will-prevent-unload "stay") deterministic?
const { app, BrowserWindow, WebContentsView } = require('electron')
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path')
const { execFileSync } = require('node:child_process')
const UD = process.env.EXP_USER_DATA; app.setPath('userData', UD)
const results = {}; const note = (k, v) => { results[k] = v; console.log(`[result] ${k} ${JSON.stringify(v)}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const page = (body, head = '') => `<!doctype html><html><head><meta charset=utf-8>${head}</head><body>${body}</body></html>`
const site = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  switch (url.pathname) {
    case '/plain': return res.end(page('<h1>plain</h1>'))
    case '/alert': return res.end(page('<h1>a</h1>', `<script>alert('alert from page ${url.searchParams.get('n')}'); document.title = 'after-alert-${url.searchParams.get('n')}'</script>`))
    case '/confirm': return res.end(page('<h1>c</h1>', `<script>document.title = 'confirm-' + confirm('Really?')</script>`))
    case '/unload': return res.end(page('<input id=draft>', `<script>addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = 'unsaved'; return 'unsaved' })</script>`))
    default: return res.end(page('404'))
  }
})
function xwindows() {
  try { return execFileSync('xwininfo', ['-display', process.env.DISPLAY, '-root', '-tree'], { encoding: 'utf8', timeout: 8000 }).split('\n').filter((l) => /^\s+0x[0-9a-f]+ "/.test(l) && !/has no name/.test(l)).map((l) => l.trim().replace(/\s+/g, ' ').slice(0, 120)) } catch (e) { return [`xwininfo failed: ${e.message}`] }
}
function shot(name) { try { execFileSync('import', ['-display', process.env.DISPLAY, '-window', 'root', path.join(UD, name)], { timeout: 8000 }); return name } catch (e) { return `failed: ${e.message}` } }
let mode = 'accept'; const events = []
app.whenReady().then(async () => {
  await new Promise((r) => site.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${site.address().port}`
  const win = new BrowserWindow({ width: 900, height: 700, show: true, x: 40, y: 40 }); await sleep(500)
  const view = new WebContentsView({ webPreferences: { partition: 'persist:browser', sandbox: true, contextIsolation: true, nodeIntegration: false } })
  win.contentView.addChildView(view); view.setBounds({ x: 0, y: 0, width: 900, height: 700 }); const contents = view.webContents
  contents.on('will-prevent-unload', () => events.push('will-prevent-unload'))
  contents.on('did-fail-load', (_e, code, desc, url) => events.push(`did-fail-load ${desc} ${url}`))
  contents.on('did-navigate', (_e, url) => events.push(`did-navigate ${url}`))
  contents.debugger.attach('1.3')
  contents.debugger.on('message', (_e, method, params) => {
    if (method === 'Page.javascriptDialogOpening') { events.push(`dialogOpening ${params.type}`); if (mode !== 'none') void contents.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: mode === 'accept' }).catch((e) => events.push(`handle failed: ${e.message}`)) }
    if (method === 'Page.javascriptDialogClosed') events.push(`dialogClosed result=${params.result}`)
  })
  await contents.loadURL('about:blank'); await contents.debugger.sendCommand('Page.enable'); await contents.debugger.sendCommand('Network.enable')
  const go = async (url, ms = 1200) => { void contents.loadURL(url).catch(() => {}); await sleep(ms) }
  const eval_ = async (expr) => { const out = await Promise.race([contents.debugger.sendCommand('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true }), sleep(2000).then(() => ({ timedOut: true }))]); return out?.timedOut ? { timedOut: true } : out.result?.value }

  note('S0_windows_before', { windows: xwindows() })
  // (1) three alerts, each accepted over the protocol as Rocket does.
  for (const n of [1, 2, 3]) { await go(`${origin}/alert?n=${n}`); }
  note('S1_after_three_accepted_alerts', { title: contents.getTitle(), pageResponsive: await eval_('1+1'), windows: xwindows(), screenshot: shot('after-alerts.png'), events: events.splice(0) })
  // a confirm, dismissed over the protocol
  mode = 'dismiss'; await go(`${origin}/confirm`)
  note('S2_after_dismissed_confirm', { title: contents.getTitle(), windows: xwindows(), screenshot: shot('after-confirm.png'), events: events.splice(0) })
  mode = 'accept'
  // (2) beforeunload accept, repeated.
  const runs = []
  for (let i = 0; i < 6; i++) {
    await go(`${origin}/unload?i=${i}`, 900)
    if (!contents.getURL().includes('/unload')) { runs.push({ i, skipped: `stuck at ${contents.getURL()}` }); continue }
    const box = await eval_("(() => { const r = document.getElementById('draft').getBoundingClientRect(); return { x: r.x + 5, y: r.y + 5 } })()")
    for (const type of ['mousePressed', 'mouseReleased']) await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 })
    await contents.debugger.sendCommand('Input.insertText', { text: 'draft' })
    events.length = 0
    await go(`${origin}/plain?i=${i}`, 1500)
    const left = contents.getURL().includes('/plain')
    runs.push({ i, left, events: [...events] })
    if (!left) { mode = 'none'; await go(`${origin}/plain?unstick=${i}`, 300); await contents.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); await sleep(800); mode = 'accept' }
  }
  note('S3_beforeunload_accept_repeated', { runs, leftCount: runs.filter((r) => r.left).length })
  note('S4_windows_end', { windows: xwindows(), screenshot: shot('end.png') })
  fs.writeFileSync(path.join(UD, 'results.json'), JSON.stringify({ electron: process.versions.electron, results }, null, 2)); app.exit(0)
}).catch((e) => { console.error('[fatal]', e); fs.writeFileSync(path.join(UD, 'results.json'), JSON.stringify({ fatal: String(e.stack), results }, null, 2)); app.exit(1) })
