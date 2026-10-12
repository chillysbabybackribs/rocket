import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accessibleName, arrange, DEFAULT_TOOLBAR, moveSection, normalizeToolbar, rename, setKept, type ToolbarPrefs } from './toolbar.ts'

test('saved toolbar preferences drop unknown sections and add missing ones', () => {
  const prefs = normalizeToolbar({ open: true, order: ['browser', 'nope', 'chats', 'browser'], kept: ['library', 'library', 7], names: { chats: '  History  ', library: 'Library', bogus: 'x' } })
  assert.deepEqual(prefs.order, ['browser', 'chats', 'library'])
  assert.deepEqual(prefs.kept, ['library'])
  assert.deepEqual(prefs.names, { chats: 'History' })
  assert.equal(prefs.open, true)
  assert.deepEqual(normalizeToolbar(null), DEFAULT_TOOLBAR)
  assert.deepEqual(normalizeToolbar('junk'), DEFAULT_TOOLBAR)
})

test('renaming keeps the real name for screen readers, and a blank or default name clears it', () => {
  let prefs: ToolbarPrefs = { ...DEFAULT_TOOLBAR, names: rename(DEFAULT_TOOLBAR, 'chats', 'History') }
  assert.equal(accessibleName(prefs, 'chats'), 'History (Chats)')
  assert.equal(accessibleName(prefs, 'library'), 'Library')
  prefs = { ...prefs, names: rename(prefs, 'chats', '   ') }
  assert.deepEqual(prefs.names, {})
  assert.deepEqual(rename(prefs, 'library', 'Library'), {})
  assert.equal(rename(prefs, 'library', 'x'.repeat(40)).library?.length, 24)
})

test('keeping and moving sections splits them between the toolbar and the drawer in order', () => {
  let prefs: ToolbarPrefs = { ...DEFAULT_TOOLBAR }
  prefs = { ...prefs, kept: setKept(prefs, 'browser', true) }
  prefs = { ...prefs, kept: setKept(prefs, 'library', true) }
  prefs = { ...prefs, order: moveSection(prefs.order, 'browser', 'chats') }
  assert.deepEqual(prefs.order, ['browser', 'chats', 'library'])
  assert.deepEqual(arrange(prefs), { kept: ['browser', 'library'], drawer: ['chats'] })
  prefs = { ...prefs, kept: setKept(prefs, 'library', false) }
  assert.deepEqual(arrange(prefs).kept, ['browser'])
  assert.deepEqual(moveSection(prefs.order, 'library', null), ['browser', 'chats', 'library'])
  assert.deepEqual(moveSection(prefs.order, 'library', 'library'), prefs.order)
})
