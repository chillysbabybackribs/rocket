import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BrowserDownload, Item, Turn } from '../shared/types.ts'
import { jpegBase64 } from '../../tests/fixtures/image.ts'
import { pdfBytes } from '../../tests/fixtures/pdf.ts'
import { AttachmentStore } from './attachments.ts'
import { Library } from './library.ts'
import { Store } from './store.ts'
import { libraryTools } from './tools/library.ts'

async function setup(downloads: BrowserDownload[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'rocket-library-'))
  const store = new Store(join(root, 'rocket.db'))
  const attachments = new AttachmentStore(store, join(root, 'attachments'))
  let changes = 0
  const library = new Library(store, attachments, join(root, 'previews'), {
    hidden: (chatId) => store.chat(chatId)?.cwd.startsWith('/evals') ?? false,
    changed: () => { changes++ },
    downloads: async () => downloads
  })
  const chat = (id: string, cwd = root): void => store.createChat({ id, title: `Chat ${id}`, cwd, lastProvider: null, createdAt: 1, updatedAt: 1 })
  return { root, store, attachments, library, chat, changes: () => changes, done: async () => { store.close(); await rm(root, { recursive: true, force: true }) } }
}

const turn = (chatId: string, startedAt = 0): Turn => ({
  id: `t-${chatId}`, chatId, provider: 'claude', model: null, status: 'completed', error: null, handoffTurns: 0, goalRole: null, changes: null, tokens: null, sources: null, startedAt, endedAt: startedAt + 1
} as Turn)

test('sent attachments are on the shelf with their chat; a draft’s and an eval chat’s are not', async () => {
  const { store, attachments, library, chat, done } = await setup()
  try {
    chat('c1')
    chat('evals', '/evals/run')
    const sent = await attachments.importFile('brief.pdf', pdfBytes('Quarterly brief'))
    const draft = await attachments.importFile('draft.md', Buffer.from('# Draft\n'))
    const hidden = await attachments.importFile('eval.md', Buffer.from('# Eval\n'))
    store.createTurn(turn('c1'))
    store.putItem('c1', { type: 'user', id: 'u1', turnId: 't-c1', text: 'Read this', attachments: [sent] } as Item)
    store.createTurn(turn('evals'))
    store.putItem('evals', { type: 'user', id: 'u2', turnId: 't-evals', text: 'Eval', attachments: [hidden] } as Item)
    const entries = library.list()
    assert.deepEqual(entries.map((each) => each.name), ['brief.pdf'])
    assert.equal(entries[0]!.chatId, 'c1')
    assert.equal(entries[0]!.kind, 'pdf')
    assert.equal(entries[0]!.pages, 1)
    assert.ok(!entries.some((each) => each.id === draft.id))
    const preview = await library.preview(sent.id)
    assert.equal(preview.type, 'page')
    const view = await library.view(sent.id)
    assert.equal(view.type, 'pdf')
  } finally {
    await done()
  }
})

test('one entry is looked up by id, and a draft or hidden chat’s id is refused as before', async () => {
  const { root, store, attachments, library, chat, done } = await setup()
  try {
    chat('c1')
    chat('evals', '/evals/run')
    const sent = await attachments.importFile('brief.md', Buffer.from('# Brief\n'))
    const draft = await attachments.importFile('draft.md', Buffer.from('# Draft\n'))
    const hidden = await attachments.importFile('eval.md', Buffer.from('# Eval\n'))
    store.createTurn(turn('c1'))
    store.putItem('c1', { type: 'user', id: 'u1', turnId: 't-c1', text: 'Read this', attachments: [sent] } as Item)
    store.createTurn(turn('evals'))
    store.putItem('evals', { type: 'user', id: 'u2', turnId: 't-evals', text: 'Eval', attachments: [hidden] } as Item)
    assert.equal(library.entry(sent.id).name, 'brief.md')
    assert.equal(library.entry(sent.id).chatId, 'c1')
    assert.throws(() => library.entry(draft.id), /There is no library file/)
    assert.throws(() => library.entry(hidden.id), /There is no library file/)
    assert.throws(() => library.entry('f999'), /There is no library file/)
    const path = join(root, 'plan.md')
    await writeFile(path, '# Plan\n')
    const plan = await library.add(path, 'plan', 'c1')
    assert.equal(library.entry(plan!.id).path, path)
  } finally {
    await done()
  }
})

test('files join by path once, keep where they first came from, and show when they go missing', async () => {
  const { root, library, chat, changes, done } = await setup()
  try {
    chat('c1')
    const plan = join(root, 'plan.md')
    await writeFile(plan, '# The plan\n\nShip the library.\n')
    const first = await library.add(plan, 'plan', 'c1')
    const again = await library.add(plan, 'opened', 'c1')
    assert.equal(first?.id, again?.id)
    assert.equal(library.list()[0]!.source, 'plan')
    assert.equal(changes(), 2)
    assert.equal(await library.add(join(root, 'nothing.md'), 'opened', 'c1'), null)
    assert.equal(await library.add('relative.md', 'opened', 'c1'), null)
    const preview = await library.preview(first!.id)
    assert.deepEqual(preview, { type: 'text', text: '# The plan\n\nShip the library.\n', markdown: true })
    // A PDF is known by its bytes, whatever its name says.
    const odd = join(root, 'download')
    await writeFile(odd, pdfBytes('Odd name'))
    assert.equal((await library.add(odd, 'opened', null))?.kind, 'pdf')
    await rm(plan)
    const gone = library.list().find((each) => each.id === first!.id)!
    assert.equal(gone.missing, true)
    assert.equal((await library.view(gone.id)).type, 'none')
  } finally {
    await done()
  }
})

