import { expect, test } from '@playwright/test'
import { FIXTURE, downloadConfig, openFixture } from './console.ts'

/**
 * The two doors of the app: the landing that takes a file in, and the export
 * that hands one back.
 *
 * What the export *writes* is `journeys.spec.ts`' subject — every claim about
 * the bytes is made there, against the fixture. This file is about the doors
 * themselves: what the landing refuses and how it says so, and the one property
 * that spans both ends, which is that nothing corral does touches the network.
 */

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

  await downloadConfig(page)

  expect(afterLoad).toEqual([])
})

/**
 * The install snippet and the clipboard are the other two ways out of the export
 * dialog, and both are about the same file the download writes.
 */
test('the export dialog offers the full file, the hunks and a way to install it', async ({
  page,
}) => {
  await openFixture(page)

  await page.getByRole('button', { name: /download config\.toml/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('tab', { name: 'full file' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(dialog.getByRole('button', { name: 'copy to clipboard' })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'copy install snippet' })).toBeEnabled()
  await expect(dialog.getByLabel('config.toml as it will be written')).toContainText(
    '# herdr configuration',
  )

  await dialog.getByRole('tab', { name: 'changed hunks' }).click()
  await expect(dialog.getByRole('tab', { name: 'changed hunks' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
