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

test('the shell has the anatomy ADR-0002 draws', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('region', { name: 'settings' })).toBeVisible()
  await expect(page.getByRole('region', { name: /^preview/ })).toBeVisible()
  await expect(page.getByLabel('mode')).toHaveText('EDIT')
  await expect(page.getByText('0 keys changed')).toBeVisible()
  await expect(page.getByRole('button', { name: /download config\.toml/ })).toBeEnabled()
})

/**
 * The acceptance criterion, walked without ever touching the mouse: the six
 * switches, the filter, the row cursor, the editor, undo, and the palette.
 */
test('the whole shell is reachable from the keyboard alone', async ({ page }) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 820 })

  const nav = page.getByRole('navigation', { name: 'Sections' })

  // 1–6 switch sections.
  await page.keyboard.press('4')
  await expect(nav.getByRole('button', { name: '[4] keys' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await page.keyboard.press('6')
  await expect(nav.getByRole('button', { name: '[6] all' })).toHaveAttribute(
    'aria-current',
    'page',
  )

  // `/` filters the tree.
  await page.keyboard.press('/')
  await expect(page.getByRole('searchbox', { name: 'Filter settings' })).toBeFocused()
  await page.keyboard.type('sidebar_')
  await expect(page.getByRole('button', { name: 'ui.sidebar_width = 26' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^theme\.name/ })).toHaveCount(0)

  // j/k move the row cursor.
  await page.getByRole('button', { name: 'ui.sidebar_width = 26' }).focus()
  await page.keyboard.press('j')
  await expect(page.getByRole('button', { name: /^ui\.sidebar_min_width/ })).toBeFocused()
  await page.keyboard.press('k')
  await expect(page.getByRole('button', { name: 'ui.sidebar_width = 26' })).toBeFocused()

  // enter opens the editor, esc closes it and changes nothing.
  await page.keyboard.press('Enter')
  const popover = page.getByRole('dialog', { name: 'ui.sidebar_width' })
  await expect(popover).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
  await expect(page.getByRole('button', { name: 'ui.sidebar_width = 26' })).toBeFocused()

  // enter applies, and the tree and the diagnostics line both say so.
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('34')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'ui.sidebar_width = 34' })).toBeVisible()
  await expect(page.getByText('1 keys changed')).toBeVisible()

  // u undoes it.
  await page.getByRole('button', { name: 'ui.sidebar_width = 34' }).focus()
  await page.keyboard.press('u')
  await expect(page.getByRole('button', { name: 'ui.sidebar_width = 26' })).toBeVisible()
  await expect(page.getByText('0 keys changed')).toBeVisible()

  // ctrl+k opens the palette and jumps to a key in another section.
  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type('theme.auto_switch')
  await page.getByRole('option', { name: /theme\.auto_switch/ }).first().click()
  await expect(nav.getByRole('button', { name: '[5] theme' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByRole('button', { name: /^theme\.auto_switch/ })).toBeFocused()
})

test('the download is refused while the config has an error', async ({ page }) => {
  await page.goto('/')

  // `ui.window_title` takes a string herdr can expand; a lone `{` is not one.
  await page.keyboard.press('6')
  await page.keyboard.press('/')
  await page.keyboard.type('sidebar_min_width')
  await page.getByRole('button', { name: /^ui\.sidebar_min_width/ }).focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('999')
  await page.keyboard.press('Enter')

  await expect(page.getByText(/warning/)).toContainText('sidebar')
})

test('the shell matches the reference at 1280x820', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'settings' })).toBeVisible()

  await page.screenshot({ path: 'test-results/console-shell.png' })
})
