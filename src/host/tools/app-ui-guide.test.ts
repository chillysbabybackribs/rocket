import assert from 'node:assert/strict'
import test from 'node:test'
import { appUiContext, APP_UI_GUIDE } from './app-ui-guide.ts'

test('fresh sessions get rocket-app context', () => {
  const block = appUiContext(() => [], 'chat-1', true)
  assert.ok(block?.includes('<rocket-app>'))
  assert.ok(block?.includes('rocket_ui_snapshot'))
})

test('resumed sessions skip context unless editing renderer', () => {
  assert.equal(appUiContext(() => [], 'chat-1', false), null)
  const block = appUiContext(
    () => [{ chatId: 'chat-1', provider: 'claude', model: null, request: '', edited: ['src/renderer/src/App.tsx'] }],
    'chat-1',
    false
  )
  assert.ok(block?.includes(APP_UI_GUIDE.slice(0, 40)))
})
