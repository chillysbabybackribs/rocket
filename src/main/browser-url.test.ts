import assert from 'node:assert/strict'
import { test } from 'node:test'
import { plainUserAgent } from './browser-url.ts'

const DEFAULT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Rocket/0.1.0 Chrome/152.0.7977.130 Electron/44.5.1 Safari/537.36'

test('the plain user agent is Chrome\'s, with the app and Electron names gone', () => {
  assert.equal(plainUserAgent(DEFAULT, 'Rocket'),
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36')
})

test('an app name with regex characters is matched literally', () => {
  const ua = DEFAULT.replace('Rocket/0.1.0', 'My.App+/2.0')
  assert.equal(plainUserAgent(ua, 'My.App+'),
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36')
})

test('a user agent already plain is left alone', () => {
  const plain = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36'
  assert.equal(plainUserAgent(plain, 'Rocket'), plain)
})
