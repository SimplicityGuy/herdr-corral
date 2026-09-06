import path from 'node:path'
import { type Page, expect } from '@playwright/test'

/** The hand-written config the round-trip specs open, as a path on disk. */
export const FIXTURE = path.resolve(
  import.meta.dirname,
  '../src/test/fixture-user-config.toml',
)

/**
 * Get past the landing into the Console shell.
 *
 * corral opens on the import screen, so every spec about the editor has to say
 * which document it is editing first. "Start from herdr defaults" is the shortest
 * honest answer for a spec that does not care about the file; the import spec
 * opens the fixture instead.
 */
export async function openConsole(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'start from herdr defaults' }).click()
  await page.getByRole('region', { name: 'settings' }).waitFor()
}

/**
 * The `key = value` lines an export would add, read out of the `:diff` dialog.
 *
 * A session started from herdr's defaults has no original file, so every line of
 * that diff is an addition and the interesting ones are the settings — the
 * generated header comment and the `[table]` headers carry no `=`. Reading the
 * diff rather than the editor is what makes a spec about the file herdr will
 * get, and it is the same door a user opens before installing a config.
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
