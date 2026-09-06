import { describe, expect, it } from 'vitest'
import {
  MODIFIER_ORDER,
  NAVIGATE_RESERVED_CHORDS,
  formatChord,
  isIndexedChord,
  isUnmodifiedPrintable,
  navigateRejection,
  normalizeChord,
  parseBinding,
  parseChord,
  parseModifier,
  parseModifierCombo,
} from '@/model/keys'

/** Every chord that parses, printed back; `null` when herdr would reject it. */
function round(text: string): string | null {
  return normalizeChord(text)
}

describe('modifiers', () => {
  it("accepts herdr's spellings and folds the aliases", () => {
    expect(parseModifier('ctrl')).toBe('ctrl')
    expect(parseModifier('CONTROL')).toBe('ctrl')
    expect(parseModifier('option')).toBe('alt')
    expect(parseModifier('cmd')).toBe('super')
    expect(parseModifier('Command')).toBe('super')
    expect(parseModifier('hyper')).toBe('hyper')
    expect(parseModifier('windows')).toBeNull()
  })

  it('reads meta as alt, the way the chord parser does', () => {
    expect(round('meta+x')).toBe('alt+x')
    expect(round('cmd+k')).toBe('super+k')
  })

  it("prints modifiers in herdr's fixed order however they were written", () => {
    expect(MODIFIER_ORDER).toEqual(['ctrl', 'alt', 'shift', 'super', 'hyper'])
    expect(round('shift+alt+ctrl+x')).toBe('ctrl+alt+shift+x')
    expect(round('super+ctrl+x')).toBe('ctrl+super+x')
  })

  it('drops a repeated modifier', () => {
    expect(round('ctrl+ctrl+x')).toBe('ctrl+x')
  })

  it('reads a modifiers-only combo for the legacy indexed settings', () => {
    expect(parseModifierCombo('ctrl')).toEqual(['ctrl'])
    expect(parseModifierCombo('shift+ctrl')).toEqual(['ctrl', 'shift'])
    expect(parseModifierCombo('')).toBeNull()
    expect(parseModifierCombo('ctrl+1')).toBeNull()
  })
})

describe('keys', () => {
  it('accepts the named keys', () => {
    expect(round('enter')).toBe('enter')
    expect(round('return')).toBe('enter')
    expect(round('escape')).toBe('esc')
    expect(round('BS')).toBe('backspace')
    expect(round('space')).toBe('space')
    expect(round('Up')).toBe('up')
  })

  it('resolves named punctuation to the character it produces', () => {
    expect(round('minus')).toBe('-')
    expect(round('prefix+minus')).toBe('prefix+-')
    expect(round('comma')).toBe(',')
    expect(round('double_quote')).toBe('"')
    expect(round('double-quote')).toBe('"')
    expect(round('backtick')).toBe('`')
    expect(round('plus')).toBe('+')
    expect(round('shift+ampersand')).toBe('shift+&')
  })

  it('reads function keys and normalizes their number', () => {
    expect(round('f1')).toBe('f1')
    expect(round('F12')).toBe('f12')
    expect(round('f05')).toBe('f5')
    expect(round('f255')).toBe('f255')
    expect(round('f256')).toBeNull()
    expect(round('f')).toBe('f')
    expect(round('f+1')).toBeNull()
  })

  it('turns an uppercase letter into shift plus the lowercase one', () => {
    expect(round('A')).toBe('shift+a')
    expect(round('ctrl+A')).toBe('ctrl+shift+a')
    expect(round('a')).toBe('a')
  })

  it('leaves a non-ASCII character alone', () => {
    expect(round('é')).toBe('é')
    expect(round('É')).toBe('É')
  })

  it('folds shift+tab into its own key code and prints it back', () => {
    expect(round('shift+tab')).toBe('shift+tab')
    expect(round('tab')).toBe('tab')
    expect(round('ctrl+shift+tab')).toBe('ctrl+shift+tab')
    expect(parseChord('shift+tab')).toEqual({ prefix: false, modifiers: [], key: 'backtab' })
    expect(parseChord('ctrl+shift+tab')).toEqual({
      prefix: false,
      modifiers: ['ctrl'],
      key: 'backtab',
    })
  })
})

describe('printing back what was parsed', () => {
  it('round-trips every chord except the one whose key is the separator', () => {
    const spellings = [
      'ctrl+b',
      'prefix+shift+n',
      'shift+tab',
      'f12',
      'space',
      'minus',
      'backtick',
      'A',
      'prefix+alt+1',
    ]
    const printed = spellings.map((text) => normalizeChord(text) as string)
    expect(printed.map((text) => normalizeChord(text))).toEqual(printed)
  })

  it('prints the plus key as a label herdr cannot read back either', () => {
    expect(round('plus')).toBe('+')
    expect(parseChord('+')).toBeNull()
    expect(round('shift+plus')).toBe('shift++')
    expect(parseChord('shift++')).toBeNull()
  })

  it('always writes super, never the cmd herdr shows on macOS', () => {
    expect(round('cmd+k')).toBe('super+k')
    expect(round('command+k')).toBe('super+k')
    expect(round('super+k')).toBe('super+k')
  })
})

