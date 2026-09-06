import { expect, test } from '@playwright/test'

test('the Console shell loads with its top line', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle('corral')

  const topLine = page.getByRole('banner')
  await expect(topLine).toBeVisible()
  await expect(topLine.getByLabel('corral')).toHaveText('▐▛█▜▌')
  await expect(topLine.getByText('config.toml')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Sections' })).toContainText('[1] layout')
})
