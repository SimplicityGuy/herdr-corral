/**
 * What the keybindings editor needs to know that is not a component.
 *
 * Three questions, none of which needs a DOM to answer:
 *
 * - **Which group does an action belong to?** herdr's reference page lists the
 *   whole `[keys]` table in one flat run, which is the wrong shape for a
 *   screen: nobody looks for "the key that splits a pane" in a list that also
 *   holds workspace pickers. The groups below are ordered claims over the key
 *   names, first match wins, exactly as `src/lib/sections.ts` claims keys for
 *   the six switches — and for the same reason: a herdr release that adds
 *   `keys.split_diagonal` lands it in `panes` without anyone editing a list.
 *   Order *inside* a group stays the reference page's order.
 * - **Which actions collide?** `validate()` already answers that, because herdr
 *   answers it: the losing setting carries a warning naming the chord and the
 *   setting that kept it. Reading it back out of the diagnostic is what keeps
 *   corral's idea of a conflict identical to herdr's — a second implementation
 *   here would be a second thing to keep in step.
 * - **What does removing a custom command do?** `[[keys.command]]` is edited
 *   through its per-field leaves (`keys.command[i].key`, …), so dropping entry
 *   *i* is a rewrite of every entry after it plus a clearing of the tail. Doing
 *   it as a list of ops rather than a sequence of store calls is what makes it
 *   testable, and what keeps the array from going sparse.
 */
import type { ExportOp } from '@/model/export'
import type { TomlTable, TomlValue } from '@/model/parse'
import { COMMAND_FIELDS, COMMAND_TYPES, type Diagnostic } from '@/model/validate'
import { allKeys } from '@/schema'

export { COMMAND_FIELDS, COMMAND_TYPES }

/** The headings the editor draws, in the order it draws them. */
export const KEY_GROUPS = [
  'prefix and global',
  'panes',
  'tabs and workspaces',
  'navigate mode',
  'agents',
  'misc',
] as const

export type KeyGroup = (typeof KEY_GROUPS)[number]

/** The settings the editor gives a block of their own rather than a group. */
export const INDEXED_KEYS: readonly string[] = [
  'keys.indexed.tabs',
  'keys.indexed.workspaces',
  'keys.indexed.agents',
]

/** The `[keys]` settings that are about the prefix itself, or about no region. */
const GLOBAL_KEYS: ReadonlySet<string> = new Set([
  'keys.prefix',
  'keys.help',
  'keys.settings',
  'keys.goto',
  'keys.detach',
  'keys.reload_config',
  'keys.open_notification_target',
  'keys.remote_image_paste',
])

/** Ordered claims over the action names; the first that matches owns the key. */
const GROUP_RULES: readonly (readonly [KeyGroup, RegExp])[] = [
  ['navigate mode', /^keys\.navigate_/],
  ['agents', /agent/],
  ['tabs and workspaces', /tab|workspace|worktree/],
  ['panes', /pane|split_|zoom|resize_mode|copy_mode|scrollback/],
]

/** The group an action belongs to. Total: anything unclaimed is `misc`. */
export function groupOf(key: string): KeyGroup {
  if (GLOBAL_KEYS.has(key)) return 'prefix and global'
  return GROUP_RULES.find(([, rule]) => rule.test(key))?.[0] ?? 'misc'
}

/** Every `[keys]` setting the groups cover, in the reference page's order. */
export function bindingKeys(): readonly string[] {
  return allKeys().filter((key) => key.startsWith('keys.') && !INDEXED_KEYS.includes(key))
}

/** One group with its actions, in the reference page's order. */
export interface KeyGroupRows {
  readonly group: KeyGroup
  readonly keys: readonly string[]
}

/** The groups the editor draws, empty ones dropped. */
export function groupedBindings(): readonly KeyGroupRows[] {
  const buckets = new Map<KeyGroup, string[]>(KEY_GROUPS.map((group) => [group, []]))
  for (const key of bindingKeys()) buckets.get(groupOf(key))?.push(key)
  return KEY_GROUPS.map((group) => ({ group, keys: buckets.get(group) ?? [] })).filter(
    (entry) => entry.keys.length > 0,
  )
}

/**
 * The shape of herdr's collision warning, as `validate()` writes it.
 *
 * `${label}: kept ${owner.field}, disabled ${field}` — src/model/validate.ts.
 * The diagnostic hangs on the *losing* field, so the winner is only named inside
 * the text, which is why it is read back out rather than recomputed.
 */
const COLLISION = /^(?<label>.+): kept (?<kept>[^,]+), disabled (?<disabled>.+)$/

