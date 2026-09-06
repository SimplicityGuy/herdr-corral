/**
 * The document store — one source of truth for the whole editor.
 *
 * Four facts describe a session, and everything the UI shows is derived from them:
 *
 * - `source` — whether this config came from a file the user loaded or from herdr's
 *   defaults. It decides whether an export patches text or writes a new file.
 * - `originalText` — the loaded file, untouched, so the patcher always has the bytes it
 *   is preserving.
 * - `parsed` — what that file sets, flattened to `path → value`.
 * - `edits` — what the user changed since, as `path → value` or `path → REMOVED`.
 *
 * Reading a setting walks those in order and falls through to the schema:
 * **edits ⊕ parsed ⊕ schema default**. Reading one path walks them directly; the whole
 * merged config is built only when something asks for it, by `effectiveValues`, which is
 * what a validator wants. Both that and the export diff are cached on the identity of the
 * edit map that produced them, so the shell can read `isDirty` on every render without
 * rebuilding a 167-key comparison.
 *
 * Undo and redo are stacks of whole `edits` maps. Each `set` copies the map once, and
 * every stack entry after that is a pointer to a map that already exists — the sharing is
 * per stack entry, not per edit — so undo is a pointer swap however large the config gets.
 * The copy itself is the cost that grows, so `past` is capped at `MAX_HISTORY` steps and
 * the oldest states fall off the back rather than accumulating for a whole session.
 *
 * Two invariants of the epic are load-bearing here. Export compares *explicitly set*
 * values rather than effective ones, so setting a key to its own default still writes it
 * and `reset` removes the key (invariant 2); and a file that was loaded and not edited
 * produces no ops at all, so its export is the original bytes (invariant 1).
 */

import {
  type ConfigValues,
  type ExportOp,
  UnwritablePathError,
  containerKeyPaths,
  diff,
  generate,
  isLeaf,
  isContainerKey,
  isTableArrayValue,
  isUnder,
  isWholeValueKey,
  leaves,
  patch,
  valuesEqual,
} from '@/model/export'
import { type TomlSyntaxError, type TomlValue, tryParseToml } from '@/model/parse'
import {
  type PathSegment,
  childPath,
  formatPath,
  indexedPath,
  normalizePath,
  parsePath,
} from '@/model/paths'
import { defaultOf, sections } from '@/schema/index.ts'
import { create } from 'zustand'

/** Where the config being edited came from. */
export type Source = 'defaults' | 'file'

/** Marks a path the user took back out of the file. */
export const REMOVED: unique symbol = Symbol('corral.removed')

/** One entry of the edit map: a new value, or the removal of the key. */
export type Edit = TomlValue | typeof REMOVED

/** The user's changes, keyed by the path each one addresses. */
export type Edits = ReadonlyMap<string, Edit>

/**
 * What the user is looking at.
 *
 * `section` is the reference section the settings tree has open, addressed by its id
 * rather than a position, so a reordered reference page cannot silently move the user
 * somewhere else. `key` is the setting being edited, and `region` is the preview region
 * that anchors an inline popover — both unset when the selection is a whole section.
 */
export interface Selection {
  readonly section: string
  readonly key?: string
  readonly region?: string
}

/** The four facts an export is a function of. */
export interface ConfigDocument {
  readonly source: Source
  readonly originalText: string
  readonly parsed: ConfigValues
  readonly edits: Edits
}

/** Everything the store holds. */
export interface ConfigState extends ConfigDocument {
  /** Edit maps to go back to, oldest first. */
  readonly past: readonly Edits[]
  /** Edit maps undo stepped out of, nearest first. */
  readonly future: readonly Edits[]
  readonly selection: Selection
  /** The syntax error from the last failed `loadText`, or `null`. */
  readonly parseError: TomlSyntaxError | null
}

/** What the store can be asked to do. */
export interface ConfigActions {
  /** Load a config file. Returns the syntax error and changes nothing when it fails. */
  loadText(text: string): TomlSyntaxError | null
  /** Start over from herdr's defaults: no original text, no set keys. */
  loadDefaults(): void
  /** Write one setting. Throws `UnwritablePathError` when the path names a table. */
  set(path: string, value: TomlValue): void
  /** Take a path back out: removed when the file set it, otherwise just un-edited. */
  reset(path: string): void
  undo(): void
  redo(): void
  /** Merge a partial selection over the current one. */
  select(next: Partial<Selection>): void
  /** Open a section, clearing any narrower selection inside the previous one. */
  setSection(section: string): void
  /** edits ⊕ parsed ⊕ schema default. `undefined` when nothing gives the path a value. */
  effective(path: string): TomlValue | undefined
  /** Every path this config sets, defaults excluded. Shared, so read-only. */
  explicit(): ConfigValues
  /** The whole config herdr would see, defaults included — what `validate()` wants. */
  effectiveAll(): ConfigValues
  /** The leaves whose value differs from the loaded file's. */
  changedLeaves(): readonly string[]
  isDirty(): boolean
  /** The file to hand the user: a patch of the original, or a freshly written one. */
  exportText(): string
}

