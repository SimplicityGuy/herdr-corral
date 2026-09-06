import path from 'node:path'
import type { Page } from '@playwright/test'

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
