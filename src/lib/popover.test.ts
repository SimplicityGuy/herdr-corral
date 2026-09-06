/**
 * The placement math, with explicit rectangles.
 *
 * jsdom reports every rect as zero, so a component test can never show that a
 * popover would have left the window; these are the numbers a browser produces,
 * written down. The case that bounced the preview is the last one in each block:
 * a region at the bottom of an 820px window, whose popover used to be placed at
 * `top: 814`.
 */
import {
  MAX_ANCHOR_HEIGHT,
  POPOVER_ASSUMED_HEIGHT,
  POPOVER_GAP,
  POPOVER_WIDE_WIDTH,
  POPOVER_WIDTH,
  maxPopoverHeight,
  placeAt,
  shortAnchor,
} from '@/lib/popover'
import type { Anchor } from '@/store/shell'
import { describe, expect, it } from 'vitest'

const VIEWPORT = { width: 1280, height: 820 }

function anchor(partial: Partial<Anchor>): Anchor {
  return { top: 0, left: 0, width: 0, height: 0, ...partial }
}

/** Where the popover's bottom edge lands. */
function bottomOf(placement: { top: number }, height: number): number {
  return placement.top + height
}

describe('placeAt', () => {
  it('opens below the anchor when there is room', () => {
    const placed = placeAt(anchor({ top: 100, left: 40, height: 20 }), VIEWPORT, 120)
    expect(placed).toEqual({ left: 40, top: 126 })
  })

  it('flips above the anchor when the popover would not fit below', () => {
    // 760 + 20 + 6 + 120 is past 820, but there is room above.
    const placed = placeAt(anchor({ top: 760, left: 40, height: 20 }), VIEWPORT, 120)
    expect(placed.top).toBe(760 - POPOVER_GAP - 120)
    expect(bottomOf(placed, 120)).toBeLessThan(760)
  })

  it('keeps the whole popover inside the window for a bottom-edge anchor', () => {
    for (const top of [700, 760, 800, 819]) {
      const placed = placeAt(anchor({ top, left: 40, height: 20 }), VIEWPORT, 200)
      expect(placed.top).toBeGreaterThanOrEqual(POPOVER_GAP)
      expect(bottomOf(placed, 200)).toBeLessThanOrEqual(VIEWPORT.height - POPOVER_GAP)
    }
  })

  it('pins to the bottom edge when neither side has room', () => {
    // A short window: 300 tall, an anchor in the middle, a 200px popover.
    const placed = placeAt(anchor({ top: 120, height: 20 }), { width: 1280, height: 300 }, 200)
    expect(placed.top).toBe(300 - POPOVER_GAP - 200)
    expect(bottomOf(placed, 200)).toBe(300 - POPOVER_GAP)
  })

  it('keeps the caption visible when the popover is taller than the window', () => {
    const placed = placeAt(anchor({ top: 10, height: 10 }), { width: 1280, height: 200 }, 400)
    expect(placed.top).toBe(POPOVER_GAP)
  })

  it('nudges a right-hand anchor back inside the viewport', () => {
    const placed = placeAt(anchor({ top: 10, left: 1270, height: 10 }), VIEWPORT, 120)
    expect(placed.left).toBe(VIEWPORT.width - POPOVER_WIDTH - POPOVER_GAP)
  })

  it('nudges a wide popover back by its own width, not the default column', () => {
    const placed = placeAt(
      anchor({ top: 10, left: 1270, height: 10 }),
      VIEWPORT,
      120,
      POPOVER_WIDE_WIDTH,
    )
    expect(placed.left).toBe(VIEWPORT.width - POPOVER_WIDE_WIDTH - POPOVER_GAP)
    expect(placed.left + POPOVER_WIDE_WIDTH).toBeLessThanOrEqual(VIEWPORT.width)
  })

  it('never places anything above the gap', () => {
    const placed = placeAt(anchor({ top: -500, left: -500, height: 10 }), VIEWPORT, 120)
    expect(placed).toEqual({ left: POPOVER_GAP, top: POPOVER_GAP })
  })

  it('assumes a height when none is given, and keeps that inside too', () => {
    const placed = placeAt(anchor({ top: 810, height: 8 }), VIEWPORT)
    expect(bottomOf(placed, POPOVER_ASSUMED_HEIGHT)).toBeLessThanOrEqual(
      VIEWPORT.height - POPOVER_GAP,
    )
  })

  it('reads a zero rect as the top-left corner, which is what jsdom gives', () => {
    expect(placeAt(anchor({}), VIEWPORT, 0)).toEqual({ left: POPOVER_GAP, top: POPOVER_GAP })
  })
})

/**
 * The theme editor is the case: nineteen colour rows measured 2148px tall in an
 * 820px window, and the shell does not scroll, so everything past the fold was
 * unreachable — from the tree as well as from the preview. The frame is capped
 * and scrolls inside the cap, and placement uses the capped height.
 */
describe('a popover taller than the window', () => {
  it('caps at the window less a gap at each end', () => {
    expect(maxPopoverHeight(820)).toBe(820 - POPOVER_GAP * 2)
    expect(maxPopoverHeight(0)).toBe(0)
  })

  it('places the capped frame fully on screen, top and bottom', () => {
    const placed = placeAt(anchor({ top: 300, left: 40, height: 20 }), VIEWPORT, 2148)
    const drawn = maxPopoverHeight(VIEWPORT.height)

    expect(placed.top).toBe(POPOVER_GAP)
    expect(bottomOf(placed, drawn)).toBeLessThanOrEqual(VIEWPORT.height - POPOVER_GAP)
  })

  it('places a frame that only just fits the same way as before', () => {
    const fits = maxPopoverHeight(VIEWPORT.height)
    expect(placeAt(anchor({ top: 300, height: 20 }), VIEWPORT, fits)).toEqual(
      placeAt(anchor({ top: 300, height: 20 }), VIEWPORT, fits + 400),
    )
  })
})

describe('shortAnchor', () => {
  it('leaves a row-sized anchor alone', () => {
    const row = anchor({ top: 100, left: 20, width: 200, height: 18 })
    expect(shortAnchor(row, 108)).toEqual(row)
  })

  it('crops a full-height region to the row the pointer was on', () => {
    const strip = anchor({ top: 100, left: 20, width: 200, height: 672 })
    const cropped = shortAnchor(strip, 400)
    expect(cropped.height).toBe(MAX_ANCHOR_HEIGHT)
    expect(cropped.top).toBe(400 - MAX_ANCHOR_HEIGHT / 2)
    expect(cropped.left).toBe(20)
  })

  it('stays inside the region it came from', () => {
    const strip = anchor({ top: 100, left: 20, width: 200, height: 672 })
    expect(shortAnchor(strip, 50).top).toBe(100)
    expect(shortAnchor(strip, 5000).top).toBe(100 + 672 - MAX_ANCHOR_HEIGHT)
  })

  it('takes the region’s top edge for a keyboard activation, which reports no point', () => {
    const strip = anchor({ top: 300, height: 400 })
    expect(shortAnchor(strip).top).toBe(300)
  })

  it('is what keeps a tall region’s popover on screen', () => {
    // The sidebar edge: a 672px strip starting at y=104 in an 820px window.
    const edge = anchor({ top: 104, left: 360, width: 6, height: 672 })
    const placed = placeAt(shortAnchor(edge, 700), VIEWPORT, 200)
    expect(placed.top + 200).toBeLessThanOrEqual(VIEWPORT.height - POPOVER_GAP)
  })
})
