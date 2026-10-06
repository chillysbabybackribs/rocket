import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { jpegBase64 } from '../../tests/fixtures/image.ts'
import { AttachmentStore, inspectImage, validateImages } from './attachments.ts'
import { Store } from './store.ts'
import { claudeImageContent, codexImageContent, cursorImageContent, imageInput } from './providers/images.ts'

test('images are validated by bytes and round-trip through SQLite and files after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rocket-images-'))
  let store = new Store(join(root, 'rocket.db'))
  try {
    const bytes = Buffer.from(jpegBase64, 'base64')
    const images = new AttachmentStore(store, join(root, 'attachments'))
    const image = await images.import('../../screenshot.png', bytes, bytes)
    assert.equal(image.name, 'screenshot.png')
    assert.equal(image.mimeType, 'image/jpeg')
    assert.equal(image.width, 2)
    assert.throws(() => images.resolve(['../../etc/passwd']), /no longer available/)
    assert.throws(() => inspectImage(Buffer.from('<svg></svg>')), /valid PNG/)
    assert.throws(() => inspectImage(new Uint8Array(6 * 1024 * 1024)), /5 MB/)
    assert.throws(() => validateImages(Array(11).fill(image)), /at most 10/)
    store.close()
    store = new Store(join(root, 'rocket.db'))
    const reopened = new AttachmentStore(store, join(root, 'attachments'))
    assert.equal(await reopened.read(image.id), `data:image/jpeg;base64,${jpegBase64}`)
    const [resolved] = reopened.resolve([image.id])
    assert.deepEqual(await readFile(resolved.path), bytes)
    assert.equal(claudeImageContent('Look', [resolved])[1].type, 'image')
    assert.equal((claudeImageContent('Look', [resolved])[1] as { source: { data: string } }).source.data, jpegBase64)
    assert.equal((cursorImageContent('Look', [resolved])[1] as { data: string }).data, jpegBase64)
    assert.deepEqual(codexImageContent('Look', [resolved])[1], { type: 'localImage', path: resolved.path })
    const history = imageInput('Compare', Array.from({ length: 12 }, (_, index) => ({ ...resolved, id: `image-${index}` })))
    assert.equal(history.images.length, 10)
    assert.match(history.text, /read this file if needed/)
    const references = imageInput('History', [resolved], false)
    assert.equal(references.images.length, 0)
    assert.doesNotMatch(references.text, /included below/)
    assert.equal(store.unusedAttachments([image.id], Date.now() + 1000).length, 0)
    store.saveQueue('queued-chat', [{ id: 'queued', provider: 'claude', model: null, text: '', attachments: [image] }])
    assert.equal(store.unusedAttachments([], Date.now() + 1000).length, 0)
    store.saveQueue('queued-chat', [])
    assert.deepEqual(store.unusedAttachments([], Date.now() + 1000).map(entry => entry.id), [image.id])
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})
