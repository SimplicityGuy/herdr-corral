import { describe, expect, it } from 'vitest'
import type { TomlValue } from '@/model/parse'
import { parseToml } from '@/model/parse'
import {
  canonicalThemeName,
  hasErrors,
  isColor,
  isHexColor,
  isKnownKey,
  suggestKey,
  unknownKeysIn,
  validate,
} from '@/model/validate'
import type { Diagnostic } from '@/model/validate'
import { allEntries, sidebarTokenBuiltins, themeNames } from '@/schema'
import herdrCheckConfig from '@/test/fixture-herdr-check.toml?raw'
import herdrCheckOutput from '@/test/fixture-herdr-check.txt?raw'

/**
 * An effective config: every documented default, with the overrides layered on.
 *
 * This is the shape the store hands `validate` — one flat map from dotted path
 * to value, with whole-value leaves for the token rows and the two lists.
 */
function config(overrides: Readonly<Record<string, TomlValue>> = {}): Map<string, TomlValue> {
  const effective = new Map<string, TomlValue>()
  for (const entry of allEntries()) {
    if (entry.default !== null) effective.set(entry.key, entry.default as TomlValue)
  }
  for (const [path, value] of Object.entries(overrides)) effective.set(path, value)
  return effective
}

function at(diagnostics: readonly Diagnostic[], path: string): Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.path === path)
}

function messagesAt(diagnostics: readonly Diagnostic[], path: string): string[] {
  return at(diagnostics, path).map((diagnostic) => diagnostic.message)
}

describe('a config that is already right', () => {
  it("finds nothing wrong with herdr's own documented defaults", () => {
    expect(validate(config())).toEqual([])
  })

  it('returns diagnostics sorted by path', () => {
    const diagnostics = validate(
      config({ 'ui.accent': 'octarine', 'advanced.scrollback_limit_bytes': 'lots' }),
    )
    const paths = diagnostics.map((diagnostic) => diagnostic.path)
    expect(paths).toEqual([...paths].sort())
  })
})

describe('declared types', () => {
  it('accepts the type the schema declares', () => {
    expect(
      validate(
        config({
          'ui.mouse_capture': false,
          'ui.sidebar_width': 30,
          'terminal.default_shell': 'nu',
          'ui.tab_bar_position': 'bottom',
        }),
      ),
    ).toEqual([])
  })

  it('rejects a value of the wrong type as an error, because herdr would drop the file', () => {
    const diagnostics = validate(
      config({
        'ui.mouse_capture': 'yes',
        'ui.sidebar_width': 'wide',
        'terminal.default_shell': 3,
        'experimental.cjk_ime_agents': 'claude',
      }),
    )
    expect(messagesAt(diagnostics, 'ui.mouse_capture')).toEqual(['expected a boolean, got a string'])
    expect(messagesAt(diagnostics, 'ui.sidebar_width')).toEqual([
      'expected an integer, got a string',
    ])
    expect(messagesAt(diagnostics, 'terminal.default_shell')).toEqual([
      'expected a string, got an integer',
    ])
    expect(messagesAt(diagnostics, 'experimental.cjk_ime_agents')).toEqual([
      'expected a list of strings, got a string',
    ])
    expect(hasErrors(diagnostics)).toBe(true)
  })

  it('rejects a float where herdr wants an integer', () => {
    expect(messagesAt(validate(config({ 'ui.sidebar_width': 26.5 })), 'ui.sidebar_width')).toEqual([
      'expected an integer, got a float',
    ])
  })

  it('checks the elements of a list of strings', () => {
    expect(
      messagesAt(
        validate(config({ 'experimental.cjk_ime_agents': ['claude', 7] })),
        'experimental.cjk_ime_agents[1]',
      ),
    ).toEqual(['expected a string, got an integer'])
  })
})

describe('enums', () => {
  it('accepts a documented option', () => {
    expect(validate(config({ 'ui.status_indicators': 'symbols' }))).toEqual([])
  })

  it('names the options when the value is not one of them', () => {
    const diagnostics = validate(config({ 'ui.status_indicators': 'blobs' }))
    expect(at(diagnostics, 'ui.status_indicators')[0]).toEqual({
      severity: 'error',
      path: 'ui.status_indicators',
      message: 'unknown value "blobs"; expected one of dots, symbols',
    })
  })

  it('lets terminal.new_cwd hold a path, which is its documented escape hatch', () => {
    expect(validate(config({ 'terminal.new_cwd': '~/Projects' }))).toEqual([])
    expect(validate(config({ 'terminal.new_cwd': 'home' }))).toEqual([])
    expect(messagesAt(validate(config({ 'terminal.new_cwd': 3 })), 'terminal.new_cwd')).toEqual([
      'expected a string, got an integer',
    ])
  })
})

