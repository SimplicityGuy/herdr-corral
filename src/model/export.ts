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
import { formatPath, locateHeader, locateKey, normalizePath, parsePath } from '@/model/paths'
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
export function isUnder(path: string, prefix: string): boolean {
  if (path.length <= prefix.length || !path.startsWith(prefix)) return false
  const next = path[prefix.length]
  return next === '.' || next === '['
}

/**
 * Order two dynamic paths, reading digit runs as numbers.
 *
 * `keys.command[10].key` sorts after `keys.command[2].key`, not before it, and a
 * generated file's `[[keys.command]]` blocks come out in index order however the user
 * built them up.
 */
function comparePaths(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true })
}

/**
 * Every path that strictly contains `path`, from the outermost in.
 *
 * `keys.command[0].key` yields `keys`, `keys.command` and `keys.command[0]`. This goes
 * through the path parser rather than scanning for dots, because a quoted key may hold
 * dots and brackets of its own — `rows_by_agent."my agent"` is two segments, not three.
 */
function containingPaths(path: string): string[] {
  const segments = parsePath(path)
  const out: string[] = []
  for (let depth = 1; depth < segments.length; depth++) {
    out.push(formatPath(segments.slice(0, depth)))
  }
  return out
}

const schemaLeafSet: ReadonlySet<string> = new Set(schemaLeaves)

/** The paths the schema's own keys sit inside. Fixed, so it is built once. */
const schemaContainers = new Set<string>()
for (const path of schemaLeaves) {
  for (const prefix of containingPaths(path)) schemaContainers.add(prefix)
}

/**
 * Every path that is written as one unit, for the configs given.
 *
 * The schema's keys come first, in the reference page's order, followed by whatever the
 * sources add — `ui.sidebar.agents.rows_by_agent.<id>` for an agent the user named, and
 * `keys.command[i].<field>` for each custom command. Two rules prune the result: a path
 * inside a whole-value key is not its own unit, and a path that merely *contains* other
 * units (`keys.command`) is not one either.
 *
 * The order is a function of the *set* of paths, never of the order they were added:
 * schema keys keep the reference page's order, and the rest are sorted. Anything else
 * would let `generate` write `[[keys.command]]` blocks in whatever order the user
 * happened to touch them, so a file it wrote would not survive a reload and re-export.
 */
export function leaves(...sources: readonly ConfigValues[]): string[] {
  const dynamic: string[] = []
  const seen = new Set(schemaLeaves)
  for (const values of sources) {
    for (const raw of values.keys()) {
      const path = normalizePath(raw)
      if (seen.has(path)) continue
      seen.add(path)
      dynamic.push(path)
    }
  }
  const candidates = [...schemaLeaves, ...dynamic.sort(comparePaths)]
  const standalone = candidates.filter(
    (path) =>
      !containerKeys.has(path) && !wholeValueList.some((whole) => isUnder(path, whole)),
  )
  // A path is a container exactly when some surviving path sits inside it. Collecting
  // what each path sits inside costs one pass; asking every path about every other one
  // would cost 175 × 175 on each diff.
  const containers = new Set<string>()
  for (const path of standalone) {
    if (schemaLeafSet.has(path)) continue
    for (const prefix of containingPaths(path)) containers.add(prefix)
  }
  return standalone.filter(
    (path) =>
      wholeValueKeys.has(path) || !(containers.has(path) || schemaContainers.has(path)),
  )
}

/** Thrown when a path names a table rather than something an export can write. */
export class UnwritablePathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnwritablePathError'
  }
}

/**
 * True when `path` is a unit an export can write on its own.
 *
 * The same three rules `leaves` applies, decided for one path against the schema and the
 * configs in play rather than by building the whole list — this runs on every keystroke
 * that reaches the store. `leaves` remains the specification; a test pins the two
 * together over the fixture.
 */
export function isLeaf(path: string, ...sources: readonly ReadonlyMap<string, unknown>[]): boolean {
  // Parsed once and formatted back, rather than normalized and then parsed again.
  const segments = parsePath(path)
  const target = formatPath(segments)
  // A path has to end at a key to be written as one. `keys.command[2]` ends at an
  // occurrence of an array of tables and the empty path ends nowhere; `locateKey` throws
  // on both rather than inventing a key line.
  if (segments.at(-1)?.kind !== 'key') return false
  if (containerKeys.has(target)) return false
  if (wholeValueList.some((whole) => isUnder(target, whole))) return false
  if (wholeValueKeys.has(target)) return true
  if (schemaLeaves.some((key) => isUnder(key, target))) return false
  for (const values of sources) {
    for (const raw of values.keys()) {
      if (isUnder(raw, target)) return false
    }
  }
  return true
}

function isTable(value: TomlValue): value is Record<string, TomlValue> {
  return typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
}

/**
 * True when `value` is an array of tables, which TOML writes as `[[name]]` blocks.
 *
 * `parse.ts` expands any such array into `path[i].key` leaves as well as recording the
 * array itself, so a path holding one is read back as its fields. Writing the array whole
 * is only safe where the schema says that key *is* one value — `ui.tab_bar_right` — which
 * is what keeps `leaves` from dropping it in favour of the expansion on the next load.
 */
export function isTableArrayValue(value: TomlValue): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((element) => isTable(element))
}

/** True when `path` is a key the schema says holds one whole value. */
export function isWholeValueKey(path: string): boolean {
  return wholeValueKeys.has(normalizePath(path))
}

/**
 * The schema keys that name a table of user-chosen keys rather than a value.
 *
 * `ui.sidebar.agents.rows_by_agent` is the only one: its leaves are the agent ids inside
 * it. A reader that wants the table itself has to assemble it from those.
 */
export function containerKeyPaths(): readonly string[] {
  return [...containerKeys]
}

/** True when the schema calls `path` a table of user-chosen keys. */
export function isContainerKey(path: string): boolean {
  return containerKeys.has(normalizePath(path))
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
