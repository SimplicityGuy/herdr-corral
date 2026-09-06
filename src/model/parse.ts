/**
 * Reading a config: smol-toml for the tree, plus a flat path → value map.
 *
 * The flat map is what the store and the editors index by, so a widget bound to
 * `ui.sidebar.agents.row_gap` never has to walk the tree. Syntax errors come back with
 * a line and column so the diagnostics line can point at the offending character.
 */

import { TomlError, parse as parseTomlText } from 'smol-toml'
import type { TomlTable, TomlValue } from 'smol-toml'
import { childPath, indexedPath } from '@/model/paths'

export type { TomlTable, TomlValue }

/** A TOML syntax error, with the position smol-toml reported. */
export class TomlSyntaxError extends Error {
  /** One-based line of the offending character. */
  readonly line: number
  /** One-based column of the offending character. */
  readonly column: number
  /** The three-line excerpt smol-toml renders around the error. */
  readonly codeblock: string

  constructor(message: string, line: number, column: number, codeblock: string) {
    super(message)
    this.name = 'TomlSyntaxError'
    this.line = line
    this.column = column
    this.codeblock = codeblock
  }
}

/** A parsed document: the raw tree plus every leaf addressed by path. */
export interface ParsedToml {
  /** The tree exactly as smol-toml built it. */
  readonly tree: TomlTable
  /** Every scalar and array, keyed by the dotted path that addresses it. */
  readonly values: ReadonlyMap<string, TomlValue>
}

/** The byte-order mark a Windows editor may have left at the front of the file. */
export const BOM = '\uFEFF'

/** Strip a leading BOM. TOML parsers reject it, but real config files carry one. */
export function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text
}

function isTable(value: TomlValue): value is TomlTable {
  return typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
}

function isTableArray(value: TomlValue): value is TomlTable[] {
  return Array.isArray(value) && value.length > 0 && value.every((element) => isTable(element))
}

function walk(node: TomlTable, prefix: string, out: Map<string, TomlValue>): void {
  for (const [key, value] of Object.entries(node)) {
    const path = childPath(prefix, key)
    if (isTable(value)) {
      walk(value, path, out)
      continue
    }
    out.set(path, value)
    if (!isTableArray(value)) continue
    for (const [index, element] of value.entries()) {
      walk(element, indexedPath(path, index), out)
    }
  }
}

/**
 * Flatten a parsed tree into `path → value`.
 *
 * Sub-tables contribute their leaves rather than themselves. An array is recorded whole
 * *and*, when every element is a table, expanded into `path[i].key` entries — so
 * `keys.command` reads back as a list while `keys.command[0].key` reads back as a leaf.
 */
export function flattenTree(tree: TomlTable): Map<string, TomlValue> {
  const out = new Map<string, TomlValue>()
  walk(tree, '', out)
  return out
}

function toSyntaxError(error: unknown): TomlSyntaxError {
  if (error instanceof TomlSyntaxError) return error
  if (error instanceof TomlError) {
    return new TomlSyntaxError(error.message, error.line, error.column, error.codeblock)
  }
  const message = error instanceof Error ? error.message : String(error)
  return new TomlSyntaxError(message, 1, 1, '')
}

/** Parse TOML text. Throws `TomlSyntaxError` with a position when it is malformed. */
export function parseToml(text: string): ParsedToml {
  let tree: TomlTable
  try {
    tree = parseTomlText(stripBom(text))
  } catch (error) {
    throw toSyntaxError(error)
  }
  return { tree, values: flattenTree(tree) }
}

/** The success or failure of a parse, without throwing. */
export type ParseOutcome =
  | { readonly ok: true; readonly parsed: ParsedToml }
  | { readonly ok: false; readonly error: TomlSyntaxError }

/** Parse TOML text, returning the error instead of throwing it. */
export function tryParseToml(text: string): ParseOutcome {
  try {
    return { ok: true, parsed: parseToml(text) }
  } catch (error) {
    return { ok: false, error: toSyntaxError(error) }
  }
}

/** True when `text` is a complete, valid TOML value on its own (`"a"`, `[1, 2]`, `{ a = 1 }`). */
export function isCompleteValue(text: string): boolean {
  try {
    parseTomlText(`corral_probe = ${text}`)
    return true
  } catch {
    return false
  }
}