test('a turn’s finished downloads join the shelf with the site they came from', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'rocket-downloads-'))
  const path = join(folder, 'paper.pdf')
  await writeFile(path, pdfBytes('Paper'))
  const download = (state: BrowserDownload['state'], file: string): BrowserDownload => ({ id: 'd1', chat: 'c1', url: 'https://arxiv.org/pdf/2210.03629', name: 'paper.pdf', path: file, mime: 'application/pdf', size: 1, received: 1, state, startedAt: 1 })
  const { library, chat, done } = await setup([download('completed', path), download('cancelled', join(folder, 'half.pdf'))])
  try {
    chat('c1')
    await library.turnEnded(turn('c1'), [])
    const entries = library.list()
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.source, 'download')
    assert.equal(entries[0]!.origin, 'arxiv.org')
  } finally {
    await done()
    await rm(folder, { recursive: true, force: true })
  }
})

test('library_list lists with the panel’s filters, "this" chat included, and refuses unknown values', async () => {
  const { root, library, chat, store, done } = await setup()
  try {
    chat('c1')
    chat('c2')
    for (const [name, chatId] of [['notes.md', 'c1'], ['data.json', 'c2'], ['photo.png', 'c1']] as const) {
      const path = join(root, name)
      await writeFile(path, name.endsWith('.png') ? Buffer.from([0x89, 0x50]) : 'text')
      await library.add(path, 'opened', chatId)
    }
    const [tool] = libraryTools(library, store)
    const text = async (args: Record<string, unknown>, chatId: string | null = 'c1') => {
      const result = await tool!.run(args, { provider: 'claude', chatId })
      return { error: result.isError === true, text: result.content.map((part) => (part.type === 'text' ? part.text : '')).join('') }
    }
    const mine = await text({ chat: 'this' })
    assert.match(mine.text, /^2 of 3 files/)
    assert.match(mine.text, /notes\.md/)
    assert.match(mine.text, /\(this chat\)/)
    assert.doesNotMatch(mine.text, /data\.json/)
    assert.match((await text({ kind: 'image' })).text, /^1 of 3 files.*\n.*photo\.png/)
    assert.match((await text({ q: 'nothing like it' })).text, /No files match/)
    assert.equal((await text({ kind: 'spreadsheet' })).error, true)
    assert.equal((await text({ chat: 'this' }, null)).error, true)
  } finally {
    await done()
  }
})

test('the first start shelves the Markdown files earlier turns wrote, once, dated by the last turn to write each', async () => {
  const { root, store, library, chat, done } = await setup()
  try {
    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['init', '-q', root])
    chat('c1')
    chat('c2')
    await writeFile(join(root, 'plan.md'), '# Plan\n')
    const patched = (id: string, chatId: string, endedAt: number, patch: string): void => {
      store.createTurn({ ...turn(chatId, endedAt - 1), id, endedAt })
      store.setTurnChanges(id, { files: 1, added: 1, removed: 0, undone: false }, { patch, truncated: false, startTree: null, endTree: null })
    }
    patched('old', 'c1', 1_000, 'diff --git a/plan.md b/plan.md\n--- a/plan.md\n+++ b/plan.md\n@@ -0,0 +1 @@\n+# Plan\n')
    patched('new', 'c2', 2_000, 'diff --git a/plan.md b/plan.md\n--- a/plan.md\n+++ b/plan.md\n@@ -1 +1 @@\n-# P\n+# Plan\n')
    patched('gone', 'c1', 3_000, 'diff --git a/deleted.md b/deleted.md\n--- a/deleted.md\n+++ b/deleted.md\n@@ -0,0 +1 @@\n+x\n')
    assert.equal(await library.backfill(), 1)
    const [plan] = library.list()
    assert.equal(plan!.name, 'plan.md')
    assert.equal(plan!.chatId, 'c2')
    assert.equal(plan!.addedAt, 2_000)
    assert.equal(await library.backfill(), 0)
  } finally {
    await done()
  }
})

test('a picture a model made is on the shelf as generated, named for its provider, and looked up by id', async () => {
  const { store, attachments, library, chat, done } = await setup()
  try {
    chat('c1')
    const image = await attachments.keepGenerated({ base64: jpegBase64 }, 'A neon horizon')
    store.createTurn({ ...turn('c1'), provider: 'codex' })
    store.putItem('c1', { type: 'image', id: 'g1', turnId: 't-c1', status: 'done', caption: 'A neon horizon', image })
    const [entry] = library.list()
    assert.equal(entry!.source, 'generated')
    assert.equal(entry!.origin, 'Codex')
    assert.equal(entry!.kind, 'image')
    assert.equal(entry!.chatId, 'c1')
    assert.equal(library.entry(image.id).name, 'a-neon-horizon.jpg')
    assert.equal((await library.view(image.id)).type, 'image')
    assert.equal((await library.preview(image.id)).type, 'image')
    const listed = await libraryTools(library, store)[0]!.run({ source: 'generated' }, { provider: 'claude', chatId: 'c1' })
    assert.match(JSON.stringify(listed), /a-neon-horizon\.jpg/)
  } finally {
    await done()
  }
})
