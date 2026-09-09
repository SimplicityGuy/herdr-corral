import { expect, test } from '@playwright/test'
import {
  FIXTURE_BYTES,
  FIXTURE_TEXT,
  diffLines,
  downloadConfig,
  measured,
  openFixture,
  openPreview,
  tabTo,
} from './console.ts'

/**
 * The product's promises, walked end to end in a real browser against the built
 * bundle: a hand-written file goes in through the file chooser, is edited the way
 * ADR-0002 says the shell is driven, and comes back out through the browser's own
 * download.
 *
 * Every claim here is made about the **bytes on disk**, never about what the
 * export dialog says on screen. The dialog agreeing with the editor proves the
 * two read the same store; only the file herdr would open proves the patcher
 * did its job. The per-area specs cover the controls — this file covers what
 * comes out of them.
 */

const AGENT_ROWS = [
  '  ["state_icon", { token = "workspace", fg = "#89b4fa", bold = true }, "tab"],',
  '  [{ token = "agent", fg = "#a6e3a1", dim = true }, "$model"],',
]

function removed(edits: string[]): string[] {
  return edits.filter((edit) => edit.startsWith('-')).map((edit) => edit.slice(1))
}

function added(edits: string[]): string[] {
  return edits.filter((edit) => edit.startsWith('+')).map((edit) => edit.slice(1))
}

/**
 * Invariant 1, measured rather than asserted: a real file chooser puts the
 * fixture in the editor, the browser's own download hands it back, and the two
 * buffers are the same buffer. The patcher had nothing to change, so every
 * comment, blank line and alignment space has to survive the trip untouched.
 */
test('a file opened and written back unedited is byte-identical', async ({ page }) => {
  await openFixture(page)
  await expect(page.getByText('0 keys changed')).toBeVisible()

  const written = await downloadConfig(page)

  // Compared as text first, because a failure here should read as a diff rather
  // than as two byte counts; the buffer comparison after it is the actual claim.
  expect(written.toString('utf8')).toBe(FIXTURE_TEXT)
  expect(written.equals(FIXTURE_BYTES)).toBe(true)
})

/**
 * The headline gesture of ADR-0002, walked without a mouse and settled in bytes:
 * pick a token up with dnd-kit's keyboard sensor, carry it into agents row 1,
 * and see that the only thing that moved in the file is the rows value.
 *
 * dnd-kit measures the DOM to decide where an arrow key lands a chip, so a
 * component test against a synthetic layout can only show the wiring is right.
 * This is where the geometry is real.
 *
 * The bead asks for "exactly one changed line". The exporter re-wraps an array
 * that no longer fits on one line, so a token moving into a row that is already
 * near the margin turns two source lines into seven — a fact about the
 * formatter's wrap point, not about the edit. The claim made instead is the
 * stronger one the line count was standing in for: the edit script against the
 * fixture is *exactly* the rows value and nothing else in the file is touched.
 * The spaces rows, which stay inline, carry the literal single-line reading in
 * the test below.
 */
test('a token carried into agents row 1 from the keyboard changes only the rows value', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFixture(page)
  await openPreview(page)

  // codex rather than claude: the fixture gives claude a `rows_by_agent`
  // override, so the default rows this test edits are not what draws it.
  const preview = page.getByRole('region', { name: /^preview/ })
  await preview.getByRole('button', { name: 'agent codex' }).click()
  const popover = page.getByRole('dialog', { name: 'ui.sidebar.agents.rows' })
  await expect(popover).toBeVisible()

  const chip = popover.getByRole('button', { name: 'agent in row 2, token 1' })
  await tabTo(page, chip)

  const announcer = page.locator('[role="status"]:not([aria-label])')
  await page.keyboard.press('Space')
  await expect(page.getByLabel('mode', { exact: true })).toHaveText('DRAG')
  await expect(announcer).toContainText('tok:1:0')
  await measured(page)

  await page.keyboard.press('ArrowUp')
  await expect(announcer).toContainText('droppable area tok:0:0')
  await page.keyboard.press('Space')
  await expect(page.getByLabel('mode', { exact: true })).toHaveText('EDIT')

  // The chip is in row 1 now, and the row it came from is one token shorter.
  await expect(popover.getByRole('button', { name: 'agent in row 1, token 1' })).toBeVisible()
  await expect(popover.getByRole('button', { name: /^\$model in row 2, token 1/ })).toBeVisible()
  await expect(popover.getByRole('button', { name: /in row 2, token 2$/ })).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
  await expect(page.getByText('1 key changed')).toBeVisible()

  const edits = diffLines(FIXTURE_TEXT, (await downloadConfig(page)).toString('utf8'))
  expect(removed(edits)).toEqual(AGENT_ROWS)
  expect(added(edits)).toEqual([
    '  [',
    '    { token = "agent", fg = "#a6e3a1", dim = true },',
    '    "state_icon",',
    '    { token = "workspace", fg = "#89b4fa", bold = true },',
    '    "tab",',
    '  ],',
    '  ["$model"],',
  ])
})

