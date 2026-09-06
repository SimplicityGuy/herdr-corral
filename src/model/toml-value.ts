/**
 * TOML value formatting — the write half of the model.
 *
 * smol-toml parses; corral owns everything it writes back, because the whole point of
 * the editor is that an export is a set of targeted text edits rather than a
 * regenerated file. These formatters produce the *text* for one value, one `key =
 * value` line, or one `[[array.of.tables]]` block.
 */

import { quoteKey } from '@/model/paths'

/** A value corral knows how to write back out as TOML. */
export type TomlWritable =
  | string
  | number
  | bigint
  | boolean
  | Date
  | readonly TomlWritable[]
  | { readonly [key: string]: TomlWritable }

/** Thrown when a value has no TOML representation. */
export class TomlFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TomlFormatError'
  }
}

/** Knobs for how wide a value may get before it wraps. */
export interface FormatOptions {
  /** Indentation the value's continuation lines start from. Defaults to `''`. */
  readonly indent?: string
  /** Longest single-line rendering allowed before an array wraps. Defaults to 80. */
  readonly maxInlineWidth?: number
  /**
   * Render a whole number as a float (`2.0`, not `2`).
   *
   * TOML distinguishes integers from floats but JavaScript does not, so writing `2`
   * over a `1.5` would quietly change the key's type. Applies to the value itself, not
   * to numbers nested inside an array or inline table.
   */
  readonly preferFloat?: boolean
}

const DEFAULT_MAX_INLINE_WIDTH = 80

/** Escape and quote a string as a TOML basic string. */
export function formatString(value: string): string {
  return `"${escapeBasic(value)}"`
}

function escapeBasic(value: string): string {
  let out = ''
  for (const ch of value) {
    if (ch === '"') {
      out += '\\"'
      continue
    }
    if (ch === '\\') {
      out += '\\\\'
      continue
    }
    if (ch === '\b') {
      out += '\\b'
      continue
    }
    if (ch === '\t') {
      out += '\\t'
      continue
    }
    if (ch === '\n') {
      out += '\\n'
      continue
    }
    if (ch === '\f') {
      out += '\\f'
      continue
    }
    if (ch === '\r') {
      out += '\\r'
      continue
    }
    const code = ch.codePointAt(0) ?? 0
    out += code < 0x20 || code === 0x7f ? `\\u${code.toString(16).padStart(4, '0')}` : ch
  }
  return out
}

/** Render a boolean. */
export function formatBoolean(value: boolean): string {
  return value ? 'true' : 'false'
}

/**
 * Render a number or bigint, choosing TOML's integer or float syntax.
 *
 * Pass `preferFloat` to keep a whole number on the float side of that split, which is
 * what a document does when it is overwriting a value that was already a float.
 */
export function formatNumber(value: number | bigint, preferFloat = false): string {
  if (typeof value === 'bigint') return value.toString(10)
  if (Number.isNaN(value)) return 'nan'
  if (value === Number.POSITIVE_INFINITY) return 'inf'
  if (value === Number.NEGATIVE_INFINITY) return '-inf'
  if (Number.isSafeInteger(value)) return preferFloat ? `${value.toString(10)}.0` : value.toString(10)
  const rendered = String(value)
  return /[.eE]/.test(rendered) ? rendered : `${rendered}.0`
}

/** Render a date as a TOML datetime. `TomlDate` keeps its original offset-ness. */
export function formatDate(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new TomlFormatError('cannot format an invalid Date')
  return value.toISOString()
}

function isPlainTable(value: TomlWritable): value is { readonly [key: string]: TomlWritable } {
  return typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
}

/**
 * Render an array.
 *
 * Stays on one line while it fits the width budget; otherwise one element per line with
 * a trailing comma, so a later edit shows up as a one-line diff.
 */