describe('integer ranges', () => {
  it('accepts a value inside the documented bound', () => {
    expect(validate(config({ 'ui.toast.delay_seconds': 3600 }))).toEqual([])
    expect(validate(config({ 'ui.sidebar_max_width': 65_535 }))).toEqual([])
  })

  it('rejects a negative integer', () => {
    expect(
      messagesAt(validate(config({ 'ui.mouse_scroll_lines': -1 })), 'ui.mouse_scroll_lines'),
    ).toEqual(['expected a non-negative integer, got -1'])
  })

  it('rejects a u16 field above 65535', () => {
    expect(messagesAt(validate(config({ 'ui.sidebar_width': 70_000 })), 'ui.sidebar_width')).toEqual(
      ['must be between 0 and 65535, got 70000'],
    )
  })

  it('rejects a toast delay over the one-hour cap', () => {
    const diagnostics = validate(config({ 'ui.toast.delay_seconds': 3601 }))
    expect(at(diagnostics, 'ui.toast.delay_seconds')[0]).toEqual({
      severity: 'error',
      path: 'ui.toast.delay_seconds',
      message: 'must be between 0 and 3600, got 3601',
    })
  })

  it('leaves an unbounded integer alone', () => {
    expect(validate(config({ 'advanced.scrollback_limit_bytes': 500_000_000 }))).toEqual([])
  })
})

describe('colors', () => {
  it('accepts every syntax parse_color understands', () => {
    const accepted = [
      '#abc',
      '#AABBCC',
      'rgb(255, 85, 85)',
      'rgb(0,0,0)',
      'cyan',
      'purple',
      'darkgrey',
      'lightmagenta',
      'reset',
      'default',
      'none',
      'transparent',
      '  CYAN  ',
    ]
    expect(accepted.filter((color) => !isColor(color))).toEqual([])
  })

  it('rejects a malformed color the same way herdr does', () => {
    const rejected = ['#12345', '#ggg', 'rgb(300,0,0)', 'rgb(1,2)', 'octarine', '']
    expect(rejected.filter(isColor)).toEqual([])
  })

  it('reports an unknown color as a warning, because herdr falls back to cyan', () => {
    const diagnostics = validate(config({ 'ui.accent': 'octarine' }))
    expect(at(diagnostics, 'ui.accent')[0]).toEqual({
      severity: 'warning',
      path: 'ui.accent',
      message: 'unknown color "octarine"; herdr will fall back to cyan',
    })
    expect(hasErrors(diagnostics)).toBe(false)
  })

  it('accepts a custom theme token in any color syntax', () => {
    expect(
      validate(config({ 'theme.custom.red': 'rgb(255, 85, 85)', 'theme.custom.accent': '#f5c2e7' })),
    ).toEqual([])
  })

  it('takes only hex for a sidebar token fg', () => {
    expect(isHexColor('#abc')).toBe(true)
    expect(isHexColor('#AABBCC')).toBe(true)
    expect(isHexColor('cyan')).toBe(false)
    expect(isHexColor('rgb(1,2,3)')).toBe(false)
  })
})

describe('theme names', () => {
  it('accepts a built-in and the aliases herdr canonicalizes', () => {
    expect(canonicalThemeName('catppuccin')).toBe('catppuccin')
    expect(canonicalThemeName('catppuccin-mocha')).toBe('catppuccin')
    expect(canonicalThemeName('TokyoNight')).toBe('tokyo-night')
    expect(canonicalThemeName('Tokyo Night')).toBe('tokyo-night')
    expect(canonicalThemeName('gruvbox_dark')).toBe('gruvbox')
    expect(canonicalThemeName('dawn')).toBe('rose-pine-dawn')
    expect(canonicalThemeName('catppucin')).toBeNull()
  })

  it('does not answer a theme name out of Object.prototype', () => {
    // herdr calls this an unknown theme name; a lookup table with a prototype
    // would have passed it off as a real one and said nothing.
    for (const inherited of ['constructor', '__proto__', 'valueOf']) {
      expect(canonicalThemeName(inherited)).toBeNull()
    }
    expect(messagesAt(validate(config({ 'theme.name': 'constructor' })), 'theme.name')[0]).toContain(
      'unknown theme name "constructor"',
    )
  })

  it('canonicalizes every name the schema lists', () => {
    expect(themeNames().map((name) => canonicalThemeName(name))).toEqual([...themeNames()])
  })

  it('warns with the fallback herdr will use', () => {
    const diagnostics = validate(
      config({ 'theme.name': 'catppucin', 'theme.light_name': 'lattee' }),
    )
    expect(at(diagnostics, 'theme.name')[0].severity).toBe('warning')
    expect(messagesAt(diagnostics, 'theme.name')[0]).toContain(
      'unknown theme name "catppucin"; herdr will use "catppuccin"',
    )
    expect(messagesAt(diagnostics, 'theme.light_name')[0]).toContain(
      'herdr will use "catppuccin-latte"',
    )
  })
})

