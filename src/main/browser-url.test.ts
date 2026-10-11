import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clientHintHeaders, completeAddress, parseAcceptCh, plainUserAgent, userAgentMetadata } from './browser-url.ts'

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

// The expected values follow Chrome's algorithm in components/embedder_support/user_agent_utils.cc:
// seed 152 → GREASE "Not?A_Brand" v24 (152 % 11 = 9 → "?", 153 % 11 = 10 → "_", 152 % 3 = 2 → "24"),
// order kOrders[152 % 6 = 2] = {1, 0, 2}, which puts Chromium first, the GREASE brand second.
test('client hints for Chrome 152 on Linux are what Chrome itself would send', () => {
  const plain = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36'
  assert.deepEqual(userAgentMetadata(plain), {
    brands: [
      { brand: 'Chromium', version: '152' },
      { brand: 'Not?A_Brand', version: '24' },
      { brand: 'Google Chrome', version: '152' }
    ],
    fullVersionList: [
      { brand: 'Chromium', version: '152.0.7977.130' },
      { brand: 'Not?A_Brand', version: '24.0.0.0' },
      { brand: 'Google Chrome', version: '152.0.7977.130' }
    ],
    platform: 'Linux',
    platformVersion: '',
    architecture: 'x86',
    bitness: '64',
    model: '',
    mobile: false,
    wow64: false
  })
})

// seed 150 → "Not;A=Brand" v8, order kOrders[0] = {0, 1, 2}: the GREASE brand leads.
test('the GREASE brand and the order change with the major version, as in Chrome', () => {
  const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7400.1 Safari/537.36'
  const meta = userAgentMetadata(ua)
  assert.deepEqual(meta?.brands, [
    { brand: 'Not;A=Brand', version: '8' },
    { brand: 'Chromium', version: '150' },
    { brand: 'Google Chrome', version: '150' }
  ])
  assert.equal(meta?.fullVersionList[0].version, '8.0.0.0')
})

test('a user agent that is not Chrome on Linux gets no client hints', () => {
  assert.equal(userAgentMetadata('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'), null)
  assert.equal(userAgentMetadata('Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0'), null)
})

const CHROME_152 = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36'

test('every request carries the three low-entropy hints, serialized as Chrome writes them', () => {
  assert.deepEqual(clientHintHeaders(userAgentMetadata(CHROME_152)!), {
    'Sec-CH-UA': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Linux"'
  })
})

test('an origin that asked with Accept-CH also gets the high-entropy hints it named', () => {
  const asked = parseAcceptCh('Sec-CH-UA-Platform-Version, Sec-CH-UA-Full-Version-List, Sec-CH-UA-Arch, Sec-CH-UA-Form-Factors, Viewport-Width')
  assert.deepEqual(asked, ['sec-ch-ua-platform-version', 'sec-ch-ua-full-version-list', 'sec-ch-ua-arch', 'sec-ch-ua-form-factors'])
  const headers = clientHintHeaders(userAgentMetadata(CHROME_152)!, asked)
  assert.equal(headers['Sec-CH-UA-Platform-Version'], '""')
  assert.equal(headers['Sec-CH-UA-Full-Version-List'], '"Chromium";v="152.0.7977.130", "Not?A_Brand";v="24.0.0.0", "Google Chrome";v="152.0.7977.130"')
  assert.equal(headers['Sec-CH-UA-Arch'], '"x86"')
  assert.equal(headers['Sec-CH-UA-Form-Factors'], '"Desktop"')
  assert.equal(headers['Sec-CH-UA-Model'], undefined, 'a hint not asked for is not sent')
  assert.equal(Object.keys(headers).length, 7)
})

test('Accept-CH given as several header lines is read as one list', () => {
  assert.deepEqual(parseAcceptCh(['Sec-CH-UA-Bitness', ' sec-ch-ua-wow64 ']), ['sec-ch-ua-bitness', 'sec-ch-ua-wow64'])
  assert.deepEqual(parseAcceptCh(undefined), [])
})

test('the address field fills in the most visited site that starts with what is typed', () => {
  const now = Date.UTC(2026, 9, 10)
  const pages = [
    { url: 'https://github.com/anthropics/claude-code', visits: 30, last: now },
    { url: 'https://github.com/', visits: 5, last: now },
    { url: 'https://www.gitlab.com/', visits: 2, last: now },
    { url: 'https://www.google.com/search?q=one', visits: 50, last: now },
    { url: 'http://localhost:5173/', visits: 3, last: now }
  ]
  assert.equal(completeAddress('gi', pages, now), 'github.com')
  assert.equal(completeAddress('GitL', pages, now), 'gitlab.com')
  assert.equal(completeAddress('go', pages, now), 'google.com')
  assert.equal(completeAddress('www.goo', pages, now), 'www.google.com')
  assert.equal(completeAddress('github.com/an', pages, now), 'github.com/anthropics/claude-code')
  assert.equal(completeAddress('local', pages, now), 'localhost:5173')
})

test('nothing is filled in for a search, a scheme, a finished address or an unknown site', () => {
  const pages = [{ url: 'https://github.com/', visits: 5, last: 0 }]
  assert.equal(completeAddress('git hub', pages, 0), null)
  assert.equal(completeAddress('https://gi', pages, 0), null)
  assert.equal(completeAddress('github.com', pages, 0), null)
  assert.equal(completeAddress('youtu', pages, 0), null)
  assert.equal(completeAddress('', pages, 0), null)
})
