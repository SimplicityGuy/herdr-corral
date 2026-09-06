/**
 * Which scalar keys `Field` owns, and which belong to another bead's editor.
 *
 * `components/common/Field.tsx` renders every scalar type with a one-line
 * spelling, but three families are deliberately left alone: `keys.*` chords
 * (the keys editor's own chord recorder), the whole `theme` section plus
 * `ui.accent` (the theme editor's swatches and colour rows), and every
 * structured type — `array`, `list of token rows`, `table of token rows` —
 * whose value has no one-line spelling at all. `ownedElsewhere` is the one
 * predicate `SectionForm`, `register-scalar-editors.tsx`, and the coverage test
 * all read the split from, so it lives here rather than being decided three
 * different ways.
 *
 * The theme entry grew when the theme editor landed. `theme.custom.*` was
 * always its; `theme.name`, `theme.dark_name`, `theme.light_name`,
 * `theme.auto_switch` and `ui.accent` sat with `Field` until there was a
 * palette to put them in, and moved the day there was — a name means nothing
 * until you can see what it looks like. They are the whole of the `theme`
 * table, so the rule is the table rather than five exact paths, and the one
 * accent herdr keeps outside it.
 *
 * The tab bar is deliberately *not* here. `ui.tab_bar_right` is an `array` and
 * so is already structured, but the separator, the position and
 * `ui.hide_tab_bar_when_single_tab` are ordinary scalars: the status bar editor
 * claims them for its own popover through the registry, and draws them with
 * `Field` when it gets there, so `[6] all` keeps a real control for each.
 */
import { typeOf } from '@/schema'

const STRUCTURED_ELSEWHERE = new Set(['array', 'list of token rows', 'table of token rows'])

/** True when some other bead's editor claims this key, not `Field`. */
export function ownedElsewhere(key: string): boolean {
  if (key.startsWith('keys.')) return true
  if (key.startsWith('theme.')) return true
  if (key === 'ui.accent') return true
  const declared = typeOf(key)
  return declared !== undefined && STRUCTURED_ELSEWHERE.has(declared)
}
