import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Both src/host and the built out/main sit two levels below the application root.
// Point to editable files rather than embedding the catalog in every model turn.
export function designPreparationContext(root = process.env.ROCKET_DESIGN_LIBRARY || fileURLToPath(new URL('../../design-library/', import.meta.url))): string {
  const index = resolve(root, 'index.json')
  const skill = resolve(root, 'skills/goal-preparation/SKILL.md')
  if (!existsSync(index) || !existsSync(skill)) return ''
  return `\nPreparation guidance: read ${JSON.stringify(skill)}. For visual work, read the project's DESIGN.md if present and select relevant references from ${JSON.stringify(index)}. Open selected images, not just their filenames. Paths in the catalog are relative to ${JSON.stringify(resolve(root))}. Choose research depth yourself; nonvisual work does not need UI references. Preserve user preferences and existing project conventions. Summarize the chosen design direction in the goal text so the user can confirm it. Do not edit project or library files during drafting.\n`
}
