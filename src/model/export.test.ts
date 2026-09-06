/**
 * Export is where the epic's first two invariants are cashed in.
 *
 * 1. A file that was loaded and not edited comes back byte for byte — asserted against
 *    the hand-written fixture, comments and alignment and all.
 * 2. Only changed leaves are written: a key set to its own documented default is still
 *    written, and a reset key is deleted rather than left at the default.
 *
 * The patch assertions are stated as "these lines went away, these arrived", because
 * that is the only phrasing that proves the rest of the file was left alone.
 */

import { describe, expect, it } from 'vitest'
import { GENERATED_HEADER, diff, generate, isLeaf, leaves, patch } from '@/model/export'
import { type TomlValue, parseToml } from '@/model/parse'
import { useConfigStore, resetConfigStore } from '@/store/config'
import fixture from '@/test/fixture-user-config.toml?raw'

const store = () => useConfigStore.getState()

/** The lines one edit changed, found by trimming the common prefix and suffix. */
function changedLines(before: string, after: string): {
  removed: string[]
  added: string[]
} {
  const split = (text: string): string[] => text.replace(/\r?\n$/, '').split(/\r?\n/)
  const a = split(before)
  const b = split(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  return { removed: a.slice(start, endA), added: b.slice(start, endB) }
}

/** Load the fixture, apply `edit`, and report the export plus the lines it touched. */
function exported(edit: (config: ReturnType<typeof store>) => void) {
  resetConfigStore()
  store().loadText(fixture)
  edit(store())
  const text = store().exportText()
  return { text, ...changedLines(fixture, text) }
}

const fixtureValues = parseToml(fixture).values

describe('leaves', () => {
  it('lists every schema key', () => {
    expect(leaves()).toContain('ui.sidebar_width')
    expect(leaves()).toContain('theme.custom.accent')
    expect(leaves()).toContain('experimental.cjk_ime_agents')
  })

  it('treats an array of inline tables as one value, not as its entries', () => {
    const found = leaves(fixtureValues)
    expect(found).toContain('ui.tab_bar_right')
    expect(found).not.toContain('ui.tab_bar_right[0].type')
  })

  it('treats a token-row list as one value', () => {
    const found = leaves(fixtureValues)
    expect(found).toContain('ui.sidebar.agents.rows')
    expect(found).toContain('ui.sidebar.spaces.rows')
  })

  it('takes the fields of an array of tables, not the array', () => {
    const found = leaves(fixtureValues)
    expect(found).toContain('keys.command[0].command')
    expect(found).toContain('keys.command[1].type')
    expect(found).not.toContain('keys.command')
  })

  it('picks up the agents a user named under rows_by_agent', () => {
    const found = leaves(fixtureValues)
    expect(found).toContain('ui.sidebar.agents.rows_by_agent.claude')
    expect(found).not.toContain('ui.sidebar.agents.rows_by_agent')
  })
})

describe('leaf order', () => {
  it('sorts dynamic paths by index rather than by when they were seen', () => {
    const backwards = new Map<string, TomlValue>([
      ['keys.command[1].key', 'SECOND'],
      ['keys.command[0].key', 'FIRST'],
    ])
    expect(leaves(backwards).filter((path) => path.startsWith('keys.command'))).toEqual([
      'keys.command[0].key',
      'keys.command[1].key',
    ])
  })

  it('reads an index as a number, not as text', () => {
    const many = new Map<string, TomlValue>(
      [2, 10, 1].map((index) => [`keys.command[${index}].key`, 'x']),
    )
    expect(leaves(many).filter((path) => path.startsWith('keys.command'))).toEqual([
      'keys.command[1].key',
      'keys.command[2].key',
      'keys.command[10].key',
    ])
  })

  it('keeps the reference page order for schema keys', () => {
    const listed = leaves()
    expect(listed.indexOf('theme.name')).toBeLessThan(listed.indexOf('ui.sidebar_width'))
    expect(listed.indexOf('ui.sidebar_width')).toBeLessThan(listed.indexOf('ui.accent'))
  })
})

describe('isLeaf', () => {
  it('agrees with the list leaves builds', () => {
    const listed = new Set(leaves(fixtureValues))
    const probes = new Set([
      ...leaves(),
      ...fixtureValues.keys(),
      'keys.command',
      'theme.custom',
      'ui.sidebar.agents.rows_by_agent',
      'ui.sidebar.agents',
    ])
    for (const path of probes) {
      expect([path, isLeaf(path, fixtureValues)]).toEqual([path, listed.has(path)])
    }
  })

  it('accepts a path no config has yet', () => {
    expect(isLeaf('keys.command[9].key', fixtureValues)).toBe(true)
    expect(isLeaf('ui.sidebar.agents.rows_by_agent.codex', fixtureValues)).toBe(true)
  })
})

describe('diff', () => {
  it('finds nothing between a config and itself', () => {
    expect(diff(fixtureValues, fixtureValues)).toEqual([])
  })

  it('reports a new key as a set and a dropped key as a remove', () => {
    const after = new Map(fixtureValues)
    after.set('ui.sidebar_min_width', 20)
    after.delete('theme.name')
    expect(diff(fixtureValues, after)).toEqual([
      { kind: 'remove', path: 'theme.name' },
      { kind: 'set', path: 'ui.sidebar_min_width', value: 20 },
    ])
  })
})

describe('patching a loaded file', () => {
  it('gives an unedited file back byte for byte', () => {
    resetConfigStore()
    store().loadText(fixture)
    expect(store().exportText()).toBe(fixture)
  })

  it('leaves the file alone when the ops list is empty', () => {
    expect(patch(fixture, [])).toBe(fixture)
  })

  it('rewrites only the value that changed', () => {
    const { removed, added } = exported((config) => config.set('theme.name', 'nord'))
    expect(removed).toEqual(['name = "catppuccin"'])
    expect(added).toEqual(['name = "nord"'])
  })

  it('writes a key set to its own documented default', () => {
    const { removed, added, text } = exported((config) =>
      config.set('ui.sidebar_min_width', 18),
    )
    expect(removed).toEqual([])
    expect(added).toEqual(['sidebar_min_width = 18'])
    expect(parseToml(text).values.get('ui.sidebar_min_width')).toBe(18)
  })

  it('uncomments a documented default rather than appending a second key', () => {
    const { removed, added } = exported((config) =>
      config.set('ui.sidebar_start_collapsed', false),
    )
    expect(removed).toEqual(['# sidebar_start_collapsed = false'])
    expect(added).toEqual(['sidebar_start_collapsed = false'])
  })

  it('deletes the key a reset took back out', () => {
    const { removed, added, text } = exported((config) =>
      config.reset('terminal.default_shell'),
    )
    expect(removed).toEqual(['default_shell = "/opt/homebrew/bin/fish"'])
    expect(added).toEqual([])
    expect(parseToml(text).values.has('terminal.default_shell')).toBe(false)
  })

  it('replaces a token-row list as one value', () => {
    resetConfigStore()
    store().loadText(fixture)
    store().set('ui.sidebar.agents.rows', [['state_icon', 'workspace']])
    expect(store().changedLeaves()).toEqual(['ui.sidebar.agents.rows'])
    const { removed, added } = changedLines(fixture, store().exportText())
    expect(removed).toEqual([
      'rows = [',
      '  ["state_icon", { token = "workspace", fg = "#89b4fa", bold = true }, "tab"],',
      '  [{ token = "agent", fg = "#a6e3a1", dim = true }, "$model"],',
      ']',
    ])
    expect(added).toEqual(['rows = [["state_icon", "workspace"]]'])
  })

  it('replaces a tab bar entry list as one value', () => {
    resetConfigStore()
    store().loadText(fixture)
    store().set('ui.tab_bar_right', [{ type: 'zoom' }])
    expect(store().changedLeaves()).toEqual(['ui.tab_bar_right'])
    const { added } = changedLines(fixture, store().exportText())
    expect(added).toEqual(['tab_bar_right = [{ type = "zoom" }]'])
  })

  it('edits one field of one custom command', () => {
    resetConfigStore()
    store().loadText(fixture)
    store().set('keys.command[1].command', 'htop')
    expect(store().changedLeaves()).toEqual(['keys.command[1].command'])
    const { removed, added } = changedLines(fixture, store().exportText())
    expect(removed).toEqual(['command = "btop"'])
    expect(added).toEqual(['command = "htop"'])
  })

  it('applies several edits at once', () => {
    const { text } = exported((config) => {
      config.set('theme.name', 'nord')
      config.set('ui.sidebar_width', 30)
      config.reset('ui.mouse_capture')
    })
    const values = parseToml(text).values
    expect(values.get('theme.name')).toBe('nord')
    expect(values.get('ui.sidebar_width')).toBe(30)
    expect(values.has('ui.mouse_capture')).toBe(false)
    expect(values.get('keys.command[0].command')).toBe('lazygit')
  })
})

describe('generating from defaults', () => {
  it('writes only the keys that were set, grouped by table', () => {
    resetConfigStore()
    store().loadDefaults()
    store().set('onboarding', false)
    store().set('theme.name', 'nord')
    store().set('keys.prefix', 'ctrl+a')
    store().set('ui.sidebar_width', 30)
    expect(store().exportText()).toBe(
      [
        GENERATED_HEADER,
        '',
        'onboarding = false',
        '',
        '[theme]',
        'name = "nord"',
        '',
        '[keys]',
        'prefix = "ctrl+a"',
        '',
        '[ui]',
        'sidebar_width = 30',
        '',
      ].join('\n'),
    )
  })

  it('writes a value equal to the documented default', () => {
    resetConfigStore()
    store().loadDefaults()
    store().set('theme.name', 'catppuccin')
    expect(store().exportText()).toContain('name = "catppuccin"')
  })

  it('writes an array of tables as its own blocks', () => {
    resetConfigStore()
    store().loadDefaults()
    store().set('keys.command[0].key', 'prefix+alt+g')
    store().set('keys.command[0].command', 'lazygit')
    const text = store().exportText()
    expect(text).toContain('[[keys.command]]')
    expect(parseToml(text).values.get('keys.command[0].command')).toBe('lazygit')
  })

  it('writes nothing but the header when nothing was set', () => {
    expect(generate(new Map())).toBe(`${GENERATED_HEADER}\n`)
  })

  it('writes command blocks in index order however they were built', () => {
    resetConfigStore()
    store().loadDefaults()
    store().set('keys.command[1].key', 'SECOND')
    store().set('keys.command[0].key', 'FIRST')
    const values = parseToml(store().exportText()).values
    expect(values.get('keys.command[0].key')).toBe('FIRST')
    expect(values.get('keys.command[1].key')).toBe('SECOND')
  })

  it('writes the same file again after a reload', () => {
    resetConfigStore()
    store().loadDefaults()
    store().set('keys.command[1].key', 'prefix+alt+t')
    store().set('keys.command[0].key', 'prefix+alt+g')
    store().set('ui.sidebar.agents.rows_by_agent.claude', [['state_icon', 'workspace']])
    store().set('theme.name', 'nord')
    const first = store().exportText()
    expect(generate(parseToml(first).values)).toBe(first)
  })

  it('round-trips through the parser', () => {
    resetConfigStore()
    store().loadDefaults()
    store().set('ui.sidebar.agents.rows', [['state_icon', 'workspace']])
    store().set('theme.custom.accent', '#f5c2e7')
    const values = parseToml(store().exportText()).values
    expect(values.get('ui.sidebar.agents.rows')).toEqual([['state_icon', 'workspace']])
    expect(values.get('theme.custom.accent')).toBe('#f5c2e7')
    expect(values.size).toBe(2)
  })
})
