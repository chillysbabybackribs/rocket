import { useSyncExternalStore } from 'react'
import { imageSize } from 'image-size'
import { MAX_IMAGE_BYTES, MAX_MESSAGE_IMAGES, MAX_MESSAGE_IMAGE_BYTES, type ImageAttachment, type MessageDraft } from '../../shared/types.ts'
import { call } from './host.ts'

type Draft = MessageDraft & { attachments: ImageAttachment[]; pending: number; sending: boolean; error: string | null }
const empty: Draft = { text: '', attachments: [], pending: 0, sending: false, error: null }
const drafts = new Map<string, Draft>()
const listeners = new Set<() => void>()
const storageKey = 'rocket.image-drafts'
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<string, MessageDraft>
  for (const [key, value] of Object.entries(saved)) if (typeof value.text === 'string') drafts.set(key, { ...empty, ...value, attachments: value.attachments ?? [] })
} catch { /* A damaged draft must not prevent opening the chat. */ }

export function draftOf(key: string): Draft { return drafts.get(key) ?? empty }

export function updateDraft(key: string, patch: Partial<Draft>): void {
  drafts.set(key, { ...draftOf(key), ...patch })
  try {
    localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries([...drafts].filter(([, d]) => d.text || d.attachments.length).map(([id, d]) => [id, { text: d.text, attachments: d.attachments }]))))
  } catch { /* The in-memory draft remains usable when browser storage is full. */ }
  for (const notify of listeners) notify()
}

export function useDraft(key: string): Draft {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => draftOf(key))
}

export function restoreDraft(key: string, message: string | MessageDraft): void {
  const restored = typeof message === 'string' ? { text: message } : message
  const current = draftOf(key)
  updateDraft(key, { text: [restored.text, current.text].filter(Boolean).join('\n\n'), attachments: [...restored.attachments ?? [], ...current.attachments] })
}

export const IMAGE_DRAG_TYPE = 'application/x-rocket-image'
export function addExistingImage(key: string, image: ImageAttachment): void {
  const current = draftOf(key)
  if (current.sending) return
  if (current.attachments.some(each => each.id === image.id)) return
  if (current.attachments.length >= MAX_MESSAGE_IMAGES || current.attachments.reduce((sum, each) => sum + each.size, image.size) > MAX_MESSAGE_IMAGE_BYTES) {
    updateDraft(key, { error: 'Send at most 10 images totaling 20 MB in one message.' })
    return
  }
  updateDraft(key, { attachments: [...current.attachments, image], error: null })
}

/** Uploads are serialized per draft so a tab switch cannot redirect an in-flight import. */
const uploads = new Map<string, Promise<void>>()
export function addDraftImages(key: string, files: File[]): void {
  if (draftOf(key).sending) return
  updateDraft(key, { pending: draftOf(key).pending + files.length, error: null })
  const work = (uploads.get(key) ?? Promise.resolve()).then(async () => {
    for (const file of files) {
      try {
        const current = draftOf(key)
        if (current.attachments.length >= MAX_MESSAGE_IMAGES || current.attachments.reduce((sum, image) => sum + image.size, file.size) > MAX_MESSAGE_IMAGE_BYTES) throw new Error('Send at most 10 images totaling 20 MB in one message.')
        if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error('Choose images smaller than 5 MB.')
        const bytes = new Uint8Array(await file.arrayBuffer())
        let dimensions: ReturnType<typeof imageSize>
        try { dimensions = imageSize(bytes) } catch { throw new Error('Choose a PNG, JPEG, WebP or GIF image.') }
        if (!['png', 'jpg', 'webp', 'gif'].includes(dimensions.type ?? '')) throw new Error('Choose a PNG, JPEG, WebP or GIF image.')
        if (!dimensions.width || !dimensions.height || dimensions.width > 8000 || dimensions.height > 8000 || dimensions.width * dimensions.height > 32_000_000) throw new Error('Choose an image up to 8000 pixels per side and 32 megapixels.')
        const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This image could not be decoded. Choose another file.') })
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height))
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#202124'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        bitmap.close()
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not create an image preview.')), 'image/jpeg', 0.8))
        const image = await call('attachment.import', { name: file.name || 'Pasted image.png', bytes, thumbnail: new Uint8Array(await blob.arrayBuffer()) })
        addExistingImage(key, image)
      } catch (error) {
        updateDraft(key, { error: error instanceof Error ? error.message : 'Could not attach this image. Try again.' })
      } finally {
        updateDraft(key, { pending: Math.max(0, draftOf(key).pending - 1) })
      }
    }
  })
  uploads.set(key, work)
  void work.finally(() => { if (uploads.get(key) === work) uploads.delete(key) })
}
