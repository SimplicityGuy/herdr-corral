import { expect, test } from '@playwright/test'
import { openConsole } from './console.ts'

/**
 * corral-xp7.9: typed forms for every setting the specialised editors do not
 * own, mounted as the center-frame view for `[1] layout` and `[6] all`.
 */

test('pressing 1 shows the layout form, and changing a boolean through it changes one key', async ({
  page,
}) => {
  await openConsole(page)

  // The shell already opens on layout — 1 is pressed anyway, so this reads the
  // same as a person's first keystroke rather than relying on the default.
  await page.keyboard.press('1')

  const form = page.getByRole('region', { name: 'layout' })
  await expect(form).toBeVisible()

  const borders = form.getByRole('switch', { name: 'ui.pane_borders' })
  await expect(borders).toHaveAttribute('aria-checked', 'true')

  await expect(page.getByText('0 keys changed')).toBeVisible()
  await borders.click()

  await expect(page.getByText('1 key changed')).toBeVisible()
  await expect(borders).toHaveAttribute('aria-checked', 'false')
})

test('resetting a changed field in the form restores the default and clears the change', async ({
  page,
}) => {
  await openConsole(page)
  await page.keyboard.press('1')

  const form = page.getByRole('region', { name: 'layout' })
  const borders = form.getByRole('switch', { name: 'ui.pane_borders' })
  await borders.click()
  await expect(page.getByText('1 key changed')).toBeVisible()

  // Only the one changed field has a live reset button.
  await form.locator('button:not([disabled])', { hasText: 'reset' }).click()

  await expect(page.getByText('0 keys changed')).toBeVisible()
  await expect(borders).toHaveAttribute('aria-checked', 'true')
})

test('pressing 6 lists every section as a form, grouped by reference chapter', async ({ page }) => {
  await openConsole(page)
  await page.keyboard.press('6')

  const form = page.getByRole('region', { name: 'all' })
  await expect(form).toBeVisible()
  await expect(form.getByRole('heading', { name: 'Sound' })).toBeVisible()
  await expect(form.getByRole('heading', { name: 'per-agent overrides' })).toBeVisible()
})

/**
 * jsdom lays every box out at its content size, so a label collapsed to
 * nothing by a flex sibling that refuses to shrink is invisible to a
 * component test — only a real layout engine measures it as 4px wide against
 * ~16-47px of actual text. `github_copilot` is the longest agent name, so it
 * is the one most likely to still be clipped if the fix regresses to a fixed
 * basis too narrow for it.
 */
test('a per-agent sound row gives its name enough room to render, not a few px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openConsole(page)
  await page.keyboard.press('6')

  const label = page
    .getByRole('region', { name: 'Sound' })
    .getByText('github_copilot', { exact: true })
  await expect(label).toBeVisible()

  const rendered = await label.evaluate((element) => element.getBoundingClientRect().width)
  const textWidth = await label.evaluate((element) => element.scrollWidth)
  // A fraction of a pixel is ordinary flex/subpixel rounding between a
  // fractional `getBoundingClientRect` and an integer `scrollWidth`; the bug
  // this guards collapsed the label to ~4px against 16-47px of real text, not
  // a rounding error, so a couple of pixels of slack does not hide it.
  expect(rendered).toBeGreaterThanOrEqual(textWidth - 2)
})

/**
 * The label fix above only guards the name; the control has its own failure
 * mode. The three-item toggle group has an intrinsic width and does not
 * shrink, so a grid floor sized only for the (stacked) name can still leave
 * the control's last option rendering outside its cell, underneath the next
 * one — invisible to a bounding-box check, since the element is still laid
 * out at its full size, just not where a click can reach it. `elementFromPoint`
 * at the option's own center is what catches that, and a click completing the
 * round trip (a key actually changes) is the difference between "rendered"
 * and "usable".
 */
for (const width of [1024, 1280]) {
  test(`the last option of a per-agent sound control is hit-testable and clickable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 820 })
    await openConsole(page)
    await page.keyboard.press('6')

    const off = page.getByRole('radio', { name: 'ui.sound.agents.pi off' })
    // The "all" form scrolls; `toBeVisible` alone does not guarantee `pi`'s
    // row is inside the panel's clipped, scrolled-to viewport, only that it is
    // laid out and undisplayed nowhere — the coordinate check below needs it
    // actually in view, not just rendered somewhere below the fold.
    await off.scrollIntoViewIfNeeded()
    await expect(off).toBeVisible()

    const hitsTheOptionItself = await off.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const atCenter = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      )
      return atCenter === element || element.contains(atCenter)
    })
    expect(hitsTheOptionItself, 'the option must be the element at its own center').toBe(true)

    await expect(page.getByText('0 keys changed')).toBeVisible()
    await off.click()
    await expect(page.getByText('1 key changed')).toBeVisible()
  })
}
