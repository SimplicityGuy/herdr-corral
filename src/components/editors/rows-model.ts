/**
 * The moves a sidebar token layout can make, as data.
 *
 * `ui.sidebar.agents.rows` is a list of rows, each a list of entries, each entry
 * a bare token name or a `{ token, fg, bold, dim }` table. Every gesture the rows
 * editor offers — a drag, an arrow key, a palette click, a style toggle — is one
 * of the functions here, and none of them knows about React, dnd-kit or the
 * store. That split is what lets the caps be tested as arithmetic rather than as
 * a drag that has to be simulated.
 *
 * **A refusal is a value, not a throw.** herdr's deserializer rejects a whole
 * file over a 17th row (`validate_sidebar_rows`, src/config/sidebar.rs), so the
 * editor must not write one; but "you cannot drop that here" is something a
 * person needs told, and an exception would only reach a `catch`. Every mutating
 * function answers {@link Outcome}: the new rows, or the sentence to show.
 *
 * **Styling is subtractive.** A token with no style is written as a plain string,
 * because that is what herdr's own default config writes and what a diff should
 * come back to when the user turns bold off again. {@link withStyle} drops every
 * field that is not set rather than writing `bold = false`, so unstyling a token
 * returns the string it started as.
 */
import type { TomlValue } from '@/model/parse'

/** `MAX_SIDEBAR_ROWS` (herdr, src/config/sidebar.rs:7). */
export const MAX_ROWS = 16

/** `MAX_SIDEBAR_TOKENS_PER_ROW` (herdr, src/config/sidebar.rs:8). */
export const MAX_TOKENS_PER_ROW = 16

/** What a refused move says, in the words `validate.ts` would use for the file. */
export const TOO_MANY_ROWS = `sidebar layouts may contain at most ${MAX_ROWS} rows`
export const TOO_MANY_TOKENS = `sidebar rows may contain at most ${MAX_TOKENS_PER_ROW} tokens`

/** One entry of a row, exactly as it sits in the file. */
export type RowEntry = TomlValue

/** A whole `rows` value. */
export type Rows = readonly (readonly RowEntry[])[]

/** Where a token sits: which row, and where in it. */
export interface TokenAt {
  readonly row: number
  readonly index: number
}

/** The style fields a styled token carries. Absent means "contextual default". */
export interface TokenStyle {
  readonly fg?: string
  readonly bold?: boolean
  readonly dim?: boolean
}

/** A move that happened, or the sentence explaining why it did not. */
export type Outcome =
  | { readonly ok: true; readonly rows: RowEntry[][] }
  | { readonly ok: false; readonly reason: string }

/** The four directions a token or a row can be nudged. */
export type Direction = 'left' | 'right' | 'up' | 'down'

function isTable(value: TomlValue): value is Record<string, TomlValue> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  )
}

/**
 * A stored value read back as rows, with anything unusable dropped.
 *
 * The value is the user's to get wrong and `validate()` is what says so, but the
 * editor still has to draw something: a `rows` that parsed to a string has no
 * rows in it, and a row that parsed to a number is not a row. Both come back
 * empty here rather than crashing the popover the user opened to fix them.
 */
export function asRows(value: TomlValue | undefined): RowEntry[][] {
  if (!Array.isArray(value)) return []
  return value.map((row) => (Array.isArray(row) ? [...row] : []))
}

/** The token an entry names, or `''` when it names none. */
export function tokenNameOf(entry: RowEntry): string {
  if (typeof entry === 'string') return entry
  if (isTable(entry) && typeof entry.token === 'string') return entry.token
  return ''
}

/** The style an entry carries. A bare string carries none. */
export function styleOf(entry: RowEntry): TokenStyle {
  if (!isTable(entry)) return {}
  const style: { fg?: string; bold?: boolean; dim?: boolean } = {}
  if (typeof entry.fg === 'string' && entry.fg !== '') style.fg = entry.fg
  if (entry.bold === true) style.bold = true
  if (entry.dim === true) style.dim = true
  return style
}

/** True when the entry is written as an inline table rather than a bare string. */
export function isStyled(entry: RowEntry): boolean {
  const style = styleOf(entry)
  return style.fg !== undefined || style.bold === true || style.dim === true
}

/**
 * An entry re-spelled with a style.
 *
 * The field order is the one herdr documents — `{ token, fg, bold, dim }` — so
 * the line the patcher writes reads like the example in its own default config.
 */
export function withStyle(entry: RowEntry, style: TokenStyle): RowEntry {
  const token = tokenNameOf(entry)
  const fg = style.fg !== undefined && style.fg !== '' ? style.fg : undefined
  const bold = style.bold === true
  const dim = style.dim === true
  if (fg === undefined && !bold && !dim) return token
  const out: Record<string, TomlValue> = { token }
  if (fg !== undefined) out.fg = fg
  if (bold) out.bold = true
  if (dim) out.dim = true
  return out
}

function copy(rows: Rows): RowEntry[][] {
  return rows.map((row) => [...row])
}

function clampIndex(length: number, index: number): number {
  return Math.max(0, Math.min(length, index))
}

/** True when `at` addresses a token that is really there. */
export function tokenExists(rows: Rows, at: TokenAt): boolean {
  const row = rows[at.row]
  return row !== undefined && at.index >= 0 && at.index < row.length
}

