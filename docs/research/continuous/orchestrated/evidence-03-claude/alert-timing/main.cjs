// How long Electron's native alert box stays on screen after the DevTools-protocol accept that
// browser-agent.ts sends, with the page left alone afterwards; and what a click on the leftover
// box does (xdotool, when present).
const { app, BrowserWindow, WebContentsView } = require('electron')
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path')
const { execFileSync } = require('node:child_process')
const UD = process.env.EXP_USER_DATA; app.setPath('userData', UD)
const results = {}; const note = (k, v) => { results[k] = v; console.log(`[result] ${k} ${JSON.stringify(v)}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const site = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  if (req.url.startsWith('/alert')) return res.end(`<!doctype html><h1>a</h1><script>window.after = 'no'; alert('alert at ${Date.now()}'); window.after = 'yes'; document.title = 'after-alert'; setInterval(() => { document.title = 'tick-' + Date.now() }, 200)</script>`)
  res.end('<!doctype html><h1>plain</h1>')
})
function shot(name) { try { execFileSync('import', ['-display', process.env.DISPLAY, '-window', 'root', path.join(UD, name)], { timeout: 8000 }); return name } catch (e) { return `failed: ${e.message}` } }
// Is the native box on screen? It draws at the top-left of the bare X display; sample that region's mean brightness.
function boxVisible(name) { try { const out = execFileSync('convert', [path.join(UD, name), '-crop', '170x90+0+0', '-format', '%[fx:mean]', 'info:'], { encoding: 'utf8', timeout: 8000 }); return Number(out) > 0.05 } catch (e) { return `convert failed: ${e.message}` } }
const events = []
app.whenReady().then(async () => {
  await new Promise((r) => site.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${site.address().port}`
  const win = new BrowserWindow({ width: 900, height: 700, show: true, x: 40, y: 40 }); await sleep(500)
  const view = new WebContentsView({ webPreferences: { partition: 'persist:browser', sandbox: true, contextIsolation: true, nodeIntegration: false } })
  win.contentView.addChildView(view); view.setBounds({ x: 0, y: 0, width: 900, height: 700 }); const contents = view.webContents
  contents.debugger.attach('1.3')
  let acceptAt = 0
  contents.debugger.on('message', (_e, method, params) => {
    if (method === 'Page.javascriptDialogOpening') { events.push(`opening ${params.type} +${Date.now() - t0}ms`); void contents.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: true }).then(() => { acceptAt = Date.now(); events.push(`accepted +${acceptAt - t0}ms`) }) }
    if (method === 'Page.javascriptDialogClosed') events.push(`closed result=${params.result} +${Date.now() - t0}ms`)
  })
  await contents.loadURL('about:blank'); await contents.debugger.sendCommand('Page.enable')
  const t0 = Date.now()
  void contents.loadURL(`${origin}/alert`).catch(() => {})
  const timeline = []
  for (const at of [300, 1000, 2000, 4000, 7000]) {
    await sleep(at - (Date.now() - t0) > 0 ? at - (Date.now() - t0) : 0)
    const name = `t${at}.png`; shot(name)
    timeline.push({ at, title: contents.getTitle(), nativeBoxVisible: boxVisible(name), screenshot: name })
  }
  note('A1_alert_accepted_then_left_alone', { events: [...events], timeline })
  let click = 'xdotool not installed'
  try {
    execFileSync('xdotool', ['mousemove', '88', '70', 'click', '1'], { env: { ...process.env }, timeout: 8000 }); await sleep(800)
    shot('after-click.png'); click = { nativeBoxVisible: boxVisible('after-click.png'), title: contents.getTitle(), responsive: (await contents.debugger.sendCommand('Runtime.evaluate', { expression: 'window.after', returnByValue: true })).result.value, events: events.splice(0) }
  } catch (e) { click = `click skipped: ${e.message.split('\n')[0]}` }
  note('A2_click_on_leftover_box', click)
  // A second alert: does the box from the first stack or get replaced?
  events.length = 0
  await contents.loadURL(`${origin}/alert?second`).catch(() => {}); await sleep(1500); shot('second.png')
  note('A3_second_alert', { nativeBoxVisible: boxVisible('second.png'), title: contents.getTitle(), events: [...events] })
  fs.writeFileSync(path.join(UD, 'results.json'), JSON.stringify({ electron: process.versions.electron, results }, null, 2)); app.exit(0)
}).catch((e) => { console.error('[fatal]', e); fs.writeFileSync(path.join(UD, 'results.json'), JSON.stringify({ fatal: String(e.stack), results }, null, 2)); app.exit(1) })
