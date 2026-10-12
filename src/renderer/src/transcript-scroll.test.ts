import assert from 'node:assert/strict'
import { test } from 'node:test'
import { distanceFromBottom, distanceFromTop, isAtBottom, isAtTop, scrollToBottom } from './transcript-scroll.ts'

function scroller(height: number, scrollHeight: number, scrollTop = 0): HTMLElement {
  return {
    clientHeight: height,
    scrollHeight,
    scrollTop,
    scrollIntoView: () => {}
  } as unknown as HTMLElement
}

test('edge distance and pinning', () => {
  const box = scroller(400, 1000, 520)
  assert.equal(distanceFromBottom(box), 80)
  assert.equal(distanceFromTop(box), 520)
  assert.equal(isAtBottom(box), true)
  assert.equal(isAtTop(box), false)
  box.scrollTop = 0
  assert.equal(isAtTop(box), true)
  assert.equal(isAtBottom(box), false)
})

test('scrollToBottom sets scrollTop to scrollHeight', () => {
  const box = scroller(400, 900, 100)
  scrollToBottom(box)
  assert.equal(box.scrollTop, 900)
})
