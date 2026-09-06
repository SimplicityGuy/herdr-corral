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
 * **edits ⊕ parsed ⊕ schema default**. No merged config is precomputed; what is cached is
 * the export diff, keyed on the identity of the edit map that produced it, so the shell
 * can read `isDirty` on every render without rebuilding a 167-key comparison.
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
  diff,
  generate,
  isLeaf,
  isTableArrayValue,
  isUnder,
  isWholeValueKey,
  patch,
  valuesEqual,
} from '@/model/export'
import { type TomlSyntaxError, type TomlValue, tryParseToml } from '@/model/parse'
import { type PathSegment, normalizePath, parsePath } from '@/model/paths'
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
  const parsed = doc.parsed.get(target)
  return parsed === undefined ? schemaDefault(target) : parsed
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
