/**
 * Where an inline popover sits relative to the thing that opened it.
 *
 * Kept apart from the component so it can be reasoned about — and tested —
 * without a DOM, and so the preview can ask the same question about a region it
 * is about to anchor to.
 *
 * Two rules, and both exist because the shell is `overflow-hidden`: a popover
 * that leaves the viewport is not scrolled back into view, it is simply gone.
 *
 * - **The popover's bottom stays inside, not its top.** It opens below its
 *   anchor, flips above when there is no room below, and is pinned to the bottom
 *   edge only when neither side fits. Clamping the *top* — which is what this
 *   did first — puts a 200px form six pixels above the bottom of the window and
 *   calls it placed.
 * - **A tall anchor is cropped to a strip.** A region of the preview can be the
 *   full height of the frame; anchoring to the whole of it would push the
 *   popover past the bottom before the first rule ever ran. {@link shortAnchor}
 *   cuts it down to the row the pointer was on, which is also where the user is
 *   looking.
 *
 * The height a popover will be is not known until it has been rendered, so
 * `placeAt` takes it as an argument and the host measures it: the first pass
 * uses {@link POPOVER_ASSUMED_HEIGHT} and a layout effect re-places with the real
 * one before the browser paints. The width is known up front — the editor
 * registry carries it — so it is passed in rather than measured.
 */
import type { Anchor } from '@/store/shell'

/** ADR-0002's popover is a fixed 360px column; the gap keeps it off its anchor. */
export const POPOVER_WIDTH = 360
export const POPOVER_GAP = 6

/**
 * The width an editor asks for when a 360px column cannot hold it.
 *
 * The sidebar rows are the case: sixteen token chips laid out left to right is a
 * line, and wrapping it at 360px turns the one thing the editor is about — the
 * order of the tokens in a row — into a puzzle. An editor declares this through
 * `registerEditor`'s `width` option; nothing else may set a width.
 */
export const POPOVER_WIDE_WIDTH = 560

/**
 * What a popover is assumed to be tall before anyone has measured it.
 *
 * Roughly the caption, one row of controls and the hint line — the shape of
 * every editor in ADR-0002. Being wrong costs nothing: the host measures the
 * frame in a layout effect and places it again before the paint.
 */
export const POPOVER_ASSUMED_HEIGHT = 120

/** The tallest strip a popover is anchored to, however tall its region is. */
export const MAX_ANCHOR_HEIGHT = 24

export interface Placement {
  readonly left: number
  readonly top: number
}

/**
 * A tall anchor cut down to the row the pointer was on.
 *
 * `pointerY` is the click's viewport `clientY`. A keyboard activation reports
 * zero, which lands on the anchor's own top edge — the top of the region is
 * where a keyboard user's attention is, so that is the right answer rather than
 * a fallback.
 */
export function shortAnchor(anchor: Anchor, pointerY = 0): Anchor {
  if (anchor.height <= MAX_ANCHOR_HEIGHT) return anchor
  const lowest = anchor.top + anchor.height - MAX_ANCHOR_HEIGHT
  const top = Math.min(Math.max(pointerY - MAX_ANCHOR_HEIGHT / 2, anchor.top), lowest)
  return { top, left: anchor.left, width: anchor.width, height: MAX_ANCHOR_HEIGHT }
}

/**
 * Below the anchor, above it when that does not fit, and inside the viewport
 * either way.
 *
 * jsdom reports every rectangle as zero, so a test sees the top-left corner and
 * a browser sees the anchor. Both are positions, and neither needs a mocked
 * layout.
 */
export function placeAt(
  anchor: Anchor,
  viewport: { width: number; height: number },
  height: number = POPOVER_ASSUMED_HEIGHT,
  width: number = POPOVER_WIDTH,
): Placement {
  const rightmost = Math.max(POPOVER_GAP, viewport.width - width - POPOVER_GAP)
  const left = Math.max(POPOVER_GAP, Math.min(anchor.left, rightmost))

  // The lowest top that still leaves the whole popover on screen. Negative when
  // the popover is taller than the window, which the final clamp catches.
  const lowest = viewport.height - POPOVER_GAP - height
  // An anchor can sit above the viewport as well as below it — a region scrolled
  // out of view, or a zero rect from a test — so the preferred position is
  // clamped at both ends, not just at the bottom.
  const below = Math.max(POPOVER_GAP, anchor.top + anchor.height + POPOVER_GAP)
  if (below <= lowest) return { left, top: below }

  const above = anchor.top - POPOVER_GAP - height
  if (above >= POPOVER_GAP) return { left, top: above }

  // Neither side fits: sit on the bottom edge, and give up on the bottom rather
  // than the top when the popover is taller than the window, because the caption
  // and the first control are what the user needs to see.
  return { left, top: Math.max(POPOVER_GAP, lowest) }
}
