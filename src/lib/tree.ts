/**
 * The shape of the settings tree: which rows exist, under which header.
 *
 * Grouping follows the mockup rather than the reference page. Rows sit under
 * their top-level TOML table (`ui`, `theme`, `keys`), which is the shape of the
 * file the user is editing and the shape `docs/design/console-direction.html`
 * draws. The reference page's *ordering* is preserved inside each group, because
 * that is the order herdr documents its settings in.
 */
import type { TomlValue } from '@/model/parse'

/** One row: the key, what it currently reads, and where it sits in its group. */
export interface TreeRowData {
  readonly key: string
  /** The part of the path shown in the row; the group header carries the rest. */
  readonly label: string
  readonly value: TomlValue | undefined
  /** Drawn with `└` rather than `├`. */
  readonly last: boolean
}

export interface TreeGroup {
  readonly name: string
  readonly rows: readonly TreeRowData[]
}

/** The top-level table a key belongs to: `ui.sidebar.agents.rows` → `ui`. */
export function groupNameOf(key: string): string {
  const dot = key.indexOf('.')
  return dot === -1 ? key : key.slice(0, dot)
}

/** What the row itself shows: the path with the group header's part removed. */
export function labelOf(key: string, group: string): string {
  return key === group ? key : key.slice(group.length + 1)
}

/** Group keys under their table, keeping the order they were given in. */
export function groupRows(
  keys: readonly string[],
  valueOf: (key: string) => TomlValue | undefined,
): readonly TreeGroup[] {
  const order: string[] = []
  const rows = new Map<string, TreeRowData[]>()
  for (const key of keys) {
    const name = groupNameOf(key)
    let bucket = rows.get(name)
    if (bucket === undefined) {
      bucket = []
      rows.set(name, bucket)
      order.push(name)
    }
    bucket.push({ key, label: labelOf(key, name), value: valueOf(key), last: false })
  }
  return order.map((name) => {
    const bucket = rows.get(name) ?? []
    return {
      name,
      rows: bucket.map((row, index) => ({ ...row, last: index === bucket.length - 1 })),
    }
  })
}

/** Case-insensitive substring match on the whole path, the way `/` search reads. */
export function matchesFilter(key: string, filter: string): boolean {
  return key.toLowerCase().includes(filter.trim().toLowerCase())
}
