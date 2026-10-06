import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Item } from '../../shared/types.ts'
import { TurnTranslator } from './claude.ts'

const stream = (event: Record<string, unknown>) => ({ type: 'stream_event', event })
const restated = (text: string) => ({ type: 'assistant', uuid: 'u', message: { content: [{ type: 'text', text }] } })

/** One streamed text block, as the SDK sends it; the restatement lands before or after the stop. */
function say(translator: TurnTranslator, text: string, restateFirst: boolean): Item[] {
  const messages = [
    stream({ type: 'message_start' }),
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
    stream({ type: 'content_block_delta', index: 0, delta: { text } }),
    ...(restateFirst
      ? [restated(text), stream({ type: 'content_block_stop', index: 0 })]
      : [stream({ type: 'content_block_stop', index: 0 }), restated(text)])
  ]
  return messages.flatMap((message) => translator.handle(message).ops).flatMap((op) => (op.type === 'item' ? [op.item] : []))
}

for (const restateFirst of [false, true]) {
  test(`the same text said twice in a turn is two closed rows (restated ${restateFirst ? 'before' : 'after'} the stop)`, () => {
    const translator = new TurnTranslator('t')
    const rows = [...say(translator, 'Done.', restateFirst), ...say(translator, 'Done.', restateFirst)]
    const closed = rows.filter((item) => item.type === 'assistant' && !item.streaming)
    assert.equal(new Set(rows.map((item) => item.id)).size, 2)
    assert.deepEqual(closed.map((item) => item.type === 'assistant' && item.text), ['Done.', 'Done.'])
    assert.equal(new Set(closed.map((item) => item.id)).size, 2)
  })
}

test('a reply that ends while background tasks run keeps its turn open for the follow-up', async () => {
  const { ClaudeAdapter } = await import('./claude.ts')
  const adapter = new ClaudeAdapter(() => {})
  const items: Item[] = []
  const results: unknown[] = []
  // The adapter's runtime, reduced to what message routing touches; no Claude Code process runs.
  const runtime = {
    alive: true, background: new Set<string>(), woke: [] as string[], cwd: '/w', sessionId: 's', model: null,
    turn: null as unknown, disarmIdle() {}, armIdle() {}
  }
  runtime.turn = {
    request: { chatId: 'c', turnId: 't', cwd: '/w', sessionId: 's', model: null, text: '', handoff: null },
    sink: { item: (item: Item) => items.push(item), delta() {}, session() {}, model() {}, usage() {} },
    translator: new TurnTranslator('t'),
    finish: (result: unknown) => { results.push(result); runtime.turn = null }
  }
  const route = (message: Record<string, unknown>): void => (adapter as unknown as { onMessage: (r: unknown, m: unknown) => void }).onMessage(runtime, message)
  const reply = (text: string): void => {
    route(stream({ type: 'message_start' }))
    route(stream({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }))
    route(stream({ type: 'content_block_delta', index: 0, delta: { text } }))
    route(stream({ type: 'content_block_stop', index: 0 }))
    route({ type: 'result', subtype: 'success' })
  }

  route({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'a1', task_type: 'local_agent', description: 'research' }] })
  reply('Started the research.')
  assert.equal(results.length, 0, 'the turn stays open while the task runs')
  const notice = items.findLast((item) => item.type === 'notice')
  assert.match(notice?.type === 'notice' ? notice.text : '', /Waiting for 1 background task/)

  route({ type: 'system', subtype: 'task_notification', task_id: 'a1', status: 'completed', summary: 'research done', output_file: '' })
  route({ type: 'system', subtype: 'background_tasks_changed', tasks: [] })
  reply('Here is what it found.')
  assert.deepEqual(results, [{ status: 'completed' }], 'the follow-up lands in the same turn and ends it')
  assert.ok(items.some((item) => item.type === 'assistant' && item.text === 'Here is what it found.'))
})
