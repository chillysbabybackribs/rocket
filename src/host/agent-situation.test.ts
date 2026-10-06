import assert from 'node:assert/strict'
import test from 'node:test'
import { agentSituationContext, AGENT_SITUATION } from './agent-situation.ts'

test('agent situation is always returned for every turn, with the map and where the shell is', () => {
  const block = agentSituationContext('Where you are: one chat pane, this chat is pane 0 (ui.pane(0)); no side panel.')
  assert.match(block, /<agent-environment>/)
  assert.ok(block.includes(AGENT_SITUATION))
  assert.ok(block.includes('rocket_ui_snapshot'))
  assert.ok(block.includes('browser_read'))
  assert.ok(block.includes('this chat is pane 0'))
  assert.ok(block.includes('- evals.playgrounds {scenario'))
  assert.ok(block.includes('- evals.runSheet.run {scenario'))
  assert.ok(block.includes('docs/something-plan.md'))
})

test('without a readable window the block says to ask rocket_ui_where', () => {
  const block = agentSituationContext()
  assert.ok(block.includes('call rocket_ui_where'))
  assert.ok(block.includes('Places (rocket_ui_go)'))
})
