import { expect, test } from '@playwright/test'

/**
 * The mode badge, addressed exactly: `copy_mode` and `resize_mode` are rows on
 * this screen, and a substring match would find them too.
 */
const MODE = { exact: true } as const

/**
 * The keybindings editor, walked the way ADR-0002 says the shell is driven:
 * `4` opens the section, tab reaches the rows, `enter` starts a recording, and
 * the combination the browser actually delivers is what lands in the file.
 *
 * This is the one thing a component test cannot prove. jsdom synthesizes a
 * `KeyboardEvent` from whatever a test hands it; only a browser decides that
 * `ctrl+shift+p` arrives as `key: 'P'` with two modifier flags, which is exactly
 * the translation `src/lib/capture.ts` exists to do.
 */
test('recording a chord in section [4] writes it and the tree follows', async ({ page }) => {
  await page.goto('/')
  await page.setViewportSize({ width: 1280, height: 820 })

  await page.keyboard.press('4')
  await expect(
    page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: '[4] keys' }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('region', { name: /^keybindings/ })).toBeVisible()

  // `/` focuses the tree filter; the tree is one tab stop, so a second tab
  // leaves it for the first control of the editor in the centre frame.
  await page.keyboard.press('/')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const record = page.getByRole('button', { name: 'record keys.prefix' })
  await expect(record).toBeFocused()

  // enter records; the mode badge is the shell saying so.
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('mode', MODE)).toHaveText('RECORD')

  await page.keyboard.press('Control+Shift+P')
  await expect(page.getByRole('textbox', { name: 'keys.prefix' })).toHaveValue('ctrl+shift+p')
  await expect(page.getByLabel('mode', MODE)).toHaveText('EDIT')

  // The settings tree reads the same store, so the row moved with it.
  await expect(
    page.getByRole('button', { name: 'keys.prefix = ctrl+shift+p' }),
  ).toBeVisible()
  await expect(page.getByText('1 key changed')).toBeVisible()
})

test('esc cancels a recording without touching the setting', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('4')

  const record = page.getByRole('button', { name: 'record keys.split_vertical' })
  await record.press('Enter')
  await expect(page.getByLabel('mode', MODE)).toHaveText('RECORD')

  await page.keyboard.press('Escape')
  await expect(page.getByLabel('mode', MODE)).toHaveText('EDIT')
  await expect(page.getByRole('textbox', { name: 'keys.split_vertical' })).toHaveValue('prefix+v')
  await expect(page.getByText('0 keys changed')).toBeVisible()
})

test('enter on a tree row records the chord in place', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('4')

  await page.keyboard.press('/')
  await page.keyboard.type('keys.zoom')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')

  const popover = page.getByRole('dialog', { name: 'keys.zoom' })
  await expect(popover).toBeVisible()

  await popover.getByRole('button', { name: 'record keys.zoom' }).press('Enter')
  await page.keyboard.press('F5')

  await expect(popover).toBeHidden()
  await expect(page.getByRole('button', { name: 'keys.zoom = f5' })).toBeVisible()
})

test('a custom command is added, typed and written as a [[keys.command]] block', async ({
  page,
}) => {
  await page.goto('/')
  await page.keyboard.press('4')

  await page.getByRole('button', { name: '+ add command' }).click()
  await page.getByRole('combobox', { name: 'keys.command[0].type' }).selectOption('popup')
  await page.getByRole('textbox', { name: 'keys.command[0].command' }).fill('htop')
  await page.getByRole('textbox', { name: 'keys.command[0].command' }).press('Enter')
  await page.getByRole('textbox', { name: 'keys.command[0].width' }).fill('80%')
  await page.getByRole('textbox', { name: 'keys.command[0].width' }).press('Enter')

  await expect(page.getByRole('textbox', { name: 'keys.command[0].width' })).toHaveValue('80%')
  await expect(page.getByRole('textbox', { name: 'keys.command[1].command' })).toBeHidden()

  await page.getByRole('button', { name: 'remove keys.command[0]' }).click()
  await expect(page.getByText(/none yet/)).toBeVisible()
})
