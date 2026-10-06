import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTIONS, PLACES, describeMap, isAction, isPlace } from './app-map.ts'

test('every action with a place names a place that exists, and names are well formed', () => {
  for (const [name, spec] of Object.entries(ACTIONS)) {
    assert.match(name, /^[a-z]+(\.[a-zA-Z]+)+$/, `action ${name}`)
    if ('place' in spec && spec.place) assert.ok(isPlace(spec.place), `action ${name} belongs to unknown place ${spec.place}`)
  }
  for (const [name, spec] of Object.entries(PLACES)) {
    assert.match(name, /^[a-z]+(\.[a-zA-Z]+)*$/, `place ${name}`)
    assert.match(spec.file, /^src\/renderer\//, `place ${name} names its component`)
  }
  assert.ok(isPlace('evals.playgrounds'))
  assert.ok(!isPlace('evals.nowhere'))
  assert.ok(isAction('evals.playgrounds.run'))
  assert.ok(!isAction('toString'))
})

test('the map prints every place and action with its parameters', () => {
  const text = describeMap()
  for (const name of Object.keys(PLACES)) assert.ok(text.includes(`- ${name}`), name)
  for (const name of Object.keys(ACTIONS)) assert.ok(text.includes(`- ${name}`), name)
  assert.ok(text.includes('scenario: scenario id to show'))
  assert.ok(text.indexOf('Places (rocket_ui_go)') < text.indexOf('Actions (rocket_ui_act)'))
})
