/**
 * Dotted-path helpers for addressing values inside a TOML document.
 *
 * A *path* names one leaf in a config: `ui.sidebar_width`, `theme.custom.accent`,
 * `keys.command[2].key`, `ui.sidebar.agents.rows_by_agent."my agent"`. Keys are bare
 * when TOML allows it and basic-quoted otherwise; array-of-tables occurrences carry a
 * zero-based `[n]` suffix on the segment that owns them.
 *
 * Every other module in `src/model/` speaks this format, so a path produced by
 * `parse.ts` can be handed straight to `TomlDocument.set`.
 */

/** One step of a path: a table/leaf key, or an array-of-tables occurrence. */
export type PathSegment =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'index'; readonly index: number }

/** Thrown when a path string is not well formed. */
export class TomlPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TomlPathError'
  }
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/
const BARE_KEY_CHAR = /[A-Za-z0-9_-]/
const HEX_DIGITS = /^[0-9a-fA-F]+$/
const DIGITS = /^\d+$/

const STRING_ESCAPES: Readonly<Record<string, string>> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
  '"': '\\"',
  '\\': '\\\\',
}

const STRING_UNESCAPES: Readonly<Record<string, string>> = {
  b: '\b',
  t: '\t',
  n: '\n',
  f: '\f',
  r: '\r',
  '"': '"',
  '\\': '\\',
}

function isSpaceAt(text: string, index: number): boolean {
  return index < text.length && (text[index] === ' ' || text[index] === '\t')
}

/** True when `key` can be written bare (unquoted) in TOML. */
export function isBareKey(key: string): boolean {
  return BARE_KEY.test(key)
}

/**
 * Escape `value` for the inside of a TOML basic string.
 *
 * Control characters without a short escape become `\uXXXX`. Astral characters are
 * emitted verbatim, so surrogate pairs survive.
 */
export function escapeBasicString(value: string): string {
  let out = ''
  for (const ch of value) {
    const mapped = STRING_ESCAPES[ch]
    if (mapped !== undefined) {
      out += mapped
      continue
    }
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) {
      out += `\\u${code.toString(16).padStart(4, '0')}`
      continue
    }
    out += ch
  }
  return out
}

/** Render `key` as a TOML key: bare when possible, otherwise a basic string. */
export function quoteKey(key: string): string {
  return key.length > 0 && isBareKey(key) ? key : `"${escapeBasicString(key)}"`
}

/** A key token read out of a line, plus the offset just past it. */
export interface KeyToken {
  readonly key: string
  readonly end: number
}

function readBasicQuoted(text: string, start: number): KeyToken | null {
  let i = start + 1
  let key = ''
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"') return { key, end: i + 1 }
    if (ch !== '\\') {
      key += ch
      i++
      continue
    }
    if (i + 1 >= text.length) return null
    const next = text[i + 1]
    const simple = STRING_UNESCAPES[next]
    if (simple !== undefined) {
      key += simple
      i += 2
      continue
    }
    if (next !== 'u' && next !== 'U') return null
    const width = next === 'u' ? 4 : 8
    const digits = text.slice(i + 2, i + 2 + width)
    if (digits.length < width || !HEX_DIGITS.test(digits)) return null
    key += String.fromCodePoint(Number.parseInt(digits, 16))
    i += 2 + width
  }
  return null
}

function readLiteralQuoted(text: string, start: number): KeyToken | null {
  const close = text.indexOf("'", start + 1)
  if (close === -1) return null
  return { key: text.slice(start + 1, close), end: close + 1 }
}

/**
 * Read a single key token at `start` — bare, basic-quoted, or literal-quoted.
 *
 * Returns `null` when the text at `start` does not begin a key.
 */
export function readKeyToken(text: string, start: number): KeyToken | null {
  if (start >= text.length) return null
  const ch = text[start]
  if (ch === '"') return readBasicQuoted(text, start)
  if (ch === "'") return readLiteralQuoted(text, start)
  let i = start
  while (i < text.length && BARE_KEY_CHAR.test(text[i])) i++
  if (i === start) return null
  return { key: text.slice(start, i), end: i }
}

/** A dotted key expression read out of a line, plus the offset just past it. */
export interface DottedKey {
  readonly keys: readonly string[]
  readonly end: number
}

/**
 * Read a dotted key expression (`a.b."c d"`) at `start`.
 *
 * Whitespace around the dots is allowed, as TOML permits. Returns `null` when the text
 * at `start` does not begin a key.
 */
