/**
 * The comment-preserving patcher.
 *
 * `TomlDocument` holds a config as lines of text and rewrites only the spans it is told
 * to change. Comments, blank lines, key order, alignment, line endings and a leading
 * BOM all come back exactly as they went in — which is the promise that makes corral
 * safe to point at a config someone actually uses.
 *
 * It indexes three things while scanning:
 *
 * - **table headers**, `[a.b]` and `[[a.b]]`, the latter with its occurrence index, so
 *   `keys.command[1].key` resolves to a line;
 * - **key lines**, including a value that spans several lines (a wrapped array);
 * - **commented-out defaults**, `# key = value` lines under the header that owns them,
 *   so setting one uncomments it in place instead of appending a duplicate below.
 *
 * A commented line only counts as a default when its value parses as a complete TOML
 * value. That keeps prose like `# type = "shell" runs detached in the background.` out
 * of the index, which matters because herdr's own default config is full of it.
 */

import { BOM, type ParsedToml, isCompleteValue, parseToml } from '@/model/parse'
import {
  childPath,
  indexedPath,
  locateHeader,
  locateKey,
  normalizePath,
  quoteKey,
  readDottedKey,
} from '@/model/paths'
import { type TomlWritable, formatHeader, formatKeyValue, formatValue } from '@/model/toml-value'

/** Thrown when an edit cannot be expressed against this document. */
export class TomlDocumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TomlDocumentError'
  }
}

/** Settings for a document. */
export interface TomlDocumentOptions {
  /** Column an inserted or replaced value may reach before an array wraps. */
  readonly maxLineWidth?: number
}

const DEFAULT_MAX_LINE_WIDTH = 96

interface Line {
  text: string
  eol: string
}

interface Position {
  readonly line: number
  readonly col: number
}

interface HeaderEntry {
  readonly path: string
  readonly name: string
  readonly isArray: boolean
  readonly commented: boolean
  readonly line: number
  readonly indent: string
  readonly commentPrefix: string
}

interface KeyEntry {
  readonly path: string
  readonly line: number
  readonly indent: string
  readonly commentPrefix: string
  readonly valueStart: Position
  readonly valueEnd: Position
  /** Line of the header that owns this key, or -1 for a root key. */
  readonly headerLine: number
  readonly headerCommented: boolean
}

interface Restorable {
  readonly keyText: string
  readonly header?: { readonly path: string; readonly text: string }
}

function isSpaceAt(text: string, index: number): boolean {
  return index < text.length && (text[index] === ' ' || text[index] === '\t')
}

interface LinePrefix {
  readonly indent: string
  readonly commentPrefix: string
  readonly start: number
}

/** Split a line's leading whitespace and `#` comment marker from its content. */
function readLinePrefix(text: string): LinePrefix {
  let i = 0
  while (isSpaceAt(text, i)) i++
  const indent = text.slice(0, i)
  if (i >= text.length || text[i] !== '#') return { indent, commentPrefix: '', start: i }
  let j = i + 1
  while (isSpaceAt(text, j)) j++
  return { indent, commentPrefix: text.slice(i, j), start: j }
}

interface HeaderLine {
  readonly indent: string
  readonly commentPrefix: string
  readonly keys: readonly string[]
  readonly isArray: boolean
}

function parseHeaderLine(text: string): HeaderLine | null {
  const { indent, commentPrefix, start } = readLinePrefix(text)
  let i = start
  if (i >= text.length || text[i] !== '[') return null
  i++
  const isArray = i < text.length && text[i] === '['
  if (isArray) i++
  while (isSpaceAt(text, i)) i++
  const dotted = readDottedKey(text, i)
  if (dotted === null) return null
  i = dotted.end
  while (isSpaceAt(text, i)) i++
  if (i >= text.length || text[i] !== ']') return null
  i++
  if (isArray) {
    if (i >= text.length || text[i] !== ']') return null
    i++
  }
  while (isSpaceAt(text, i)) i++
  if (i < text.length && text[i] !== '#') return null
  return { indent, commentPrefix, keys: dotted.keys, isArray }
}

interface KeyLine {
  readonly indent: string
  readonly commentPrefix: string
  readonly keys: readonly string[]
  readonly valueCol: number
}

