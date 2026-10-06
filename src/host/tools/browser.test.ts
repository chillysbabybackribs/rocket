import assert from 'node:assert/strict'
import test from 'node:test'
import { homedir } from 'node:os'
import type { AgentTab, BrowserAgentOp, BrowserDownload } from '../../shared/types.ts'
import { browserContext, browserTools, describeDownload, savePath, BROWSER_RESEARCH_GUIDE } from './browser.ts'

const sampleTabs: AgentTab[] = [{
  id: 't1', url: 'https://example.com/doc', title: 'Doc', active: true, loading: false, agent: true
}]

test('browser context names the open tabs to a new session, then only when they change', async () => {
  let tabs = sampleTabs
  const context = browserContext({ request: async () => tabs })
  const first = await context('chat-1', 'codex', true)
  assert.match(first!, /<browser>[\s\S]*example\.com/)
  assert.equal(await context('chat-1', 'codex', false), null)
  assert.match((await context('chat-1', 'claude', true))!, /example\.com/, 'each provider session is told for itself')
  tabs = [...sampleTabs, { ...sampleTabs[0]!, id: 't2', url: 'https://example.org/', active: false }]
  assert.match((await context('chat-1', 'codex', false))!, /example\.org/)
})

test('browser context says nothing with no tabs open, and research guidance rides in the tool description only', async () => {
  const context = browserContext({ request: async () => [] as AgentTab[] })
  assert.equal(await context('chat-2', 'codex', true), null)
  const read = browserTools({ request: async () => null }, '/tmp/unused').find((tool) => tool.name === 'browser_read')!
  assert.ok(read.description.includes(BROWSER_RESEARCH_GUIDE))
})

test('browser_download sends main an absolute saveTo, and reports where the file went', async () => {
  const asked: BrowserAgentOp[] = []
  const done: BrowserDownload = { id: 'd1', chat: 'chat-1', url: 'https://example.com/a.pdf', name: 'a.pdf', path: '/work/files/a.pdf', mime: 'application/pdf', size: 2048, received: 2048, state: 'completed', startedAt: 1 }
  const download = browserTools({ request: async (op) => { asked.push(op); return done } }, '/tmp/unused', () => '/work').find((tool) => tool.name === 'browser_download')!
  const result = await download.run({ url: 'https://example.com/a.pdf', saveTo: 'files/' }, { provider: 'claude', chatId: 'chat-1' })
  assert.deepEqual(asked[0], { op: 'download', chat: 'chat-1', tab: null, url: 'https://example.com/a.pdf', target: null, saveTo: '/work/files/', timeout: 120_000 })
  assert.equal(result.isError, false)
  assert.match(result.content[0]!.type === 'text' ? result.content[0]!.text : '', /Downloaded a\.pdf \(2\.0 KB, application\/pdf\) to \/work\/files\/a\.pdf/)
  const neither = await download.run({}, { provider: 'claude', chatId: 'chat-1' })
  assert.equal(neither.isError, true)
  const both = await download.run({ url: 'x', click: 'e1' }, { provider: 'claude', chatId: 'chat-1' })
  assert.equal(both.isError, true)
  assert.equal(asked.length, 1, 'a call with neither or both is refused before main is asked')
})

test('saveTo paths resolve from the chat folder or home, and downloads in flight say so', () => {
  assert.equal(savePath('', '/work'), null)
  assert.equal(savePath('/abs/file.zip', '/work'), '/abs/file.zip')
  assert.equal(savePath('~/Desktop/', '/work'), `${homedir()}/Desktop/`)
  assert.equal(savePath('out/report.pdf', '/work'), '/work/out/report.pdf')
  assert.equal(savePath('out', null), `${homedir()}/out`)
  const base: BrowserDownload = { id: 'd2', chat: 'c', url: 'https://example.com/big.iso', name: 'big.iso', path: '/d/big.iso', mime: '', size: 4 * 1024 * 1024, received: 1024 * 1024, state: 'progressing', startedAt: 1 }
  assert.match(describeDownload(base, 120), /Still downloading after 120s: 1\.0 MB so far \(25% of 4\.0 MB\)\. It will be at \/d\/big\.iso/)
  assert.match(describeDownload({ ...base, state: 'interrupted' }, 5), /was interrupted/)
})
