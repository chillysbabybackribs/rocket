import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CodexAdapter } from './codex.ts'
import type { TurnSink } from './provider.ts'

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

for (const idSource of ['reply', 'notification']) {
  test(`early Stop waits for the Codex turn ID from its ${idSource} and interrupts remotely once`, async () => {
    const adapter = new CodexAdapter(() => {})
    const calls: Array<{ method: string; params: unknown }> = []
    let started!: (reply: unknown) => void
    const internals = adapter as unknown as {
      client: unknown
      onNotification(notification: unknown): void
    }
    internals.client = {
      connected: true,
      request: async (method: string, params: unknown) => {
        calls.push({ method, params })
        if (method === 'thread/start') return { thread: { id: 'thread' } }
        if (method === 'turn/start') return new Promise((resolve) => { started = resolve })
        return {}
      }
    }
    const sink: TurnSink = { session() {}, model() {}, item() {}, delta() {}, usage() {}, activity() {} }
    let settled = false
    const running = adapter.run({ chatId: 'chat', turnId: 'local', cwd: '/work', sessionId: null, model: null, text: 'hello', handoff: null }, sink)
    void running.then(() => { settled = true })
    await tick()
    await adapter.stop('chat')
    assert.equal(settled, false, 'must not discard a remotely starting turn')
    if (idSource === 'notification') {
      internals.onNotification({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'remote' } } })
    }
    started({ turn: { id: 'remote' } })
    await tick()
    await adapter.stop('chat')
    assert.deepEqual(calls.filter((call) => call.method === 'turn/interrupt'), [
      { method: 'turn/interrupt', params: { threadId: 'thread', turnId: 'remote' } }
    ])
    assert.equal(settled, false, 'wait for remote completion after interrupt acknowledgement')
    internals.onNotification({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'remote', status: 'interrupted' } } })
    assert.deepEqual(await running, { status: 'interrupted' })
  })
}