describe('sidebar token rows', () => {
  it('accepts built-in tokens, custom tokens and a styled entry', () => {
    expect(
      validate(
        config({
          'ui.sidebar.agents.rows': [
            ['state_icon', 'workspace'],
            ['agent', '$summary', { token: 'tab', fg: '#89b4fa', bold: true, dim: false }],
          ],
          'ui.sidebar.spaces.rows': [['branch', 'git_status']],
        }),
      ),
    ).toEqual([])
  })

  it('knows which built-ins belong to which sidebar', () => {
    expect(sidebarTokenBuiltins('agents')).toContain('terminal_title')
    expect(sidebarTokenBuiltins('spaces')).toContain('git_status')
    const diagnostics = validate(config({ 'ui.sidebar.spaces.rows': [['agent']] }))
    expect(messagesAt(diagnostics, 'ui.sidebar.spaces.rows[0][0]')).toEqual([
      'unknown sidebar token `agent`; custom tokens must start with `$`',
    ])
  })

  it('caps a layout at sixteen rows', () => {
    const rows = Array.from({ length: 17 }, () => ['agent'])
    const diagnostics = validate(config({ 'ui.sidebar.agents.rows': rows }))
    expect(at(diagnostics, 'ui.sidebar.agents.rows')[0]).toEqual({
      severity: 'error',
      path: 'ui.sidebar.agents.rows',
      message: 'sidebar layouts may contain at most 16 rows',
    })
    expect(validate(config({ 'ui.sidebar.agents.rows': rows.slice(0, 16) }))).toEqual([])
  })

  it('caps a row at sixteen tokens', () => {
    const row = Array.from({ length: 17 }, () => 'agent')
    expect(
      messagesAt(
        validate(config({ 'ui.sidebar.agents.rows': [row] })),
        'ui.sidebar.agents.rows[0]',
      ),
    ).toEqual(['sidebar rows may contain at most 16 tokens'])
  })

  it('requires a custom token to start with $ and stay within 32 characters', () => {
    const diagnostics = validate(
      config({
        'ui.sidebar.agents.rows': [['$'], ['$has space'], [`$${'x'.repeat(33)}`], ['$ok-1']],
      }),
    )
    expect(messagesAt(diagnostics, 'ui.sidebar.agents.rows[0][0]')).toEqual([
      'invalid custom sidebar token `$`',
    ])
    expect(messagesAt(diagnostics, 'ui.sidebar.agents.rows[1][0]')).toEqual([
      'invalid custom sidebar token `$has space`',
    ])
    expect(messagesAt(diagnostics, 'ui.sidebar.agents.rows[2][0]')).toHaveLength(1)
    expect(messagesAt(diagnostics, 'ui.sidebar.agents.rows[3][0]')).toEqual([])
  })

  it('checks the fields of a styled entry and refuses a stray one', () => {
    const diagnostics = validate(
      config({
        'ui.sidebar.agents.rows': [
          [{ token: 'agent', fg: 'cyan' }, { fg: '#fff' }, { token: 'agent', italic: true }],
        ],
      }),
    )
    expect(messagesAt(diagnostics, 'ui.sidebar.agents.rows[0][0].fg')).toEqual([
      'sidebar token fg must be #RGB or #RRGGBB',
    ])
    expect(messagesAt(diagnostics, 'ui.sidebar.agents.rows[0][1]')).toEqual([
      'a styled sidebar token needs a `token` field',
    ])
    expect(messagesAt(diagnostics, 'ui.sidebar.agents.rows[0][2].italic')).toEqual([
      'unknown field on a styled sidebar token `italic`',
    ])
  })

  it('rejects a shape that is not a list of rows', () => {
    expect(
      messagesAt(validate(config({ 'ui.sidebar.agents.rows': 'agent' })), 'ui.sidebar.agents.rows'),
    ).toEqual(['expected a list of token rows, got a string'])
    expect(
      messagesAt(
        validate(config({ 'ui.sidebar.agents.rows': ['agent'] })),
        'ui.sidebar.agents.rows[0]',
      ),
    ).toEqual(['expected a row of tokens, got a string'])
  })

  it('takes per-agent rows only under a canonical agent id', () => {
    const good = validate(
      config({ 'ui.sidebar.agents.rows_by_agent.claude': [['state_icon', 'agent']] }),
    )
    expect(good).toEqual([])

    const bad = validate(
      config({ 'ui.sidebar.agents.rows_by_agent.claude-code': [['agent']] }),
    )
    expect(messagesAt(bad, 'ui.sidebar.agents.rows_by_agent.claude-code')).toEqual([
      'unknown canonical agent id `claude-code` in sidebar rows_by_agent',
    ])
  })

  it('applies the row caps to per-agent rows too', () => {
    const diagnostics = validate(
      config({
        'ui.sidebar.agents.rows_by_agent.codex': Array.from({ length: 17 }, () => ['agent']),
      }),
    )
    expect(messagesAt(diagnostics, 'ui.sidebar.agents.rows_by_agent.codex')).toEqual([
      'sidebar layouts may contain at most 16 rows',
    ])
  })
})

