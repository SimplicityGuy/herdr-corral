import { readFileSync } from 'node:fs'
import path from 'node:path'
import { type Locator, type Page, expect } from '@playwright/test'

/** The hand-written config the round-trip specs open, as a path on disk. */
export const FIXTURE = path.resolve(
  import.meta.dirname,
  '../src/test/fixture-user-config.toml',
)

/** The fixture's bytes, read once — what a download is measured against. */
export const FIXTURE_BYTES: Buffer = readFileSync(FIXTURE)

/** The same bytes as text, for the line-level comparisons. */
export const FIXTURE_TEXT: string = FIXTURE_BYTES.toString('utf8')

/**
 * Get past the landing into the Console shell.
 *
 * corral opens on the import screen, so every spec about the editor has to say
 * which document it is editing first. "Start from herdr defaults" is the shortest
 * honest answer for a spec that does not care about the file; `openFixture` opens
 * the hand-written one instead.
 */
export async function openConsole(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'start from herdr defaults' }).click()
  await page.getByRole('region', { name: 'settings' }).waitFor()
}

/**
 * Open the hand-written fixture through the browser's own file chooser.
 *
 * A spec that asserts bytes has to start from bytes: a session started from
 * defaults has no original file, so there is nothing for the patcher to preserve
 * and nothing for a download to be compared against.
 */
export async function openFixture(page: Page): Promise<void> {
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
 * form, `keys` the chord editor, `status` and `theme` their own panels, so the
 * console opens on a section that has no preview in it. `sidebar` is the switch
 * that shows the mock itself.
 */
export async function openPreview(page: Page): Promise<void> {
  await page.keyboard.press('2')
  await page.getByRole('region', { name: /^preview/ }).waitFor()
}

/**
 * Two animation frames — long enough for dnd-kit to have measured the drop
 * targets for the drag that just started.
 *
 * Its droppables are measured *while dragging*, in the frame after the pick-up,
 * and an arrow key that arrives before that finds no rectangles to compare and
 * is silently ignored. Waiting a fixed number of milliseconds would be guessing;
 * waiting for the frames that do the measuring is the actual condition.
 */
export async function measured(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
}

/**
 * Walk the tab order until `target` has the focus, and say so if it never does.
 *
 * Calling `.focus()` on a control proves nothing about whether a person could
 * have got there: ADR-0002 asks for a keyboard route to every control, so a spec
 * about a keyboard drag has to arrive by keyboard. This presses `Tab` and stops
 * when it lands, which survives a control being added in front of the one under
 * test in a way that a hard-coded count does not.
 */
export async function tabTo(page: Page, target: Locator, limit = 30): Promise<void> {
  for (let step = 0; step < limit; step++) {
    if (await target.evaluate((node) => node === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  await expect(target, `tab order never reached this control in ${limit} steps`).toBeFocused()
}

/**
 * Download the file corral would hand the user, and answer its bytes.
 *
 * The download, not the dialog's text: the textarea is corral agreeing with
 * itself, while the bytes the browser writes to disk are the file herdr would
 * actually read. Every claim about the export in this suite is made about these.
 */
export async function downloadConfig(page: Page): Promise<Buffer> {
  await page.getByRole('button', { name: /download config\.toml/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const saving = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'download config.toml' }).click()
  const download = await saving
  expect(download.suggestedFilename()).toBe('config.toml')
  const bytes = readFileSync(await download.path())

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  return bytes
}

/**
 * The lines that differ between two files, as `-old` / `+new` entries in file
 * order — a shortest edit script, so a line that merely moved is one deletion
 * and one insertion rather than a landslide of shifted text.
 *
 * The plain index-by-index comparison a spec reaches for first calls every line
 * after an insertion "changed", which turns "one setting moved" into eighty
 * failures. Both files here are a hundred lines, so the quadratic table is
 * cheaper than the reasoning about a smarter algorithm.
 */
export function diffLines(before: string, after: string): string[] {
  const old = before.split('\n')
  const now = after.split('\n')
  const common: number[][] = Array.from({ length: old.length + 1 }, () =>
    new Array<number>(now.length + 1).fill(0),
  )
  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = now.length - 1; j >= 0; j--) {
      common[i][j] =
        old[i] === now[j]
          ? common[i + 1][j + 1] + 1
          : Math.max(common[i + 1][j], common[i][j + 1])
    }
  }

  const edits: string[] = []
  let i = 0
  let j = 0
  while (i < old.length && j < now.length) {
    if (old[i] === now[j]) {
      i++
      j++
    } else if (common[i + 1][j] >= common[i][j + 1]) {
      edits.push(`-${old[i++]}`)
    } else {
      edits.push(`+${now[j++]}`)
    }
  }
  while (i < old.length) edits.push(`-${old[i++]}`)
  while (j < now.length) edits.push(`+${now[j++]}`)
  return edits
}

/**
 * The `key = value` lines an export would add, read out of the `:diff` dialog.
 *
 * A session started from herdr's defaults has no original file, so every line of
 * that diff is an addition and the interesting ones are the settings — the
 * generated header comment and the `[table]` headers carry no `=`. Reading the
 * diff rather than the editor is what makes a spec about the file herdr will
 * get, and it is the same door a user opens before installing a config.
 *
 * The specs that start from a *file* compare `downloadConfig`'s bytes instead;
 * this is the reading for a session that has no bytes to compare against.
 */
export async function addedSettings(page: Page): Promise<string[]> {
  await page.getByRole('button', { name: ':diff' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('tab', { name: 'changed hunks' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  const text = await dialog.innerText()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  return text
    .split('\n')
    .filter((line) => line.startsWith('+') && line.includes(' = '))
    .map((line) => line.slice(1).trim())
}