function parseKeyLine(text: string): KeyLine | null {
  const { indent, commentPrefix, start } = readLinePrefix(text)
  const dotted = readDottedKey(text, start)
  if (dotted === null) return null
  let i = dotted.end
  while (isSpaceAt(text, i)) i++
  if (i >= text.length || text[i] !== '=') return null
  i++
  while (isSpaceAt(text, i)) i++
  if (i >= text.length) return null
  return { indent, commentPrefix, keys: dotted.keys, valueCol: i }
}

/**
 * Find where the value that starts at `startCol` ends.
 *
 * Tracks strings (basic, literal, and both multi-line forms), bracket and brace depth,
 * and `#` comments, so a wrapped array or an inline table is measured as one span. The
 * returned position is just past the last character of the value, excluding trailing
 * whitespace and any trailing comment. Returns `null` when the value never closes.
 */
function scanValueSpan(
  lines: readonly Line[],
  startLine: number,
  startCol: number,
  singleLine: boolean,
): Position | null {
  let line = startLine
  let col = startCol
  let depth = 0
  let quote: '"' | "'" | null = null
  let multiline = false
  let endLine = startLine
  let endCol = startCol
  let sawValue = false
  for (;;) {
    if (line >= lines.length) return null
    const text = lines[line].text
    while (col < text.length) {
      const ch = text[col]
      if (quote !== null) {
        if (quote === '"' && ch === '\\') {
          col = Math.min(col + 2, text.length)
        } else if (multiline && text.startsWith(quote.repeat(3), col)) {
          col += 3
          quote = null
          multiline = false
        } else if (!multiline && ch === quote) {
          col += 1
          quote = null
        } else {
          col += 1
        }
        endLine = line
        endCol = col
        continue
      }
      if (ch === '#') {
        col = text.length
        continue
      }
      if (ch === ' ' || ch === '\t') {
        col++
        continue
      }
      if (ch === '"' || ch === "'") {
        multiline = text.startsWith(ch.repeat(3), col)
        quote = ch
        col += multiline ? 3 : 1
      } else {
        if (ch === '[' || ch === '{') depth++
        else if (ch === ']' || ch === '}') depth--
        if (depth < 0) return null
        col++
      }
      sawValue = true
      endLine = line
      endCol = col
    }
    if (quote === null && depth === 0) break
    if (quote !== null && !multiline) return null
    if (singleLine) return null
    line++
    col = 0
  }
  return sawValue ? { line: endLine, col: endCol } : null
}

function splitLines(body: string): Line[] {
  const lines: Line[] = []
  let start = 0
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\n') continue
    const carriage = i > start && body[i - 1] === '\r'
    lines.push({ text: body.slice(start, carriage ? i - 1 : i), eol: carriage ? '\r\n' : '\n' })
    start = i + 1
  }
  if (start < body.length) lines.push({ text: body.slice(start), eol: '' })
  return lines
}

function detectEol(lines: readonly Line[]): string {
  for (const line of lines) {
    if (line.eol.length > 0) return line.eol
  }
  return '\n'
}

/** A TOML config held as text, edited by targeted replacement. */
export class TomlDocument {
  private readonly bom: string
  private readonly eol: string
  private readonly maxLineWidth: number
  private lines: Line[]
  private headerList: HeaderEntry[] = []
  private headers = new Map<string, HeaderEntry>()
  private activeKeys = new Map<string, KeyEntry>()
  private commentedKeys = new Map<string, KeyEntry>()
  private restorable = new Map<string, Restorable>()
  private created = new Map<string, { readonly blankAdded: boolean }>()

  constructor(text: string, options: TomlDocumentOptions = {}) {
    this.bom = text.startsWith(BOM) ? BOM : ''
    this.lines = splitLines(this.bom.length > 0 ? text.slice(BOM.length) : text)
    this.eol = detectEol(this.lines)
    this.maxLineWidth = options.maxLineWidth ?? DEFAULT_MAX_LINE_WIDTH
    this.reindex()
  }

  /** The document's current text, BOM and line endings included. */
  text(): string {
    let out = this.bom
    for (const line of this.lines) out += line.text + line.eol
    return out
  }

  /** The line ending inserted lines use — whatever the document already used. */
  lineEnding(): string {
    return this.eol
  }

  /** True when the document started with a byte-order mark. */
  hasBom(): boolean {
    return this.bom.length > 0
  }

  /** True when `path` is set by a live (uncommented) key line. */
  has(path: string): boolean {
    return this.activeKeys.has(normalizePath(path))
  }

