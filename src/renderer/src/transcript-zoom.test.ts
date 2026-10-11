import assert from 'node:assert/strict'
import { test } from 'node:test'
import { easeZoom, wheelPixels, zoomTarget, ZOOM_MAX, ZOOM_MIN } from './transcript-zoom.ts'

test('a notch in and a notch out come back to where they started', () => {
  assert.ok(zoomTarget(1, -100) > 1)
  assert.ok(Math.abs(zoomTarget(zoomTarget(1, -100), 100) - 1) < 1e-9)
})

test('the zoom stays within its limits', () => {
  assert.equal(zoomTarget(1, -1e6), ZOOM_MAX)
  assert.equal(zoomTarget(1, 1e6), ZOOM_MIN)
})

test('line and page wheels count in pixels', () => {
  assert.equal(wheelPixels(3, 1), 48)
  assert.equal(wheelPixels(1, 2), 400)
  assert.equal(wheelPixels(-120, 0), -120)
})

test('easing moves part of the way each frame, the same in and out, and lands exactly', () => {
  const up = easeZoom(1, 2, 16)
  const down = easeZoom(2, 1, 16)
  assert.ok(up > 1 && up < 2)
  assert.ok(Math.abs(Math.log(up / 1) + Math.log(down / 2)) < 1e-9, 'in and out are mirror images in log space')
  let shown = 1
  let frames = 0
  while (shown !== 2 && frames < 200) { shown = easeZoom(shown, 2, 16); frames++ }
  assert.equal(shown, 2)
  assert.ok(frames < 40, `settles in ${frames} frames`)
})