export function readDottedKey(text: string, start: number): DottedKey | null {
  const keys: string[] = []
  let i = start
  for (;;) {
    const token = readKeyToken(text, i)
    if (token === null) return null
    keys.push(token.key)
    i = token.end
    let j = i
    while (isSpaceAt(text, j)) j++
    if (j >= text.length || text[j] !== '.') return { keys, end: i }
    j++
    while (isSpaceAt(text, j)) j++
    i = j
  }
}

/** Parse a dotted path string into segments. Throws `TomlPathError` on bad syntax. */
export function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = []
  if (path.length === 0) return segments
  let i = 0
  for (;;) {
    const token = readKeyToken(path, i)
    if (token === null) {
      throw new TomlPathError(`expected a key at offset ${i} of path ${JSON.stringify(path)}`)
    }
    segments.push({ kind: 'key', key: token.key })
    i = token.end
    while (i < path.length && path[i] === '[') {
      const close = path.indexOf(']', i)
      if (close === -1) {
        throw new TomlPathError(`unterminated "[" at offset ${i} of path ${JSON.stringify(path)}`)
      }
      const digits = path.slice(i + 1, close)
      if (!DIGITS.test(digits)) {
        throw new TomlPathError(
          `expected a non-negative index at offset ${i} of path ${JSON.stringify(path)}`,
        )
      }
      segments.push({ kind: 'index', index: Number.parseInt(digits, 10) })
      i = close + 1
    }
    if (i >= path.length) return segments
    if (path[i] !== '.') {
      throw new TomlPathError(`expected "." at offset ${i} of path ${JSON.stringify(path)}`)
    }
    i++
  }
}

/** Render segments back into a path string. Inverse of `parsePath`. */
export function formatPath(segments: readonly PathSegment[]): string {
  let out = ''
  for (const segment of segments) {
    if (segment.kind === 'index') {
      out += `[${segment.index}]`
      continue
    }
    out += out.length === 0 ? quoteKey(segment.key) : `.${quoteKey(segment.key)}`
  }
  return out
}

/** Normalize a path: re-quote keys the canonical way and validate its syntax. */
export function normalizePath(path: string): string {
  return formatPath(parsePath(path))
}

/** Append `key` to `parent`, quoting it if needed. `parent` may be the empty root path. */
export function childPath(parent: string, key: string): string {
  return parent.length === 0 ? quoteKey(key) : `${parent}.${quoteKey(key)}`
}

/** Append an array-of-tables occurrence to `parent`. */
export function indexedPath(parent: string, index: number): string {
  return `${parent}[${index}]`
}

/** Where a leaf key lives: the table header that owns it, and the key itself. */
export interface KeyLocation {
  /** Indexed path of the owning table; `''` for a root-level key. */
  readonly header: string
  /** The final key, unquoted. */
  readonly key: string
}

/**
 * Split a path into the table header that owns it and the final key.
 *
 * Throws when the path is empty or ends in an array index, since neither names a leaf
 * key that can be written as `key = value`.
 */
export function locateKey(path: string): KeyLocation {
  const segments = parsePath(path)
  const last = segments.at(-1)
  if (last === undefined) throw new TomlPathError('cannot locate the empty path')
  if (last.kind !== 'key') {
    throw new TomlPathError(`path ${JSON.stringify(path)} names a table, not a key`)
  }
  return { header: formatPath(segments.slice(0, -1)), key: last.key }
}

/** A table header split into the name written in `[...]` and its occurrence, if any. */
export interface HeaderLocation {
  /** Dotted name as it appears between the brackets. */
  readonly name: string
  /** Zero-based occurrence for an array-of-tables header; `null` for a plain table. */
  readonly index: number | null
  /** True when a segment before the last carries an occurrence index. */
  readonly nested: boolean
}

/**
 * Split an indexed header path into the name to write between brackets and the
 * array-of-tables occurrence it selects.
 *
 * `keys.command[1]` → name `keys.command`, index 1. `ui.sidebar.agents` → index `null`.
 */
export function locateHeader(headerPath: string): HeaderLocation {
  const segments = parsePath(headerPath)
  if (segments.length === 0) throw new TomlPathError('the root table has no header')
  const keys: string[] = []
  let index: number | null = null
  let nested = false
  for (const [position, segment] of segments.entries()) {
    if (segment.kind === 'key') {
      keys.push(quoteKey(segment.key))
      continue
    }
    if (position === segments.length - 1) index = segment.index
    else nested = true
  }
  return { name: keys.join('.'), index, nested }
}
