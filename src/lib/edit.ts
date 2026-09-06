/**
 * Writing a setting from the chrome, where "that path is not a setting" is a
 * shrug rather than a crash.
 *
 * The store refuses to write a path that names a table — `keys.command` is a list
 * of `[[keys.command]]` blocks and `theme.custom` is a table of colour tokens, and
 * neither can be spelled as one `key = value` line. That refusal is right, and it
 * throws, because a model caller passing one has a bug. A *person* pressing `d` on
 * such a row in the tree does not have a bug, so the shell absorbs it: the keys
 * inside are where the change is made, and the editor that owns the structure says
 * so. Anything else still throws.
 */
import { UnwritablePathError } from '@/model/export'
import type { TomlValue } from '@/model/parse'
import { useConfigStore } from '@/store/config'

/** Reset a key to herdr's default. A path that is not a setting is a no-op. */
export function resetKey(key: string): void {
  try {
    useConfigStore.getState().reset(key)
  } catch (error) {
    if (!(error instanceof UnwritablePathError)) throw error
  }
}

/** Write a setting. A path that is not a setting is a no-op. */
export function setKey(key: string, value: TomlValue): void {
  try {
    useConfigStore.getState().set(key, value)
  } catch (error) {
    if (!(error instanceof UnwritablePathError)) throw error
  }
}
