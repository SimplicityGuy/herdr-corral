import { expect, test } from '@playwright/test'
import { addedSettings, openConsole } from './console.ts'

/**
 * Section `[5] theme` and the popover the preview opens, walked in a browser.
 *
 * A theme is a claim about what herdr will look like, so the things only a
 * browser can settle are here: that picking one from the swatches writes the
 * name, that a colour herdr cannot read is refused in words rather than in
 * silence, that clicking the mock's theme chip repaints the mock instead of
 * replacing it, and that the popover fits in the window it is drawn in.
 */

test('section [5] picks a theme from its swatches and overrides the accent', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openConsole(page)

  await page.keyboard.press('5')
  await expect(
    page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: '[5] theme' }),
  ).toHaveAttribute('aria-current', 'page')
  const theme = page.getByRole('region', { name: /^theme/ })
  await expect(theme).toBeVisible()

  const nord = page.getByRole('button', { name: 'theme nord' })
  await expect(nord).toHaveAttribute('aria-pressed', 'false')
  await nord.click()
  await expect(nord).toHaveAttribute('aria-pressed', 'true')

  await page.getByLabel('ui.accent', { exact: true }).fill('#ff8800')

  expect(await addedSettings(page)).toEqual(['name = "nord"', 'accent = "#ff8800"'])
  await expect(page.getByText('2 keys changed')).toBeVisible()
})

test('an unreadable colour is refused in words, not in silence', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openConsole(page)
  await page.keyboard.press('5')

  await page.getByLabel('theme.custom.sidebar_bg', { exact: true }).fill('chartreuse')

  // Under the field, and again in the diagnostics line — herdr loads the file
  // and falls back to cyan, so it is a warning and the download stays open.
  await expect(page.getByText('unknown color "chartreuse"')).toHaveCount(2)
  await expect(page.getByRole('button', { name: /download config\.toml/ })).toBeEnabled()

  // Resetting takes the line back out of the file entirely.
  await page.getByRole('button', { name: 'reset theme.custom.sidebar_bg' }).click()
  expect(await addedSettings(page)).toEqual([])
  await expect(page.getByText('0 keys changed')).toBeVisible()
})

/**
 * The mock's theme chip edits the theme in front of the theme.
 *
 * Every colour on screen comes from this one setting, so replacing the mock with
 * a panel at the moment it is picked hides the only thing that would tell the
 * user whether they picked the right one.
 */
test('the preview’s theme chip repaints the mock rather than replacing it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openConsole(page)
  await page.keyboard.press('2')

  const preview = page.getByRole('region', { name: /^preview/ })
  const sidebar = preview.locator('[data-part="sidebar"]')
  const before = await sidebar.evaluate((node) => getComputedStyle(node).backgroundColor)

  await preview.getByRole('button', { name: /^theme catppuccin/ }).click()
  const popover = page.getByRole('dialog', { name: 'theme.name' })
  await expect(popover).toBeVisible()
  await expect(preview).toBeVisible()

  await popover.getByRole('button', { name: 'theme nord' }).click()

  await expect(sidebar).not.toHaveCSS('background-color', before)
  await page.keyboard.press('Escape')
  await expect(preview).toBeVisible()
  expect(await addedSettings(page)).toEqual(['name = "nord"'])
})

/**
 * The palette is nineteen colour rows and a window is 820px tall.
 *
 * The shell is `overflow-hidden`, so a frame past the fold is not scrolled back
 * — it is gone. The frame is capped at the window, its body scrolls inside that,
 * and the overrides are folded away until they are asked for.
 */
test('the theme popover fits the window it is drawn in', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openConsole(page)
  await page.keyboard.press('2')

  await page.getByRole('button', { name: /^theme catppuccin/ }).click()
  const popover = page.getByRole('dialog', { name: 'theme.name' })
  await expect(popover).toBeVisible()

  const box = await popover.boundingBox()
  expect(box, 'the popover must be laid out').not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(820)
  expect(box!.x + box!.width).toBeLessThanOrEqual(1280)

  // Folded by default, and every row is there once it is opened — inside the
  // frame, which scrolls, rather than off the bottom of the window.
  const overrides = popover.getByRole('button', { name: /override colours/ })
  await expect(overrides).toHaveAttribute('aria-expanded', 'false')
  await overrides.click()
  await expect(popover.getByLabel('theme.custom.peach', { exact: true })).toBeAttached()

  // Unfolding makes the frame taller, and the host re-places it once it has
  // measured the new height — a layout pass later, so this polls rather than
  // reading the frame mid-correction.
  await expect
    .poll(async () => {
      const opened = await popover.boundingBox()
      return opened === null ? Number.POSITIVE_INFINITY : opened.y + opened.height
    })
    .toBeLessThanOrEqual(820)
})

/**
 * The tree opens one key, and the popover has to be about that key.
 *
 * The palette draws twenty colour rows and folds nineteen of them away, so a
 * popover opened on one of those rows unfolds them and puts the cursor on the
 * row it is captioned with. Walked from the keyboard, which is how the tree is
 * driven.
 */
test('a theme.custom row opened from the tree shows its own field', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openConsole(page)

  await page.keyboard.press('5')
  await page.keyboard.press('/')
  await page.keyboard.type('theme.custom.sidebar_bg')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')

  const popover = page.getByRole('dialog', { name: 'theme.custom.sidebar_bg' })
  await expect(popover).toBeVisible()

  const field = popover.getByRole('textbox', { name: 'theme.custom.sidebar_bg' })
  await expect(field).toBeVisible()
  await expect(field).toBeFocused()
  await expect(popover.getByRole('button', { name: /override colours/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  )

  await page.keyboard.type('#101010')
  await page.keyboard.press('Escape')
  expect(await addedSettings(page)).toEqual(['sidebar_bg = "#101010"'])
})
