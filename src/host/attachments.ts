import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { imageSize } from 'image-size'
import { MAX_IMAGE_BYTES, MAX_MESSAGE_IMAGE_BYTES, MAX_MESSAGE_IMAGES, type ImageAttachment } from '../shared/types.ts'
import type { Store } from './store.ts'

export type ProviderImage = ImageAttachment & { path: string }
const mimes = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as const

/** Inspect bytes before trusting names or browser MIME labels. Full decoding happens in the composer. */
export function inspectImage(bytes: Uint8Array): { mimeType: ImageAttachment['mimeType']; width: number; height: number } {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('Choose an image smaller than 5 MB.')
  }
  try {
    const { type, width, height } = imageSize(bytes)
    if (!type || !(type in mimes)) throw new Error('format')
    if (!width || !height || width > 8000 || height > 8000 || width * height > 32_000_000) throw new Error('dimensions')
    return { mimeType: mimes[type as keyof typeof mimes], width, height }
  } catch {
    throw new Error('Choose a valid PNG, JPEG, WebP or GIF image up to 8000 pixels per side and 32 megapixels.')
  }
}

export function validateImages(images: ImageAttachment[]): void {
  if (images.length > MAX_MESSAGE_IMAGES || images.reduce((sum, image) => sum + image.size, 0) > MAX_MESSAGE_IMAGE_BYTES) {
    throw new Error('Send at most 10 images totaling 20 MB in one message.')
  }
}

/** The host owns image files. Caller-supplied ids are resolved through SQLite, never treated as paths. */
export class AttachmentStore {
  constructor(private readonly store: Store, private readonly directory: string) {}

  async import(name: string, bytes: Uint8Array, thumbnail: Uint8Array): Promise<ImageAttachment> {
    const info = inspectImage(bytes)
    const small = inspectImage(thumbnail)
    if (small.mimeType !== 'image/jpeg' || small.width > 320 || small.height > 320 || thumbnail.length > 150_000) {
      throw new Error('The image preview could not be saved. Try attaching the image again.')
    }
    const image: ImageAttachment = { ...info, id: randomUUID(), name: String(name).split(/[\\/]/).at(-1)!.replace(/[\x00-\x1f]/g, '').slice(0, 180) || 'Image', size: bytes.length }
    await mkdir(this.directory, { recursive: true })
    try {
      await writeFile(this.path(image), bytes)
      await writeFile(this.path(image, true), thumbnail)
      this.store.saveAttachment(image)
      return image
    } catch (error) {
      await Promise.all([rm(this.path(image), { force: true }), rm(this.path(image, true), { force: true })])
      throw error
    }
  }

  resolve(ids: string[]): ProviderImage[] {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('Attach the images again.')
    return ids.map(id => {
      const image = this.store.attachment(id)
      if (!image) throw new Error('An image is no longer available. Attach it again.')
      return { ...image, path: this.path(image) }
    })
  }

  async read(id: string, thumbnail = false): Promise<string> {
    const [image] = this.resolve([id])
    try {
      const bytes = await readFile(this.path(image, thumbnail))
      return `data:${thumbnail ? 'image/jpeg' : image.mimeType};base64,${bytes.toString('base64')}`
    } catch {
      throw new Error('This image file is missing. Attach it again.')
    }
  }

  private path(image: ImageAttachment, thumbnail = false): string {
    return join(this.directory, `${image.id}${thumbnail ? '.thumb.jpg' : `.${image.mimeType.split('/')[1]}`}`)
  }
}