/**
 * The same gesture on the spaces rows, which the fixture writes inline: one line
 * of the file differs, and it is the rows line.
 */
test('a token carried into spaces row 1 changes exactly one line of the file', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFixture(page)
  await openPreview(page)

  await page
    .getByRole('region', { name: /^preview/ })
    .getByRole('button', { name: /^space homelab$/ })
    .click()
  const popover = page.getByRole('dialog', { name: 'ui.sidebar.spaces.rows' })
  await expect(popover).toBeVisible()

  await tabTo(page, popover.getByRole('button', { name: 'branch in row 2, token 1' }))
  const announcer = page.locator('[role="status"]:not([aria-label])')
  await page.keyboard.press('Space')
  await expect(announcer).toContainText('tok:1:0')
  await measured(page)
  await page.keyboard.press('ArrowUp')
  await expect(announcer).toContainText('droppable area tok:0:0')
  await page.keyboard.press('Space')
  await expect(page.getByLabel('mode', { exact: true })).toHaveText('EDIT')

  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()

  const edits = diffLines(FIXTURE_TEXT, (await downloadConfig(page)).toString('utf8'))
  expect(edits).toEqual([
    '-rows = [["state_icon", "workspace"], ["branch", "git_status"]]',
    '+rows = [["branch", "state_icon", "workspace"], ["git_status"]]',
  ])
})

/**
 * The rest of the editors, chained into one sitting: record a chord, reorder a
 * tab-bar entry, pick a theme and override the accent — then write the file once
 * and read what four unrelated editors did to it.
 *
 * Four settings changed, four lines differ. The comments the file was written
 * with, the two custom command blocks, the sidebar tables and the entries that
 * were not reordered all come back byte for byte, which is the whole point of a
 * patcher that no editor knows about.
 */
