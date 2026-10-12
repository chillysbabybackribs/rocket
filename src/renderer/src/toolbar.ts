// Side panel labels in the title strip (Library and Browser beside the usage notch). Names can be
// renamed in prefs; defaults come from SECTIONS.

export type SectionId = 'library' | 'browser'

export const SECTIONS: Record<SectionId, { name: string }> = {
  library: { name: 'Library' },
  browser: { name: 'Browser' }
}

export const SECTION_IDS = Object.keys(SECTIONS) as SectionId[]

/** Long enough for a word or two. */
export const NAME_MAX = 24

export type ToolbarPrefs = {
  /** Labels the user gave, by section. */
  names: Partial<Record<SectionId, string>>
}

export const DEFAULT_TOOLBAR: ToolbarPrefs = { names: {} }

function isSection(value: unknown): value is SectionId {
  return typeof value === 'string' && Object.hasOwn(SECTIONS, value)
}

/** Saved preferences as they can be trusted; legacy drawer fields are ignored. */
export function normalizeToolbar(saved: unknown): ToolbarPrefs {
  const record = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {}
  const names: Partial<Record<SectionId, string>> = {}
  if (record.names && typeof record.names === 'object') {
    for (const [id, name] of Object.entries(record.names as Record<string, unknown>)) {
      if (isSection(id) && typeof name === 'string') {
        const clean = cleanName(id, name)
        if (clean) names[id] = clean
      }
    }
  }
  return { names }
}

/** A typed name as it is kept: trimmed and capped, or nothing when it is blank or the default. */
export function cleanName(id: SectionId, name: string): string | null {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
  return clean && clean !== SECTIONS[id].name ? clean : null
}

export function labelOf(prefs: ToolbarPrefs, id: SectionId): string {
  return prefs.names[id] ?? SECTIONS[id].name
}

/** What a screen reader hears: the label, with the real name after it when the two differ. */
export function accessibleName(prefs: ToolbarPrefs, id: SectionId): string {
  const label = labelOf(prefs, id)
  return label === SECTIONS[id].name ? label : `${label} (${SECTIONS[id].name})`
}

export function rename(prefs: ToolbarPrefs, id: SectionId, name: string): ToolbarPrefs['names'] {
  const names = { ...prefs.names }
  const clean = cleanName(id, name)
  if (clean) names[id] = clean
  else delete names[id]
  return names
}