export type ConfigStore = ConfigState & ConfigActions

/** The section the tree opens on: the first one the reference page lists. */
export const DEFAULT_SECTION: string = sections()[0]?.id ?? ''

/**
 * The documented default, as a value.
 *
 * herdr prints "unset" for a setting with no default and the generator records that as
 * `null`; the store reports it as `undefined`, because "no value" is what the editor
 * means by it and TOML has no null to write.
 */
function schemaDefault(path: string): TomlValue | undefined {
  const value = defaultOf(path)
  return value === null || value === undefined ? undefined : (value as TomlValue)
}

/**
 * The edit that owns `target` from above, and the path left to walk inside its value.
 *
 * `ui.tab_bar_right` is written as one value, so once it is edited the entries inside it
 * live in that value and the `ui.tab_bar_right[0].type` the file parsed to is stale. The
 * edits map is a handful of entries, so scanning it beats parsing the path.
 */
function editedAncestor(doc: ConfigDocument, target: string): { path: string; edit: Edit } | null {
  let found: { path: string; edit: Edit } | null = null
  for (const [path, edit] of doc.edits) {
    if (!isUnder(target, path)) continue
    if (found === null || path.length > found.path.length) found = { path, edit }
  }
  return found
}

/** Walk `segments` into `value`, or `undefined` when the value has nothing there. */
function valueAt(value: TomlValue, segments: readonly PathSegment[]): TomlValue | undefined {
  let current: TomlValue | undefined = value
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    if (segment.kind === 'index') {
      current = Array.isArray(current) ? current[segment.index] : undefined
      continue
    }
    if (typeof current !== 'object' || Array.isArray(current) || current instanceof Date) {
      return undefined
    }
    current = (current as Record<string, TomlValue>)[segment.key]
  }
  return current
}

/**
 * The normalized path of a setting an edit may address, or a throw explaining why not.
 *
 * A table is not a setting. `keys.command` names a list of `[[keys.command]]` blocks and
 * `theme.custom` names a table of colour tokens; neither can be written as one
 * `key = value` line, so an edit at either would be dropped on the way out. Rejecting the
 * write is the only honest answer — the editors address the fields inside instead, which
 * is what `TomlDocument` can actually patch in place.
 */
function writablePath(doc: ConfigDocument, path: string, value?: TomlValue): string {
  const target = normalizePath(path)
  if (!isLeaf(target, doc.parsed, doc.edits)) {
    throw new UnwritablePathError(
      `${target} names a table, not a setting; edit the keys inside it instead`,
    )
  }
  // A path can look like a setting until you see the value. An array of tables is read
  // back as its fields, so writing one anywhere the schema has not declared a whole value
  // gives a file corral would not load the way it wrote it.
  if (value !== undefined && isTableArrayValue(value) && !isWholeValueKey(target)) {
    throw new UnwritablePathError(
      `${target} cannot hold a list of tables; set the fields of each entry instead`,
    )
  }
  return target
}

/** edits ⊕ parsed ⊕ schema default, for one path. */
export function effectiveValue(doc: ConfigDocument, path: string): TomlValue | undefined {
  const target = normalizePath(path)
  const edit = doc.edits.get(target)
  if (edit !== undefined) return edit === REMOVED ? schemaDefault(target) : edit
  if (doc.edits.size > 0) {
    const ancestor = editedAncestor(doc, target)
    if (ancestor !== null) {
      if (ancestor.edit === REMOVED) return schemaDefault(target)
      const rest = parsePath(target).slice(parsePath(ancestor.path).length)
      return valueAt(ancestor.edit, rest)
    }
  }
  // A table of user-chosen keys has no value of its own in the file — `flattenTree` walks
  // into it and reports the agent ids inside. Assembling it is the whole map's job.
  if (isContainerKey(target)) return effectiveValues(doc).get(target)
  const parsed = doc.parsed.get(target)
  if (parsed === undefined) return schemaDefault(target)
  // `keys.command` is the file's own array, and the editors change its fields one path at
  // a time, so once anything is edited the array the file parsed to is behind. Only a
  // container can go stale this way: a key the schema calls one whole value is edited
  // whole, and that edit was caught above.
  if (doc.edits.size > 0 && isTableArrayValue(parsed) && !isWholeValueKey(target)) {
    return effectiveValues(doc).get(target)
  }
  return parsed
}

