import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Item } from './types.ts'
import { chipBounds, describeStep, doneLabel, fillPrompt, fillSources, parseFillReply, voiceSamples, type FillField, type FillTarget } from './fill.ts'

const field = (id: string, label: string, extra: Partial<FillField> = {}): FillField => ({
  id, label, kind: 'text', inputType: '', value: '', placeholder: '', required: false, maxLength: null, selector: `#${id}`, ...extra
})

const target: FillTarget = {
  tab: 't4',
  url: 'https://forum.example/t/float',
  title: 'Permanently float windows?',
  mode: 'field',
  fields: [field('f1', 'Your reply')],
  skipped: [],
  context: 'Is there a way to permanently enable floating windows?'
}

test('the prompt says where the field is, what is around it and how to answer', () => {
  const prompt = fillPrompt(target, 'fill', null)
  assert.match(prompt, /tab t4 · Permanently float windows\? · https:\/\/forum\.example\/t\/float/)
  assert.match(prompt, /- f1 · "Your reply" \(multi-line text box, selector #f1\) · empty/)
  assert.match(prompt, /"""\nIs there a way to permanently enable floating windows\?\n"""/)
  assert.match(prompt, /never navigate, click, type or submit there/)
  assert.match(prompt, /```rocket-fill\n\{"fields": \{"f1": "…"\}/)
  assert.doesNotMatch(prompt, /user-messages/)
})

test('a rework says what to change, and Sound like you carries the user\'s messages', () => {
  const holding = { ...target, fields: [field('f1', 'Your reply', { value: 'That is expected.\nFloat is static.' })] }
  const shorter = fillPrompt(holding, 'shorter', null)
  assert.match(shorter, /Make it shorter/)
  assert.match(shorter, /It holds now:\n {4}That is expected\.\n {4}Float is static\./)
  const voice = fillPrompt(holding, 'voice', 'keep the code', ['yeah lets do it -- go', 'ok approved - build it'])
  assert.match(voice, /<user-messages>\nyeah lets do it -- go\n---\nok approved - build it\n<\/user-messages>/)
  assert.match(voice, /The user's instructions for this: keep the code/)
  assert.match(voice, /do not research again/)
})

test('a form lists every field and the ones Rocket will not touch', () => {
  const form: FillTarget = {
    ...target, mode: 'form',
    fields: [field('f1', 'Title', { kind: 'line' }), field('f2', 'Email', { kind: 'line', inputType: 'email', required: true })],
    skipped: [{ label: 'Password', reason: 'a password' }]
  }
  const prompt = fillPrompt(form, 'fill', null)
  assert.match(prompt, /a form with 2 fields to fill/)
  assert.match(prompt, /- f2 · "Email" \(one-line email input, required, selector #f2\) · empty/)
  assert.match(prompt, /Not for you \(leave these alone\): "Password" \(a password\)/)
})

test('the fill block is read from the end of the reply, whatever came before it', () => {
  const reply = [
    'I checked the wiki first.',
    '```lua',
    'hl.window_rule({})',
    '```',
    '```rocket-fill',
    '{"fields": {"f1": "line one\\n```lua\\ncode\\n```", "f9": "not asked for"}, "left": {"f2": "needs your email", "f1": "ignored"}}',
    '```'
  ].join('\n')
  assert.deepEqual(parseFillReply(reply, ['f1', 'f2']), {
    values: { f1: 'line one\n```lua\ncode\n```' },
    left: { f2: 'needs your email' }
  })
})

test('a reply without a usable fill says so in a sentence', () => {
  assert.throws(() => parseFillReply('Here you go: hello', ['f1']), /answered without a fill/)
  assert.throws(() => parseFillReply('```rocket-fill\n{"fields": \n```', ['f1']), /could not be read/)
  assert.throws(() => parseFillReply('```rocket-fill\n{"fields": {}, "left": {"f1": "it asks for your phone number"}}\n```', ['f1']), /left it for you: it asks for your phone number/)
})

const tool = (kind: Extract<Item, { type: 'tool' }>['kind'], label: string, status: 'running' | 'done' = 'running'): Item =>
  ({ type: 'tool', id: label, turnId: 't', kind, label, status, output: '' })

test('steps are read from the model\'s own calls', () => {
  const page = 'https://forum.example/t/float'
  assert.equal(describeStep(tool('mcp', 'rocket · browser_read {"tab":"t4"}'), page), 'Reading the page')
  assert.equal(describeStep(tool('mcp', 'rocket · browser_read {"url":"https://wiki.hypr.land/configuring/core/rules/window-rules/"}'), page), 'Opening wiki.hypr.land/configuring/core/rules/window-rules')
  assert.equal(describeStep(tool('web', 'hyprland float window rule'), page), 'Searching the web for “hyprland float window rule”')
  assert.equal(describeStep(tool('command', 'hyprctl version'), page), 'Running hyprctl version')
  assert.equal(describeStep({ type: 'assistant', id: 'a', turnId: 't', text: '', streaming: true }, page), 'Writing the answer')
  assert.equal(describeStep({ type: 'notice', id: 'n', turnId: 't', text: '', tone: 'info' }, page), null)
})

test('sources are each page once, the page itself named, and the commands that ran', () => {
  const sources = fillSources(
    [{ url: 'https://forum.example/t/float' }, { url: 'https://wiki.hypr.land/rules/' }, { url: 'https://wiki.hypr.land/rules' }],
    [tool('command', 'hyprctl version', 'done'), tool('command', 'hyprctl version', 'done'), tool('command', 'ls', 'running')],
    'https://www.forum.example/t/float'
  )
  assert.deepEqual(sources.map((source) => source.title), ['This page', 'wiki.hypr.land/rules', 'Ran hyprctl version'])
})

test('voice samples skip pasted text, one-word replies and walls of text', () => {
  const samples = voiceSamples([
    'ok',
    'change humanize to Sound like you - thats much better',
    '<pasted_content id="x">a log</pasted_content>',
    'x'.repeat(2_000),
    'change humanize to Sound like you - thats much better',
    'when i click add instructions it highlights the text'
  ])
  assert.deepEqual(samples, ['change humanize to Sound like you - thats much better', 'when i click add instructions it highlights the text'])
})

test('the done line says what was filled and what was left', () => {
  assert.deepEqual(doneLabel('voice', [field('f1', 'Reply')], ['f1'], {}), { label: 'In your voice', warn: null, detail: null })
  const fields = [field('f1', 'Title'), field('f2', 'Contact email')]
  assert.deepEqual(doneLabel('fill', fields, ['f1'], { f2: 'needs your email' }), {
    label: '1 of 2', warn: '1 for you', detail: 'Left for you: Contact email (needs your email)'
  })
})

test('the chip sits above the field\'s top right corner, below it with no room above, and inside the page', () => {
  const page = { x: 100, y: 50, width: 900, height: 700 }
  // A field in the middle of the page: the chip's right edge meets the field's, just above it.
  assert.deepEqual(chipBounds(page, { x: 40, y: 300, width: 640, height: 150 }, 1, 34), { x: 270, y: 300, width: 520, height: 54 })
  // At the top of the page there is no room above, so it goes under the field.
  assert.equal(chipBounds(page, { x: 40, y: 10, width: 640, height: 150 }, 1, 34).y, 50 + 160 + 6 - 10)
  // A narrow field near the left edge does not push it off the page.
  assert.equal(chipBounds(page, { x: 10, y: 300, width: 120, height: 40 }, 1, 34).x, 100 + 4 - 10)
  // Zoomed pages are measured in their own pixels.
  assert.equal(chipBounds(page, { x: 20, y: 150, width: 320, height: 75 }, 2, 34).x, 270)
})
