import { expect, test } from '@playwright/test'
import { addedSettings, openConsole } from './console.ts'

/**
 * Section `[3] status`, walked in a browser.
 *
 * The component tests already prove the editor agrees with the preview; what
 * only a browser can show is that a real `alt`+arrow on a real drag handle
 * reorders the list, and that the file at the end of it is the one herdr would
 * read. So each test drives the controls and then reads the diff behind
 * `:diff`.
 */

test('section [3] builds the tab bar entries, and the keyboard reorders them', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openConsole(page)

  await page.keyboard.press('3')
  await expect(
    page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: '[3] status' }),
  ).toHaveAttribute('aria-current', 'page')
  const status = page.getByRole('region', { name: /^status/ })
  await expect(status).toBeVisible()

  // Two entries, so there is an order to change.
  const picker = page.getByLabel('entry type to add')
  const add = page.getByRole('button', { name: '+ add entry' })
  await picker.selectOption('zoom')
  await add.click()
  await picker.selectOption('datetime')
  await add.click()

  await expect(page.getByLabel('ui.tab_bar_right[1].format')).toBeVisible()
  expect(await addedSettings(page)).toEqual([
    'tab_bar_right = [{ type = "zoom" }, { type = "datetime" }]',
  ])

  // Reordered from the keyboard alone: focus the handle, hold alt, press up.
  await page.getByRole('button', { name: 'drag ui.tab_bar_right[1]' }).focus()
  await page.keyboard.press('Alt+ArrowUp')
  await expect(page.getByRole('button', { name: 'drag ui.tab_bar_right[0]' })).toBeFocused()

  // Still one changed line, and the order in it is the order on screen.
  expect(await addedSettings(page)).toEqual([
    'tab_bar_right = [{ type = "datetime" }, { type = "zoom" }]',
  ])
  await expect(page.getByText('1 key changed')).toBeVisible()
})

/**
 * Clicking a thing must not take that thing off the screen.
 *
 * A region click moves the tree to the section that owns the key, so the cursor
 * can follow it, but the centre frame stays on the mock: the popover opens over
 * the tab bar it was anchored to, the bar repaints as the entry lands, and `esc`
 * leaves the user looking at what they clicked.
 */
test('the preview’s tab bar edits itself, in place, under the popover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openConsole(page)
  // `sidebar` is the switch that opens on the mock; every other one has a panel.
  await page.keyboard.press('2')

  const preview = page.getByRole('region', { name: /^preview/ })
  const entries = preview.getByRole('button', { name: 'tab bar status entries' })
  await entries.click()

  const popover = page.getByRole('dialog', { name: 'ui.tab_bar_right' })
  await expect(popover).toBeVisible()
  // The tree followed the click; the eye did not have to.
  await expect(
    page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: '[3] status' }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(preview).toBeVisible()

  await popover.getByLabel('entry type to add').selectOption('hostname')
  await popover.getByRole('button', { name: '+ add entry' }).click()

  // The right of the bar repainted behind the popover, as the entry landed.
  await expect(entries).toContainText('mbp')

  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
  await expect(preview).toBeVisible()
  await expect(entries).toHaveAttribute('data-selected', 'true')
  expect(await addedSettings(page)).toEqual(['tab_bar_right = [{ type = "hostname" }]'])
})

/** The switch is still how you get the panel, once you want it. */
test('the status switch still opens the section panel', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openConsole(page)
  await page.keyboard.press('2')

  await page.getByRole('button', { name: 'tab bar status entries' }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('3')

  await expect(page.getByRole('region', { name: /^status/ })).toBeVisible()
  await expect(page.getByRole('region', { name: /^preview/ })).toBeHidden()
})
