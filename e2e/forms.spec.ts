import { expect, test } from '@playwright/test'

/**
 * corral-xp7.9: typed forms for every setting the specialised editors do not
 * own, mounted as the center-frame view for `[1] layout` and `[6] all`.
 */

test('pressing 1 shows the layout form, and changing a boolean through it changes one key', async ({
  page,
}) => {
  await page.goto('/')

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
  await page.goto('/')
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
  await page.goto('/')
  await page.keyboard.press('6')

  const form = page.getByRole('region', { name: 'all' })
  await expect(form).toBeVisible()
  await expect(form.getByRole('heading', { name: 'Sound' })).toBeVisible()
  await expect(form.getByRole('heading', { name: 'per-agent overrides' })).toBeVisible()
})
