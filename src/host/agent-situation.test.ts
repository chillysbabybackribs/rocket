import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentEnvironmentContext, agentSituationContext, agentSituationFull, agentSituationIncremental, AGENT_SITUATION
} from './agent-situation.ts'

test('a fresh provider session gets the full agent block with the map', () => {
  const block = agentEnvironmentContext('Where you are: one chat pane, this chat is pane 0 (ui.pane(0)); no side panel.', true)
  assert.match(block, /<agent-environment>/)
  assert.ok(block.includes(AGENT_SITUATION))
  assert.ok(block.includes('rocket_ui_snapshot'))
  assert.ok(block.includes('this chat is pane 0'))
  assert.ok(block.includes('- library {'))
  assert.ok(block.includes('- library.open {id'))
})

test('a resumed session gets only where the shell is and a map pointer', () => {
  const block = agentEnvironmentContext('Where you are: browser open beside the chat.', false)
  assert.match(block, /<agent-environment>/)
  assert.ok(!block.includes('Places (rocket_ui_go)'), 'the map is not repeated')
  assert.ok(block.includes('Where you are: browser open beside the chat.'))
  assert.ok(block.includes('rocket_ui_where'))
})

test('ROCKET_AGENT_SITUATION=full keeps the map on every turn', () => {
  const prev = process.env.ROCKET_AGENT_SITUATION
  process.env.ROCKET_AGENT_SITUATION = 'full'
  try {
    const block = agentEnvironmentContext('Where you are: test.', false)
    assert.ok(block.includes('Places (rocket_ui_go)'))
  } finally {
    if (prev === undefined) delete process.env.ROCKET_AGENT_SITUATION
    else process.env.ROCKET_AGENT_SITUATION = prev
  }
})

test('agentSituationContext is the full block for legacy callers', () => {
  const block = agentSituationContext()
  assert.deepEqual(block, agentSituationFull(null))
})

test('without a readable window the full block says to ask rocket_ui_where', () => {
  const block = agentSituationFull()
  assert.ok(block.includes('call rocket_ui_where'))
  assert.ok(block.includes('Places (rocket_ui_go)'))
})

test('incremental block repeats the unreadable-window hint', () => {
  assert.ok(agentSituationIncremental(null).includes('call rocket_ui_where'))
})
