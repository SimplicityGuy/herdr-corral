import { expect, test } from '@playwright/test'
import { downloadConfig, openConsole, openFixture, openPreview } from './console.ts'

/**
 * The sidebar rows editor: the three ways into it, and what it does once it is
 * open.
 *
 * The keyboard drag itself, and what it writes, is `journeys.spec.ts`' subject —
 * dnd-kit's sensor is a claim about the file, so it is settled against the file's
 * bytes rather than here. What is left is this editor's own contract: every entry
 * point reaches it, an edit repaints the mock behind it, an override the file
 * already carries comes back out under its own key, and a row of chips gets a
 * frame wide enough to hold them.
 */

/**
 * The two other ways in: the spaces region of the preview, and the tree row for
 * the per-agent override table. Both have to reach the same editor, or the key
 * is editable from one place and inert from the other.
 */
test('the spaces region and the rows_by_agent tree row open the same editor', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openConsole(page)
  await openPreview(page)

  const preview = page.getByRole('region', { name: /^preview/ })
  await preview.getByRole('button', { name: /^space homelab$/ }).click()
  const spaces = page.getByRole('dialog', { name: 'ui.sidebar.spaces.rows' })
  await expect(spaces).toBeVisible()
  await expect(spaces.getByRole('button', { name: 'add branch' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.keyboard.press('6')
  await page.keyboard.press('/')
  await page.keyboard.type('rows_by_agent')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')

  const byAgent = page.getByRole('dialog', { name: 'ui.sidebar.agents.rows_by_agent' })
  await expect(byAgent).toBeVisible()
  await expect(byAgent.getByRole('combobox', { name: 'agent to override' })).toBeVisible()
})

/**
 * The preview redraws from the same value the editor writes, so a token added in
 * the popover shows up in the mock behind it without anything telling it to.
 */
test('a token added in the popover repaints the mock behind it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFixture(page)
  await openPreview(page)

  // codex rather than claude: the fixture gives claude a `rows_by_agent`
  // override, so the default rows this test edits are not what draws it.
  const preview = page.getByRole('region', { name: /^preview/ })
  const row = preview.getByRole('button', { name: 'agent codex' })
  await row.click()

  const popover = page.getByRole('dialog', { name: 'ui.sidebar.agents.rows' })
  await expect(popover).toBeVisible()
  await expect(row).not.toContainText('blocked')

  await popover.getByRole('button', { name: 'add state_text' }).click()
  await expect(row).toContainText('blocked')

  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
  await expect(page.getByText('1 key changed')).toBeVisible()
})

/**
 * An override the file already carries is editable in place, and comes back out
 * of the download under the key it went in as.
 */
test('an existing rows_by_agent override edits and writes back under its own key', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFixture(page)

  await page.keyboard.press('6')
  await page.keyboard.press('/')
  await page.keyboard.type('rows_by_agent')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')

  const popover = page.getByRole('dialog', { name: 'ui.sidebar.agents.rows_by_agent' })
  await popover.getByRole('button', { name: 'claude', exact: true }).click()
  await expect(
    popover.getByRole('button', { name: /^terminal_title_stripped in row 2/ }),
  ).toBeVisible()

  await popover.getByRole('button', { name: 'remove row 2' }).click()
  await page.keyboard.press('Escape')

  const written = (await downloadConfig(page)).toString('utf8')
  expect(written).toContain(
    'claude = [["state_icon", "workspace", "tab"], ["agent"]]',
  )
})

/** ADR-0002's popover is a 360px column; a row of chips asks for more. */
test('the rows editor gets a wider popover than a value field', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openConsole(page)
  await openPreview(page)

  await page.getByRole('region', { name: /^preview/ })
    .getByRole('button', { name: 'agent claude' })
    .click()

  const box = await page.getByRole('dialog').boundingBox()
  expect(box, 'the popover must be laid out').not.toBeNull()
  expect(box!.width).toBeGreaterThan(360)
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(1440)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(900)
})
