/**
 * The schema is generated, never hand-edited — so these tests are the gate that
 * catches a herdr upgrade the generators handled badly.
 *
 * The core check runs both ways between `reference.json` (what herdr.dev
 * documents) and `default-config.toml` (what herdr itself prints). Neither file
 * is a superset of the other, so both directions carry an explicit exceptions
 * list. Every exception is named with its reason and asserted to still be one:
 * a stale entry fails just as loudly as a new gap.
 */
import { describe, expect, it } from 'vitest'
import {
  allKeys,
  bySection,
  byKey,
  defaultConfigToml,
  defaultOf,
  enumOptions,
  herdrVersion,
  isKeybinding,
  paletteOf,
  reference,
  sections,
  sidebarTokenBuiltins,
  tabBarEntryTypes,
  themeNames,
  themeTokens,
  themes,
} from './index.ts'
import type { ReferenceDefault } from './types.ts'

// ---------------------------------------------------------------------------
// Reading the annotated default config
// ---------------------------------------------------------------------------

/**
 * A commented `key = value` line only counts as a documented setting when what
 * follows `=` is an actual TOML value. herdr's default config also contains
 * prose of the same shape ("# type = "shell" runs detached in the background."),
 * which is explanation, not a setting.
 */
const TOML_VALUE =
  /^(?:"(?:[^"\\]|\\.)*"|'[^']*'|true|false|[+-]?\d[\d_]*(?:\.\d+)?|\[[\s\S]*\]|\{[\s\S]*\})\s*(?:#.*)?$/

const TABLE_HEADER = /^\[\[?([A-Za-z0-9_.-]+)\]\]?$/
const ASSIGNMENT = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/

type DocumentedKey = { key: string; line: number }

/**
 * Walk the default config the way a reader does: commented and uncommented
 * table headers alike set the table that following keys belong to, because
 * herdr comments out whole example tables such as `# [theme.custom]`.
 */