describe('ui.tab_bar_right', () => {
  it('accepts one entry of every type', () => {
    expect(
      validate(
        config({
          'ui.tab_bar_right': [
            { type: 'zoom' },
            { type: 'hostname' },
            { type: 'datetime', format: '%H:%M' },
            { type: 'text', text: 'prod' },
            { type: 'command', command: 'status.sh', interval_seconds: 5, timeout_seconds: 2 },
          ],
        }),
      ),
    ).toEqual([])
  })

  it('names the entry types when one is unknown or missing', () => {
    const diagnostics = validate(
      config({ 'ui.tab_bar_right': [{ type: 'weather' }, { text: 'prod' }] }),
    )
    expect(messagesAt(diagnostics, 'ui.tab_bar_right[0].type')[0]).toContain(
      'unknown entry type "weather"',
    )
    expect(messagesAt(diagnostics, 'ui.tab_bar_right[1].type')[0]).toContain(
      'unknown entry type (missing)',
    )
  })

  it('requires the field each type needs', () => {
    const diagnostics = validate(config({ 'ui.tab_bar_right': [{ type: 'text' }] }))
    expect(at(diagnostics, 'ui.tab_bar_right[0].text')[0]).toEqual({
      severity: 'error',
      path: 'ui.tab_bar_right[0].text',
      message: 'a text entry needs a `text` field',
    })
  })

  it('only warns about a field from another type, which serde silently drops', () => {
    const diagnostics = validate(config({ 'ui.tab_bar_right': [{ type: 'zoom', format: '%H' }] }))
    expect(at(diagnostics, 'ui.tab_bar_right[0].format')[0]).toEqual({
      severity: 'warning',
      path: 'ui.tab_bar_right[0].format',
      message: 'unknown field `format` on a zoom entry; herdr will ignore it',
    })
  })

  it('reports a stray field once, like the other array of tables does', () => {
    const text = `[[ui.tab_bar_right]]
type = "zoom"
bogus = 1

[[keys.command]]
key = "prefix+alt+g"
command = "lazygit"
bogus = 1
`
    const parsed = parseToml(text)
    const effective = config()
    for (const [path, value] of parsed.values) effective.set(path, value)
    const diagnostics = validate(effective, unknownKeysIn(parsed.values.keys()))
    expect(messagesAt(diagnostics, 'ui.tab_bar_right[0].bogus')).toHaveLength(1)
    expect(messagesAt(diagnostics, 'keys.command[0].bogus')).toHaveLength(1)
  })

  it('names the value of a seconds field that is not a count', () => {
    const diagnostics = validate(
      config({
        'ui.tab_bar_right': [
          { type: 'command', command: 'ls', interval_seconds: -5 },
          { type: 'command', command: 'ls', timeout_seconds: 'soon' },
        ],
      }),
    )
    expect(messagesAt(diagnostics, 'ui.tab_bar_right[0].interval_seconds')).toEqual([
      'expected a non-negative integer, got -5',
    ])
    expect(messagesAt(diagnostics, 'ui.tab_bar_right[1].timeout_seconds')).toEqual([
      'expected an integer, got a string',
    ])
  })

  it('warns about a command entry herdr would hide', () => {
    const diagnostics = validate(
      config({
        'ui.tab_bar_right': [
          { type: 'command', command: '   ' },
          { type: 'command', command: 'ok.sh', interval_seconds: 0 },
          { type: 'command', command: 'ok.sh', timeout_seconds: 3601 },
          { type: 'command', command: 'ok.sh', interval_seconds: 31_536_001 },
        ],
      }),
    )
    expect(messagesAt(diagnostics, 'ui.tab_bar_right[0].command')).toEqual([
      'command is empty; herdr will hide the entry',
    ])
    expect(messagesAt(diagnostics, 'ui.tab_bar_right[1].interval_seconds')).toEqual([
      'must be at least 1; herdr will hide the entry',
    ])
    expect(messagesAt(diagnostics, 'ui.tab_bar_right[2].timeout_seconds')).toEqual([
      'may be at most 3600; herdr will hide the entry',
    ])
    expect(messagesAt(diagnostics, 'ui.tab_bar_right[3].interval_seconds')).toEqual([
      'may be at most 31536000; herdr will hide the entry',
    ])
    expect(hasErrors(diagnostics)).toBe(false)
  })

  it('warns about an empty datetime format', () => {
    expect(
      messagesAt(
        validate(config({ 'ui.tab_bar_right': [{ type: 'datetime', format: '' }] })),
        'ui.tab_bar_right[0].format',
      ),
    ).toEqual(['datetime format is empty; herdr will hide the entry'])
  })

  it('warns past sixteen entries, which herdr ignores rather than rejects', () => {
    const entries = Array.from({ length: 17 }, () => ({ type: 'zoom' }))
    const diagnostics = validate(config({ 'ui.tab_bar_right': entries }))
    expect(at(diagnostics, 'ui.tab_bar_right')[0]).toEqual({
      severity: 'warning',
      path: 'ui.tab_bar_right',
      message: 'may contain at most 16 entries; herdr will ignore the extras',
    })
  })
})

