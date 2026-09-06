/**
 * The moves a `ui.tab_bar_right` list can make, as data.
 *
 * The setting is an ordered list of typed entry tables — `{ type = "datetime",
 * format = "%H:%M" }` — and herdr reads the whole list as one value, so every
 * gesture the status bar editor offers is a function from one array to the next.
 * None of them knows about React, dnd-kit or the store, which is what lets the
 * cap be tested as arithmetic rather than as a drag that has to be simulated.
 *
 * **A refusal is a value, not a throw.** A seventeenth entry is something herdr
 * keeps loading and quietly ignores (`MAX_TAB_BAR_RIGHT_ENTRIES`,
 * src/config/tab_bar.rs:7), so the editor must not write one — but "there is no
 * room for another" is something a person has to be told, and an exception would
 * only reach a `catch`. {@link addEntry} answers {@link Outcome}: the new list,
 * or the sentence to show.
 *
 * **The fields come from the validator.** {@link fieldsOf} reads
 * `TAB_BAR_ENTRY_FIELDS` out of `model/validate.ts` rather than restating it, so
 * the inputs a person is offered are exactly the fields herdr accepts. Only the
 * *kind* of each field — a string, or a bounded count of seconds — is decided
 * here, because that is a question about the control and not about the file.
 *
 * **A new entry carries its required fields, empty.** A `text` entry with no
 * `text` key is an error herdr throws the whole file away over; the same entry
 * with `text = ""` is a file herdr loads. So adding one writes the empty field
 * rather than leaving a hole the user has to know to fill.
 */
import type { TomlValue } from '@/model/parse'
import {
  MAX_TAB_BAR_COMMAND_INTERVAL_SECONDS,
  MAX_TAB_BAR_COMMAND_TIMEOUT_SECONDS,
  MAX_TAB_BAR_RIGHT_ENTRIES,
  TAB_BAR_ENTRY_FIELDS,
} from '@/model/validate'

/** The setting this module is about. */
export const TAB_BAR_RIGHT = 'ui.tab_bar_right'

/** `MAX_TAB_BAR_RIGHT_ENTRIES`, under the name the editor uses. */
export const MAX_ENTRIES: number = MAX_TAB_BAR_RIGHT_ENTRIES

/** What a refused add says, in the words `validate.ts` uses for the file. */
export const TOO_MANY_ENTRIES = `the tab bar may hold at most ${MAX_ENTRIES} entries; herdr ignores the extras`

/** One entry, exactly as it sits in the file. */
export type TabBarEntry = Readonly<Record<string, TomlValue>>

/** A move that happened, or the sentence explaining why it did not. */
export type Outcome =
  | { readonly ok: true; readonly entries: TabBarEntry[] }
  | { readonly ok: false; readonly reason: string }

/** What kind of control one field wants. */
export type FieldKind = 'string' | 'seconds'

/** One field of an entry: what it is called, what it holds, and whether herdr needs it. */
export interface FieldSpec {
  readonly name: string
  readonly kind: FieldKind
  readonly required: boolean
  /** The ceiling herdr hides the entry over, for the `seconds` fields. */
  readonly max?: number
  /** The one line the editor prints under the input. */
  readonly hint: string
}

/**
 * How each field is spelled and what it means.
 *
 * herdr documents `tab_bar_right` in prose rather than per-field in the
 * reference, so the hints are written here — the only thing in this module that
 * is not derived from the schema or the validator, and the reason it is one
 * table instead of a sentence scattered through the component.
 */
const FIELD_KINDS: Readonly<Record<string, { kind: FieldKind; max?: number; hint: string }>> = {
  format: {
    kind: 'string',
    hint: 'strftime format, e.g. %H:%M — empty hides the entry',
  },
  text: {
    kind: 'string',
    hint: 'the literal text drawn in the bar',
  },
  command: {
    kind: 'string',
    hint: 'shell line herdr runs on its own host — empty hides the entry',
  },
  interval_seconds: {
    kind: 'seconds',
    max: MAX_TAB_BAR_COMMAND_INTERVAL_SECONDS,
    hint: `how often to re-run it, 1–${MAX_TAB_BAR_COMMAND_INTERVAL_SECONDS} seconds`,
  },
  timeout_seconds: {
    kind: 'seconds',
    max: MAX_TAB_BAR_COMMAND_TIMEOUT_SECONDS,
    hint: `how long to wait for it, 1–${MAX_TAB_BAR_COMMAND_TIMEOUT_SECONDS} seconds`,
  },
}