describe('the prefix marker', () => {
  it('marks a chord as prefix mode and prints it back', () => {
    expect(parseChord('prefix+shift+n')).toEqual({
      prefix: true,
      modifiers: ['shift'],
      key: 'n',
    })
    expect(round('prefix+shift+n')).toBe('prefix+shift+n')
  })

  it('is case-sensitive, so a capitalized marker is not one', () => {
    expect(round('Prefix+n')).toBeNull()
  })

  it('separates the prefix and direct namespaces', () => {
    expect(formatChord({ prefix: true, modifiers: [], key: 'x' })).toBe('prefix+x')
    expect(formatChord({ prefix: false, modifiers: [], key: 'x' })).toBe('x')
  })
})

describe('chords herdr rejects', () => {
  it('rejects an empty part, an empty string and a second key', () => {
    expect(round('')).toBeNull()
    expect(round('+')).toBeNull()
    expect(round('ctrl+')).toBeNull()
    expect(round('a+b')).toBeNull()
    expect(round('ctrl')).toBeNull()
  })

  it('rejects a multi-character name that is not a key', () => {
    expect(round('pgup')).toBeNull()
    expect(round('delete')).toBeNull()
  })

  it('does not answer a modifier or a key name out of Object.prototype', () => {
    // `herdr config check` calls all of these `invalid keybinding`; a lookup
    // table with a prototype would have turned the first two into a bare `x`.
    for (const inherited of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(parseModifier(inherited)).toBeNull()
      expect(round(`${inherited}+x`)).toBeNull()
      expect(round(inherited)).toBeNull()
      expect(parseModifierCombo(inherited)).toBeNull()
    }
  })

  it('tolerates whitespace around the parts, as herdr trims each one', () => {
    expect(round('  ctrl + b  ')).toBe('ctrl+b')
    expect(round('prefix+ shift + n')).toBe('prefix+shift+n')
  })
})

describe('1..9 ranges', () => {
  it('expands to the nine digits, carrying the modifiers and the prefix', () => {
    const binding = parseBinding('prefix+alt+1..9')
    expect(binding?.kind).toBe('range')
    if (binding?.kind !== 'range') return
    expect(binding.chords).toHaveLength(9)
    expect(binding.chords.map(formatChord)).toEqual([
      'prefix+alt+1',
      'prefix+alt+2',
      'prefix+alt+3',
      'prefix+alt+4',
      'prefix+alt+5',
      'prefix+alt+6',
      'prefix+alt+7',
      'prefix+alt+8',
      'prefix+alt+9',
    ])
  })

  it('allows a range with no modifiers at all', () => {
    const binding = parseBinding('1..9')
    expect(binding?.kind).toBe('range')
  })

  it('is tried before the chord form, so a range is never a chord', () => {
    expect(round('alt+1..9')).toBeNull()
    expect(parseBinding('alt+1..9')?.kind).toBe('range')
  })

  it('rejects two ranges in one binding', () => {
    expect(parseBinding('1..9+1..9')).toBeNull()
  })

  it('reads a plain chord as a chord', () => {
    const binding = parseBinding('prefix+c')
    expect(binding).toEqual({ kind: 'chord', chord: { prefix: true, modifiers: [], key: 'c' } })
  })
})

describe('chord predicates', () => {
  it('spots the digits an indexed action must bind', () => {
    expect(isIndexedChord({ prefix: true, modifiers: [], key: '1' })).toBe(true)
    expect(isIndexedChord({ prefix: true, modifiers: [], key: '9' })).toBe(true)
    expect(isIndexedChord({ prefix: true, modifiers: [], key: '0' })).toBe(false)
    expect(isIndexedChord({ prefix: true, modifiers: [], key: 'a' })).toBe(false)
  })

  it('spots a direct binding that would swallow typing', () => {
    expect(isUnmodifiedPrintable({ prefix: false, modifiers: [], key: 'a' })).toBe(true)
    expect(isUnmodifiedPrintable({ prefix: false, modifiers: ['shift'], key: 'a' })).toBe(true)
    expect(isUnmodifiedPrintable({ prefix: false, modifiers: [], key: 'space' })).toBe(true)
    expect(isUnmodifiedPrintable({ prefix: false, modifiers: ['ctrl'], key: 'a' })).toBe(false)
    expect(isUnmodifiedPrintable({ prefix: false, modifiers: [], key: 'enter' })).toBe(false)
    expect(isUnmodifiedPrintable({ prefix: false, modifiers: [], key: 'f5' })).toBe(false)
  })
})

describe('navigate mode', () => {
  it('accepts the movement keys herdr ships as defaults', () => {
    for (const key of ['h', 'j', 'k', 'l', 'up', 'down']) {
      expect(navigateRejection(parseChord(key)!)).toBeNull()
    }
  })

  it('refuses a prefix-mode binding', () => {
    expect(navigateRejection(parseChord('prefix+h')!)).toMatch(/must not include prefix/)
  })

  it('refuses esc whatever it is modified with', () => {
    expect(navigateRejection(parseChord('esc')!)).toMatch(/cannot use esc/)
    expect(navigateRejection(parseChord('ctrl+esc')!)).toMatch(/cannot use esc/)
  })

  it('refuses the keys navigate mode drives itself', () => {
    for (const key of ['enter', 'tab', 'shift+tab', 'left', 'right', '1', '5', '9']) {
      expect(navigateRejection(parseChord(key)!)).toMatch(/reserves/)
    }
    expect(NAVIGATE_RESERVED_CHORDS).toContain('shift+tab')
  })

  it('leaves a modified version of a reserved key alone', () => {
    expect(navigateRejection(parseChord('ctrl+enter')!)).toBeNull()
    expect(navigateRejection(parseChord('alt+1')!)).toBeNull()
  })
})
