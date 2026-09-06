import { describe, expect, it } from 'vitest'
import { parseToml } from '@/model/parse'
import {
  TomlFormatError,
  type TomlWritable,
  formatArray,
  formatArrayOfTables,
  formatBoolean,
  formatHeader,
  formatInlineTable,
  formatKeyValue,
  formatNumber,
  formatString,
  formatValue,
} from '@/model/toml-value'

/** Round-trip a formatted value through smol-toml to prove it is valid TOML. */
function reparse(rendered: string): unknown {
  return parseToml(`value = ${rendered}\n`).tree.value
}

describe('strings', () => {
  it('prefers basic strings and escapes what has to be escaped', () => {
    expect(formatString('catppuccin')).toBe('"catppuccin"')
    expect(formatString('say "hi"')).toBe('"say \\"hi\\""')
    expect(formatString('C:\\Users\\herdr')).toBe('"C:\\\\Users\\\\herdr"')
    expect(formatString('a\nb')).toBe('"a\\nb"')
    expect(formatString('a\tb\rc')).toBe('"a\\tb\\rc"')
    expect(formatString('\u0000')).toBe('"\\u0000"')
    expect(formatString('\u007f')).toBe('"\\u007f"')
    expect(formatString('')).toBe('""')
  })

  it('leaves printable non-ASCII alone', () => {
    expect(formatString('héllo \u{1f411}')).toBe('"héllo \u{1f411}"')
  })

  it('produces strings smol-toml reads back unchanged', () => {
    for (const value of ['say "hi"', 'C:\\Users\\herdr', 'a\nb\tc', '#89b4fa', '{hostname}']) {
      expect(reparse(formatString(value))).toBe(value)
    }
  })
})

describe('scalars', () => {
  it('renders booleans', () => {
    expect(formatBoolean(true)).toBe('true')
    expect(formatValue(false)).toBe('false')
  })

  it('renders integers as integers', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(26)).toBe('26')
    expect(formatNumber(-3)).toBe('-3')
    expect(formatNumber(10_000_000)).toBe('10000000')
    expect(formatNumber(9007199254740991n)).toBe('9007199254740991')
  })

  it('renders floats with a decimal point TOML accepts', () => {
    expect(formatNumber(1.5)).toBe('1.5')
    expect(formatNumber(1e21)).toBe('1e+21')
    expect(reparse(formatNumber(1.5))).toBe(1.5)
  })

  it('renders the TOML spellings of the special floats', () => {
    expect(formatNumber(Number.NaN)).toBe('nan')
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('inf')
    expect(formatNumber(Number.NEGATIVE_INFINITY)).toBe('-inf')
  })

  it('renders a date as an offset datetime', () => {
    expect(formatValue(new Date('2026-09-06T12:30:00Z'))).toBe('2026-09-06T12:30:00.000Z')
  })

  it('refuses values TOML cannot express', () => {
    expect(() => formatValue(undefined as unknown as TomlWritable)).toThrow(TomlFormatError)
    expect(() => formatValue(null as unknown as TomlWritable)).toThrow(TomlFormatError)
    expect(() => formatValue(new Date('nope'))).toThrow(TomlFormatError)
  })
})

describe('arrays', () => {
  it('stays on one line while it fits', () => {
    expect(formatArray([])).toBe('[]')
    expect(formatArray(['zoom', 'hostname'])).toBe('["zoom", "hostname"]')
    expect(formatArray([1, 2, 3])).toBe('[1, 2, 3]')
  })

  it('nests arrays inline, which is how a sidebar row set reads', () => {
    expect(formatArray([['state_icon', 'workspace'], ['branch', 'git_status']])).toBe(
      '[["state_icon", "workspace"], ["branch", "git_status"]]',
    )
  })

  it('wraps one element per line once it outgrows the budget', () => {
    const rows = [
      ['state_icon', 'workspace', 'tab'],
      ['terminal_title_stripped'],
      ['agent', '$model'],
    ]
    expect(formatArray(rows, { maxInlineWidth: 40 })).toBe(
      [
        '[',
        '  ["state_icon", "workspace", "tab"],',
        '  ["terminal_title_stripped"],',
        '  ["agent", "$model"],',
        ']',
      ].join('\n'),
    )
  })

  it('indents a wrapped array under the indent it was given', () => {
    expect(formatArray(['aaaa', 'bbbb'], { maxInlineWidth: 8, indent: '  ' })).toBe(
      ['[', '    "aaaa",', '    "bbbb",', '  ]'].join('\n'),
    )
  })

  it('produces arrays smol-toml reads back unchanged', () => {
    const rows = [['state_icon', 'workspace'], ['branch']]
    expect(reparse(formatArray(rows, { maxInlineWidth: 10 }))).toEqual(rows)
  })
})