describe('keybinding grammar', () => {
  it('accepts a chord, a list of chords and a range on an indexed action', () => {
    expect(
      validate(
        config({
          'keys.help': ['prefix+?', 'f1'],
          'keys.focus_agent': 'prefix+alt+1..9',
        }),
      ),
    ).toEqual([])
  })

  it('warns about a chord herdr cannot parse', () => {
    const diagnostics = validate(config({ 'keys.help': 'prefix+pgup' }))
    expect(at(diagnostics, 'keys.help')[0]).toEqual({
      severity: 'warning',
      path: 'keys.help',
      message: 'invalid keybinding "prefix+pgup"; herdr will disable the binding',
    })
  })

  it('warns about an unparseable prefix and names the fallback', () => {
    expect(messagesAt(validate(config({ 'keys.prefix': 'ctrl+' })), 'keys.prefix')).toEqual([
      'invalid keybinding "ctrl+"; herdr will use ctrl+b',
    ])
  })

  it('lets the fallback prefix claim ctrl+b, as herdr does', () => {
    // `herdr config check` prints both of these for this file.
    const diagnostics = validate(config({ 'keys.prefix': 'nonsense', 'keys.help': 'ctrl+b' }))
    expect(messagesAt(diagnostics, 'keys.prefix')).toEqual([
      'invalid keybinding "nonsense"; herdr will use ctrl+b',
    ])
    expect(messagesAt(diagnostics, 'keys.help')).toEqual([
      'ctrl+b: kept keys.prefix, disabled keys.help',
    ])
  })

  it('reserves the fallback prefix even when keys.prefix is missing entirely', () => {
    const effective = config()
    effective.delete('keys.prefix')
    effective.set('keys.help', 'ctrl+b')
    expect(messagesAt(validate(effective), 'keys.help')).toEqual([
      'ctrl+b: kept keys.prefix, disabled keys.help',
    ])
  })

  it('rejects a chord whose modifier only exists on Object.prototype', () => {
    for (const inherited of ['constructor+x', '__proto__+x']) {
      const diagnostics = validate(config({ 'keys.help': inherited }))
      expect(messagesAt(diagnostics, 'keys.help')).toEqual([
        `invalid keybinding ${JSON.stringify(inherited)}; herdr will disable the binding`,
      ])
    }
  })

  it('rejects a keybinding that is not a string or a list of them', () => {
    expect(messagesAt(validate(config({ 'keys.help': 7 })), 'keys.help')).toEqual([
      'expected a keybinding string or a list of them, got an integer',
    ])
  })

  it('allows a range only on an indexed action', () => {
    expect(messagesAt(validate(config({ 'keys.help': 'prefix+1..9' })), 'keys.help')).toEqual([
      'range keybinding "prefix+1..9" is only valid for indexed actions; herdr will disable the binding',
    ])
  })

  it('requires an indexed action to bind one of 1..9', () => {
    expect(
      messagesAt(validate(config({ 'keys.switch_workspace': 'prefix+alt+a' })), 'keys.switch_workspace'),
    ).toEqual(['indexed keybinding must use 1..9: "prefix+alt+a"; herdr will disable the binding'])
  })
})

describe('keybinding conflicts', () => {
  it('reports two settings the user pointed at the same chord', () => {
    const diagnostics = validate(
      config({ 'keys.new_tab': 'prefix+alt+t', 'keys.rename_tab': 'prefix+alt+t' }),
    )
    expect(at(diagnostics, 'keys.rename_tab')[0]).toEqual({
      severity: 'warning',
      path: 'keys.rename_tab',
      message: 'prefix+alt+t: kept keys.new_tab, disabled keys.rename_tab',
    })
  })

  it('says nothing when a binding merely displaces a default, as herdr does not', () => {
    // `prefix+c` is the default for keys.new_tab; herdr registers the user's
    // setting first and drops the default without a diagnostic.
    expect(validate(config({ 'keys.rename_tab': 'prefix+c' }))).toEqual([])
  })

  it("takes the caller's word for which settings the user wrote", () => {
    // Told that both are the user's, the conflict is real again.
    const diagnostics = validate(config({ 'keys.rename_tab': 'prefix+c' }), [], [
      'keys.new_tab',
      'keys.rename_tab',
    ])
    expect(messagesAt(diagnostics, 'keys.rename_tab')).toEqual([
      'prefix+c: kept keys.new_tab, disabled keys.rename_tab',
    ])
  })

  it('reports a direct binding that collides with the prefix key itself', () => {
    expect(messagesAt(validate(config({ 'keys.help': 'ctrl+b' })), 'keys.help')).toEqual([
      'ctrl+b: kept keys.prefix, disabled keys.help',
    ])
  })

  it('refuses a prefix-mode binding on the prefix key, which sends a literal prefix', () => {
    const diagnostics = validate(config({ 'keys.help': 'prefix+ctrl+b' }))
    expect(messagesAt(diagnostics, 'keys.help')[0]).toContain('uses keys.prefix as the prefix-mode key')
  })

  it('follows the configured prefix rather than assuming ctrl+b', () => {
    const diagnostics = validate(config({ 'keys.prefix': 'ctrl+a', 'keys.help': 'prefix+ctrl+a' }))
    expect(messagesAt(diagnostics, 'keys.help')[0]).toContain('uses keys.prefix as the prefix-mode key')
    expect(validate(config({ 'keys.prefix': 'ctrl+a', 'keys.help': 'prefix+ctrl+b' }))).toEqual([])
  })

  it('refuses a direct binding that would swallow ordinary typing', () => {
    const diagnostics = validate(config({ 'keys.help': 'x' }))
    expect(messagesAt(diagnostics, 'keys.help')[0]).toContain('unsafe direct keybinding "x"')
    expect(messagesAt(diagnostics, 'keys.help')[0]).toContain('use "prefix+x"')
  })

  it('lets navigate mode keep the unmodified letters it ships with', () => {
    expect(validate(config({ 'keys.navigate_pane_left': 'a' }))).toEqual([])
  })

  it('keeps the navigate registry separate from the action one', () => {
    // `prefix+h` is taken by keys.focus_pane_left, but navigate mode is a
    // different namespace and a direct `h` never collides with it.
    expect(validate(config({ 'keys.navigate_pane_up': 'y' }))).toEqual([])
  })
})

describe('navigate-mode restrictions', () => {
  it('refuses prefix+, esc, enter, tab and 1..9', () => {
    const cases: Readonly<Record<string, RegExp>> = {
      'prefix+h': /must not include prefix/,
      esc: /cannot use esc/,
      enter: /reserves enter/,
      tab: /reserves tab/,
      '3': /reserves 3/,
      left: /reserves left/,
    }
    for (const [binding, expected] of Object.entries(cases)) {
      const diagnostics = validate(config({ 'keys.navigate_pane_down': binding }))
      expect(`${binding}: ${messagesAt(diagnostics, 'keys.navigate_pane_down')[0]}`).toMatch(
        expected,
      )
    }
  })

  it('reports the restriction as a warning, not a file-killing error', () => {
    expect(hasErrors(validate(config({ 'keys.navigate_pane_down': 'esc' })))).toBe(false)
  })
})

