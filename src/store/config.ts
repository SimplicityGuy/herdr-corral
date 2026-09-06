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
 * **edits ⊕ parsed ⊕ schema default**. Nothing precomputes a merged config, because the
 * merge is cheap and a cached copy is one more thing to keep honest.
 *
 * Undo and redo are stacks of whole `edits` maps. A map is never mutated, so a stack
 * entry is a pointer to the map that was current at the time — structural sharing, not a
 * deep copy — and undo is a pointer swap however large the config gets.
 *
 * Two invariants of the epic are load-bearing here. Export compares *explicitly set*
 * values rather than effective ones, so setting a key to its own default still writes it
 * and `reset` removes the key (invariant 2); and a file that was loaded and not edited
 * produces no ops at all, so its export is the original bytes (invariant 1).
 */

import {
  type ConfigValues,
  diff,
  generate,
  patch,
  valuesEqual,
} from '@/model/export'
import { type TomlSyntaxError, type TomlValue, tryParseToml } from '@/model/parse'
import { normalizePath } from '@/model/paths'
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
  /** Every path this config sets, defaults excluded. */
  explicit(): Map<string, TomlValue>
  /** The leaves whose value differs from the loaded file's. */
  changedLeaves(): string[]
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

/** edits ⊕ parsed ⊕ schema default, for one path. */
export function effectiveValue(doc: ConfigDocument, path: string): TomlValue | undefined {
  const target = normalizePath(path)
  const edit = doc.edits.get(target)
  if (edit !== undefined) return edit === REMOVED ? schemaDefault(target) : edit
  const parsed = doc.parsed.get(target)
  return parsed === undefined ? schemaDefault(target) : parsed
}

/**
 * Every path the config sets, with the edits applied.
 *
 * Schema defaults are deliberately absent: this is the map an export diffs, and a key
 * nobody touched must not be written into the file.
 */
export function explicitValues(doc: ConfigDocument): Map<string, TomlValue> {
  const out = new Map<string, TomlValue>(doc.parsed)
  for (const [path, edit] of doc.edits) {
    if (edit === REMOVED) out.delete(path)
    else out.set(path, edit)
  }
  return out
}

/** The leaves an export would write or drop, in schema order. */
export function changedLeaves(doc: ConfigDocument): string[] {
  return diff(doc.parsed, explicitValues(doc)).map((op) => op.path)
}

/** True when an export would change anything. */
export function isDirty(doc: ConfigDocument): boolean {
  return diff(doc.parsed, explicitValues(doc)).length > 0
}

/**
 * The config as a file.
 *
 * A loaded file is patched, so its comments, blank lines and untouched keys come back
 * byte for byte; a session that started from the defaults has no text to patch and gets
 * a compact file written from the keys it set.
 */
export function exportText(doc: ConfigDocument): string {
  const explicit = explicitValues(doc)
  if (doc.source === 'defaults') return generate(explicit)
  return patch(doc.originalText, diff(doc.parsed, explicit))
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
    const target = normalizePath(path)
    const state = get()
    const edit = state.edits.get(target)
    const settled = edit === undefined ? state.parsed.get(target) : edit === REMOVED ? undefined : edit
    // A key that is not set at all is never a no-op, even when the new value matches the
    // documented default — invariant 2 says an explicit default is still written.
    if (settled !== undefined && valuesEqual(settled, value)) return
    const edits = new Map(state.edits)
    edits.set(target, value)
    write({ edits, past: [...state.past, state.edits], future: [] })
  },

  reset(path) {
    const target = normalizePath(path)
    const state = get()
    const edit = state.edits.get(target)
    if (edit === REMOVED) return
    const inFile = state.parsed.has(target)
    if (edit === undefined && !inFile) return
    const edits = new Map(state.edits)
    if (inFile) edits.set(target, REMOVED)
    else edits.delete(target)
    write({ edits, past: [...state.past, state.edits], future: [] })
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
    write({ edits: next, past: [...state.past, state.edits], future: rest })
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
    return explicitValues(get())
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
