import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { photocraftWebDir, staticFile } from './photocraft-files.ts'

test('requests read files inside the build folder and nothing outside it', () => {
  const root = '/srv/photocraft/dist/web'
  assert.equal(staticFile(root, '/'), `${root}/index.html`)
  assert.equal(staticFile(root, '/photocraft-web-1_bg.wasm'), `${root}/photocraft-web-1_bg.wasm`)
  assert.equal(staticFile(root, '/fonts/manifest.txt'), `${root}/fonts/manifest.txt`)
  assert.equal(staticFile(root, '/../secret'), null)
  assert.equal(staticFile(root, '/%2e%2e/%2e%2e/etc/passwd'), null)
  assert.equal(staticFile(root, '/%E0%A4%A'), null, 'a malformed escape is refused, not thrown')
})

test('the build folder comes from ROCKET_PHOTOCRAFT_WEB, else the fork\'s dist/web', () => {
  assert.equal(photocraftWebDir({ ROCKET_PHOTOCRAFT_WEB: '/tmp/pc/' }), '/tmp/pc')
  assert.equal(photocraftWebDir({}), join(homedir(), 'src/photocraft/dist/web'))
})
