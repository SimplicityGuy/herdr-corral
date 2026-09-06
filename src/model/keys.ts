/**
 * herdr's chord grammar: parse a binding string, normalize it, print it back.
 *
 * Every rule here is a transcription of herdr 0.8.2's own parser, so corral
 * accepts exactly what herdr accepts and prints exactly what herdr prints. The
 * source is `github.com/herdrdev/herdr` at tag `v0.8.2`; each non-obvious rule
 * carries the file and line it came from.
 *
 * The shape of a binding, from `parse_binding_string` (src/config/keybinds.rs:1062):
 *
 *     binding := "prefix+"? ( range | chord )
 *     range   := ( modifier "+" )* "1..9" ( "+" modifier )*     -- indexed actions only
 *     chord   := ( modifier "+" )* key
 *
 * A *chord* is `(key code, modifier set)` in herdr, and two bindings collide when
 * those two parts match after normalization — which is why `formatChord` is also
 * the identity used for duplicate detection. `prefix+x` and a direct `x` live in
 * separate namespaces (src/config/keybinds.rs:386-437), so the printed label,
 * which carries the `prefix+`, is the right key for both.
 */

/**
 * A modifier bit a chord can carry.
 *
 * herdr's parser reaches five of crossterm's bits: `meta` is an alias for `alt`
 * and `cmd`/`command` are aliases for `super` (src/config/keybinds.rs:1169-1178).
 * `ui.right_click_passthrough_modifier` uses a *different* table where `meta` is
 * its own bit (src/config/model.rs:179-205); that setting is not a chord and is
 * validated separately.
 */
export type Modifier = 'ctrl' | 'alt' | 'shift' | 'super' | 'hyper'

/**
 * Modifier order in a printed chord.
 *
 * `format_key_combo` pushes ctrl, alt, shift, super, hyper, meta in that fixed
 * order (src/config/keybinds.rs:1114-1131), so normalization is a sort into it.
 */
export const MODIFIER_ORDER: readonly Modifier[] = ['ctrl', 'alt', 'shift', 'super', 'hyper']

/**
 * One normalized chord.
 *
 * `key` is herdr's own printed key name: a named key (`enter`, `esc`, `tab`,
 * `backtab`, `backspace`, `left`, `right`, `up`, `down`, `space`), a function key
 * (`f0`…`f255`), or the single character the key produces (`a`, `-`, `?`).
 */
export interface Chord {
  /** True when the binding is written `prefix+…` and fires only in prefix mode. */
  readonly prefix: boolean
  /** Modifier bits, deduplicated and sorted into `MODIFIER_ORDER`. */
  readonly modifiers: readonly Modifier[]
  /** The normalized key name. */
  readonly key: string
}

/** A parsed binding: one chord, or the nine chords a `1..9` range expands to. */
export type Binding =
  | { readonly kind: 'chord'; readonly chord: Chord }
  | { readonly kind: 'range'; readonly chords: readonly Chord[] }

/**
 * Modifier aliases herdr accepts, from `parse_modifier_token`
 * (src/config/keybinds.rs:1169-1178). Matching is case-insensitive.
 */
const MODIFIER_TOKENS: Readonly<Record<string, Modifier>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  meta: 'alt',
  cmd: 'super',
  command: 'super',
  super: 'super',
  hyper: 'hyper',
}

/**
 * Named keys, from the match in `parse_key_combo`
 * (src/config/keybinds.rs:1241-1279). The named punctuation entries resolve to
 * the character they produce, because `format_key_combo` prints a `Char` as
 * itself — so `minus` normalizes to `-` and never back to `minus`.
 */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  space: 'space',
  ' ': 'space',
  enter: 'enter',
  return: 'enter',
  esc: 'esc',
  escape: 'esc',
  tab: 'tab',
  backspace: 'backspace',
  bs: 'backspace',
  left: 'left',
  right: 'right',
  up: 'up',
  down: 'down',
  minus: '-',
  comma: ',',
  period: '.',
  slash: '/',
  backslash: '\\',
  quote: "'",
  double_quote: '"',
  'double-quote': '"',
  semicolon: ';',
  colon: ':',
  percent: '%',
  ampersand: '&',
  backtick: '`',
  plus: '+',
}

/** The prefix marker a binding string carries. Case-sensitive, as in herdr. */
const PREFIX_MARKER = 'prefix+'

/** The literal a range binding spells for "the digits 1 through 9". */
const RANGE_TOKEN = '1..9'

function sortModifiers(modifiers: Iterable<Modifier>): Modifier[] {
  const present = new Set(modifiers)
  return MODIFIER_ORDER.filter((modifier) => present.has(modifier))
}

