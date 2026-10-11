// Candidate fix check: an agent tab created with webPreferences.disableDialogs = true. Does the
// DevTools-protocol event still reach Rocket's handler, what does the page get back from
// confirm()/alert(), is a native box shown, and does beforeunload still behave as before?
const { app, BrowserWindow, WebContentsView } = require('electron')
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path')
const { execFileSync } = require('node:child_process')
const UD = process.env.EXP_USER_DATA; app.setPath('userData', UD)
const results = {}; const note = (k, v) => { results[k] = v; console.log(`[result] ${k} ${JSON.stringify(v)}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const server = { deleteHits: 0 }
const site = http.createServer((req, res) => {
  if (req.url.startsWith('/delete')) { server.deleteHits++; res.writeHead(200); return res.end() }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  if (req.url.startsWith('/confirm')) return res.end(`<!doctype html><h1>c</h1><script>const ok = confirm('Delete your account?'); document.title = 'confirm-' + ok; if (ok) fetch('/delete', { method: 'POST' })</script>`)
  if (req.url.startsWith('/alert')) return res.end(`<!doctype html><h1>a</h1><script>alert('hi'); document.title = 'after-alert'</script>`)
  if (req.url.startsWith('/unload')) return res.end(`<!doctype html><input id=draft><script>addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = 'unsaved' })</script>`)
  res.end('<!doctype html><h1>plain</h1>')
})
function shot(name) { try { execFileSync('import', ['-display', process.env.DISPLAY, '-window', 'root', path.join(UD, name)], { timeout: 8000 }); return name } catch (e) { return `failed: ${e.message}` } }
let mode = 'accept'; const events = []
app.whenReady().then(async () => {
  await new Promise((r) => site.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${site.address().port}`
  const win = new BrowserWindow({ width: 900, height: 700, show: true, x: 40, y: 40 }); await sleep(500)
  const view = new WebContentsView({ webPreferences: { partition: 'persist:browser', sandbox: true, contextIsolation: true, nodeIntegration: false, disableDialogs: true } })
  win.contentView.addChildView(view); view.setBounds({ x: 0, y: 0, width: 900, height: 700 }); const contents = view.webContents
  contents.on('will-prevent-unload', () => events.push('will-prevent-unload'))
  contents.on('did-fail-load', (_e, code, desc, url) => events.push(`did-fail-load ${desc} ${url}`))
  contents.on('did-navigate', (_e, url) => events.push(`did-navigate ${url}`))
  contents.debugger.attach('1.3')
  contents.debugger.on('message', (_e, method, params) => {
    if (method === 'Page.javascriptDialogOpening') { events.push(`dialogOpening ${params.type} hasBrowserHandler=${params.hasBrowserHandler}`); if (mode !== 'none') void contents.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: mode === 'accept' }).then(() => events.push('handle ok'), (e) => events.push(`handle failed: ${e.message}`)) }
    if (method === 'Page.javascriptDialogClosed') events.push(`dialogClosed result=${params.result}`)
  })
  await contents.loadURL('about:blank'); await contents.debugger.sendCommand('Page.enable')
  const go = async (url, ms = 1200) => { void contents.loadURL(url).catch(() => {}); await sleep(ms) }
  const eval_ = async (expr) => (await contents.debugger.sendCommand('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true })).result.value
  for (const m of ['accept', 'none']) {
    mode = m; events.length = 0; const before = server.deleteHits
    await go(`${origin}/confirm?m=${m}`)
    note(`D1_confirm_disableDialogs_handler_${m}`, { title: contents.getTitle(), deleteRequests: server.deleteHits - before, screenshot: shot(`confirm-${m}.png`), events: [...events] })
  }
  mode = 'accept'; events.length = 0; await go(`${origin}/alert`)
  note('D2_alert_disableDialogs', { title: contents.getTitle(), screenshot: shot('alert.png'), events: [...events] })
  for (const m of ['accept', 'dismiss']) {
    mode = m; await go(`${origin}/unload?m=${m}`, 900)
    const box = await eval_("(() => { const r = document.getElementById('draft').getBoundingClientRect(); return { x: r.x + 5, y: r.y + 5 } })()")
    for (const type of ['mousePressed', 'mouseReleased']) await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 })
    await contents.debugger.sendCommand('Input.insertText', { text: 'draft' })
    events.length = 0; await go(`${origin}/plain?m=${m}`, 1500)
    note(`D3_beforeunload_disableDialogs_${m}`, { left: contents.getURL().includes('/plain'), events: [...events] })
    if (!contents.getURL().includes('/plain')) { mode = 'accept'; await go(`${origin}/plain?unstick`, 1200) }
  }
  fs.writeFileSync(path.join(UD, 'results.json'), JSON.stringify({ electron: process.versions.electron, results }, null, 2)); app.exit(0)
}).catch((e) => { console.error('[fatal]', e); fs.writeFileSync(path.join(UD, 'results.json'), JSON.stringify({ fatal: String(e.stack), results }, null, 2)); app.exit(1) })