/**
 * Every path the config sets, with the edits applied.
 *
 * Schema defaults are deliberately absent: this is the map an export diffs, and a key
 * nobody touched must not be written into the file. Editing a value that has structure
 * inside it drops the paths the file parsed to underneath it, so no reader can be handed
 * an entry from the array that used to be there.
 */
export function explicitValues(doc: ConfigDocument): ConfigValues {
  const out = new Map<string, TomlValue>(doc.parsed)
  for (const [path, edit] of doc.edits) {
    for (const existing of out.keys()) {
      if (isUnder(existing, path)) out.delete(existing)
    }
    if (edit === REMOVED) out.delete(path)
    else out.set(path, edit)
  }
  return out
}

/**
 * The explicit map and the ops an export would apply, computed once per edit map.
 *
 * The shell reads `isDirty` and `changedLeaves` as zustand selectors, which run on every
 * touch of the store; recomputing a 167-key diff and handing back a fresh array each time
 * would re-render the whole chrome on an unrelated selection change. Edit maps are never
 * mutated and are shared with the undo stacks, so their identity is a sound cache key —
 * and stepping back through history hits the cache rather than rebuilding.
 */
interface Derived {
  readonly parsed: ConfigValues
  readonly explicit: ConfigValues
  readonly ops: readonly ExportOp[]
  readonly changed: readonly string[]
}

const derivedCache = new WeakMap<Edits, Derived>()

function derive(doc: ConfigDocument): Derived {
  const cached = derivedCache.get(doc.edits)
  if (cached !== undefined && cached.parsed === doc.parsed) return cached
  const explicit = explicitValues(doc)
  const ops = diff(doc.parsed, explicit)
  const fresh: Derived = {
    parsed: doc.parsed,
    explicit,
    ops,
    changed: ops.map((op) => op.path),
  }
  derivedCache.set(doc.edits, fresh)
  return fresh
}

/** The leaves an export would write or drop, in schema order. */
export function changedLeaves(doc: ConfigDocument): readonly string[] {
  return derive(doc).changed
}

/** True when an export would change anything. */
export function isDirty(doc: ConfigDocument): boolean {
  return derive(doc).ops.length > 0
}

/**
 * The config as a file.
 *
 * A loaded file is patched, so its comments, blank lines and untouched keys come back
 * byte for byte; a session that started from the defaults has no text to patch and gets
 * a compact file written from the keys it set.
 */
export function exportText(doc: ConfigDocument): string {
  const derived = derive(doc)
  if (doc.source === 'defaults') return generate(derived.explicit)
  return patch(doc.originalText, derived.ops)
}

/**
 * The paths this config sets, edits applied — the same map an export diffs.
 *
 * Shared, so repeated reads are the same reference; read-only for the same reason.
 */
export function explicitOf(doc: ConfigDocument): ConfigValues {
  return derive(doc).explicit
}

/** Write `value` at `segments` inside `target`, creating the tables on the way. */
function assignInto(
  target: Record<string, TomlValue>,
  segments: readonly PathSegment[],
  value: TomlValue,
): void {
  let node = target
  for (const [position, segment] of segments.entries()) {
    if (segment.kind !== 'key') return
    if (position === segments.length - 1) {
      node[segment.key] = value
      return
    }
    const next = node[segment.key]
    if (typeof next === 'object' && next !== null && !Array.isArray(next) && !(next instanceof Date)) {
      node = next as Record<string, TomlValue>
      continue
    }
    const created: Record<string, TomlValue> = {}
    node[segment.key] = created
    node = created
  }
}

/**
 * Assemble `keys.command[i].<field>` leaves back into the array they describe.
 *
 * The per-field paths are what the editors write and what the exporter patches, so they
 * are the truth; the array is derived from them and never read from the file, which is
 * what keeps the two consistent after an edit, an append or a reset. A gap in the indices
 * becomes an empty entry rather than being closed up, so `keys.command[i]` still names
 * element `i` of the array.
 */
/** The array-of-tables occurrences the loaded file held, per base path. */
function occurrencesIn(parsed: ConfigValues): Map<string, Set<number>> {
  const found = new Map<string, Set<number>>()
  for (const path of parsed.keys()) {
    const segments = parsePath(path)
    const at = segments.findIndex((segment) => segment.kind === 'index')
    const owner = at === -1 ? undefined : segments[at]
    if (owner === undefined || owner.kind !== 'index') continue
    const base = formatPath(segments.slice(0, at))
    const bucket = found.get(base)
    if (bucket === undefined) found.set(base, new Set([owner.index]))
    else bucket.add(owner.index)
  }
  return found
}