/** Read one modifier token. Returns `null` when the token names something else. */
export function parseModifier(token: string): Modifier | null {
  return MODIFIER_TOKENS[token.trim().toLowerCase()] ?? null
}

/**
 * Read a modifiers-only combo such as `ctrl+shift`.
 *
 * This is the grammar of the legacy `[keys.indexed]` settings, which name the
 * modifiers that `1`…`9` are held with rather than a whole chord
 * (`parse_modifier_combo`, src/config/keybinds.rs:1197-1217). An empty result is
 * rejected, so `""` is not a valid combo — herdr skips empty values before it
 * gets here (src/config/keybinds.rs:944-946).
 */
export function parseModifierCombo(text: string): Modifier[] | null {
  const found: Modifier[] = []
  for (const part of text.split('+')) {
    const modifier = parseModifier(part)
    if (modifier === null) return null
    found.push(modifier)
  }
  const sorted = sortModifiers(found)
  return sorted.length === 0 ? null : sorted
}

/** The single character `text` spells, or `null` when it is not one character. */
function singleKeyChar(text: string): string | null {
  const characters = Array.from(text)
  return characters.length === 1 ? characters[0] : null
}

function isAsciiUppercase(character: string): boolean {
  return character >= 'A' && character <= 'Z'
}

/**
 * Parse a function-key name, mirroring `s[1..].parse::<u8>()`
 * (src/config/keybinds.rs:1277). Only ASCII digits, and only 0-255 — which is
 * why `f05` is accepted and normalizes to `f5`, while `f256` and `f+1` are not.
 */
function parseFunctionKey(lower: string): string | null {
  if (!lower.startsWith('f')) return null
  const digits = lower.slice(1)
  if (digits.length === 0 || !/^\d+$/.test(digits)) return null
  const number = Number.parseInt(digits, 10)
  return number <= 255 ? `f${number}` : null
}

/**
 * Parse the chord body — everything after an optional `prefix+`.
 *
 * Mirrors `parse_key_combo` (src/config/keybinds.rs:1219-1282): split on `+`,
 * trim each part, take every part that names a modifier, and take exactly one
 * part as the key. An empty part, or a second non-modifier part, is a failure.
 */
function parseChordBody(text: string): Omit<Chord, 'prefix'> | null {
  const modifiers = new Set<Modifier>()
  let keyText: string | null = null
  for (const part of text.split('+')) {
    const trimmed = part.trim()
    if (trimmed === '') return null
    const modifier = parseModifier(trimmed)
    if (modifier !== null) {
      modifiers.add(modifier)
      continue
    }
    if (keyText !== null) return null
    keyText = trimmed
  }
  if (keyText === null) return null

  const lower = keyText.toLowerCase()
  let key: string

  // `shift+tab` is its own key code, and normalization drops the shift bit so
  // that `shift+tab` and a bare BackTab compare equal
  // (`normalize_key_combo`, src/config/keybinds.rs:1309-1317).
  if (lower === 'tab' && modifiers.has('shift')) {
    modifiers.delete('shift')
    key = 'backtab'
  } else if (lower in NAMED_KEYS) {
    key = NAMED_KEYS[lower]
  } else {
    // The single-character arm is reached before the function-key arm, so a bare
    // `f` is the letter f and only `f1`, `f12`, … are function keys.
    const character = singleKeyChar(keyText)
    if (character !== null) {
      if (isAsciiUppercase(character)) {
        modifiers.add('shift')
        key = character.toLowerCase()
      } else {
        key = character
      }
    } else {
      const functionKey = parseFunctionKey(lower)
      if (functionKey === null) return null
      key = functionKey
    }
  }

  return { modifiers: sortModifiers(modifiers), key }
}

/**
 * Parse one chord, with or without a leading `prefix+`.
 *
 * Returns `null` for anything herdr's parser rejects — which is also everything
 * herdr reports as `invalid keybinding: <field> = <value>; disabling binding`
 * (src/config/keybinds.rs:825).
 */
export function parseChord(text: string): Chord | null {
  const trimmed = text.trim()
  const prefix = trimmed.startsWith(PREFIX_MARKER)
  const body = parseChordBody(prefix ? trimmed.slice(PREFIX_MARKER.length) : trimmed)
  return body === null ? null : { prefix, ...body }
}

/**
 * Print a chord the way herdr prints it (`format_key_combo`,
 * src/config/keybinds.rs:1111-1159).
 *
 * BackTab is the one code that spells its own shift: it renders as `shift+tab`
 * after the other modifiers rather than taking a `shift` part of its own.
 */