function isTable(value: TomlValue): value is Record<string, TomlValue> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  )
}

/**
 * A stored value read back as entries, with anything unusable kept as a blank.
 *
 * The value is the user's to get wrong and `validate()` is what says so, but the
 * editor still has to draw something: an element that parsed to a string is not
 * an entry. It becomes an empty table rather than disappearing, so the entry the
 * user came here to fix keeps its place in the list and its own remove button.
 */
export function asEntries(value: TomlValue | undefined): TabBarEntry[] {
  if (!Array.isArray(value)) return []
  return value.map((element) => (isTable(element) ? { ...element } : {}))
}

/** An entry's `type`, or `''` when it has none — which `validate()` reports. */
export function typeOf(entry: TabBarEntry): string {
  return typeof entry.type === 'string' ? entry.type : ''
}

/** The fields this entry type accepts, required ones first. */
export function fieldsOf(type: string): readonly FieldSpec[] {
  const shape = TAB_BAR_ENTRY_FIELDS.get(type)
  if (shape === undefined) return []
  const spec = (name: string, required: boolean): FieldSpec => {
    const kind = FIELD_KINDS[name] ?? { kind: 'string' as const, hint: '' }
    return { name, kind: kind.kind, required, max: kind.max, hint: kind.hint }
  }
  return [
    ...shape.required.map((name) => spec(name, true)),
    ...shape.optional.map((name) => spec(name, false)),
  ]
}

/** A fresh entry of this type: its `type`, and its required fields left empty. */
export function newEntry(type: string): TabBarEntry {
  const entry: Record<string, TomlValue> = { type }
  for (const field of fieldsOf(type)) {
    if (field.required) entry[field.name] = field.kind === 'seconds' ? 0 : ''
  }
  return entry
}

/** Append an entry of `type`, or refuse because the bar is full. */
export function addEntry(entries: readonly TabBarEntry[], type: string): Outcome {
  if (entries.length >= MAX_ENTRIES) return { ok: false, reason: TOO_MANY_ENTRIES }
  return { ok: true, entries: [...entries, newEntry(type)] }
}

/** Drop the entry at `index`. Out of range is the list unchanged. */
export function removeEntry(entries: readonly TabBarEntry[], index: number): TabBarEntry[] {
  return entries.filter((_, at) => at !== index)
}

/**
 * Move the entry at `from` to `to`, clamped to the ends of the list.
 *
 * Clamping rather than refusing: nudging the first entry up is a person saying
 * "further left" at the left edge, which is a no-op, not an error to explain.
 */
export function moveEntry(entries: readonly TabBarEntry[], from: number, to: number): TabBarEntry[] {
  if (from < 0 || from >= entries.length) return [...entries]
  const target = Math.max(0, Math.min(entries.length - 1, to))
  const next = [...entries]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  return next
}

/**
 * Set one field of one entry, or take it back out.
 *
 * `undefined` deletes rather than writing an empty value, because an optional
 * field herdr never saw and an optional field set to nothing are different
 * files: the first leaves herdr's own default in place.
 */
export function withField(
  entries: readonly TabBarEntry[],
  index: number,
  field: string,
  value: TomlValue | undefined,
): TabBarEntry[] {
  return entries.map((entry, at) => {
    if (at !== index) return entry
    const next: Record<string, TomlValue> = { ...entry }
    if (value === undefined) delete next[field]
    else next[field] = value
    return next
  })
}

/** True when two lists would be written the same way — nothing to record. */
export function sameEntries(a: readonly TabBarEntry[], b: readonly TabBarEntry[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