function groupIndexedEntries(out: Map<string, TomlValue>, fileOccurrences: Map<string, Set<number>>): void {
  const groups = new Map<string, Map<number, Record<string, TomlValue>>>()
  for (const [path, value] of out) {
    const segments = parsePath(path)
    const at = segments.findIndex((segment) => segment.kind === 'index')
    const owner = at === -1 ? undefined : segments[at]
    if (owner === undefined || owner.kind !== 'index') continue
    const rest = segments.slice(at + 1)
    // A nested array of tables would need a second index to place the value. herdr has
    // none, and guessing would be worse than leaving the outer array underived.
    if (rest.length === 0 || rest.some((segment) => segment.kind === 'index')) continue
    const base = formatPath(segments.slice(0, at))
    let entries = groups.get(base)
    if (entries === undefined) {
      entries = new Map()
      groups.set(base, entries)
    }
    let entry = entries.get(owner.index)
    if (entry === undefined) {
      entry = {}
      entries.set(owner.index, entry)
    }
    assignInto(entry, rest, value)
  }
  for (const [base, entries] of groups) {
    // Resetting every field of one command does not delete its `[[keys.command]]` block,
    // so the slot survives in the file and has to survive here, as an empty entry.
    for (const index of fileOccurrences.get(base) ?? []) {
      if (!entries.has(index)) entries.set(index, {})
    }
    const highest = Math.max(...entries.keys())
    const array: TomlValue[] = []
    for (let index = 0; index <= highest; index++) array.push(entries.get(index) ?? {})
    out.set(base, array)
  }
}

/** Assemble the agent ids under a container key back into the table that holds them. */
function buildContainerTables(out: Map<string, TomlValue>): void {
  for (const base of containerKeyPaths()) {
    const depth = parsePath(base).length
    const table: Record<string, TomlValue> = {}
    for (const [path, value] of out) {
      if (!isUnder(path, base)) continue
      const rest = parsePath(path).slice(depth)
      const only = rest.length === 1 ? rest[0] : undefined
      if (only === undefined || only.kind !== 'key') continue
      table[only.key] = value
    }
    out.set(base, table)
  }
}

/** Emit the leaves of one table, the way `flattenTree` would have read them back. */
function emitTable(
  out: Map<string, TomlValue>,
  prefix: string,
  table: Record<string, TomlValue>,
): void {
  for (const [key, value] of Object.entries(table)) {
    const path = childPath(prefix, key)
    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      emitTable(out, path, value as Record<string, TomlValue>)
      continue
    }
    out.set(path, value)
    if (!isTableArrayValue(value)) continue
    for (const [index, element] of (value as TomlValue[]).entries()) {
      emitTable(out, indexedPath(path, index), element as Record<string, TomlValue>)
    }
  }
}

/**
 * Expand every array of tables into the indexed paths a parse of the file would give.
 *
 * `ui.tab_bar_right` is written and edited whole, so its entries have no leaf of their
 * own; a reader asking for `ui.tab_bar_right[0].type` gets it from here.
 */
function expandTableArrays(out: Map<string, TomlValue>): void {
  for (const [path, value] of [...out]) {
    if (!isTableArrayValue(value)) continue
    for (const [index, element] of (value as TomlValue[]).entries()) {
      emitTable(out, indexedPath(path, index), element as Record<string, TomlValue>)
    }
  }
}

function buildEffective(doc: ConfigDocument): ConfigValues {
  const explicit = explicitOf(doc)
  const out = new Map<string, TomlValue>()
  for (const path of leaves(doc.parsed, explicit)) {
    const set = explicit.get(path)
    const value = set === undefined ? schemaDefault(path) : set
    if (value !== undefined) out.set(path, value)
  }
  groupIndexedEntries(out, occurrencesIn(doc.parsed))
  buildContainerTables(out)
  expandTableArrays(out)
  return out
}

const effectiveCache = new WeakMap<Edits, { parsed: ConfigValues; values: ConfigValues }>()

