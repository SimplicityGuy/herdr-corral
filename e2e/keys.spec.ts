import { type Page, expect, test } from '@playwright/test'
import { downloadConfig, openConsole } from './console.ts'

/**
 * The mode badge, addressed exactly: `copy_mode` and `resize_mode` are rows on
 * this screen, and a substring match would find them too.
 */
const MODE = { exact: true } as const

/**
 * The file corral would hand the user, as the bytes the browser writes to disk.
 *
 * Asserting the UI values proves the editor agrees with itself; only the
 * downloaded file proves it agrees with herdr, which is what a config file is
 * for. Reading the dialog's textarea would prove neither — it is the same string
 * the editor already showed.
 */
async function writtenConfig(page: Page): Promise<string> {
  return (await downloadConfig(page)).toString('utf8')
}

/**
 * The keybindings editor, section `[4]`.
 *
 * The recording itself — `enter`, a real chord, and the line it writes — is
 * walked over the fixture in `journeys.spec.ts`, because what a browser settles
 * about `src/lib/capture.ts` is a claim about the file. What is left here is the
 * editor's own behaviour around it: an abandoned recording, a recording started
 * from a tree row, the custom-command blocks, and the two ways a value reaches
 * the file without an `enter` at all.
 */

test('esc cancels a recording without touching the setting', async ({ page }) => {
  await openConsole(page)
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
  await openConsole(page)
  await page.keyboard.press('4')

  await page.keyboard.press('/')
  await page.keyboard.type('keys.zoom')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')

  const popover = page.getByRole('dialog', { name: 'keys.zoom' })
  await expect(popover).toBeVisible()

  // Tab is trapped inside the popover and every step out of the field settles
  // it, so walking the controls must not write the default back.
  for (let step = 0; step < 4; step++) await page.keyboard.press('Tab')
  await expect(page.getByText('0 keys changed')).toBeVisible()

  await popover.getByRole('button', { name: 'record keys.zoom' }).press('Enter')
  await page.keyboard.press('F5')

  await expect(popover).toBeHidden()
  await expect(page.getByRole('button', { name: 'keys.zoom = f5' })).toBeVisible()
})

test('a custom command is added, typed and written as a [[keys.command]] block', async ({
  page,
}) => {
  await openConsole(page)
  await page.keyboard.press('4')

  await page.getByRole('button', { name: '+ add command' }).click()
  await page.getByRole('combobox', { name: 'keys.command[0].type' }).selectOption('popup')
  await page.getByRole('textbox', { name: 'keys.command[0].command' }).fill('htop')
  await page.getByRole('textbox', { name: 'keys.command[0].command' }).press('Enter')
  await page.getByRole('textbox', { name: 'keys.command[0].width' }).fill('80%')
  await page.getByRole('textbox', { name: 'keys.command[0].width' }).press('Enter')

  await page.getByRole('textbox', { name: 'keys.command[0].key' }).fill('prefix+t')
  await page.getByRole('textbox', { name: 'keys.command[0].key' }).press('Enter')

  await expect(page.getByRole('textbox', { name: 'keys.command[0].width' })).toHaveValue('80%')
  await expect(page.getByRole('textbox', { name: 'keys.command[1].command' })).toBeHidden()

  const written = await writtenConfig(page)
  expect(written).toContain('[[keys.command]]')
  expect(written).toContain('key = "prefix+t"')
  expect(written).toContain('type = "popup"')
  expect(written).toContain('command = "htop"')
  expect(written).toContain('width = "80%"')

  await page.getByRole('button', { name: 'remove keys.command[0]' }).click()
  await expect(page.getByText(/none yet/)).toBeVisible()
  expect(await writtenConfig(page)).not.toContain('[[keys.command]]')
})

test('the prefix+ toggle reaches the file, not just the field', async ({ page }) => {
  await openConsole(page)
  await page.keyboard.press('4')

  await page.getByRole('checkbox', { name: 'prefix+ for keys.remote_image_paste' }).check()

  await expect(page.getByRole('textbox', { name: 'keys.remote_image_paste' })).toHaveValue(
    'prefix+ctrl+v',
  )
  await expect(
    page.getByRole('button', { name: 'keys.remote_image_paste = prefix+ctrl+v' }),
  ).toBeVisible()
  expect(await writtenConfig(page)).toContain('remote_image_paste = "prefix+ctrl+v"')
})

test('a chord typed and left behind is still written', async ({ page }) => {
  await openConsole(page)
  await page.keyboard.press('4')

  // Browsing rows is not editing them: a binding on its schema default is unset,
  // and settling it must not write a pure-default line into the file.
  await page.getByRole('textbox', { name: 'keys.zoom' }).click()
  await page.getByRole('textbox', { name: 'keys.split_vertical' }).click()
  await page.getByRole('button', { name: 'reset keys.settings' }).click()
  await expect(page.getByText('0 keys changed')).toBeVisible()

  const field = page.getByRole('textbox', { name: 'keys.help' })
  await field.fill('prefix+f1')
  // No enter: the user types and clicks elsewhere, which is where the value
  // used to be lost.
  await page.getByRole('button', { name: 'reset keys.settings' }).click()

  await expect(page.getByRole('button', { name: 'keys.help = prefix+f1' })).toBeVisible()
  expect(await writtenConfig(page)).toContain('help = "prefix+f1"')
})