describe('the legacy [keys.indexed] settings', () => {
  it('accepts a modifiers-only value', () => {
    expect(validate(config({ 'keys.indexed.tabs': 'ctrl' }))).toEqual([])
  })

  it('warns when the value is a whole chord rather than modifiers', () => {
    expect(messagesAt(validate(config({ 'keys.indexed.tabs': 'ctrl+1' })), 'keys.indexed.tabs')).toEqual(
      ['invalid indexed keybinding "ctrl+1"; herdr will disable the binding'],
    )
  })

  it('expands over 1..9, so two settings with the same modifiers collide nine times', () => {
    const diagnostics = validate(
      config({ 'keys.indexed.tabs': 'ctrl', 'keys.indexed.workspaces': 'ctrl' }),
    )
    expect(messagesAt(diagnostics, 'keys.indexed.workspaces')).toHaveLength(9)
    expect(messagesAt(diagnostics, 'keys.indexed.workspaces')[0]).toBe(
      'ctrl+1: kept keys.indexed.tabs, disabled keys.indexed.workspaces',
    )
  })
})

describe('[[keys.command]] entries', () => {
  it('accepts a popup command with a percentage size', () => {
    expect(
      validate(
        config({
          'keys.command': [
            {
              key: 'prefix+alt+g',
              type: 'popup',
              command: 'lazygit',
              width: '80%',
              height: 24,
              description: 'git',
            },
          ],
        }),
      ),
    ).toEqual([])
  })

  it('warns about an empty command, which herdr disables', () => {
    const diagnostics = validate(
      config({ 'keys.command': [{ key: 'prefix+alt+g', command: '  ' }] }),
    )
    expect(messagesAt(diagnostics, 'keys.command[0].command')).toEqual([
      'empty custom command; herdr will disable it',
    ])
  })

  it('names the execution modes when the type is not one of them', () => {
    const diagnostics = validate(
      config({ 'keys.command': [{ key: 'prefix+alt+g', command: 'ls', type: 'window' }] }),
    )
    expect(messagesAt(diagnostics, 'keys.command[0].type')).toEqual([
      'unknown value "window"; expected one of shell, pane, popup, plugin_action',
    ])
  })

  it('checks a popup size against the cell and percentage forms', () => {
    const diagnostics = validate(
      config({
        'keys.command': [
          { key: 'prefix+alt+a', command: 'a', type: 'popup', width: '80' },
          { key: 'prefix+alt+b', command: 'b', type: 'popup', width: '0%' },
          { key: 'prefix+alt+c', command: 'c', type: 'popup', height: -3 },
        ],
      }),
    )
    expect(messagesAt(diagnostics, 'keys.command[0].width')).toEqual([
      'string sizes must be percentages like "80%"; use a number for cells',
    ])
    expect(messagesAt(diagnostics, 'keys.command[1].width')).toEqual([
      'percentage must be between 1% and 100%',
    ])
    expect(messagesAt(diagnostics, 'keys.command[2].height')).toEqual([
      'cell count must be between 0 and 65535, got -3',
    ])
  })

  it('warns about a popup size on a command that is not a popup', () => {
    const diagnostics = validate(
      config({ 'keys.command': [{ key: 'prefix+alt+g', command: 'ls', width: '80%' }] }),
    )
    expect(messagesAt(diagnostics, 'keys.command[0].width')).toEqual([
      'popup size on a non-popup custom command; herdr will ignore it',
    ])
  })

  it('holds command keys to the same grammar and the same registry', () => {
    const diagnostics = validate(
      config({
        'keys.command': [
          { key: 'prefix+nope', command: 'a' },
          { key: 'prefix+alt+g', command: 'b' },
          { key: 'prefix+alt+g', command: 'c' },
        ],
      }),
    )
    expect(messagesAt(diagnostics, 'keys.command[0].key')).toEqual([
      'invalid keybinding "prefix+nope"; herdr will disable the binding',
    ])
    expect(messagesAt(diagnostics, 'keys.command[2].key')).toEqual([
      'prefix+alt+g: kept keys.command[1].key, disabled keys.command[2].key',
    ])
  })

  it('lets a command key displace a default binding silently', () => {
    // Custom commands are always the user's, so `prefix+c` beats the default
    // keys.new_tab without a word, the way herdr resolves it.
    expect(
      validate(config({ 'keys.command': [{ key: 'prefix+c', command: 'lazygit' }] })),
    ).toEqual([])
  })

  it('rejects a shape that is not a list of tables', () => {
    expect(messagesAt(validate(config({ 'keys.command': 'lazygit' })), 'keys.command')).toEqual([
      'expected a list of command tables, got a string',
    ])
  })
})