describe('inline tables', () => {
  it('renders a styled sidebar token', () => {
    expect(formatInlineTable({ token: 'workspace', fg: '#89b4fa', bold: true })).toBe(
      '{ token = "workspace", fg = "#89b4fa", bold = true }',
    )
  })

  it('renders an empty table and never wraps', () => {
    expect(formatInlineTable({})).toBe('{}')
    const wide = { a: 'aaaaaaaaaa', b: 'bbbbbbbbbb', c: 'cccccccccc' }
    expect(formatInlineTable(wide, { maxInlineWidth: 10 })).not.toContain('\n')
  })

  it('quotes keys that need it', () => {
    expect(formatInlineTable({ 'my agent': 1 })).toBe('{ "my agent" = 1 }')
  })

  it('mixes into an array the way a styled row does', () => {
    const row = ['state_icon', { token: 'workspace', fg: '#89b4fa', bold: true }, 'tab']
    expect(formatValue(row)).toBe(
      '["state_icon", { token = "workspace", fg = "#89b4fa", bold = true }, "tab"]',
    )
    expect(reparse(formatValue(row))).toEqual(row)
  })
})

describe('key lines and headers', () => {
  it('renders a key line', () => {
    expect(formatKeyValue('sidebar_width', 26)).toBe('sidebar_width = 26')
    expect(formatKeyValue('my agent', true)).toBe('"my agent" = true')
    expect(formatKeyValue('rows', [['a']], { indent: '  ' })).toBe('  rows = [["a"]]')
  })

  it('charges the key against the wrapping budget', () => {
    // `rows = ` costs 7 of the budget, and `["aaaa", "bbbb"]` needs 16.
    expect(formatArray(['aaaa', 'bbbb'], { maxInlineWidth: 16 })).toBe('["aaaa", "bbbb"]')
    expect(formatKeyValue('rows', ['aaaa', 'bbbb'], { maxInlineWidth: 23 })).toBe(
      'rows = ["aaaa", "bbbb"]',
    )
    expect(formatKeyValue('rows', ['aaaa', 'bbbb'], { maxInlineWidth: 22 })).toBe(
      ['rows = [', '  "aaaa",', '  "bbbb",', ']'].join('\n'),
    )
  })

  it('renders table and array-of-tables headers', () => {
    expect(formatHeader('theme.custom')).toBe('[theme.custom]')
    expect(formatHeader('keys.command', true)).toBe('[[keys.command]]')
  })

  it('renders a whole array-of-tables section', () => {
    const rendered = formatArrayOfTables('keys.command', [
      { key: 'prefix+alt+g', type: 'popup', command: 'lazygit', width: '80%' },
      { key: 'prefix+alt+t', type: 'pane', command: 'btop' },
    ])
    expect(rendered).toBe(
      [
        '[[keys.command]]',
        'key = "prefix+alt+g"',
        'type = "popup"',
        'command = "lazygit"',
        'width = "80%"',
        '',
        '[[keys.command]]',
        'key = "prefix+alt+t"',
        'type = "pane"',
        'command = "btop"',
      ].join('\n'),
    )
    expect(parseToml(`${rendered}\n`).tree).toEqual({
      keys: {
        command: [
          { key: 'prefix+alt+g', type: 'popup', command: 'lazygit', width: '80%' },
          { key: 'prefix+alt+t', type: 'pane', command: 'btop' },
        ],
      },
    })
  })
})
