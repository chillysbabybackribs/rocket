// Does Electron's (Chromium's) cookie store accept a cookie whose Domain is a public suffix?
// Mirrors cookie-import.ts toElectronCookie(): url from the bare host, `domain` only for dotted hosts.
const { app, session } = require('electron')
const fs = require('node:fs'), path = require('node:path')
app.setPath('userData', process.env.EXP_USER_DATA)
const cases = [
  { label: 'domain cookie .com (public suffix) set via https://bank.com/', details: { url: 'https://bank.com/', name: 'a', value: '1', domain: '.com', secure: true } },
  { label: 'domain cookie .co.uk (public suffix) via https://example.co.uk/', details: { url: 'https://example.co.uk/', name: 'b', value: '1', domain: '.co.uk', secure: true } },
  { label: 'domain cookie .ai (public suffix) via https://claude.ai/', details: { url: 'https://claude.ai/', name: 'c', value: '1', domain: '.ai', secure: true } },
  { label: 'host-only cookie for host "com" via https://com/', details: { url: 'https://com/', name: 'd', value: '1', secure: true } },
  { label: 'domain cookie .github.io (PSL private section) via https://user.github.io/', details: { url: 'https://user.github.io/', name: 'e', value: '1', domain: '.github.io', secure: true } },
  { label: 'host-only cookie for github.io itself via https://github.io/', details: { url: 'https://github.io/', name: 'f', value: '1', secure: true } },
  { label: 'control: domain cookie .claude.ai via https://app.claude.ai/', details: { url: 'https://app.claude.ai/', name: 'g', value: '1', domain: '.claude.ai', secure: true } },
  { label: 'control: host-only cookie app.claude.ai', details: { url: 'https://app.claude.ai/', name: 'h', value: '1', secure: true } },
]
app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:exp')
  const out = []
  for (const c of cases) {
    try { await ses.cookies.set(c.details); out.push({ case: c.label, result: 'accepted' }) }
    catch (e) { out.push({ case: c.label, result: 'rejected', error: String(e.message || e) }) }
  }
  const stored = await ses.cookies.get({})
  out.push({ stored: stored.map(k => ({ name: k.name, domain: k.domain, hostOnly: k.hostOnly })) })
  fs.writeFileSync(path.join(__dirname, 'result.json'), JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, out }, null, 2))
  app.quit()
})
