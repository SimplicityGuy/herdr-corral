import { expect, test } from '@playwright/test'

/**
 * ADR-0002 asks for square corners everywhere. Collapsing the `--radius-*`
 * scale onto `--radius: 0` is not enough on its own: `rounded-full` is a fixed
 * `calc(infinity * 1px)`, arbitrary `rounded-[Npx]` values are literals, and the
 * unsuffixed utility is a fixed `0.25rem`. src/index.css zeroes those with an
 * unlayered rule, and this test proves the cascade actually resolves that way
 * rather than trusting the stylesheet to say so.
 *
 * Every class here is emitted by a vendored shadcn component, so it exists in
 * the built CSS regardless of what this file mentions.
 */
const ESCAPES = [
  'rounded-full', // switch, slider, scroll-area, checkbox, tooltip
  'rounded-[4px]',
  'rounded-[2px]',
  'rounded',
  'rounded-lg', // a plain scale step, for contrast
  'rounded-4xl',
]

test('no rounded utility survives the square-corner rule', async ({ page }) => {
  await page.goto('/')

  const radii = await page.evaluate((classes) => {
    const probe = document.createElement('div')
    document.body.append(probe)
    const out: Record<string, string> = {}
    for (const cls of classes) {
      probe.className = cls
      out[cls] = getComputedStyle(probe).borderRadius
    }
    probe.remove()
    return out
  }, ESCAPES)

  for (const cls of ESCAPES) {
    expect(radii[cls], `${cls} must resolve to a zero radius`).toBe('0px')
  }
})

test('rounded-[inherit] still propagates a parent radius', async ({ page }) => {
  await page.goto('/')

  const inherited = await page.evaluate(() => {
    const parent = document.createElement('div')
    parent.style.borderRadius = '7px'
    const child = document.createElement('div')
    child.className = 'rounded-[inherit]'
    parent.append(child)
    document.body.append(parent)
    const value = getComputedStyle(child).borderRadius
    parent.remove()
    return value
  })

  expect(inherited).toBe('7px')
})