export function formatArray(value: readonly TomlWritable[], options: FormatOptions = {}): string {
  if (value.length === 0) return '[]'
  const indent = options.indent ?? ''
  const budget = options.maxInlineWidth ?? DEFAULT_MAX_INLINE_WIDTH
  const inlineParts = value.map((element) => formatValue(element, { indent, maxInlineWidth: budget }))
  const inline = `[${inlineParts.join(', ')}]`
  if (inline.length <= budget && !inline.includes('\n')) return inline
  const inner = `${indent}  `
  const parts = value.map((element) =>
    formatValue(element, { indent: inner, maxInlineWidth: budget }),
  )
  return `[\n${parts.map((part) => `${inner}${part},`).join('\n')}\n${indent}]`
}

/**
 * Render an inline table: `{ token = "workspace", fg = "#89b4fa", bold = true }`.
 *
 * TOML 1.0 inline tables are single-line by definition, so this never wraps.
 */
export function formatInlineTable(
  value: { readonly [key: string]: TomlWritable },
  options: FormatOptions = {},
): string {
  const entries = Object.entries(value)
  if (entries.length === 0) return '{}'
  const budget = options.maxInlineWidth ?? DEFAULT_MAX_INLINE_WIDTH
  const parts = entries.map(
    ([key, element]) => `${quoteKey(key)} = ${formatValue(element, { maxInlineWidth: budget })}`,
  )
  return `{ ${parts.join(', ')} }`
}

/** Render any writable value as TOML. */
export function formatValue(value: TomlWritable, options: FormatOptions = {}): string {
  switch (typeof value) {
    case 'string':
      return formatString(value)
    case 'boolean':
      return formatBoolean(value)
    case 'number':
    case 'bigint':
      return formatNumber(value, options.preferFloat)
    case 'object':
      break
    default:
      throw new TomlFormatError(`cannot format a ${typeof value} as a TOML value`)
  }
  if (!value) throw new TomlFormatError('cannot format null as a TOML value')
  if (value instanceof Date) return formatDate(value)
  if (Array.isArray(value)) return formatArray(value, options)
  if (isPlainTable(value)) return formatInlineTable(value, options)
  throw new TomlFormatError(`cannot format ${String(value)} as a TOML value`)
}

/**
 * Render one `key = value` line.
 *
 * The key's own width comes out of the array-wrapping budget, so `rows = [...]` wraps
 * on the same rule a bare array would.
 */
export function formatKeyValue(
  key: string,
  value: TomlWritable,
  options: FormatOptions = {},
): string {
  return formatDottedKeyValue([key], value, options)
}

/**
 * Render a `a.b.c = value` line.
 *
 * A dotted key extends a table that some other line already implied, which is how a
 * document adds to an implicit table without writing a second `[a.b]` header over it.
 */
export function formatDottedKeyValue(
  keys: readonly string[],
  value: TomlWritable,
  options: FormatOptions = {},
): string {
  if (keys.length === 0) throw new TomlFormatError('a key line needs at least one key')
  const indent = options.indent ?? ''
  const prefix = `${keys.map(quoteKey).join('.')} = `
  const budget = (options.maxInlineWidth ?? DEFAULT_MAX_INLINE_WIDTH) - prefix.length
  const rendered = formatValue(value, {
    indent,
    maxInlineWidth: Math.max(budget, 1),
    preferFloat: options.preferFloat,
  })
  return `${indent}${prefix}${rendered}`
}

/** Render a `[name]` or `[[name]]` header line. */
export function formatHeader(name: string, isArrayOfTables = false): string {
  return isArrayOfTables ? `[[${name}]]` : `[${name}]`
}

/**
 * Render a whole array-of-tables section — one `[[name]]` block per entry, blank line
 * separated. This is how a `[[keys.command]]` list is written from scratch.
 */
export function formatArrayOfTables(
  name: string,
  entries: readonly { readonly [key: string]: TomlWritable }[],
  options: FormatOptions = {},
): string {
  return entries
    .map((entry) => {
      const lines = [formatHeader(name, true)]
      for (const [key, value] of Object.entries(entry)) {
        lines.push(formatKeyValue(key, value, options))
      }
      return lines.join('\n')
    })
    .join('\n\n')
}