/**
 * The whole config herdr would see, as one flat `path → value` map.
 *
 * This is the argument `validate()` wants. It is built from the leaves outward: each
 * writable path takes its value from the edits, then the file, then the schema's
 * documented default, and every container is then derived from those leaves rather than
 * read from the file. That is what keeps `keys.command` and its `keys.command[i].field`
 * entries telling the same story after a per-field edit, an append or a reset, and what
 * makes a path inside a replaced value — `ui.tab_bar_right[0].type` — read through the
 * replacement instead of returning what the file used to say.
 *
 * The shape matches `flattenTree`, with one addition: the container key
 * `ui.sidebar.agents.rows_by_agent` is present as a table alongside the `<id>` entries
 * inside it, because a validator wants to see the table as a whole. A key herdr documents
 * as unset and nobody set is absent rather than null, and `keys.command` is absent when
 * there are no commands, which is what a parse of such a file gives.
 *
 * The other two arguments a validator needs come from elsewhere on purpose. The user-set
 * paths are the keys of `explicit()`. The unknown keys should come from `unknownKeysIn`
 * in the validation layer, which owns what "unknown" means — a second definition here
 * would be the drift that helper exists to prevent.
 *
 * Memoized on the identity of the edit map that produced it, guarded on the parsed map,
 * so repeated reads are the same reference and an undo is a cache hit.
 */
export function effectiveValues(doc: ConfigDocument): ConfigValues {
  const cached = effectiveCache.get(doc.edits)
  if (cached !== undefined && cached.parsed === doc.parsed) return cached.values
  const values = buildEffective(doc)
  effectiveCache.set(doc.edits, { parsed: doc.parsed, values })
  return values
}

/**
 * How many undo steps are kept.
 *
 * Each step holds a full copy of the edit map, so an unbounded stack would retain every
 * intermediate state of a long session. Two hundred is far more than a person reaches for
 * and bounds the retained copies at a fixed number.
 */
export const MAX_HISTORY = 200

/** Push the state being left onto the undo stack, dropping the oldest past the cap. */
function pushHistory(past: readonly Edits[], leaving: Edits): readonly Edits[] {
  const next = [...past, leaving]
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next
}

/** The state a fresh session starts from: herdr's defaults, nothing set, nothing done. */
export function initialConfigState(): ConfigState {
  return {
    source: 'defaults',
    originalText: '',
    parsed: new Map(),
    edits: new Map(),
    past: [],
    future: [],
    selection: { section: DEFAULT_SECTION },
    parseError: null,
  }
}

export const useConfigStore = create<ConfigStore>()((write, get) => ({
  ...initialConfigState(),

  loadText(text) {
    const outcome = tryParseToml(text)
    if (!outcome.ok) {
      write({ parseError: outcome.error })
      return outcome.error
    }
    write({
      ...initialConfigState(),
      source: 'file',
      originalText: text,
      parsed: outcome.parsed.values,
      selection: get().selection,
    })
    return null
  },

  loadDefaults() {
    write({ ...initialConfigState(), selection: get().selection })
  },

  set(path, value) {
    const state = get()
    const target = writablePath(state, path, value)
    const edit = state.edits.get(target)
    const settled = edit === undefined ? state.parsed.get(target) : edit === REMOVED ? undefined : edit
    // A key that is not set at all is never a no-op, even when the new value matches the
    // documented default — invariant 2 says an explicit default is still written.
    if (settled !== undefined && valuesEqual(settled, value)) return
    const edits = new Map(state.edits)
    edits.set(target, value)
    write({ edits, past: pushHistory(state.past, state.edits), future: [] })
  },

  reset(path) {
    const state = get()
    const target = writablePath(state, path)
    const edit = state.edits.get(target)
    if (edit === REMOVED) return
    const inFile = state.parsed.has(target)
    if (edit === undefined && !inFile) return
    const edits = new Map(state.edits)
    if (inFile) edits.set(target, REMOVED)
    else edits.delete(target)
    write({ edits, past: pushHistory(state.past, state.edits), future: [] })
  },

  undo() {
    const state = get()
    const previous = state.past.at(-1)
    if (previous === undefined) return
    write({
      edits: previous,
      past: state.past.slice(0, -1),
      future: [state.edits, ...state.future],
    })
  },

  redo() {
    const state = get()
    const [next, ...rest] = state.future
    if (next === undefined) return
    write({ edits: next, past: pushHistory(state.past, state.edits), future: rest })
  },

  select(next) {
    write({ selection: { ...get().selection, ...next } })
  },

  setSection(section) {
    write({ selection: { section } })
  },

  effective(path) {
    return effectiveValue(get(), path)
  },

  explicit() {
    return explicitOf(get())
  },

  effectiveAll() {
    return effectiveValues(get())
  },

  changedLeaves() {
    return changedLeaves(get())
  },

  isDirty() {
    return isDirty(get())
  },

  exportText() {
    return exportText(get())
  },
}))

/** Put the store back to a fresh session. Tests use it; so does "discard everything". */
export function resetConfigStore(): void {
  useConfigStore.setState(initialConfigState())
}
