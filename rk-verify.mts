import { app, session } from 'electron'
import { detectCookieSources, defaultCookieSource, importCookies } from './src/main/cookie-import.ts'
app.whenReady().then(async () => {
  const sources = detectCookieSources()
  console.log('RK detected:', sources.map(s => `${s.id}(${s.family})`).join(', '))
  const def = defaultCookieSource(sources)
  console.log('RK default:', def?.id)
  const ses = session.fromPartition('persist:verify-cookies')
  const r = await importCookies(ses, def!)
  console.log('RK import result:', JSON.stringify(r))
  console.log('RK cookies now:', (await ses.cookies.get({})).length)
  console.log('RK claude.ai:', (await ses.cookies.get({ domain: 'claude.ai' })).length, 'x.com:', (await ses.cookies.get({ domain: 'x.com' })).length)
  const ses2 = session.fromPartition('persist:verify-cookies-2')
  const r2 = await importCookies(ses2, def!, 'claude.ai')
  console.log('RK site-only:', JSON.stringify(r2), 'total:', (await ses2.cookies.get({})).length)
  app.exit(0)
})
