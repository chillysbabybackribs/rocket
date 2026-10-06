import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentTab } from '../../shared/types.ts'
import { browserContext } from './browser.ts'

const sampleTabs: AgentTab[] = [{
  id: 't1', url: 'https://example.com/doc', title: 'Doc', active: true, loading: false, agent: true
}]

test('browser context tells research once per chat and provider, then only when tabs change', async () => {
  const link = { request: async () => sampleTabs }
  const context = browserContext(link)
  const first = await context('chat-1', 'codex', true)
  assert.match(first!, /native web search/)
  assert.match(first!, /example.com/)
  const again = await context('chat-1', 'codex', false)
  assert.equal(again, null)
  const other = await context('chat-1', 'claude', true)
  assert.match(other!, /native web search/)
})

test('browser context can carry research alone when no tabs are open yet', async () => {
  const link = { request: async () => [] as AgentTab[] }
  const context = browserContext(link)
  const block = await context('chat-2', 'codex', true)
  assert.match(block!, /browser-research/)
  assert.doesNotMatch(block!, /<browser>/)
})
