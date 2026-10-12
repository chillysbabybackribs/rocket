import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accessibleName, DEFAULT_TOOLBAR, normalizeToolbar, rename } from './toolbar.ts'

test('saved toolbar preferences keep custom names and drop unknown sections', () => {
  const prefs = normalizeToolbar({ open: true, order: ['browser', 'nope'], kept: ['library'], names: { library: 'Files', chats: 'History', bogus: 'x' } })
  assert.deepEqual(prefs, { names: { library: 'Files' } })
  assert.deepEqual(normalizeToolbar(null), DEFAULT_TOOLBAR)
  assert.deepEqual(normalizeToolbar('junk'), DEFAULT_TOOLBAR)
})

test('renaming keeps the real name for screen readers, and a blank or default name clears it', () => {
  let prefs = { ...DEFAULT_TOOLBAR, names: rename(DEFAULT_TOOLBAR, 'library', 'Files') }
  assert.equal(accessibleName(prefs, 'library'), 'Files (Library)')
  assert.equal(accessibleName(prefs, 'browser'), 'Browser')
  prefs = { ...prefs, names: rename(prefs, 'library', '   ') }
  assert.deepEqual(prefs.names, {})
  assert.deepEqual(rename(prefs, 'library', 'Library'), {})
  assert.equal(rename(prefs, 'library', 'x'.repeat(40)).library?.length, 24)
})
