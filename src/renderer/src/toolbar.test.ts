import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accessibleName, arrange, DEFAULT_TOOLBAR, moveSection, normalizeToolbar, rename, setKept, type ToolbarPrefs } from './toolbar.ts'

test('saved toolbar preferences drop unknown sections and add missing ones', () => {
  const prefs = normalizeToolbar({ open: true, order: ['browser', 'nope', 'goals', 'browser'], kept: ['evals', 'evals', 7], names: { chats: '  History  ', library: 'Library', bogus: 'x' } })
  assert.deepEqual(prefs.order, ['browser', 'goals', 'chats', 'library', 'evals'])
  assert.deepEqual(prefs.kept, ['evals'])
  assert.deepEqual(prefs.names, { chats: 'History' })
  assert.equal(prefs.open, true)
  assert.deepEqual(normalizeToolbar(null), DEFAULT_TOOLBAR)
  assert.deepEqual(normalizeToolbar('junk'), DEFAULT_TOOLBAR)
})

test('renaming keeps the real name for screen readers, and a blank or default name clears it', () => {
  let prefs: ToolbarPrefs = { ...DEFAULT_TOOLBAR, names: rename(DEFAULT_TOOLBAR, 'chats', 'History') }
  assert.equal(accessibleName(prefs, 'chats'), 'History (Chats)')
  assert.equal(accessibleName(prefs, 'goals'), 'Goals')
  prefs = { ...prefs, names: rename(prefs, 'chats', '   ') }
  assert.deepEqual(prefs.names, {})
  assert.deepEqual(rename(prefs, 'evals', 'Evals'), {})
  assert.equal(rename(prefs, 'evals', 'x'.repeat(40)).evals?.length, 24)
})

test('keeping and moving sections splits them between the toolbar and the drawer in order', () => {
  let prefs: ToolbarPrefs = { ...DEFAULT_TOOLBAR }
  prefs = { ...prefs, kept: setKept(prefs, 'browser', true) }
  prefs = { ...prefs, kept: setKept(prefs, 'goals', true) }
  prefs = { ...prefs, order: moveSection(prefs.order, 'browser', 'chats') }
  assert.deepEqual(prefs.order, ['goals', 'browser', 'chats', 'library', 'evals'])
  assert.deepEqual(arrange(prefs), { kept: ['goals', 'browser'], drawer: ['chats', 'library', 'evals'] })
  prefs = { ...prefs, kept: setKept(prefs, 'goals', false) }
  assert.deepEqual(arrange(prefs).kept, ['browser'])
  assert.deepEqual(moveSection(prefs.order, 'goals', null), ['browser', 'chats', 'library', 'evals', 'goals'])
  assert.deepEqual(moveSection(prefs.order, 'goals', 'goals'), prefs.order)
})
