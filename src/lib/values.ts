/**
 * How a setting's value reads in the settings tree.
 *
 * ADR-0002 colours a value by its type: "numbers yellow, enums/strings green,
 * booleans red/green, colors as a swatch". The mockup adds two more readings —
 * a chord is yellow like a number, and a list shows its length in `--overlay0`
 * rather than its contents, because a row is one line and a token list is not.
 *
 * **A value is shown exactly as the user spelled it.** `keys.ts` can normalize a
 * chord, and `normalizeChord('plus')` answers `'+'`, which is not a spelling
 * `parseChord` reads back. Running a value through a formatter on the way to the
 * screen would therefore show some users a chord they did not write and could not
 * type back in. Strings are printed verbatim; only the shapes that have no
 * one-line spelling — lists and tables — are summarized, and they are summarized
 * as a count, which nobody can mistake for the value itself.
 */
import { typeOf } from '@/schema'
import type { TomlValue } from '@/model/parse'
import { isColor } from '@/model/validate'

/** What herdr documents an unset setting as. */
export const UNSET = 'unset'

function isTable(value: TomlValue): value is Record<string, TomlValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
}

/**
 * The one-line rendering of a value.
 *
 * Strings come back unquoted, as the mockup shows them (`top`, `catppuccin`,
 * `ctrl+b`) and verbatim, as this module's docstring requires. The one string
 * that is quoted is the empty one, which has nothing to show otherwise.
 */
export function formatValue(value: TomlValue | undefined): string {
  if (value === undefined || value === null) return UNSET
  // An empty string is a value herdr accepts and a row has to show it, or the
  // accessible name trails off into nothing: `ui.window_title = `.
  if (value === '') return '""'
  if (typeof value === 'string') return value
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return String(value.length)
  return String(Object.keys(value).length)
}

/** True when the row shows a count rather than the value — lists and tables. */
export function isSummarized(value: TomlValue | undefined): boolean {
  return Array.isArray(value) || (value !== undefined && isTable(value))
}

/**
 * The colour of a value, as a Tailwind class from the tokens in `src/index.css`.
 *
 * Never a hex literal: the swatch is the only place a colour value reaches the
 * screen as a colour, and it paints the *user's* colour, which is data rather
 * than a design token.
 */
export function toneOf(key: string, value: TomlValue | undefined): string {
  if (value === undefined || value === null) return 'text-overlay0'
  if (isSummarized(value)) return 'text-overlay0'
  if (typeof value === 'boolean') return value ? 'text-green' : 'text-red'
  if (typeof value === 'number') return 'text-yellow'
  const declared = typeOf(key)
  if (declared === 'keybinding') return 'text-yellow'
  if (declared === 'color') return 'text-teal'
  return 'text-green'
}

/**
 * The colour to paint a swatch, or `null` when the value is not one.
 *
 * `isColor` is herdr's own rule, so a value corral paints is a value herdr would
 * accept; anything else gets no swatch rather than a guess. Named colours are
 * handed to CSS as they are — herdr's names are the CSS ones for the sixteen it
 * supports, and a name CSS does not know simply paints nothing.
 */
export function swatchOf(key: string, value: TomlValue | undefined): string | null {
  if (typeOf(key) !== 'color') return null
  if (typeof value !== 'string' || !isColor(value)) return null
  return value
}

/**
 * The typed value a draft string stands for, or `undefined` when it stands for
 * nothing yet.
 *
 * An integer field reading `12x` is not a number the store should be handed, so
 * `enter` does nothing until it reads like one. Everything else is a string:
 * whether it is a *good* string is herdr's question, and `validate()` answers it
 * in the diagnostics line rather than here, because refusing the keystroke would
 * stop a user from typing their way through an intermediate state.
 */
export function parseDraft(declared: string | undefined, draft: string): TomlValue | undefined {
  if (declared !== 'integer') return draft
  const trimmed = draft.trim()
  if (!/^[+-]?\d+$/.test(trimmed)) return undefined
  return Number.parseInt(trimmed, 10)
}
