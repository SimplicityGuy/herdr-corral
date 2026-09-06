import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { FIXTURE, openConsole } from './console.ts'

const ORIGINAL = readFileSync(FIXTURE, 'utf8')

/**
 * The round trip, in the shipped bundle: a real file chooser puts the fixture in
 * the editor, and the browser's own download hands it back. Comparing the bytes
 * is invariant 1 measured rather than asserted — the patcher had nothing to change
 * and every comment, blank line and alignment space has to survive the trip.
 */
test('a file opened and written back unedited is byte-identical', async ({ page }) => {
  await page.goto('/')

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /drop your config\.toml here/ }).click()
  await (await chooser).setFiles(FIXTURE)

  await expect(page.getByRole('region', { name: 'settings' })).toBeVisible()
  await expect(page.getByText('0 keys changed')).toBeVisible()

  await page.getByRole('button', { name: /download config\.toml/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const saving = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'download config.toml' }).click()
  const download = await saving

  expect(download.suggestedFilename()).toBe('config.toml')
  const written = readFileSync(await download.path(), 'utf8')
  expect(written).toBe(ORIGINAL)
})

/** Import is forgiving, but it does not pretend: a broken paste says where. */
test('a pasted config that will not parse names the line and keeps the user here', async ({
  page,
}) => {
  await page.goto('/')

  await page.getByLabel('or paste it').fill('[theme]\nname = "catppuccin\n')
  await page.getByRole('button', { name: 'load pasted config' }).click()

  await expect(page.getByRole('alert')).toContainText(/line 2, column \d+/)
  await expect(page.getByRole('region', { name: 'settings' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /drop your config\.toml here/ })).toBeVisible()
})

/** A file that is not a config is refused by name, not by silence. */
test('a file that is not a config is refused with a reason', async ({ page }) => {
  await page.goto('/')

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /drop your config\.toml here/ }).click()
  await (await chooser).setFiles({
    name: 'herdr.png',
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  })

  await expect(page.getByRole('alert')).toContainText('herdr.png is not a .toml file')
})

/**
 * The diff is the honest half of the export, and it has to work while the file is
 * one herdr would refuse — that is exactly when a user wants to look at it.
 */
test('an error blocks the write but never the diff', async ({ page }) => {
  await openConsole(page)

  await page.keyboard.press('6')
  await page.keyboard.press('/')
  await page.keyboard.type('sidebar_width')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('99999')
  await page.keyboard.press('Enter')

  await expect(page.getByText(/1 error/)).toBeVisible()
  await expect(page.getByRole('button', { name: /download config\.toml/ })).toBeDisabled()

  await page.getByRole('button', { name: ':diff' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('tab', { name: 'changed hunks' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(dialog.getByRole('button', { name: 'download config.toml' })).toBeDisabled()
  await expect(dialog.getByRole('alert')).toContainText('ui.sidebar_width')
  await expect(dialog.getByRole('button', { name: 'copy to clipboard' })).toBeEnabled()
})

/**
 * Radix keeps `aria-hidden` on the rest of the page until the palette's exit
 * animation ends, so a jump that moves focus onto a tree row too early is focus
 * inside hidden content and Chrome says so out loud. The console is the only place
 * that shows up, so the console is what this test reads.
 */
test('jumping from the palette leaves the console clean', async ({ page }) => {
  const complaints: string[] = []
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) complaints.push(message.text())
  })

  await openConsole(page)

  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type('theme.auto_switch')
  await page.getByRole('option', { name: /theme\.auto_switch/ }).first().click()
  await expect(page.getByRole('button', { name: /^theme\.auto_switch/ })).toBeFocused()

  expect(complaints.filter((text) => text.includes('aria-hidden'))).toEqual([])
  expect(complaints).toEqual([])
})

/**
 * Nothing corral does reaches anything but its own origin, and never as data.
 *
 * The page is allowed to go on pulling its own static assets — a font subset
 * loads the first time a glyph is needed, which is the bundle, not a call home.
 * What it may not do is address another origin at all, or fetch anything from its
 * own: a `fetch` or `XMLHttpRequest` is how a config would be uploaded, and
 * `no-network.test.ts` already forbids writing one.
 */
test('the editor makes no request while a file goes in and comes out', async ({ page }, info) => {
  await page.goto('/')
  const origin = new URL(info.project.use.baseURL ?? '').origin
  const afterLoad: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (url.startsWith('blob:')) return
    const offsite = !url.startsWith(origin)
    const isData = ['fetch', 'xhr', 'websocket', 'eventsource'].includes(request.resourceType())
    if (offsite || isData) afterLoad.push(`${request.resourceType()} ${url}`)
  })

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /drop your config\.toml here/ }).click()
  await (await chooser).setFiles(FIXTURE)
  await expect(page.getByRole('region', { name: 'settings' })).toBeVisible()

  await page.getByRole('button', { name: /download config\.toml/ }).click()
  const saving = page.waitForEvent('download')
  await page.getByRole('dialog').getByRole('button', { name: 'download config.toml' }).click()
  await saving

  expect(afterLoad).toEqual([])
})
