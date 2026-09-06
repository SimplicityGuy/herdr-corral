/**
 * Turning a browser keydown into the chord string herdr's config spells.
 *
 * `src/model/keys.ts` owns the grammar — what herdr accepts and how it prints.
 * This owns the one translation that grammar cannot do for itself: a
 * `KeyboardEvent` is a physical press, and a config file is a spelling. The two
 * disagree in three places, and every rule here is one of them.
 *
 * **Shift is sometimes a modifier and sometimes the character.** `shift+p`
 * arrives as `key: 'P'` and is spelled `shift+p`, because herdr's own parser
 * reads `P` as exactly that (`parse_key_combo`, src/config/keybinds.rs:1263-1268).
 * `shift+/` arrives as `key: '?'` and is spelled `?`, with no shift part at all —
 * which is how herdr's default config spells `prefix+?`. The rule that separates
 * them: shift is spelled when the character it produced is a letter or a digit,
 * and is otherwise the thing that produced the character.
 *
 * **`+` is the separator.** A press of the plus key is spelled `plus`, never
 * `+` — `parseChord('+')` is `null`, exactly as herdr's parser rejects it. This
 * is the writing half of the round-trip hole `keys.ts` documents: corral writes
 * the spelling that reads back, and never the normalized label.
 *
 * **Not every key has a name.** herdr names ten keys, the function keys, and the
 * character a key produces; `CapsLock`, `ContextMenu` and a dead key have no
 * spelling, so a press of one is not a chord and the recorder keeps waiting
 * rather than writing something herdr would refuse.
 *
 * Kept out of the component so it can be tested as the pure function it is: a
 * description of a press in, a string or `null` out, no DOM anywhere.
 */
import { MODIFIER_ORDER, type Modifier, parseChord } from '@/model/keys'

/** The parts of a `KeyboardEvent` a chord is made of. */
export interface KeyPress {
  /** `KeyboardEvent.key`. */
  readonly key: string
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly metaKey: boolean
}

/**
 * Browser key names that map onto one of herdr's named keys.
 *
 * herdr's list is in `NAMED_KEYS` (src/model/keys.ts); this is the subset the
 * DOM spells differently, plus the space bar, whose `key` is a literal space.
 * A `Map` because the lookup key comes from an event rather than from code.
 */
const NAMED_EVENT_KEYS: ReadonlyMap<string, string> = new Map([
  [' ', 'space'],
  ['spacebar', 'space'],
  ['enter', 'enter'],
  ['escape', 'esc'],
  ['esc', 'esc'],
  ['tab', 'tab'],
  ['backspace', 'backspace'],
  ['arrowleft', 'left'],
  ['arrowright', 'right'],
  ['arrowup', 'up'],
  ['arrowdown', 'down'],
])

/**
 * Keys that are held rather than pressed, and keys herdr cannot spell.
 *
 * A recorder that treated `Shift` as a chord would capture the modifier the user
 * is still reaching across, so these are skipped and the capture keeps waiting.
 */
const NOT_A_CHORD: ReadonlySet<string> = new Set([
  'control',
  'shift',
  'alt',
  'altgraph',
  'meta',
  'os',
  'super',
  'hyper',
  'fn',
  'fnlock',
  'capslock',
  'numlock',
  'scrolllock',
  'contextmenu',
  'dead',
  'unidentified',
  'process',
  'compose',
])

/** `f1` … `f24`, which is every function key a keyboard actually has. */
const FUNCTION_KEY = /^f([1-9]|1\d|2[0-4])$/

function isAsciiLetterOrDigit(character: string): boolean {
  return /^[A-Za-z0-9]$/.test(character)
}

/** How one press spells its key, and whether shift was spent producing it. */
interface CapturedKey {
  readonly token: string
  /** True when shift made this character and so must not be spelled as well. */
  readonly consumesShift: boolean
}

function keyOf(press: KeyPress): CapturedKey | null {
  const lower = press.key.toLowerCase()
  if (NOT_A_CHORD.has(lower)) return null

  const named = NAMED_EVENT_KEYS.get(lower)
  if (named !== undefined) return { token: named, consumesShift: false }
  if (FUNCTION_KEY.test(lower)) return { token: lower, consumesShift: false }

  const characters = Array.from(press.key)
  if (characters.length !== 1) return null
  const character = characters[0]

  // The separator has a name, and only a name — see the module docstring.
  if (character === '+') return { token: 'plus', consumesShift: true }
  if (isAsciiLetterOrDigit(character)) {
    return { token: character.toLowerCase(), consumesShift: false }
  }
  return { token: character, consumesShift: true }
}

function modifiersOf(press: KeyPress, consumesShift: boolean): Modifier[] {
  const held = new Set<Modifier>()
  if (press.ctrlKey) held.add('ctrl')
  if (press.altKey) held.add('alt')
  if (press.shiftKey && !consumesShift) held.add('shift')
  // corral always writes `super`, never the `cmd` herdr's own printer uses on
  // macOS — see `formatChord` in src/model/keys.ts.
  if (press.metaKey) held.add('super')
  return MODIFIER_ORDER.filter((modifier) => held.has(modifier))
}

/**
 * The chord string this press spells, or `null` when it does not spell one.
 *
 * `prefix` is the recorder's own toggle rather than anything the press carries:
 * a browser cannot observe herdr's prefix mode, so the marker is a decision the
 * user makes and not one a recording can infer.
 *
 * The result is checked against `parseChord` before it is returned, so a string
 * this function hands back is one herdr's own parser reads.
 */
export function chordFromPress(press: KeyPress, prefix = false): string | null {
  const captured = keyOf(press)
  if (captured === null) return null
  const parts = [...modifiersOf(press, captured.consumesShift), captured.token]
  const text = `${prefix ? 'prefix+' : ''}${parts.join('+')}`
  return parseChord(text) === null ? null : text
}

/** True when this press is the `esc` that cancels a recording. */
export function cancelsRecording(press: KeyPress): boolean {
  const lower = press.key.toLowerCase()
  if (lower !== 'escape' && lower !== 'esc') return false
  return !press.ctrlKey && !press.altKey && !press.metaKey && !press.shiftKey
}

/** The `prefix+` marker, which both the toggle and the recorder write. */
export const PREFIX_MARKER = 'prefix+'

/** The same chord with or without its `prefix+` marker. */
export function withPrefix(text: string, prefix: boolean): string {
  const bare = text.startsWith(PREFIX_MARKER) ? text.slice(PREFIX_MARKER.length) : text
  if (!prefix) return bare
  return bare === '' ? '' : `${PREFIX_MARKER}${bare}`
}

/** True when this chord string is written in prefix mode. */
export function hasPrefix(text: string): boolean {
  return text.startsWith(PREFIX_MARKER)
}
