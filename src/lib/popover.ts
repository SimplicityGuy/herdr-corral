/**
 * Where an inline popover sits relative to the thing that opened it.
 *
 * Kept apart from the component so it can be reasoned about — and tested —
 * without a DOM, and so the preview bead can ask the same question about a
 * region it is about to anchor to.
 */
import type { Anchor } from '@/store/shell'

/** ADR-0002's popover is a fixed 360px column; the gap keeps it off its anchor. */
export const POPOVER_WIDTH = 360
export const POPOVER_GAP = 6

export interface Placement {
  readonly left: number
  readonly top: number
}

/**
 * Below the anchor, nudged back inside the viewport.
 *
 * jsdom reports every rectangle as zero, so a test sees the top-left corner and a
 * browser sees the anchor. Both are positions, and neither needs a mocked layout.
 */
export function placeAt(anchor: Anchor, viewport: { width: number; height: number }): Placement {
  const rightmost = Math.max(POPOVER_GAP, viewport.width - POPOVER_WIDTH - POPOVER_GAP)
  const left = Math.max(POPOVER_GAP, Math.min(anchor.left, rightmost))
  const lowest = Math.max(POPOVER_GAP, viewport.height - POPOVER_GAP)
  const top = Math.max(POPOVER_GAP, Math.min(anchor.top + anchor.height + POPOVER_GAP, lowest))
  return { left, top }
}