  /** True when `path` exists only as a commented-out default. */
  hasCommentedDefault(path: string): boolean {
    return this.commentedKeys.has(normalizePath(path))
  }

  /** The raw text of `path`'s value, or `null` when no live key sets it. */
  valueText(path: string): string | null {
    const entry = this.activeKeys.get(normalizePath(path))
    if (entry === undefined) return null
    return this.spanText(entry.valueStart, entry.valueEnd)
  }

  /** Every path set by a live key line, in document order. */
  activePaths(): string[] {
    return [...this.activeKeys.values()]
      .sort((a, b) => a.line - b.line)
      .map((entry) => entry.path)
  }

  /** Every path that exists only as a commented-out default, in document order. */
  commentedDefaultPaths(): string[] {
    return [...this.commentedKeys.values()]
      .sort((a, b) => a.line - b.line)
      .map((entry) => entry.path)
  }

  /** Every live table header, in document order. */
  headerPaths(): string[] {
    return this.headerList.filter((entry) => !entry.commented).map((entry) => entry.path)
  }

  /** Parse the current text. Throws `TomlSyntaxError` when an edit left it malformed. */
  parse(): ParsedToml {
    return parseToml(this.text())
  }

  /**
   * Write `value` at `path`.
   *
   * Replaces the value span of an existing key, uncomments a commented default in
   * place, or appends the key under its header — creating the header at the end of the
   * file when it is missing. Nothing outside the edited span moves.
   */
  set(path: string, value: TomlWritable): this {
    const target = normalizePath(path)
    const location = locateKey(target)

    const active = this.activeKeys.get(target)
    if (active !== undefined) {
      this.replaceValue(active, value)
      this.reindex()
      return this
    }

    const commented = this.commentedKeys.get(target)
    if (commented !== undefined && this.canUncomment(commented)) {
      const restorable: Restorable = {
        keyText: this.lines[commented.line].text,
        header: commented.headerCommented
          ? {
              path: location.header,
              text: this.lines[commented.headerLine].text,
            }
          : undefined,
      }
      if (commented.headerCommented) {
        const header = this.headerAtLine(commented.headerLine)
        if (header !== null) this.uncommentLine(header.line, header.indent, header.commentPrefix)
      }
      this.uncommentLine(commented.line, commented.indent, commented.commentPrefix)
      this.reindex()
      const uncommented = this.activeKeys.get(target)
      if (uncommented === undefined) {
        throw new TomlDocumentError(`uncommenting ${target} did not produce a live key`)
      }
      this.restorable.set(target, restorable)
      this.replaceValue(uncommented, value)
      this.reindex()
      return this
    }

    if (location.header !== '' && !this.headers.has(location.header)) {
      this.createHeader(location.header)
    }
    const at = this.insertPointFor(location.header)
    const text = formatKeyValue(location.key, value, { maxInlineWidth: this.maxLineWidth })
    this.insertLines(at, text.split('\n'))
    this.reindex()
    return this
  }

  /**
   * Drop `path` from the document.
   *
   * A key that started life as a commented default goes back to being that comment,
   * byte for byte; a header this document created for it goes back with it. Any other
   * key has its lines deleted. An unset path is a no-op.
   */
  remove(path: string): this {
    const target = normalizePath(path)
    const entry = this.activeKeys.get(target)
    if (entry === undefined) return this

    const restorable = this.restorable.get(target)
    if (restorable !== undefined) {
      this.replaceLines(entry.line, entry.valueEnd.line, [restorable.keyText])
      this.restorable.delete(target)
      this.reindex()
      if (restorable.header !== undefined) this.restoreHeader(restorable.header)
      return this
    }

    this.deleteLines(entry.line, entry.valueEnd.line)
    this.reindex()
    this.dropCreatedHeader(locateKey(target).header)
    return this
  }

  private spanText(start: Position, end: Position): string {
    if (start.line === end.line) return this.lines[start.line].text.slice(start.col, end.col)
    const parts = [this.lines[start.line].text.slice(start.col)]
    for (let i = start.line + 1; i < end.line; i++) parts.push(this.lines[i].text)
    parts.push(this.lines[end.line].text.slice(0, end.col))
    return parts.join('\n')
  }

  private headerAtLine(line: number): HeaderEntry | null {
    return this.headerList.find((entry) => entry.line === line) ?? null
  }

