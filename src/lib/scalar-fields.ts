/**
 * Which scalar keys `Field` owns, and which belong to another bead's editor.
 *
 * `components/common/Field.tsx` renders every scalar type with a one-line
 * spelling, but three families are deliberately left alone: `keys.*` chords
 * (the keys bead's own chord recorder), `theme.custom.*` tokens (the theme bead
 * reuses `ColorField` for those itself), and every structured type — `array`,
 * `list of token rows`, `table of token rows` — whose value has no one-line
 * spelling at all. `ownedElsewhere` is the one predicate `SectionForm`,
 * `register-scalar-editors.tsx`, and the coverage test all read the split
 * from, so it lives here rather than being decided three different ways.
 */
import { typeOf } from '@/schema'

const STRUCTURED_ELSEWHERE = new Set(['array', 'list of token rows', 'table of token rows'])

/** True when some other bead's editor claims this key, not `Field`. */
export function ownedElsewhere(key: string): boolean {
  if (key.startsWith('keys.')) return true
  if (key.startsWith('theme.custom.')) return true
  const declared = typeOf(key)
  return declared !== undefined && STRUCTURED_ELSEWHERE.has(declared)
}
