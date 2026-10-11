import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WebContents } from 'electron'
import { readingOf, ReadingScroll } from './reading-scroll.ts'

test("the page's reading status is kept only while it reads, and rounded for the toolbar", () => {
  assert.deepEqual(readingOf({ state: 'running', progress: 0.12345, secondsLeft: 31.6 }), { state: 'running', progress: 0.123, secondsLeft: 32 })
  assert.deepEqual(readingOf({ state: 'end', progress: 1.4, secondsLeft: -3 }), { state: 'end', progress: 1, secondsLeft: 0 })
  assert.deepEqual(readingOf({ state: 'paused', progress: 'x', secondsLeft: Number.NaN }), { state: 'paused', progress: 0, secondsLeft: 0 })
  assert.equal(readingOf({ state: 'off', progress: 0, secondsLeft: 0 }), null)
  assert.equal(readingOf(undefined), null)
  assert.equal(readingOf('running'), null)
})

test('a page gets the reader library once, and again only after it has lost it', async () => {
  const sent: string[] = []
  let loaded = false
  // A fake page: the library is the one call that starts with the bundled function's parenthesis.
  const page = {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: async (_world: number, [{ code }]: Array<{ code: string }>) => {
      if (code.startsWith('(')) {
        sent.push('library')
        loaded = true
      } else {
        sent.push('call')
        if (!loaded) throw new Error('globalThis.__rocketReader is not defined')
      }
      return { state: 'running', progress: 0.5, secondsLeft: 10 }
    }
  } as unknown as WebContents
  const reader = new ReadingScroll(() => undefined, () => page)
  try {
    await reader.start(page)
    await reader.toggle(page)
    assert.deepEqual(sent, ['library', 'call'])
    // A new document: the call fails, and the library goes with the retry.
    loaded = false
    await reader.toggle(page)
    assert.deepEqual(sent, ['library', 'call', 'call', 'library'])
  } finally {
    reader.dispose()
  }
})