  private uncommentLine(line: number, indent: string, commentPrefix: string): void {
    const text = this.lines[line].text
    this.lines[line].text = indent + text.slice(indent.length + commentPrefix.length)
  }

  private replaceValue(entry: KeyEntry, value: TomlWritable): void {
    const budget = Math.max(this.maxLineWidth - entry.valueStart.col, 1)
    const rendered = formatValue(value, { indent: entry.indent, maxInlineWidth: budget })
    const head = this.lines[entry.valueStart.line].text.slice(0, entry.valueStart.col)
    const tail = this.lines[entry.valueEnd.line].text.slice(entry.valueEnd.col)
    const pieces = rendered.split('\n')
    pieces[0] = head + pieces[0]
    pieces[pieces.length - 1] += tail
    this.replaceLines(entry.valueStart.line, entry.valueEnd.line, pieces)
  }

  private replaceLines(from: number, to: number, texts: readonly string[]): void {
    const tailEol = this.lines[to].eol
    const added = texts.map((text, index) => ({
      text,
      eol: index === texts.length - 1 ? tailEol : this.eol,
    }))
    this.lines.splice(from, to - from + 1, ...added)
  }

  private insertLines(at: number, texts: readonly string[]): void {
    if (texts.length === 0) return
    const added = texts.map((text) => ({ text, eol: this.eol }))
    const last = this.lines.length - 1
    if (at >= this.lines.length && last >= 0 && this.lines[last].eol === '') {
      this.lines[last].eol = this.eol
      added[added.length - 1].eol = ''
    }
    this.lines.splice(Math.min(at, this.lines.length), 0, ...added)
  }

  private deleteLines(from: number, to: number): void {
    const last = this.lines.length - 1
    if (to >= last && from > 0 && this.lines[last].eol === '') {
      this.lines[from - 1].eol = ''
    }
    this.lines.splice(from, to - from + 1)
  }

  /**
   * True when a commented default can be uncommented where it sits.
   *
   * A default under a live header always can. One under a commented header can only if
   * uncommenting that header would not silently adopt live keys that currently belong
   * to an enclosing table, and only if no live header already claims the path.
   */
  private canUncomment(entry: KeyEntry): boolean {
    if (!entry.headerCommented) return true
    const header = this.headerAtLine(entry.headerLine)
    if (header === null || !header.commented) return false
    if (this.headers.has(header.path)) return false
    let boundary = this.lines.length
    for (const candidate of this.headerList) {
      if (!candidate.commented && candidate.line > header.line && candidate.line < boundary) {
        boundary = candidate.line
      }
    }
    for (const key of this.activeKeys.values()) {
      if (key.line > header.line && key.line < boundary) return false
    }
    return true
  }

  private createHeader(headerPath: string): void {
    const location = locateHeader(headerPath)
    if (location.nested) {
      throw new TomlDocumentError(
        `cannot create a table header for ${headerPath}: it nests inside an array of tables`,
      )
    }
    if (location.index !== null) {
      const count = this.headerList.filter(
        (entry) => !entry.commented && entry.isArray && entry.name === location.name,
      ).length
      if (location.index !== count) {
        throw new TomlDocumentError(
          `cannot create [[${location.name}]] at occurrence ${location.index}: the document has ${count}`,
        )
      }
    }
    const at = this.lines.length
    const blankAdded = at > 0 && this.lines[at - 1].text.trim() !== ''
    const header = formatHeader(location.name, location.index !== null)
    this.insertLines(at, blankAdded ? ['', header] : [header])
    this.created.set(headerPath, { blankAdded })
    this.reindex()
  }

  private insertPointFor(headerPath: string): number {
    const headerLine = headerPath === '' ? -1 : (this.headers.get(headerPath)?.line ?? -1)
    let lastKeyLine = -1
    for (const entry of this.activeKeys.values()) {
      if (entry.headerLine === headerLine && entry.valueEnd.line > lastKeyLine) {
        lastKeyLine = entry.valueEnd.line
      }
    }
    if (lastKeyLine >= 0) return lastKeyLine + 1
    if (headerLine >= 0) return headerLine + 1
    let at = this.headerList.length > 0 ? this.headerList[0].line : this.lines.length
    while (at > 0 && this.lines[at - 1].text.trim() === '') at--
    return at
  }