test('a chord, an entry reorder, a theme and an accent reach the file together', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openFixture(page)
  const nav = page.getByRole('navigation', { name: 'Sections' })

  // [4] keys — the recording only a browser can settle: `ctrl+shift+p` arrives
  // as `key: 'P'` with two modifier flags, which is the translation
  // `src/lib/capture.ts` exists to do.
  await page.keyboard.press('4')
  await expect(nav.getByRole('button', { name: '[4] keys' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  // `/` filters the tree, tab leaves the filter for the row it found, and enter
  // opens the chord editor on it — the whole route from the keyboard.
  await page.keyboard.press('/')
  await page.keyboard.type('keys.split_vertical')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  const chord = page.getByRole('dialog', { name: 'keys.split_vertical' })
  await expect(chord).toBeVisible()

  await tabTo(page, chord.getByRole('button', { name: 'record keys.split_vertical' }))
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('mode', { exact: true })).toHaveText('RECORD')
  await page.keyboard.press('Control+Shift+P')
  await expect(page.getByLabel('mode', { exact: true })).toHaveText('EDIT')
  await expect(chord).toBeHidden()
  // The settings tree reads the same store, so the row moved with it.
  await expect(
    page.getByRole('button', { name: 'keys.split_vertical = ctrl+shift+p' }),
  ).toBeVisible()

  // [3] status — the fixture's three entries, reordered from the keyboard alone.
  await page.keyboard.press('3')
  await expect(page.getByRole('region', { name: /^status/ })).toBeVisible()
  await page.keyboard.press('/')
  const last = page.getByRole('button', { name: 'drag ui.tab_bar_right[2]' })
  await tabTo(page, last)
  await page.keyboard.press('Alt+ArrowUp')
  await expect(page.getByRole('button', { name: 'drag ui.tab_bar_right[1]' })).toBeFocused()

  // [5] theme — a built-in from the swatches, and the one accent that lives
  // outside the `theme.custom` table.
  await page.keyboard.press('5')
  const nord = page.getByRole('button', { name: 'theme nord' })
  await expect(page.getByRole('button', { name: 'theme catppuccin', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(nord).toHaveAttribute('aria-pressed', 'false')
  await nord.click()
  await expect(nord).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('ui.accent', { exact: true }).fill('#ff8800')

  await expect(page.getByText('4 keys changed')).toBeVisible()

  const edits = diffLines(FIXTURE_TEXT, (await downloadConfig(page)).toString('utf8'))
  expect(removed(edits)).toEqual([
    'name = "catppuccin"',
    'split_vertical = "prefix+v"',
    '  { type = "hostname" },',
    'accent = "cyan"',
  ])
  expect(added(edits)).toEqual([
    'name = "nord"',
    'split_vertical = "ctrl+shift+p"',
    '  { type = "hostname" },',
    'accent = "#ff8800"',
  ])
})

/**
 * Invariant 6, from both sides, on a file that is otherwise fine.
 *
 * herdr's own split is what corral mirrors: a value it *copes* with is a
 * warning and the door stays open, a value that makes its deserializer throw the
 * whole file away is an error and the door is shut, with the offending key named
 * where the user is about to write.
 *
 * The bead asks for the colour to be the thing that shuts it. It is not, and
 * deliberately: an unreadable colour makes herdr fall back to cyan rather than
 * discard the file (`checkColor`, src/model/validate.ts), so corral warns and
 * keeps writing. The only colour herdr rejects outright is a sidebar token `fg`
 * that is not hex, and the rows editor will not let one be typed — `set fg` is
 * disabled until `isHexColor` agrees. So the blocking half is walked with the
 * value that genuinely blocks: an integer past herdr's u16 ceiling.
 */
test('a clamped width warns, an unreadable colour warns, and a bad number shuts the door', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openFixture(page)
  const write = page.getByRole('button', { name: /download config\.toml/ })
  // The diagnostics line is the shell's footer, and the only one on the page.
  const diagnostics = page.getByRole('contentinfo')

  // A minimum above the width herdr would clamp to: herdr keeps running, so
  // corral says so in the line and leaves the write open.
  await page.keyboard.press('6')
  await page.keyboard.press('/')
  await page.keyboard.type('ui.sidebar_min_width')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('30')
  await page.keyboard.press('Enter')

  await expect(diagnostics).toContainText('1 warning')
  await expect(diagnostics).toContainText(
    'ui.sidebar_width (26) is below sidebar_min_width (30); herdr will clamp it',
  )
  await expect(write).toBeEnabled()

  // A colour herdr cannot read: a second warning, in the same words under the
  // field and in the line, and the write is still open.
  await page.keyboard.press('5')
  const colour = page.getByLabel('theme.custom.sidebar_bg', { exact: true })
  await colour.fill('chartreuse')
  await expect(page.getByText('unknown color "chartreuse"')).toHaveCount(2)
  await expect(diagnostics).toContainText('2 warnings')
  await expect(write).toBeEnabled()
  // Leave the field before driving the shell again: while a text input has the
  // focus, `6` and `/` are characters, not switches.
  await colour.blur()

  // A number past the u16 ceiling: herdr's deserializer rejects the file and
  // starts on defaults, so the write is refused and says why.
  await page.keyboard.press('6')
  await page.keyboard.press('/')
  await page.keyboard.type('ui.sidebar_width')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('99999')
  await page.keyboard.press('Enter')

  await expect(diagnostics).toContainText('1 error')
  await expect(write).toBeDisabled()
  await expect(write).toHaveAccessibleDescription(
    'herdr ignores a config file it cannot read and starts on defaults; fix the errors first',
  )

  // `:diff` is never blocked — reading what is wrong is what a user with an
  // error needs — and it is where the offending key is named. The download
  // behind it is refused a second time, and a plain copy of the text is not.
  await page.getByRole('button', { name: ':diff' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('tab', { name: 'changed hunks' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(dialog.getByRole('alert')).toContainText('ui.sidebar_width')
  await expect(dialog.getByRole('button', { name: 'download config.toml' })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'copy to clipboard' })).toBeEnabled()
})