export function formatChord(chord: Chord): string {
  const parts = chord.modifiers.filter(
    (modifier) => !(chord.key === 'backtab' && modifier === 'shift'),
  )
  const key = chord.key === 'backtab' ? 'shift+tab' : chord.key
  const label = [...parts, key].join('+')
  return chord.prefix ? `${PREFIX_MARKER}${label}` : label
}

/** Parse and re-print a binding string, or `null` when it is not a valid chord. */
export function normalizeChord(text: string): string | null {
  const chord = parseChord(text)
  return chord === null ? null : formatChord(chord)
}

/**
 * Parse the modifiers of a `1..9` range, or `null` when `text` is not a range.
 *
 * Mirrors `parse_range_modifiers` (src/config/keybinds.rs:1180-1195): exactly one
 * part is the literal `1..9` and every other part must be a modifier. A range
 * with no modifiers at all is legal.
 */
function parseRangeModifiers(text: string): Modifier[] | null {
  const modifiers = new Set<Modifier>()
  let sawRange = false
  for (const part of text.split('+')) {
    const trimmed = part.trim()
    if (trimmed === RANGE_TOKEN) {
      if (sawRange) return null
      sawRange = true
      continue
    }
    const modifier = parseModifier(trimmed)
    if (modifier === null) return null
    modifiers.add(modifier)
  }
  return sawRange ? sortModifiers(modifiers) : null
}

/**
 * Parse a binding string into the chord — or the nine chords — it names.
 *
 * `parse_binding_string` tries the range form first, so `prefix+alt+1..9` is nine
 * bindings and never a chord (src/config/keybinds.rs:1062-1109).
 */
export function parseBinding(text: string): Binding | null {
  const trimmed = text.trim()
  const prefix = trimmed.startsWith(PREFIX_MARKER)
  const body = prefix ? trimmed.slice(PREFIX_MARKER.length) : trimmed

  const rangeModifiers = parseRangeModifiers(body)
  if (rangeModifiers !== null) {
    const chords = Array.from({ length: 9 }, (_unused, index) => ({
      prefix,
      modifiers: rangeModifiers,
      key: String(index + 1),
    }))
    return { kind: 'range', chords }
  }

  const chord = parseChord(trimmed)
  return chord === null ? null : { kind: 'chord', chord }
}

/** True when the chord's key is one of the digits an indexed action can use. */
export function isIndexedChord(chord: Chord): boolean {
  return chord.key.length === 1 && chord.key >= '1' && chord.key <= '9'
}

/**
 * True when a *direct* binding on this chord would swallow ordinary typing.
 *
 * herdr refuses such bindings and suggests the `prefix+` form
 * (`is_unmodified_printable`, src/config/keybinds.rs:1472-1475): a printable
 * character carrying no modifier other than shift. Navigate-mode bindings are
 * exempt, which is how `h`/`j`/`k`/`l` can be their defaults.
 */
export function isUnmodifiedPrintable(chord: Chord): boolean {
  const printable = chord.key === 'space' || Array.from(chord.key).length === 1
  return printable && chord.modifiers.every((modifier) => modifier === 'shift')
}

/**
 * Chords navigate mode reserves for its own runtime handling.
 *
 * From `reserve_navigate_runtime_keys` (src/config/keybinds.rs:717-737), as
 * printed labels: a navigate binding on any of these is dropped with a
 * `kept navigate reserved keys, disabled <field>` diagnostic. herdr's default
 * config says the same thing in prose above the `navigate_*` block
 * ("Do not include prefix+, esc, enter, tab, or 1..9 here").
 */
export const NAVIGATE_RESERVED_CHORDS: readonly string[] = [
  'esc',
  'enter',
  'tab',
  'shift+tab',
  'left',
  'right',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
]

/**
 * Why navigate mode refuses this chord, or `null` when it accepts it.
 *
 * The prefix and `esc` rejections are explicit
 * (`reject_navigate_binding`, src/config/keybinds.rs:983-1001); the rest fall out
 * of the reserved-key registry. `esc` is checked on the key code alone, so
 * `ctrl+esc` is refused too.
 */
export function navigateRejection(chord: Chord): string | null {
  if (chord.prefix) return 'navigate keybindings must not include prefix+'
  if (chord.key === 'esc') return 'navigate keybindings cannot use esc'
  if (NAVIGATE_RESERVED_CHORDS.includes(formatChord(chord))) {
    return `navigate mode reserves ${formatChord(chord)} for its own movement`
  }
  return null
}
