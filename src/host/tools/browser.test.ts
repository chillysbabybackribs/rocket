import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentTab } from '../../shared/types.ts'
import { browserContext, browserTools, BROWSER_RESEARCH_GUIDE } from './browser.ts'

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
