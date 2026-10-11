import assert from 'node:assert/strict'
import test from 'node:test'
import { contextMeterLabel } from './context-meter.ts'

test('context meter shows a percentage when the window size is known', () => {
  assert.equal(contextMeterLabel({ input: 1, cached: 0, output: 1, context: 50_000, contextWindow: 200_000 }), '25% context')
})

test('context meter falls back to token count without a window size', () => {
  assert.equal(contextMeterLabel({ input: 1, cached: 0, output: 1, context: 30_000, contextWindow: null }), '30k context')
})

test('context meter is hidden when the provider reports nothing', () => {
  assert.equal(contextMeterLabel(null), null)
  assert.equal(contextMeterLabel({ input: 0, cached: 0, output: 0, context: null, contextWindow: null }), null)
})
