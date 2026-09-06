import { expect, test } from '@playwright/test'
import { openConsole } from './console.ts'

test('the Console shell loads with its top line', async ({ page }) => {
  await openConsole(page)

  await expect(page).toHaveTitle('corral')

  const topLine = page.getByRole('banner')
  await expect(topLine).toBeVisible()
  await expect(topLine.getByLabel('corral')).toHaveText('▐▛█▜▌')
  await expect(topLine.getByText('config.toml')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Sections' })).toContainText('[1] layout')
})

test('the shell has the anatomy ADR-0002 draws', async ({ page }) => {
  await openConsole(page)

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
  await page.setViewportSize({ width: 1280, height: 820 })
  await openConsole(page)

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
  // `ui.sidebar_` rather than `sidebar_`, so the first row is the one the rest of
  // the walk expects: a bare `sidebar_` also matches `theme.custom.sidebar_bg`,
  // and the reference page lists theme before ui.
  await page.keyboard.type('ui.sidebar_')
  await expect(page.getByRole('button', { name: 'ui.sidebar_width = 26' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^theme\.name/ })).toHaveCount(0)

  // tab leaves the filter for the tree, and j/k move the row cursor from there.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'ui.sidebar_width = 26' })).toBeFocused()
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
  await expect(page.getByText('1 key changed')).toBeVisible()

  // u undoes it. Focus is already back on the row the popover was anchored to.
  await expect(page.getByRole('button', { name: 'ui.sidebar_width = 34' })).toBeFocused()
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
  await openConsole(page)

  // 99999 is past herdr's u16 ceiling, so its deserializer rejects the file and
  // herdr would start on defaults — an error, not a warning.
  await page.keyboard.press('6')
  await page.keyboard.press('/')
  await page.keyboard.type('sidebar_width')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('99999')
  await page.keyboard.press('Enter')

  await expect(page.getByText(/1 error/)).toBeVisible()
  const download = page.getByRole('button', { name: /download config\.toml/ })
  await expect(download).toBeDisabled()
  await expect(download).toHaveAccessibleDescription(
    'herdr ignores a config file it cannot read and starts on defaults; fix the errors first',
  )
})

/**
 * ADR-0002 gives the top line 30px and asks the shell to hold together down to
 * 960 wide. The switches are the line's job, so they never wrap; the hints give
 * way instead.
 */
for (const width of [960, 1020, 1280]) {
  test(`the top line stays one 30px row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 })
    await openConsole(page)

    const header = page.getByRole('banner')
    await expect(header).toBeVisible()
    expect((await header.boundingBox())?.height).toBe(30)

    const nav = page.getByRole('navigation', { name: 'Sections' })
    const navBox = await nav.boundingBox()
    expect(navBox?.height).toBeLessThanOrEqual(30)

    // Every switch is still on the line, and none of them has spilled past it.
    for (const label of ['[1] layout', '[6] all']) {
      const box = await nav.getByRole('button', { name: label }).boundingBox()
      expect(box, `${label} must be laid out`).not.toBeNull()
      expect(box!.y + box!.height).toBeLessThanOrEqual(30)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    }

    // Nothing overflows the viewport horizontally.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

/**
 * "The preview is the editor" (ADR-0002), walked once end to end: click a region
 * of the herdr mock, get the popover for the key that draws it, leave with esc.
 */
test('clicking an agent row in the preview edits the rows that draw it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openConsole(page)

  const preview = page.getByRole('region', { name: /^preview/ })
  const row = preview.getByRole('button', { name: 'agent claude' })
  await expect(row).toBeVisible()
  await row.click()

  const popover = page.getByRole('dialog', { name: 'ui.sidebar.agents.rows' })
  await expect(popover).toBeVisible()
  await expect(popover).toContainText('┤ ui.sidebar.agents.rows ├')
  // The tree's cursor followed the click: the shell switched to the section that
  // owns the key, and the row for it is the focused one.
  await expect(page.getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: '[2] sidebar' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: 'ui.sidebar.agents.rows = 2' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
  // The selection outlives the popover: the region keeps the coral outline and
  // the tree keeps the cursor, which is where the shell puts the focus back.
  await expect(row).toHaveAttribute('data-selected', 'true')
  await expect(page.getByRole('button', { name: 'ui.sidebar.agents.rows = 2' })).toBeFocused()
})

/**
 * The shell is `overflow-hidden`, so a popover that runs off the bottom of the
 * window is not scrolled back — it is unreachable. The three bottom-anchored
 * regions are the ones that used to do it.
 */
for (const region of [
  'notification toast, delivery off',
  'sidebar width, 26 columns',
  'pane zsh',
]) {
  test(`the popover for "${region}" opens fully inside the window`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 })
    await openConsole(page)

    await page.getByRole('region', { name: /^preview/ }).getByRole('button', { name: region }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    expect(box, 'the popover must be laid out').not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(820)
    expect(box!.x + box!.width).toBeLessThanOrEqual(1280)
  })
}

test('the shell matches the reference at 1280x820', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await openConsole(page)
  await expect(page.getByRole('region', { name: 'settings' })).toBeVisible()

  // The mock's anatomy, as console-direction.html draws it: a tab row with its
  // right-hand entries, the Spaces and Agents panels, two panes with `┤ ├`
  // captions, and the toast in its corner.
  const preview = page.getByRole('region', { name: /^preview/ })
  await expect(preview.getByRole('button', { name: 'tab bar', exact: true })).toBeVisible()
  await expect(preview.getByRole('button', { name: 'tab bar status entries' })).toBeVisible()
  await expect(preview.getByText('SPACES')).toBeVisible()
  await expect(preview.getByText('AGENTS')).toBeVisible()
  await expect(preview.getByRole('button', { name: /^pane / })).toHaveCount(2)
  await expect(preview.getByText('┤ zsh ├')).toBeVisible()
  await expect(preview.getByRole('button', { name: /notification toast/ })).toBeVisible()

  await page.screenshot({ path: 'test-results/console-shell.png' })
})
