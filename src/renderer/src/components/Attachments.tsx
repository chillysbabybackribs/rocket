import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { ImageAttachment } from '../../../shared/types.ts'
import { call } from '../host.ts'
import { IMAGE_DRAG_TYPE } from '../drafts.ts'

function ImageTile({ image, remove }: { image: ImageAttachment; remove?: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [full, setFull] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    let alive = true
    void call('attachment.read', { id: image.id, thumbnail: true }).then(value => { if (alive) setSrc(value) }, reason => { if (alive) setError(String(reason.message)) })
    return () => { alive = false }
  }, [image.id])
  const enlarge = async (): Promise<void> => {
    dialog.current?.showModal()
    try { setFull(await call('attachment.read', { id: image.id })) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'This image could not be opened.') }
  }
  return (
    <div className="image-attachment">
      <button type="button" className="image-thumbnail" aria-label={`Preview ${image.name}`} onClick={() => void enlarge()} draggable
        onDragStart={event => { event.dataTransfer.setData(IMAGE_DRAG_TYPE, JSON.stringify(image)); event.dataTransfer.effectAllowed = 'copy' }}>
        {src ? <img src={src} alt={image.name} draggable={false} /> : <span>{error ? 'Unavailable' : 'Loading…'}</span>}
      </button>
      {remove && <button type="button" className="image-remove" aria-label={`Remove ${image.name}`} onClick={remove}><X size={12} /></button>}
      <span className="image-name" title={image.name}>{image.name}</span>
      <dialog ref={dialog} className="image-preview" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close() }} onClose={() => setFull(null)}>
        <div className="image-preview-bar"><span>{image.name}</span><button type="button" aria-label="Close image preview" onClick={() => dialog.current?.close()}><X size={18} /></button></div>
        {full ? <img src={full} alt={image.name} /> : <p>{error ?? 'Loading image…'}</p>}
      </dialog>
    </div>
  )
}

export function Attachments({ images, onRemove }: { images?: ImageAttachment[]; onRemove?: (id: string) => void }) {
  if (!images?.length) return null
  return <div className={`image-attachments${onRemove ? ' is-draft' : ''}`}>{images.map((image, index) => <ImageTile key={`${image.id}:${index}`} image={image} remove={onRemove ? () => onRemove(image.id) : undefined} />)}</div>
}
