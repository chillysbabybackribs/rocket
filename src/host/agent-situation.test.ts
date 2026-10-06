import assert from 'node:assert/strict'
import test from 'node:test'
import { agentSituationContext, AGENT_SITUATION } from './agent-situation.ts'

test('agent situation is always returned for every turn', () => {
  const block = agentSituationContext()
  assert.match(block, /<agent-environment>/)
  assert.ok(block.includes(AGENT_SITUATION))
  assert.ok(block.includes('rocket_ui_snapshot'))
  assert.ok(block.includes('browser_read'))
})
