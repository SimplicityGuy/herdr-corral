/**
 * Export — what changed, and how to write it back.
 *
 * The store holds two flat `path → value` maps: what the loaded file set, and what it
 * effectively sets now. Everything here is a function of that pair:
 *
 * - `leaves()` decides which paths are *writable units*. Not every path in a flat map
 *   is one. `keys.command` names an array of `[[keys.command]]` blocks that cannot be
 *   written as a single `key = value` line, so its fields are the units; `ui.tab_bar_right`
 *   is an array of *inline* tables that lives inside one value span, so the array is the
 *   unit and its `[i].type` children are not. Which is which comes from the schema's own
 *   type words, never from a hand-kept list of paths.
 * - `diff()` turns the pair into set/remove ops over those units.
 * - `patch()` applies the ops to the original text through `TomlDocument`, which rewrites
 *   only the spans it is told to (invariant 1: an unedited file comes back byte for byte).
 * - `generate()` writes a fresh compact file for a config that started from herdr's
 *   defaults and so has no original text to patch.
 *
 * Invariant 2 lives in the shape of `diff`: it compares *explicitly set* values, never
 * defaults, so a key the user set to the default is still an op, and a key the user reset
 * is a `remove` rather than a silent no-op.
 */

import type { TomlValue } from '@/model/parse'
import { locateHeader, locateKey, normalizePath } from '@/model/paths'
import { TomlDocument } from '@/model/toml-doc'
import { type TomlWritable, formatHeader, formatKeyValue } from '@/model/toml-value'
import { allEntries } from '@/schema/index.ts'

/** A flat `path → value` map, as `parse.ts` produces and the store keeps. */
export type ConfigValues = ReadonlyMap<string, TomlValue>

/** One change to apply to a config. */
export type ExportOp =
  | { readonly kind: 'set'; readonly path: string; readonly value: TomlValue }
  | { readonly kind: 'remove'; readonly path: string }

/**
 * herdr types whose value is written whole, even though it has structure inside.
 *
 * A styled sidebar row (`["state_icon", { token = "workspace", fg = "#89b4fa" }]`) and a
 * `tab_bar_right` entry list are edited as one value, and `parse.ts` does not hand out
 * paths for the tokens inside a row anyway, because those elements are arrays rather
 * than tables.
 */
const WHOLE_VALUE_TYPES: ReadonlySet<string> = new Set([
  'array',
  'list of strings',
  'list of token rows',
])

/** herdr types that name a table of user-chosen keys rather than a value of their own. */
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['table of token rows'])

const schemaLeaves: string[] = []
const wholeValueKeys = new Set<string>()
const containerKeys = new Set<string>()

for (const entry of allEntries()) {
  const path = normalizePath(entry.key)
  if (CONTAINER_TYPES.has(entry.type)) {
    containerKeys.add(path)
    continue
  }
  if (WHOLE_VALUE_TYPES.has(entry.type)) wholeValueKeys.add(path)
  schemaLeaves.push(path)
}

const wholeValueList: readonly string[] = [...wholeValueKeys]

/** True when `path` addresses something strictly inside `prefix`. */
function isUnder(path: string, prefix: string): boolean {
  if (path.length <= prefix.length || !path.startsWith(prefix)) return false
  const next = path[prefix.length]
  return next === '.' || next === '['
}

/**
 * Every path that is written as one unit, for the configs given.
 *
 * The schema's keys come first, in the reference page's order, followed by whatever the
 * sources add — `ui.sidebar.agents.rows_by_agent.<id>` for an agent the user named, and
 * `keys.command[i].<field>` for each custom command. Two rules prune the result: a path
 * inside a whole-value key is not its own unit, and a path that merely *contains* other
 * units (`keys.command`) is not one either.
 */
export function leaves(...sources: readonly ConfigValues[]): string[] {
  const candidates = [...schemaLeaves]
  const seen = new Set(candidates)
  for (const values of sources) {
    for (const raw of values.keys()) {
      const path = normalizePath(raw)
      if (seen.has(path)) continue
      seen.add(path)
      candidates.push(path)
    }
  }
  const standalone = candidates.filter(
    (path) =>
      !containerKeys.has(path) && !wholeValueList.some((whole) => isUnder(path, whole)),
  )
  return standalone.filter(
    (path) => wholeValueKeys.has(path) || !standalone.some((other) => isUnder(other, path)),
  )
}

function isTable(value: TomlValue): value is Record<string, TomlValue> {
  return typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
}

/** Deep equality for TOML values: arrays by element, tables by key, dates by instant. */
export function valuesEqual(a: TomlValue, b: TomlValue): boolean {
  if (a === b) return true
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((element, index) => valuesEqual(element, b[index]))
  }
  if (!isTable(a) || !isTable(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => key in b && valuesEqual(a[key], b[key]))
}

/**
 * The ops that turn `original` into `effective`.
 *
 * `effective` is the *explicitly set* map — schema defaults are deliberately not folded
 * in, because a key nobody touched must not appear in the file. A key that is set on
 * both sides to the same value produces nothing, which is what makes an unedited export
 * a no-op patch.
 */
export function diff(original: ConfigValues, effective: ConfigValues): ExportOp[] {
  const ops: ExportOp[] = []
  for (const path of leaves(original, effective)) {
    const before = original.get(path)
    const after = effective.get(path)
    if (after === undefined) {
      if (before !== undefined) ops.push({ kind: 'remove', path })
      continue
    }
    if (before !== undefined && valuesEqual(before, after)) continue
    ops.push({ kind: 'set', path, value: after })
  }
  return ops
}

/**
 * Apply `ops` to the text of a loaded file.
 *
 * Removals go first, so a path that is dropped and re-added in the same batch ends up
 * written rather than deleted. Reading a document straight back out is already byte-for-byte
 * identical, so an empty op list satisfies invariant 1 without a special case.
 */
export function patch(originalText: string, ops: readonly ExportOp[]): string {
  const doc = new TomlDocument(originalText)
  for (const op of ops) {
    if (op.kind === 'remove') doc.remove(op.path)
  }
  for (const op of ops) {
    if (op.kind === 'set') doc.set(op.path, op.value)
  }
  return doc.text()
}

/** The one-line comment `generate` puts at the top of a file it writes from scratch. */
export const GENERATED_HEADER =
  '# herdr config written by corral — only the settings that differ from the defaults.'

interface Assignment {
  readonly key: string
  readonly value: TomlWritable
}

/**
 * Write a whole config from scratch, for a session that started from herdr's defaults.
 *
 * Only keys the user actually set are written — a default they never touched stays out
 * of the file so a later herdr release can change it. Keys are grouped by the table that
 * owns them, each table header written once, root keys first so no header swallows them.
 */
export function generate(effective: ConfigValues): string {
  const groups = new Map<string, Assignment[]>()
  for (const path of leaves(effective)) {
    const value = effective.get(path)
    if (value === undefined) continue
    const { header, key } = locateKey(path)
    const bucket = groups.get(header)
    if (bucket === undefined) groups.set(header, [{ key, value }])
    else bucket.push({ key, value })
  }

  const lines = [GENERATED_HEADER]
  const emit = (header: string, entries: readonly Assignment[]): void => {
    lines.push('')
    if (header !== '') {
      const location = locateHeader(header)
      lines.push(formatHeader(location.name, location.index !== null))
    }
    for (const entry of entries) lines.push(formatKeyValue(entry.key, entry.value))
  }

  const root = groups.get('')
  if (root !== undefined) emit('', root)
  for (const [header, entries] of groups) {
    if (header !== '') emit(header, entries)
  }
  return `${lines.join('\n')}\n`
}