  private headerIsEmpty(header: HeaderEntry): boolean {
    for (const entry of this.activeKeys.values()) {
      if (entry.headerLine === header.line) return false
    }
    return true
  }

  private restoreHeader(saved: { readonly path: string; readonly text: string }): void {
    const header = this.headers.get(saved.path)
    if (header === undefined || !this.headerIsEmpty(header)) return
    this.lines[header.line].text = saved.text
    this.reindex()
  }

  private dropCreatedHeader(headerPath: string): void {
    if (headerPath === '') return
    const record = this.created.get(headerPath)
    const header = this.headers.get(headerPath)
    if (record === undefined || header === undefined || !this.headerIsEmpty(header)) return
    const blankLine =
      record.blankAdded && header.line > 0 && this.lines[header.line - 1].text.trim() === ''
    this.deleteLines(blankLine ? header.line - 1 : header.line, header.line)
    this.created.delete(headerPath)
    this.reindex()
  }

  private reindex(): void {
    this.headerList = []
    this.headers = new Map()
    this.activeKeys = new Map()
    this.commentedKeys = new Map()

    const activeCounts = new Map<string, number>()
    const commentCounts = new Map<string, number>()
    let activeContext = ''
    let activeHeaderLine = -1
    let commentContext = ''
    let commentHeaderLine = -1
    let commentContextCommented = false

    const resolve = (
      keys: readonly string[],
      isArray: boolean,
      counts: Map<string, number>,
      seed: Map<string, number> | null,
    ): string => {
      let path = ''
      for (const [position, key] of keys.entries()) {
        const candidate = childPath(path, key)
        if (position === keys.length - 1 && isArray) {
          const seen = Math.max(counts.get(candidate) ?? -1, seed?.get(candidate) ?? -1)
          counts.set(candidate, seen + 1)
          path = indexedPath(candidate, seen + 1)
          continue
        }
        const occurrence = counts.get(candidate) ?? seed?.get(candidate)
        path = occurrence === undefined ? candidate : indexedPath(candidate, occurrence)
      }
      return path
    }

    let i = 0
    while (i < this.lines.length) {
      const text = this.lines[i].text
      const header = parseHeaderLine(text)
      if (header !== null) {
        const commented = header.commentPrefix.length > 0
        const path = commented
          ? resolve(header.keys, header.isArray, commentCounts, activeCounts)
          : resolve(header.keys, header.isArray, activeCounts, null)
        const entry: HeaderEntry = {
          path,
          name: header.keys.map(quoteKey).join('.'),
          isArray: header.isArray,
          commented,
          line: i,
          indent: header.indent,
          commentPrefix: header.commentPrefix,
        }
        this.headerList.push(entry)
        if (commented) {
          commentContext = path
          commentHeaderLine = i
          commentContextCommented = true
        } else {
          if (!this.headers.has(path)) this.headers.set(path, entry)
          activeContext = path
          activeHeaderLine = i
          commentContext = path
          commentHeaderLine = i
          commentContextCommented = false
          commentCounts.clear()
        }
        i++
        continue
      }

      const key = parseKeyLine(text)
      if (key === null) {
        i++
        continue
      }

      if (key.commentPrefix.length === 0) {
        const end = scanValueSpan(this.lines, i, key.valueCol, false)
        if (end === null) {
          i++
          continue
        }
        const path = key.keys.reduce((acc, name) => childPath(acc, name), activeContext)
        if (!this.activeKeys.has(path)) {
          this.activeKeys.set(path, {
            path,
            line: i,
            indent: key.indent,
            commentPrefix: '',
            valueStart: { line: i, col: key.valueCol },
            valueEnd: end,
            headerLine: activeHeaderLine,
            headerCommented: false,
          })
        }
        i = end.line + 1
        continue
      }

      const end = scanValueSpan(this.lines, i, key.valueCol, true)
      if (end !== null && isCompleteValue(text.slice(key.valueCol, end.col))) {
        const path = key.keys.reduce((acc, name) => childPath(acc, name), commentContext)
        if (!this.commentedKeys.has(path)) {
          this.commentedKeys.set(path, {
            path,
            line: i,
            indent: key.indent,
            commentPrefix: key.commentPrefix,
            valueStart: { line: i, col: key.valueCol },
            valueEnd: end,
            headerLine: commentHeaderLine,
            headerCommented: commentContextCommented,
          })
        }
      }
      i++
    }
  }
}