function readDefaultConfig(toml: string): { keys: DocumentedKey[]; tables: Set<string> } {
  const keys: DocumentedKey[] = []
  const tables = new Set<string>()
  const seen = new Set<string>()
  let table = ''

  toml.split('\n').forEach((raw, index) => {
    const trimmed = raw.trim()
    if (trimmed === '') return
    const line = trimmed.startsWith('#') ? trimmed.replace(/^#\s?/, '') : trimmed

    const header = TABLE_HEADER.exec(line)
    if (header) {
      table = header[1]
      tables.add(table)
      return
    }

    const assignment = ASSIGNMENT.exec(line)
    if (!assignment || !TOML_VALUE.test(assignment[2].trim())) return

    const key = table === '' ? assignment[1] : `${table}.${assignment[1]}`
    if (seen.has(key)) return
    seen.add(key)
    keys.push({ key, line: index + 1 })
  })

  return { keys, tables }
}

const defaultConfig = readDefaultConfig(defaultConfigToml)
const documentedInDefaultConfig = new Set(defaultConfig.keys.map((entry) => entry.key))

// ---------------------------------------------------------------------------
// Exceptions — every one named, with the reason it is not a bug
// ---------------------------------------------------------------------------

type Exceptions = { reason: string; keys: string[] }

const THEME_CUSTOM_TOKENS_ONLY_ON_THE_SITE: Exceptions = {
  reason:
    'herdr prints six representative [theme.custom] overrides as examples; the reference page ' +
    'documents all nineteen tokens.',
  keys: [
    'theme.custom.surface0',
    'theme.custom.surface1',
    'theme.custom.surface_dim',
    'theme.custom.overlay0',
    'theme.custom.overlay1',
    'theme.custom.text',
    'theme.custom.subtext0',
    'theme.custom.mauve',
    'theme.custom.yellow',
    'theme.custom.blue',
    'theme.custom.teal',
    'theme.custom.peach',
  ],
}

const KEYBINDINGS_ONLY_ON_THE_SITE: Exceptions = {
  reason:
    'documented on the reference page but not emitted in the herdr 0.8.2 annotated default ' +
    'config.',
  keys: [
    'keys.copy_mode',
    'keys.swap_pane_left',
    'keys.swap_pane_down',
    'keys.swap_pane_up',
    'keys.swap_pane_right',
  ],
}

const SOUND_AGENTS_ONLY_ON_THE_SITE: Exceptions = {
  reason:
    '[ui.sound.agents] shows only the one agent muted by default (droid); the reference page ' +
    'lists every canonical agent id.',
  keys: [
    'ui.sound.agents.pi',
    'ui.sound.agents.claude',
    'ui.sound.agents.codex',
    'ui.sound.agents.gemini',
    'ui.sound.agents.cursor',
    'ui.sound.agents.devin',
    'ui.sound.agents.agy',
    'ui.sound.agents.cline',
    'ui.sound.agents.open_code',
    'ui.sound.agents.github_copilot',
    'ui.sound.agents.kimi',
    'ui.sound.agents.kiro',
    'ui.sound.agents.amp',
    'ui.sound.agents.grok',
    'ui.sound.agents.hermes',
    'ui.sound.agents.kilo',
    'ui.sound.agents.qodercli',
    'ui.sound.agents.qwen',
    'ui.sound.agents.maki',
  ],
}

const ACCENT_ATTRIBUTED_TO_THE_WRONG_TABLE: Exceptions = {
  reason:
    'herdr prints `accent = "cyan"` after the commented [ui.sidebar.spaces] example block, so ' +
    'reading the file top-down attributes the [ui] key ui.accent to ui.sidebar.spaces.accent.',
  keys: ['ui.accent'],
}

/** Reference keys with no `key = value` line in the default config. */
const REFERENCE_ONLY: Exceptions[] = [
  THEME_CUSTOM_TOKENS_ONLY_ON_THE_SITE,
  KEYBINDINGS_ONLY_ON_THE_SITE,
  SOUND_AGENTS_ONLY_ON_THE_SITE,
  ACCENT_ATTRIBUTED_TO_THE_WRONG_TABLE,
]

/** Default-config lines with no matching reference row. */
const DEFAULT_CONFIG_ONLY: Exceptions[] = [
  {
    reason:
      'fields of the [[keys.command]] array-of-tables example. The reference documents custom ' +
      'commands as a whole, not one row per field.',
    keys: [
      'keys.command.key',
      'keys.command.type',
      'keys.command.command',
      'keys.command.width',
      'keys.command.height',
    ],
  },
  {
    reason:
      'an example entry inside the ui.sidebar.agents.rows_by_agent table, which the reference ' +
      'documents as a single "table of token rows" key.',
    keys: ['ui.sidebar.agents.rows_by_agent.claude'],
  },
  {
    reason: `${ACCENT_ATTRIBUTED_TO_THE_WRONG_TABLE.reason} This is the other half of that pair.`,
    keys: ['ui.sidebar.spaces.accent'],
  },
]

function flatten(groups: Exceptions[]): string[] {
  return groups.flatMap((group) => group.keys)
}

// ---------------------------------------------------------------------------
// Default values must match their declared type
// ---------------------------------------------------------------------------

const TYPE_CHECKS: Record<string, (value: ReferenceDefault) => boolean> = {
  boolean: (value) => typeof value === 'boolean',
  integer: (value) => typeof value === 'number' && Number.isInteger(value),
  string: (value) => typeof value === 'string',
  path: (value) => typeof value === 'string',
  color: (value) => typeof value === 'string',
  keybinding: (value) => typeof value === 'string',
  enum: (value) => typeof value === 'string',
  array: (value) => Array.isArray(value),
  'list of strings': (value) => Array.isArray(value),
  'list of token rows': (value) => Array.isArray(value),
  'table of token rows': (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
}

/** Keys whose printed default deliberately does not parse as its own type. */
const DEFAULT_TYPE_EXCEPTIONS: Exceptions[] = []

// ---------------------------------------------------------------------------

describe('reference.json', () => {
  it('covers herdr 0.8.2 with every setting the reference page lists', () => {
    expect(herdrVersion).toBe('0.8.2')
    expect(reference.source).toBe('https://herdr.dev/docs/config-reference/')
    // Bump deliberately when herdr ships settings: regenerate, then diff.
    expect(reference.entries.length).toBe(167)
    expect(reference.entries.length).toBeGreaterThanOrEqual(150)
  })

  it('has unique keys, each in a declared section', () => {
    const keys = allKeys()
    expect(new Set(keys).size).toBe(keys.length)

    const sectionIds = new Set(sections().map((section) => section.id))
    expect(sectionIds.size).toBe(sections().length)

    const orphans = reference.entries
      .filter((entry) => !sectionIds.has(entry.section))
      .map((entry) => `${entry.key} -> ${entry.section}`)
    expect(orphans).toEqual([])

    const emptySections = sections()
      .filter((section) => bySection(section.id).length === 0)
      .map((section) => section.id)
    expect(emptySections).toEqual([])
  })

  it('gives every enum at least two options', () => {
    const thin = reference.entries
      .filter((entry) => entry.type === 'enum' && entry.options.length < 2)
      .map((entry) => `${entry.key} (${entry.options.length})`)
    expect(thin).toEqual([])
  })

  it('only attaches options to enums and to ui.tab_bar_right', () => {
    const withOptions = reference.entries
      .filter((entry) => entry.options.length > 0 && entry.type !== 'enum')
      .map((entry) => entry.key)
    expect(withOptions).toEqual(['ui.tab_bar_right'])
  })

  it('gives every entry a description and a known type', () => {
    const undescribed = reference.entries
      .filter((entry) => entry.description === '')
      .map((entry) => entry.key)
    expect(undescribed).toEqual([])

    const unknownTypes = reference.entries
      .filter((entry) => !(entry.type in TYPE_CHECKS))
      .map((entry) => `${entry.key}: ${entry.type}`)
    expect(unknownTypes).toEqual([])
  })

  it('parses every default as its declared type', () => {
    const excused = new Set(flatten(DEFAULT_TYPE_EXCEPTIONS))
    const wrong = reference.entries
      .filter((entry) => entry.default !== null && !excused.has(entry.key))
      .filter((entry) => !TYPE_CHECKS[entry.type](entry.default))
      .map((entry) => `${entry.key}: ${entry.type} = ${JSON.stringify(entry.default)}`)
    expect(wrong).toEqual([])

    const stale = [...excused].filter((key) => {
      const entry = byKey(key)
      return entry === undefined || entry.default === null || TYPE_CHECKS[entry.type](entry.default)
    })
    // Exceptions that are no longer exceptions.
    expect(stale).toEqual([])
  })

  it("keeps an enum's default among its own options", () => {
    const outside = reference.entries
      .filter((entry) => entry.type === 'enum' && typeof entry.default === 'string')
      .filter((entry) => !entry.options.includes(entry.default as string))
      .map((entry) => `${entry.key} = ${String(entry.default)}`)
    expect(outside).toEqual([])
  })

  it('records the printed literal alongside every parsed default', () => {
    const mismatched = reference.entries
      .filter((entry) => (entry.default === null) !== (entry.defaultLiteral === null))
      .map((entry) => entry.key)
    expect(mismatched).toEqual([])
    expect(byKey('update.channel')?.defaultNote).toBe('("preview" for Windows preview builds)')
  })
})

describe('reference.json against default-config.toml', () => {
  it('reads the annotated default config', () => {
    expect(defaultConfig.keys.length).toBeGreaterThan(120)
    expect(defaultConfig.tables).toContain('theme.custom')
    expect(defaultConfig.tables).toContain('ui.sound.agents')
  })

  it('documents every reference key in the default config, bar the listed exceptions', () => {
    const excused = new Set(flatten(REFERENCE_ONLY))

    const undocumented = allKeys().filter(
      (key) =>
        !documentedInDefaultConfig.has(key) &&
        !defaultConfig.tables.has(key) &&
        !excused.has(key),
    )
    expect(undocumented).toEqual([])

    const stale = [...excused].filter(
      (key) => documentedInDefaultConfig.has(key) || defaultConfig.tables.has(key),
    )
    // Exceptions that are no longer exceptions.
    expect(stale).toEqual([])
  })

  it('finds every default-config setting in the reference, bar the listed exceptions', () => {
    const excused = new Set(flatten(DEFAULT_CONFIG_ONLY))
    const known = new Set(allKeys())

    const unknown = defaultConfig.keys
      .filter((entry) => !known.has(entry.key) && !excused.has(entry.key))
      .map((entry) => `${entry.key} (line ${entry.line})`)
    expect(unknown).toEqual([])

    const stale = [...excused].filter((key) => known.has(key) || !documentedInDefaultConfig.has(key))
    // Exceptions that are no longer exceptions.
    expect(stale).toEqual([])
  })

  it('states a reason for every exception', () => {
    for (const group of [...REFERENCE_ONLY, ...DEFAULT_CONFIG_ONLY, ...DEFAULT_TYPE_EXCEPTIONS]) {
      expect(group.reason.length).toBeGreaterThan(20)
      expect(group.keys.length).toBeGreaterThan(0)
    }
    expect(flatten(REFERENCE_ONLY)).toHaveLength(37)
    expect(flatten(DEFAULT_CONFIG_ONLY)).toHaveLength(7)
  })
})

describe('themes.json', () => {
  const NAMED_COLORS = new Set([
    'reset',
    'black',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'purple',
    'cyan',
    'white',
    'gray',
    'grey',
    'darkgray',
    'darkgrey',
    'lightred',
    'lightgreen',
    'lightyellow',
    'lightblue',
    'lightmagenta',
    'lightcyan',
  ])

  /** The built-in names herdr's own default config points a user at. */
  function themeNamesInDefaultConfig(): string[] {
    const lines = defaultConfigToml.split('\n')
    const start = lines.findIndex((line) => line.includes('Built-in themes:'))
    if (start === -1) throw new Error('default-config.toml no longer lists the built-in themes')

    const block: string[] = []
    for (let i = start; i < lines.length; i += 1) {
      const line = lines[i].trim()
      if (!line.startsWith('#')) break
      const prose = line.replace(/^#\s*/, '')
      // The list runs to the first setting or table the file gets back to.
      if (ASSIGNMENT.test(prose) || TABLE_HEADER.test(prose)) break
      block.push(prose)
    }
    const listed = block
      .join(' ')
      .split('Built-in themes:')[1]
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '')

    const referenced = [...defaultConfigToml.matchAll(/^#\s*(?:dark_|light_)?name\s*=\s*"([^"]+)"/gm)].map(
      (match) => match[1],
    )
    return [...new Set([...listed, ...referenced])]
  }

  it('carries the nineteen tokens [theme.custom] can override', () => {
    expect(themeTokens()).toHaveLength(19)
    const fromReference = allKeys()
      .filter((key) => key.startsWith('theme.custom.'))
      .map((key) => key.slice('theme.custom.'.length))
    expect([...themeTokens()].sort()).toEqual([...fromReference].sort())
  })

  it('has every built-in theme the default config names, with all nineteen tokens', () => {
    const named = themeNamesInDefaultConfig()
    expect(named.length).toBeGreaterThanOrEqual(12)

    const wanted = [...themeTokens()].join()
    const incomplete = named.filter((name) => Object.keys(paletteOf(name) ?? {}).join() !== wanted)
    expect(incomplete).toEqual([])
  })

  it('uses only colors herdr can parse', () => {
    const unparseable = themeNames().flatMap((name) =>
      Object.entries(paletteOf(name) ?? {})
        .filter(([, value]) => !/^#[0-9a-f]{6}$/.test(value) && !NAMED_COLORS.has(value))
        .map(([token, value]) => `${name}.${token} = ${value}`),
    )
    expect(unparseable).toEqual([])
  })

  it('cites where each palette came from and flags anything reconstructed', () => {
    expect(themes.source.repository).toBe('https://github.com/herdrdev/herdr')
    expect(themes.source.tag).toBe('v0.8.2')
    expect(themes.source.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(themes.source.palettes).toContain('src/app/state.rs')
    expect(themes.source.tokens).toContain('src/config/theme.rs')
    expect(themes.herdrVersion).toBe(herdrVersion)

    // Palettes that could not be read from herdr's tagged source.
    const approximate = themeNames().filter((name) => themes.themes[name].approximate === true)
    expect(approximate).toEqual([])
  })
})

describe('accessors', () => {
  it('looks settings up by key, section, type and default', () => {
    expect(byKey('ui.tab_bar_position')?.section).toBe('ref-ui')
    expect(byKey('nope.not.a.key')).toBeUndefined()
    expect(bySection('ref-general').map((entry) => entry.key)).toEqual(['onboarding'])
    expect(bySection('ref-nonexistent')).toEqual([])

    expect(defaultOf('server.headless_cols')).toBe(120)
    expect(defaultOf('theme.name')).toBe('catppuccin')
    expect(defaultOf('onboarding')).toBeNull()
    expect(defaultOf('nope')).toBeUndefined()

    expect(isKeybinding('keys.new_tab')).toBe(true)
    expect(isKeybinding('keys.prefix')).toBe(false)
    expect(enumOptions('ui.tab_bar_position')).toEqual(['top', 'bottom'])
    expect(enumOptions('theme.name')).toEqual([])
  })

  it('exposes the tab bar entry types and the sidebar row built-ins', () => {
    expect(tabBarEntryTypes()).toEqual(['zoom', 'hostname', 'datetime', 'text', 'command'])
    expect(sidebarTokenBuiltins('agents')).toEqual([
      'state_icon',
      'state_text',
      'workspace',
      'tab',
      'pane',
      'agent',
      'terminal_title',
      'terminal_title_stripped',
    ])
    expect(sidebarTokenBuiltins('spaces')).toEqual([
      'state_icon',
      'state_text',
      'workspace',
      'branch',
      'git_status',
    ])
  })
})