/** Two actions that want the same chord, and which of them herdr keeps. */
export interface Conflict {
  /** The printed chord both actions asked for. */
  readonly label: string
  /** The setting herdr keeps the binding on. */
  readonly kept: string
  /** The setting herdr disables. */
  readonly disabled: string
}

/** Every collision the diagnostics report, in the order they report them. */
export function conflictsIn(diagnostics: readonly Diagnostic[]): readonly Conflict[] {
  const found: Conflict[] = []
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== 'warning') continue
    const groups = COLLISION.exec(diagnostic.message)?.groups
    if (groups === undefined) continue
    found.push({ label: groups.label, kept: groups.kept, disabled: groups.disabled })
  }
  return found
}

/** True when a diagnostic is one of herdr's collision warnings. */
export function isConflictMessage(message: string): boolean {
  return COLLISION.test(message)
}

/** The collisions one setting is part of, whether it won them or lost them. */
export function conflictsFor(
  conflicts: readonly Conflict[],
  key: string,
): readonly Conflict[] {
  return conflicts.filter((conflict) => conflict.kept === key || conflict.disabled === key)
}

/**
 * How a conflict reads on the row of `key`.
 *
 * Both actions are named on both rows, because a duplicate is only intelligible
 * as a pair: the row that lost has to say what beat it, and the row that won has
 * to say what it silently switched off.
 */
export function conflictMessage(conflict: Conflict, key: string): string {
  const pair = `duplicate ${conflict.label}: kept ${conflict.kept}, disabled ${conflict.disabled}`
  return conflict.kept === key ? `${pair} — this action keeps the chord` : pair
}

// ---------------------------------------------------------------------------
// [[keys.command]]
// ---------------------------------------------------------------------------

/** Where the custom commands live. */
export const COMMAND_PATH = 'keys.command'

/** The mode a freshly added command starts in. */
export const DEFAULT_COMMAND_TYPE = 'shell'

/** The path of one field of one command. */
export function commandField(index: number, field: string): string {
  return `${COMMAND_PATH}[${index}].${field}`
}

function isTable(value: TomlValue): value is TomlTable {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
}

/**
 * The custom commands the config currently holds.
 *
 * The store derives this array from the per-field leaves, so it is the truth
 * about what an export would write — including the empty entry a
 * `[[keys.command]]` block whose fields were all cleared leaves behind.
 */
export function commandsIn(effective: ReadonlyMap<string, TomlValue>): readonly TomlTable[] {
  const value = effective.get(COMMAND_PATH)
  if (!Array.isArray(value)) return []
  return value.map((entry) => (isTable(entry) ? entry : {}))
}

/**
 * The ops that append an empty command at the next free index.
 *
 * "Next free" is the array's length, never a gap: `keys.command[i]` names
 * element *i* of the array herdr reads, so writing index 4 into a config with
 * three commands would give herdr an empty fourth entry it disables.
 */
export function appendCommandOps(commands: readonly TomlTable[]): readonly ExportOp[] {
  const index = commands.length
  return [
    { kind: 'set', path: commandField(index, 'type'), value: DEFAULT_COMMAND_TYPE },
    { kind: 'set', path: commandField(index, 'command'), value: '' },
  ]
}

/**
 * The ops that drop command `index` and close the gap it leaves.
 *
 * Every entry after it moves down one slot, field by field, and the slot that
 * falls off the end is cleared. A field an entry does not have is cleared rather
 * than skipped, so a short entry moving into a long entry's slot does not
 * inherit what was there.
 */
export function removeCommandOps(
  commands: readonly TomlTable[],
  index: number,
): readonly ExportOp[] {
  if (index < 0 || index >= commands.length) return []
  const remaining = commands.filter((_entry, position) => position !== index)
  const ops: ExportOp[] = []
  for (const [position, entry] of remaining.entries()) {
    if (position < index) continue
    for (const field of COMMAND_FIELDS) {
      const path = commandField(position, field)
      const value = entry[field]
      if (value === undefined) ops.push({ kind: 'remove', path })
      else ops.push({ kind: 'set', path, value })
    }
  }
  for (const field of COMMAND_FIELDS) {
    ops.push({ kind: 'remove', path: commandField(commands.length - 1, field) })
  }
  return ops
}

/**
 * A popup size as herdr reads it: a cell count, or a percentage string.
 *
 * A field holding `80` means eighty cells and a field holding `80%` means eighty
 * percent, so the digits decide which of the two the store is handed. Anything
 * else goes in as the string the user typed, and `validate()` says why herdr
 * will not take it — refusing the keystroke here would stop someone typing their
 * way to `80%` through `8`, `80`.
 */
export function parseSize(draft: string): TomlValue {
  const trimmed = draft.trim()
  return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : trimmed
}
