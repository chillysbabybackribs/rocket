import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import type { Goal } from '../../../shared/types.ts'
import { call } from '../host.ts'
import { openChatLink } from '../store.ts'

// A visual goal's design: the concept, and the references the drafting model actually opened,
// each with the screenshot it saved. The window's content policy only allows its own images, so
// the host reads each screenshot and hands it over as a data URL.

const images = new Map<string, Promise<string>>()

function useReferenceImage(goalId: string, index: number, path: string): string | null | 'missing' {
  const key = `${goalId}:${index}:${path}`
  const [src, setSrc] = useState<string | null | 'missing'>(null)
  useEffect(() => {
    let live = true
    let load = images.get(key)
    if (!load) {
      load = call('goal.referenceImage', { goalId, index })
      load.catch(() => images.delete(key))
      images.set(key, load)
    }
    load.then((url) => { if (live) setSrc(url) }, () => { if (live) setSrc('missing') })
    return () => { live = false }
  }, [key, goalId, index])
  return src
}

function hostOf(source: string): string {
  try {
    const url = new URL(source)
    return url.hostname.replace(/^www\./, '') + (url.pathname !== '/' ? url.pathname.replace(/\/$/, '') : '')
  } catch {
    return source
  }
}

function ReferenceCard({ goal, index }: { goal: Goal; index: number }) {
  const reference = goal.design!.references[index]!
  const src = useReferenceImage(goal.id, index, reference.screenshot)
  const [large, setLarge] = useState(false)
  const linked = /^https?:\/\//.test(reference.source)
  return (
    <figure className={`gd-ref${large ? ' is-large' : ''}`}>
      <button type="button" className="gd-shot" aria-label={large ? 'Show smaller' : 'Show larger'} onClick={() => setLarge(!large)}>
        {src && src !== 'missing' && <img src={src} alt={`Screenshot of ${hostOf(reference.source)}`} />}
        {src === 'missing' && <span className="gd-missing"><ImageOff size={14} aria-hidden /> Screenshot no longer on disk</span>}
      </button>
      <figcaption>
        {linked
          ? <a className="gd-source" href={reference.source} onClick={(event) => { event.preventDefault(); void openChatLink(reference.source, goal.cwd) }}>{hostOf(reference.source)}</a>
          : <span className="gd-source">{reference.source}</span>}
        <span className="gd-takes">{reference.takes}</span>
      </figcaption>
    </figure>
  )
}

/** The concept, editable while the brief is being confirmed, and the reference cards. */
export function GoalDesignView({ goal, concept, onConcept }: { goal: Goal; concept?: string; onConcept?: (text: string) => void }) {
  if (!goal.design) return null
  return (
    <div className="gd">
      {onConcept
        ? <textarea className="brief-edit gd-concept-edit" rows={2} value={concept} aria-label="Design concept" onChange={(event) => onConcept(event.target.value)} />
        : <p className="gd-concept">{goal.design.concept}</p>}
      <div className="gd-refs">
        {goal.design.references.map((reference, index) => <ReferenceCard key={reference.screenshot + index} goal={goal} index={index} />)}
      </div>
    </div>
  )
}