describe('cross-field rules', () => {
  it('accepts a width inside its bounds', () => {
    expect(
      validate(
        config({ 'ui.sidebar_min_width': 20, 'ui.sidebar_width': 26, 'ui.sidebar_max_width': 40 }),
      ),
    ).toEqual([])
  })

  it('warns when the minimum width is above the maximum', () => {
    const diagnostics = validate(
      config({ 'ui.sidebar_min_width': 40, 'ui.sidebar_max_width': 30 }),
    )
    expect(at(diagnostics, 'ui.sidebar_min_width')[0]).toEqual({
      severity: 'warning',
      path: 'ui.sidebar_min_width',
      message: 'ui.sidebar_min_width (40) is greater than sidebar_max_width (30)',
    })
  })

  it('warns when the width falls outside the bounds herdr will clamp it into', () => {
    expect(
      messagesAt(validate(config({ 'ui.sidebar_width': 10 })), 'ui.sidebar_width'),
    ).toEqual(['ui.sidebar_width (10) is below sidebar_min_width (18); herdr will clamp it'])
    expect(
      messagesAt(validate(config({ 'ui.sidebar_width': 90 })), 'ui.sidebar_width'),
    ).toEqual(['ui.sidebar_width (90) is above sidebar_max_width (36); herdr will clamp it'])
  })

  it('warns about a zero headless terminal size, at whichever field is zero', () => {
    expect(
      messagesAt(validate(config({ 'server.headless_cols': 0 })), 'server.headless_cols'),
    ).toEqual([
      'server.headless_cols and server.headless_rows must be greater than zero (got 0x40)',
    ])
    // herdr prints exactly one line for this file, naming both sizes.
    const rowsOnly = validate(config({ 'server.headless_rows': 0 }))
    expect(messagesAt(rowsOnly, 'server.headless_rows')).toEqual([
      'server.headless_cols and server.headless_rows must be greater than zero (got 120x0)',
    ])
    expect(messagesAt(rowsOnly, 'server.headless_cols')).toEqual([])
  })
})

describe('settings with a grammar of their own', () => {
  it('accepts a window title built from the documented tokens', () => {
    expect(validate(config({ 'ui.window_title': '{hostname}: {workspace} {{literal}}' }))).toEqual(
      [],
    )
    expect(validate(config({ 'ui.window_title': '' }))).toEqual([])
  })

  it('warns about a window title herdr cannot parse', () => {
    expect(messagesAt(validate(config({ 'ui.window_title': '{hostname' })), 'ui.window_title')[0]).toContain(
      "unclosed '{'",
    )
    expect(messagesAt(validate(config({ 'ui.window_title': 'a}b' })), 'ui.window_title')[0]).toContain(
      "unmatched '}'",
    )
    expect(messagesAt(validate(config({ 'ui.window_title': '{host}' })), 'ui.window_title')[0]).toContain(
      "unknown token '{host}'",
    )
  })

  it('accepts the right-click modifiers, and refuses shift', () => {
    const accepted = ['', 'off', 'none', 'disabled', 'ctrl', 'cmd+alt', 'META']
    expect(
      accepted.filter(
        (value) => validate(config({ 'ui.right_click_passthrough_modifier': value })).length > 0,
      ),
    ).toEqual([])
    expect(
      messagesAt(
        validate(config({ 'ui.right_click_passthrough_modifier': 'shift' })),
        'ui.right_click_passthrough_modifier',
      )[0],
    ).toContain('without shift')
  })

  it('wants an mp3 for a sound path', () => {
    expect(validate(config({ 'ui.sound.done_path': '~/sounds/Ping.MP3' }))).toEqual([])
    expect(messagesAt(validate(config({ 'ui.sound.path': 'ping.wav' })), 'ui.sound.path')).toEqual([
      'unsupported sound file format "ping.wav"; expected an mp3 file',
    ])
  })
})

describe('unknown keys', () => {
  it('recognizes every schema key and the three open-ended shapes', () => {
    expect(isKnownKey('ui.sidebar_width')).toBe(true)
    expect(isKnownKey('keys.command')).toBe(true)
    expect(isKnownKey('keys.command[0]')).toBe(true)
    expect(isKnownKey('keys.command[0].key')).toBe(true)
    expect(isKnownKey('keys.command[0].colour')).toBe(false)
    expect(isKnownKey('ui.tab_bar_right[2].interval_seconds')).toBe(true)
    // Every field of a tab bar entry counts as known here, misspelt ones
    // included, because which fields an entry may carry depends on its `type`
    // and the entry rule owns that with a better message.
    expect(isKnownKey('ui.tab_bar_right[2].nope')).toBe(true)
    expect(isKnownKey('ui.sidebar.agents.rows_by_agent.claude')).toBe(true)
    expect(isKnownKey('ui.sidebar_wdith')).toBe(false)
  })

  it('finds the unknown paths in a parsed file', () => {
    const parsed = parseToml(`
[ui]
sidebar_width = 30
sidebar_wdith = 30

[[keys.command]]
key = "prefix+alt+g"
command = "lazygit"
`)
    expect(unknownKeysIn(parsed.values.keys())).toEqual(['ui.sidebar_wdith'])
  })

  it('reports an unknown key as a warning with the nearest schema key', () => {
    const diagnostics = validate(config(), ['ui.sidebar_wdith'])
    expect(at(diagnostics, 'ui.sidebar_wdith')[0]).toEqual({
      severity: 'warning',
      path: 'ui.sidebar_wdith',
      message: 'unknown config key ui.sidebar_wdith; did you mean ui.sidebar_width? herdr will ignore it',
    })
  })

  it('points a top-level [toast] table at [ui.toast]', () => {
    expect(suggestKey('toast.delivery')).toBe('ui.toast.delivery')
  })

  it('says nothing when no schema key is close', () => {
    expect(suggestKey('completely.unrelated.setting')).toBeNull()
    expect(messagesAt(validate(config(), ['zzz.qqq']), 'zzz.qqq')).toEqual([
      'unknown config key zzz.qqq; herdr will ignore it',
    ])
  })
})