/**
 * Move one token, within its row or into another one.
 *
 * The destination index is read against the row *after* the token has left it,
 * which is what makes dropping a token on the chip to its right land to the
 * right of it rather than back where it started.
 */
export function moveToken(rows: Rows, from: TokenAt, to: TokenAt): Outcome {
  if (!tokenExists(rows, from)) return { ok: false, reason: 'that token is no longer there' }
  const next = copy(rows)
  const target = next[to.row]
  if (target === undefined) return { ok: false, reason: 'that row is no longer there' }
  if (from.row !== to.row && target.length >= MAX_TOKENS_PER_ROW) {
    return { ok: false, reason: TOO_MANY_TOKENS }
  }
  const [entry] = next[from.row].splice(from.index, 1)
  next[to.row].splice(clampIndex(next[to.row].length, to.index), 0, entry)
  return { ok: true, rows: next }
}

/** Move a whole row to another position. */
export function moveRow(rows: Rows, from: number, to: number): Outcome {
  if (rows[from] === undefined) return { ok: false, reason: 'that row is no longer there' }
  const next = copy(rows)
  const [row] = next.splice(from, 1)
  next.splice(clampIndex(next.length, to), 0, row)
  return { ok: true, rows: next }
}

/** Put a new token into a row, at `to.index`. */
export function insertToken(rows: Rows, to: TokenAt, token: RowEntry): Outcome {
  const next = copy(rows)
  const target = next[to.row]
  if (target === undefined) return { ok: false, reason: 'that row is no longer there' }
  if (target.length >= MAX_TOKENS_PER_ROW) return { ok: false, reason: TOO_MANY_TOKENS }
  target.splice(clampIndex(target.length, to.index), 0, token)
  return { ok: true, rows: next }
}

/** Take a token out. This is what dragging one off the popover does. */
export function removeToken(rows: Rows, at: TokenAt): Outcome {
  if (!tokenExists(rows, at)) return { ok: false, reason: 'that token is no longer there' }
  const next = copy(rows)
  next[at.row].splice(at.index, 1)
  return { ok: true, rows: next }
}

/** Replace one entry — how a style toggle is applied. */
export function replaceToken(rows: Rows, at: TokenAt, entry: RowEntry): Outcome {
  if (!tokenExists(rows, at)) return { ok: false, reason: 'that token is no longer there' }
  const next = copy(rows)
  next[at.row][at.index] = entry
  return { ok: true, rows: next }
}

/** Append an empty row, unless that would be the 17th. */
export function addRow(rows: Rows): Outcome {
  if (rows.length >= MAX_ROWS) return { ok: false, reason: TOO_MANY_ROWS }
  return { ok: true, rows: [...copy(rows), []] }
}

/** Drop a row and everything in it. */
export function removeRow(rows: Rows, index: number): Outcome {
  if (rows[index] === undefined) return { ok: false, reason: 'that row is no longer there' }
  const next = copy(rows)
  next.splice(index, 1)
  return { ok: true, rows: next }
}

/**
 * The keyboard equivalent of a token drag.
 *
 * Left and right walk the row and stop at its ends; up and down carry the token
 * into the neighbouring row, keeping its position in the line where that row is
 * long enough. Moving off the first or last row is a refusal rather than a
 * silent no-op, because a person pressing the key twice deserves to know the
 * second press did nothing.
 */
export function nudgeToken(rows: Rows, at: TokenAt, direction: Direction): Outcome {
  if (!tokenExists(rows, at)) return { ok: false, reason: 'that token is no longer there' }
  if (direction === 'left' || direction === 'right') {
    const index = at.index + (direction === 'left' ? -1 : 1)
    if (index < 0 || index >= rows[at.row].length) {
      return { ok: false, reason: `this token is already at the ${direction === 'left' ? 'start' : 'end'} of its row` }
    }
    return moveToken(rows, at, { row: at.row, index })
  }
  const row = at.row + (direction === 'up' ? -1 : 1)
  if (row < 0 || row >= rows.length) {
    return { ok: false, reason: `there is no row ${direction === 'up' ? 'above' : 'below'} this one` }
  }
  return moveToken(rows, at, { row, index: Math.min(at.index, rows[row].length) })
}

/** The keyboard equivalent of a row drag. Rows only move up and down. */
export function nudgeRow(rows: Rows, index: number, direction: 'up' | 'down'): Outcome {
  const to = index + (direction === 'up' ? -1 : 1)
  if (rows[index] === undefined) return { ok: false, reason: 'that row is no longer there' }
  if (to < 0 || to >= rows.length) {
    return { ok: false, reason: `there is no row ${direction === 'up' ? 'above' : 'below'} this one` }
  }
  return moveRow(rows, index, to)
}

/**
 * A custom token typed into the palette, normalized to what herdr accepts.
 *
 * The `$` is what makes a token custom rather than a misspelt built-in, so it is
 * added when the user leaves it off — typing `ticket` and getting `$ticket` is
 * the only reading of that input that produces a config herdr loads.
 */
export function customToken(input: string): string {
  const text = input.trim()
  if (text === '') return ''
  return text.startsWith('$') ? text : `$${text}`
}

/** Whether two `rows` values say the same thing, for skipping a no-op write. */
export function sameRows(a: Rows, b: Rows): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
