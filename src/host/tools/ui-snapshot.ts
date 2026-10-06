import type { UiSnapshot } from '../../shared/types.ts'
import type { Tool } from './registry.ts'

// Main owns the window; the host only translates its capture into the shared MCP image format.
export function uiSnapshotTools(snapshot: () => Promise<UiSnapshot>): Tool[] {
  return [{
    name: 'rocket_ui_snapshot',
    description: 'See Rocket’s currently running app UI, including chat panes, drawers and native browser views. Read-only: does not switch tabs, move focus or click controls. Returns images directly, saved capture paths, visible shell controls and panels, native view bounds, and running-instance information. This shows the running app; edits on disk may need a rebuild or reload to appear. When whole-window capture is unavailable, separate surfaces are returned with an explicit warning.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const { images, ...metadata } = await snapshot()
      return { content: [
        { type: 'text', text: JSON.stringify({ ...metadata, images: images.map(({ base64: _base64, ...image }) => image) }, null, 2) },
        ...images.flatMap(image => [
          { type: 'text' as const, text: image.label },
          { type: 'image' as const, data: image.base64, mimeType: image.mimeType }
        ])
      ] }
    }
  }]
}
