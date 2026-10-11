// Isolated fixture: what a controlled remote page can cause in a tab shaped like Rocket's agent
// tabs (browser-pane.ts load(): partition persist:browser, sandbox, contextIsolation, no node),
// driven over the DevTools protocol the way browser-agent.ts does (Network.enable, Page.enable,
// dialogs accepted in onProtocol, Runtime.evaluate with userGesture, Input.dispatch* clicks).
// Nothing here touches Rocket's profile: userData is a fresh temp dir and the only "local file"
// read is one this script writes there. Results go to EXP_USER_DATA/results.json.
const { app, session, BrowserWindow, WebContentsView } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const UD = process.env.EXP_USER_DATA
app.setPath('userData', UD)
const SECRET = path.join(UD, 'secret.txt')
fs.writeFileSync(SECRET, 'SECRET-CONTENT-7f3a\n')
const DL = path.join(UD, 'downloads'); fs.mkdirSync(DL, { recursive: true })
app.setPath('downloads', DL)
const FILE_URL = `file://${SECRET}`
const PARTITION = 'persist:browser'

const results = {}
const note = (key, value) => { results[key] = value; console.log(`[result] ${key} ${JSON.stringify(value)}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// browser-pane.ts safeFileName / uniquePath / downloadTarget, copied (download-path.ts).
function safeFileName(suggested) {
  const name = path.basename(String(suggested).replace(/\\/g, '/')).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200)
  return name && name !== '.' && name !== '..' ? name : 'download'
}
function uniquePath(p, taken) {
  if (!taken(p)) return p
  const ext = path.extname(p); const stem = p.slice(0, p.length - ext.length)
  for (let n = 1; ; n++) { const next = `${stem} (${n})${ext}`; if (!taken(next)) return next }
}

// ── Controlled "remote" site ──────────────────────────────────────────
const server = { deleteHits: 0, prompted: [], spaSeen: [], hits: [] }
const page = (body, head = '') => `<!doctype html><html><head><meta charset=utf-8>${head}</head><body>${body}</body></html>`
const site = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  server.hits.push(`${req.method} ${req.url}`)
  const html = (body, head) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page(body, head)) }
  switch (url.pathname) {
    case '/plain': return html('<h1 id=plain>plain page</h1>')
    case '/link': return html(`<a id=f href="${FILE_URL}">local report</a> <a id=h href="/plain">web</a>`)
    case '/loc': return html('<p>redirecting</p>', `<script>location.href=${JSON.stringify(FILE_URL)}</script>`)
    case '/iframe': return html(`<iframe id=fr src="${FILE_URL}"></iframe>`)
    case '/redirect': res.writeHead(302, { location: FILE_URL }); return res.end()
    case '/winopen': return html('<p>win</p>', `<script>window.open(${JSON.stringify(FILE_URL)})</script>`)
    case '/confirm': return html('<h1>account</h1>', `<script>if (confirm('Delete your account? This cannot be undone.')) fetch('/delete',{method:'POST'})</script>`)
    case '/delete': server.deleteHits++; res.writeHead(200); return res.end('deleted')
    case '/prompt': return html('<h1>p</h1>', `<script>const v = prompt('Enter token', 'default-token'); fetch('/prompted?v=' + encodeURIComponent(String(v)) + '&t=' + typeof v)</script>`)
    case '/prompted': server.prompted.push(`${url.searchParams.get('v')} (${url.searchParams.get('t')})`); res.writeHead(200); return res.end()
    case '/unload': return html('<form><input id=draft value=""></form>', `<script>addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = 'You have unsaved changes'; return 'You have unsaved changes' })</script>`)
    case '/autodl': return html('<p>auto download</p>', `<script>addEventListener('load', () => { const a = document.createElement('a'); a.download = 'planted-by-page.txt'; a.href = 'data:text/plain,hello-from-page'; document.body.append(a); a.click() })</script>`)
    case '/autodl-nav': return html('<p>nav to attachment</p>', `<script>location.href = '/attachment'</script>`)
    case '/attachment': res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="../../.bashrc"' }); return res.end('echo planted\n')
    case '/spa': return html('<h1>spa</h1>', `<script>setTimeout(() => { fetch('/spa-seen?hooked=' + Boolean(globalThis.__rocketSpaHook)); const n = globalThis.__rocketSpaNavigation; if (n) globalThis.__rocketSpaNavigation = { ...n, seq: n.seq + 1 } }, 300)</script>`)
    case '/spa-seen': server.spaSeen.push(url.searchParams.get('hooked')); res.writeHead(200); return res.end()
    case '/alerts': return html('<h1 id=t>alerts</h1>', `<script>alert('one'); alert('two'); document.title = 'after-alerts'</script>`)
    default: res.writeHead(404); return res.end()
  }
})

// ── Tab shaped like the pane's, driven like the agent does ───────────
let dialogMode = 'accept' // 'accept' (Rocket today) | 'dismiss' | 'none' (Page enabled, nobody answers)
const events = []
const ev = (line) => { events.push(line); console.log(`[event] ${line}`) }
let dialogs = []
let downloads = []
let openHandlerCalls = []

function makeTab(win) {
  const view = new WebContentsView({ webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  win.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 })
  const contents = view.webContents
  contents.setWindowOpenHandler(({ url }) => {
    openHandlerCalls.push(url)
    return /^(https?:|about:blank)/i.test(url) ? { action: 'allow' } : { action: 'deny' }
  })
  contents.on('console-message', (event, ...rest) => {
    const message = typeof rest[1] === 'string' ? rest[1] : event?.message
    ev(`console: ${String(message).slice(0, 160)}`)
  })
  contents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => ev(`did-fail-load ${code} ${desc} ${url} main=${isMainFrame}`))
  contents.on('did-navigate', (_e, url) => ev(`did-navigate ${url}`))
  contents.on('will-navigate', (_e, url) => ev(`will-navigate ${url}`))
  contents.on('will-prevent-unload', () => ev('will-prevent-unload (not prevented: Rocket has no handler)'))
  contents.on('did-create-window', () => ev('did-create-window'))
  contents.debugger.attach('1.3')
  contents.debugger.on('message', (_e, method, params) => {
    if (method === 'Page.javascriptDialogOpening') {
      dialogs.push({ type: params.type, message: String(params.message).slice(0, 200), hasBrowserHandler: params.hasBrowserHandler, defaultPrompt: params.defaultPrompt ?? null, mode: dialogMode })
      ev(`dialogOpening ${params.type} "${params.message}" hasBrowserHandler=${params.hasBrowserHandler}`)
      // browser-agent.ts onProtocol, with the answer made switchable.
      if (dialogMode !== 'none') void contents.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: dialogMode === 'accept' }).catch((e) => ev(`handleJavaScriptDialog failed: ${e.message}`))
    }
    if (method === 'Page.javascriptDialogClosed') ev(`dialogClosed result=${params.result} input=${JSON.stringify(params.userInput)}`)
  })
  return contents
}

async function enable(contents) {
  await contents.debugger.sendCommand('Network.enable')
  await contents.debugger.sendCommand('Page.enable')
  await contents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
}

async function evaluate(contents, expression, timeoutMs = 2500) {
  const call = contents.debugger.sendCommand('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  const out = await Promise.race([call, sleep(timeoutMs).then(() => ({ timedOut: true }))])
  if (out?.timedOut) return { timedOut: true }
  if (out.exceptionDetails) return { exception: out.exceptionDetails.text }
  return out.result?.value
}

/** browser-agent.ts navigate(): loadURL, ERR_ABORTED is not a failure, then wait for the document. */
async function goto(contents, url, settleMs = 900) {
  let problem = null
  const done = new Promise((resolve) => contents.once('did-stop-loading', resolve))
  void contents.loadURL(url).catch((error) => { if (!/ERR_ABORTED/.test(error.message)) problem = error.message })
  await Promise.race([done, sleep(3000)])
  await sleep(settleMs)
  return { problem, url: contents.getURL(), title: contents.getTitle() }
}
const { execFileSync } = require('node:child_process')
function shot(name) {
  try { execFileSync('import', ['-display', process.env.DISPLAY, '-window', 'root', path.join(UD, name)], { timeout: 8000 }); return name } catch (e) { return `screenshot failed: ${e.message}` }
}

async function realClick(contents, selector) {
  const box = await evaluate(contents, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 })
  }
}

const SPA_HOOK = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', '..', 'src', 'main', 'browser-spa-hook.ts'), 'utf8').match(/`([\s\S]*)`/)[1]

app.whenReady().then(async () => {
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${site.address().port}`
  const ses = session.fromPartition(PARTITION)
  // browser-downloads.ts start(), for a tab a model owns: save without a dialog, never overwrite.
  ses.on('will-download', (_event, item, contents) => {
    const target = uniquePath(path.join(DL, safeFileName(item.getFilename())), (p) => fs.existsSync(p))
    item.setSavePath(target)
    const entry = { url: item.getURL(), suggested: item.getFilename(), savedAs: path.basename(target), state: 'progressing', fromContents: Boolean(contents) }
    downloads.push(entry)
    item.once('done', (_e, state) => { entry.state = state; entry.bytes = fs.existsSync(target) ? fs.statSync(target).size : null })
  })
  const win = new BrowserWindow({ width: 900, height: 700, show: true, x: 40, y: 40 })
  await sleep(500)
  const contents = makeTab(win)
  await contents.loadURL('about:blank')
  await enable(contents)
  const reset = () => { dialogs = []; downloads = []; openHandlerCalls = []; events.length = 0 }

  // E1 agent authority: goto file: (toUrl passes file: through; loadURL is main-process).
  reset()
  let r = await goto(contents, FILE_URL)
  note('E1_agent_goto_file', { ...r, body: await evaluate(contents, 'document.body.innerText'), events: [...events] })

  // E2 agent authority: session.fetch file: (browser-agent.ts fetch()).
  try {
    const response = await ses.fetch(FILE_URL)
    note('E2_session_fetch_file', { status: response.status, type: response.headers.get('content-type'), body: await response.text() })
  } catch (error) { note('E2_session_fetch_file', { error: error.message }) }

  // E3 page alone: location.href = file:
  reset(); r = await goto(contents, `${origin}/loc`)
  note('E3_page_location_file', { ...r, body: await evaluate(contents, 'document.body.innerText'), events: [...events] })

  // E4 page alone: iframe to file:
  reset(); r = await goto(contents, `${origin}/iframe`)
  note('E4_page_iframe_file', { ...r, frames: contents.mainFrame.frames.map((f) => f.url), frameText: await evaluate(contents, `(() => { try { return document.getElementById('fr').contentDocument.body.innerText } catch (e) { return 'cross-origin: ' + e.message } })()`), events: [...events] })

  // E5 page alone: HTTP 302 to file:
  reset(); r = await goto(contents, `${origin}/redirect`)
  note('E5_http_redirect_to_file', { ...r, body: await evaluate(contents, 'document.body.innerText'), events: [...events] })

  // E6 page alone: window.open(file:) against the pane's setWindowOpenHandler rule.
  reset(); r = await goto(contents, `${origin}/winopen`)
  note('E6_page_window_open_file', { ...r, openHandlerCalls: [...openHandlerCalls], events: [...events] })

  // E7 agent real click on a page link whose href is file:
  reset(); r = await goto(contents, `${origin}/link`)
  await realClick(contents, '#f'); await sleep(900)
  note('E7_agent_clicks_page_file_link', { url: contents.getURL(), body: await evaluate(contents, 'document.body.innerText'), events: [...events] })

  // E8 agent follow(): href from the page, resolved in main, loaded with loadURL (browser-agent.ts 'follow').
  reset(); r = await goto(contents, `${origin}/link`)
  const href = await evaluate(contents, "document.getElementById('f').getAttribute('href')")
  const full = new URL(href, contents.getURL()).href
  r = await goto(contents, full)
  note('E8_agent_follow_page_href', { href, full, ...r, body: await evaluate(contents, 'document.body.innerText'), events: [...events] })

  // E9 agent download op with a page-supplied url that is file: (browser-agent.ts 'download' → downloadURL).
  reset(); await goto(contents, `${origin}/plain`)
  contents.downloadURL(FILE_URL); await sleep(1200)
  note('E9_downloadURL_file', { downloads: JSON.parse(JSON.stringify(downloads)), events: [...events] })

  // E10 page alone: <a download> clicked by the page's own script, no agent action after goto.
  reset(); await goto(contents, `${origin}/autodl`, 1200)
  note('E10_page_auto_download', { downloads: JSON.parse(JSON.stringify(downloads)), url: contents.getURL(), events: [...events] })

  // E11 page alone: navigation to a Content-Disposition attachment with a traversal filename.
  reset(); await goto(contents, `${origin}/autodl-nav`, 1200)
  note('E11_page_attachment_traversal_name', { downloads: JSON.parse(JSON.stringify(downloads)), url: contents.getURL(), listing: fs.readdirSync(DL), events: [...events] })

  // E12 confirm() on load, Rocket's accept: does the consequential request go out?
  for (const mode of ['accept', 'dismiss']) {
    dialogMode = mode; reset(); const before = server.deleteHits
    r = await goto(contents, `${origin}/confirm?m=${mode}`)
    note(`E12_confirm_${mode}`, { deleteRequests: server.deleteHits - before, dialogs: [...dialogs], events: [...events] })
  }
  // 'none': Page enabled, no answer. Does Electron's own dialog manager answer, or does the page stall?
  dialogMode = 'none'; reset(); { const before = server.deleteHits
    r = await goto(contents, `${origin}/confirm?m=none`, 600)
    const probe = await evaluate(contents, '1+1', 1500)
    const picture = shot('confirm-none-dialog.png')
    note('E12_confirm_none', { deleteRequestsAfter2s: server.deleteHits - before, evaluateWhileOpen: probe, screenshot: picture, browserWindows: BrowserWindow.getAllWindows().length, dialogs: [...dialogs], events: [...events] })
    await contents.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: false }).catch((e) => ev(`unstick failed: ${e.message}`))
    await sleep(300)
    note('E12_confirm_none_after_dismiss', { deleteRequests: server.deleteHits - before, events: [...events] }) }
  dialogMode = 'accept'

  // E13 prompt(): what the page receives when accepted with no promptText.
  reset(); server.prompted = []; await goto(contents, `${origin}/prompt`)
  note('E13_prompt_accept', { pageReceived: [...server.prompted], dialogs: [...dialogs], events: [...events] })

  // E14 alert chain: page continues after accepts.
  reset(); await goto(contents, `${origin}/alerts`)
  note('E14_alerts_accept', { title: contents.getTitle(), dialogs: [...dialogs] })

  // E15 beforeunload with unsaved input, after a real click (sticky activation), then agent goto elsewhere.
  for (const mode of ['accept', 'dismiss', 'none']) {
    dialogMode = mode; reset()
    await goto(contents, `${origin}/unload?m=${mode}`)
    await realClick(contents, '#draft')
    await contents.debugger.sendCommand('Input.insertText', { text: 'unsaved draft' })
    const typed = await evaluate(contents, "document.getElementById('draft').value")
    const start = Date.now()
    r = await goto(contents, `${origin}/plain?from=${mode}`, 1200)
    const stillOpen = (await evaluate(contents, '1+1', 1500))?.timedOut === true
    const picture = mode === 'none' ? shot('beforeunload-none.png') : null
    if (stillOpen) await contents.debugger.sendCommand('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
    await sleep(500)
    note(`E15_beforeunload_${mode}`, { typed, left: contents.getURL().includes('/plain'), finalUrl: contents.getURL(), ms: Date.now() - start, dialogStalledPage: stillOpen, screenshot: picture, dialogs: [...dialogs], events: [...events] })
  }
  dialogMode = 'accept'

  // E16 SPA hook: page sees the hook and bumps the counter without routing (browser-agent.ts waitSpa).
  reset(); server.spaSeen = []
  await goto(contents, `${origin}/plain`)
  await contents.debugger.sendCommand('Runtime.evaluate', { expression: SPA_HOOK })
  await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: SPA_HOOK })
  await goto(contents, `${origin}/spa`, 200)
  const seq0 = await evaluate(contents, 'globalThis.__rocketSpaNavigation?.seq ?? 0')
  const url0 = contents.getURL()
  await sleep(800)
  const seq1 = await evaluate(contents, 'globalThis.__rocketSpaNavigation?.seq ?? 0')
  note('E16_spa_hook_page_controlled', { pageSawHook: [...server.spaSeen], seqBefore: seq0, seqAfter: seq1, waitSpaWouldReturn: seq1 > seq0, urlUnchanged: contents.getURL() === url0 })

  fs.writeFileSync(path.join(UD, 'results.json'), JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, origin, secretPath: SECRET, results, serverHits: server.hits }, null, 2))
  console.log('[done]')
  app.exit(0)
}).catch((error) => { console.error('[fatal]', error); fs.writeFileSync(path.join(UD, 'results.json'), JSON.stringify({ fatal: String(error.stack ?? error), results }, null, 2)); app.exit(1) })
