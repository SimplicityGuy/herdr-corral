import { expect, test, type Page } from '@playwright/test'
import { FIXTURE, openConsole } from './console.ts'

/**
 * Two animation frames — long enough for dnd-kit to have measured the drop
 * targets for the drag that just started.
 *
 * Its droppables are measured *while dragging*, in the frame after the pick-up,
 * and an arrow key that arrives before that finds no rectangles to compare and
 * is silently ignored. Waiting a fixed number of milliseconds would be guessing;
 * waiting for the frames that do the measuring is the actual condition.
 */
async function measured(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
}

/** Open the hand-written fixture, so a diff is a diff against real bytes. */
async function openFixture(page: Page): Promise<void> {
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /drop your config\.toml here/ }).click()
  await (await chooser).setFiles(FIXTURE)
  await page.getByRole('region', { name: 'settings' }).waitFor()
}

/**
 * Switch to `[2] sidebar`, which is where the herdr mock is drawn.
 *
 * The centre frame is one line per section: `layout` and `all` draw the typed
 * form and `keys` draws the chord editor, so the console opens on a section that
 * has no preview in it. The sidebar rows are what this file is about, and the
 * sidebar switch is where they are on screen.
 */
async function openPreview(page: Page): Promise<void> {
  await page.keyboard.press('2')
  await page.getByRole('region', { name: /^preview/ }).waitFor()
}

/**
 * The headline gesture of ADR-0002, walked in a real browser without a mouse:
 * click the sidebar rows the preview draws, pick a token up with the keyboard,
 * drop it in the row below, and see the preview and the diff both follow.
 *
 * The keyboard sensor is what is under test rather than the editor's own
 * `alt`-arrow shortcut: dnd-kit measures the DOM to decide where an arrow key
 * lands a chip, and a component test measuring a synthetic layout can only show
 * the wiring is right. This is where the geometry is real.
 */
test('a token moves between sidebar rows from the keyboard alone', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFixture(page)
  await openPreview(page)

  // codex rather than claude: the fixture gives claude a `rows_by_agent`
  // override, so the default rows this test edits are not what draws it.
  const preview = page.getByRole('region', { name: /^preview/ })
  await preview.getByRole('button', { name: 'agent codex' }).click()

  const popover = page.getByRole('dialog', { name: 'ui.sidebar.agents.rows' })
  await expect(popover).toBeVisible()
  await expect(popover.getByRole('button', { name: 'tab in row 1, token 3' })).toBeVisible()

  const announcer = page.locator('[role="status"]:not([aria-label])')
  await popover.getByRole('button', { name: 'tab in row 1, token 3' }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByLabel('mode', { exact: true })).toHaveText('DRAG')
  await expect(announcer).toContainText('tok:0:2')
  await measured(page)

  await page.keyboard.press('ArrowDown')
  await expect(announcer).toContainText('droppable area tok:1')

  await page.keyboard.press('Space')
  await expect(page.getByLabel('mode', { exact: true })).toHaveText('EDIT')

  await expect(popover.getByRole('button', { name: /^tab in row 2/ })).toBeVisible()
  await expect(popover.getByRole('button', { name: /^tab in row 1/ })).toHaveCount(0)

  // The preview redraws from the same value, so a token added here shows up in
  // the mock behind the popover without anything telling it to.
  await expect(preview.getByRole('button', { name: 'agent codex' })).not.toContainText('blocked')
  await popover.getByRole('button', { name: 'add state_text' }).click()
  await expect(preview.getByRole('button', { name: 'agent codex' })).toContainText('blocked')

  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
  await expect(page.getByText('1 key changed')).toBeVisible()

  // The rows line is what changed in the file, and nothing else: the editor
  // writes the whole value and the patcher leaves every other byte alone.
  await page.getByRole('button', { name: ':diff' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('tab', { name: 'changed hunks' })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  const edited = await dialog.evaluate((node) =>
    [...node.querySelectorAll('p')]
      .map((line) => line.textContent ?? '')
      .filter((line) => line.startsWith('+') || line.startsWith('-')),
  )
  // The fixture writes `rows` as a wrapped array and so does the patcher, so
  // the `rows = [` line itself is untouched and the difference is the rows
  // inside it. Every line the export changes is one of those.
  expect(edited.length).toBeGreaterThan(0)
  expect(edited.every((line) => /^[+-]\s*\[/.test(line))).toBe(true)
  expect(edited.some((line) => line.startsWith('+') && line.includes('"tab"'))).toBe(true)
})

/**
 * The other two ways in: the spaces region of the preview, and the tree row for
 * the per-agent override table. Both have to reach the same editor, or the key
 * is editable from one place and inert from the other.
 */
test('the spaces region and the rows_by_agent tree row open the same editor', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openConsole(page)
  await openPreview(page)

  const preview = page.getByRole('region', { name: /^preview/ })
  await preview.getByRole('button', { name: /^space phaze$/ }).click()
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
 * An override the file already carries is editable in place, and comes back out
 * under the key it went in as.
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

  await page.getByRole('button', { name: /download config\.toml/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('tab', { name: 'full file' }).click()
  await expect(dialog.getByLabel('config.toml as it will be written')).toContainText(
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
