import { formatValue, parseDraft, swatchOf, toneOf } from '@/lib/values'
import { describe, expect, it } from 'vitest'

describe('formatValue', () => {
  it('prints a string as the user spelled it, unquoted', () => {
    expect(formatValue('top')).toBe('top')
    expect(formatValue('ctrl+b')).toBe('ctrl+b')
    // `normalizeChord('plus')` answers `+`, which `parseChord` cannot read back.
    expect(formatValue('plus')).toBe('plus')
  })

  it('quotes the empty string, which would otherwise print as nothing', () => {
    expect(formatValue('')).toBe('""')
  })

  it('calls an absent value unset', () => {
    expect(formatValue(undefined)).toBe('unset')
  })

  it('summarizes a list or a table as a count, never as its contents', () => {
    expect(formatValue([['a'], ['b']])).toBe('2')
    expect(formatValue({ claude: 1, codex: 2, gemini: 3 })).toBe('3')
  })

  it('prints numbers and booleans as themselves', () => {
    expect(formatValue(26)).toBe('26')
    expect(formatValue(false)).toBe('false')
  })
})

describe('toneOf', () => {
  it('colours by type, the way ADR-0002 asks', () => {
    expect(toneOf('ui.sidebar_width', 26)).toBe('text-yellow')
    expect(toneOf('theme.auto_switch', true)).toBe('text-green')
    expect(toneOf('theme.auto_switch', false)).toBe('text-red')
    expect(toneOf('theme.name', 'catppuccin')).toBe('text-green')
    expect(toneOf('keys.split_vertical', 'prefix+v')).toBe('text-yellow')
    // Documented as a plain string, but it holds a chord, so it reads as one.
    expect(toneOf('keys.prefix', 'ctrl+b')).toBe('text-yellow')
    expect(toneOf('keys.indexed.tabs', 'alt')).toBe('text-yellow')
    expect(toneOf('ui.sidebar.agents.rows', [[], []])).toBe('text-overlay0')
    expect(toneOf('ui.accent', undefined)).toBe('text-overlay0')
  })
})

describe('swatchOf', () => {
  it('offers a swatch only for a colour herdr would accept', () => {
    expect(swatchOf('ui.accent', 'cyan')).toBe('cyan')
    expect(swatchOf('ui.accent', '#89b4fa')).toBe('#89b4fa')
    expect(swatchOf('ui.accent', 'not-a-colour')).toBeNull()
    expect(swatchOf('theme.name', 'catppuccin')).toBeNull()
  })
})

describe('parseDraft', () => {
  it('holds an integer field back until it reads like an integer', () => {
    expect(parseDraft('integer', '42')).toBe(42)
    expect(parseDraft('integer', ' -7 ')).toBe(-7)
    expect(parseDraft('integer', '12x')).toBeUndefined()
    expect(parseDraft('integer', '')).toBeUndefined()
  })

  it('lets every other type through as a string, for validate() to judge', () => {
    expect(parseDraft('enum', 'bottom')).toBe('bottom')
    expect(parseDraft('color', 'nonsense')).toBe('nonsense')
    expect(parseDraft(undefined, 'anything')).toBe('anything')
  })
})
