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