/**
 * A whole file, checked against what herdr 0.8.2 itself prints for it.
 *
 * Both halves are committed: `fixture-herdr-check.toml` is the config, and
 * `fixture-herdr-check.txt` is the recorded output of
 * `HERDR_CONFIG_PATH=… herdr config check` on it. The test reads the config
 * from the fixture rather than repeating it, so the file the binary was run
 * against and the file corral is checked against cannot drift; re-record the
 * `.txt` on a herdr bump and the diff is the list of rules that moved.
 */
describe('against herdr config check', () => {
  /** herdr's own diagnostic lines, without this fixture's comment header. */
  const HERDR_LINES = herdrCheckOutput
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#') && !line.startsWith('config:'))

  /** Layer a parsed file over the documented defaults, the way the store will. */
  function effectiveOf(text: string) {
    const parsed = parseToml(text)
    const effective = config()
    for (const [path, value] of parsed.values) effective.set(path, value)
    return { effective, parsed }
  }

  it('is checked against a recording of seven real diagnostics', () => {
    expect(HERDR_LINES).toHaveLength(7)
    // Spot-check the recording itself, so a truncated re-record is obvious.
    expect(HERDR_LINES[0]).toBe('unknown config key ui.sidebar_wdith; ignoring key')
  })

  it('reports every diagnostic the binary reports, at the right path', () => {
    const { effective, parsed } = effectiveOf(herdrCheckConfig)
    const diagnostics = validate(
      effective,
      unknownKeysIn(parsed.values.keys()),
      parsed.values.keys(),
    )

    // One corral path per recorded herdr line, in the recording's order.
    const paths = [
      'ui.sidebar_wdith',
      'keys.navigate_pane_down',
      'keys.help',
      'keys.command[0].command',
      'theme.name',
      'ui.window_title',
      'ui.sidebar_min_width',
    ]
    expect(HERDR_LINES).toHaveLength(paths.length)
    expect(paths.filter((path) => at(diagnostics, path).length !== 1)).toEqual([])

    // And nothing else, beyond the unknown color herdr logs through tracing
    // rather than collecting (src/config/theme.rs:185-188).
    expect(diagnostics.map((diagnostic) => diagnostic.path).sort()).toEqual(
      [...paths, 'ui.accent'].sort(),
    )
    expect(hasErrors(diagnostics)).toBe(false)
  })

  it('says nothing about the binding that merely displaces a default', () => {
    // The file rebinds `prefix+c` from keys.new_tab to keys.rename_tab and
    // herdr does not complain, because the loser is a default.
    const { effective, parsed } = effectiveOf(herdrCheckConfig)
    const diagnostics = validate(effective, [], parsed.values.keys())
    expect(at(diagnostics, 'keys.rename_tab')).toEqual([])
  })

  it('calls error exactly what the binary refuses to load', () => {
    // Each of these made `herdr config check` print "config parse error: …",
    // which means the whole file is dropped and herdr starts on defaults.
    const refused: Readonly<Record<string, TomlValue>>[] = [
      { 'ui.status_indicators': 'blobs' },
      { 'ui.sidebar.agents.rows': Array.from({ length: 17 }, () => ['agent']) },
      { 'ui.sidebar.spaces.rows': [['agent']] },
      { 'ui.toast.delay_seconds': 3601 },
      { 'ui.sidebar.agents.rows_by_agent.claude-code': [['agent']] },
      { 'keys.command': [{ key: 'prefix+alt+g', command: 'ls', type: 'popup', width: '80' }] },
      { 'ui.tab_bar_right': [{ type: 'text' }] },
      { 'ui.tab_bar_right': [{ type: 'weather' }] },
      { 'ui.sidebar.agents.rows': [[{ token: 'agent', italic: true }]] },
      { 'ui.sidebar.agents.rows': [[{ token: 'agent', fg: 'cyan' }]] },
    ]
    expect(refused.filter((overrides) => !hasErrors(validate(config(overrides))))).toEqual([])
  })

  it('calls warning exactly what the binary loads anyway', () => {
    // Each of these left `herdr config check` reporting an issue but still
    // loading the file, or reporting nothing at all.
    const tolerated: Readonly<Record<string, TomlValue>>[] = [
      { 'ui.tab_bar_right': Array.from({ length: 17 }, () => ({ type: 'zoom' })) },
      { 'ui.tab_bar_right': [{ type: 'zoom', format: '%H' }] },
      { 'keys.command': [{ key: 'prefix+alt+g', command: 'ls' }] },
      { 'theme.name': 'catppucin' },
      { 'ui.accent': 'octarine' },
      { 'ui.window_title': '{host}' },
      { 'ui.sidebar_min_width': 40, 'ui.sidebar_max_width': 30 },
      { 'keys.navigate_pane_down': 'esc' },
      { 'keys.help': 'x' },
    ]
    expect(tolerated.filter((overrides) => hasErrors(validate(config(overrides))))).toEqual([])
  })
})
