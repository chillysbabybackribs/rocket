import { readFileSync } from 'node:fs'
import { MAX_MESSAGE_IMAGES, MAX_MESSAGE_IMAGE_BYTES } from '../../shared/types.ts'
import type { ProviderImage } from '../attachments.ts'

/** Current images come first. Large histories retain readable paths without replaying unbounded pixels. */
export function imageInput(text: string, images: ProviderImage[] = []): { text: string; images: ProviderImage[] } {
  let size = 0
  const selected = images.filter((image, index) => {
    if (index >= MAX_MESSAGE_IMAGES || size + image.size > MAX_MESSAGE_IMAGE_BYTES) return false
    size += image.size
    return true
  })
  const manifest = images.map(image => `[Image attachment ${image.id}: ${JSON.stringify(image.name)}; file ${JSON.stringify(image.path)}${selected.includes(image) ? '; included below' : '; read this file if needed'}]`).join('\n')
  return { text: manifest ? `${text}\n\n${manifest}` : text, images: selected }
}

export function claudeImageContent(text: string, images: ProviderImage[] = []) {
  const input = imageInput(text, images)
  return [
    { type: 'text' as const, text: input.text },
    ...input.images.map(image => ({ type: 'image' as const, source: {
      type: 'base64' as const, media_type: image.mimeType, data: readFileSync(image.path).toString('base64')
    } }))
  ]
}

export function cursorImageContent(text: string, images: ProviderImage[] = []) {
  const input = imageInput(text, images)
  return [
    { type: 'text', text: input.text },
    ...input.images.map(image => ({ type: 'image', mimeType: image.mimeType, data: readFileSync(image.path).toString('base64') }))
  ]
}

export function codexImageContent(text: string, images: ProviderImage[] = []) {
  const input = imageInput(text, images)
  return [{ type: 'text', text: input.text }, ...input.images.map(image => ({ type: 'localImage', path: image.path }))]
}
