import type { Bounds } from './types.ts'

export const OVERLAY_SLOTS = ['menu', 'flyout', 'modal', 'notice'] as const
export type OverlaySlot = typeof OVERLAY_SLOTS[number]
export type OverlayCommand =
  | { type: 'prepare'; slot: OverlaySlot; generation: number }
  | { type: 'present'; slot: OverlaySlot; generation: number; bounds: Bounds; focus: boolean }
  | { type: 'hide'; slot: OverlaySlot; generation: number }
export type OverlayDismiss = { slot: OverlaySlot; generation: number }

export function isOverlaySlot(value: unknown): value is OverlaySlot {
  return typeof value === 'string' && (OVERLAY_SLOTS as readonly string[]).includes(value)
}
