/**
 * The store's contract: what a setting reads as, and what an edit costs.
 *
 * Two behaviours here look like bugs until you read invariant 2. Setting a key to a
 * value it already has is a no-op — but only when the key is *already set*; setting an
 * unset key to its own documented default is a real change, because it is the difference
 * between "herdr decides" and "I decided, and I decided this".
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { UnwritablePathError } from '@/model/export'
import { MAX_HISTORY, REMOVED, useConfigStore, resetConfigStore } from '@/store/config'
import fixture from '@/test/fixture-user-config.toml?raw'

const store = () => useConfigStore.getState()

beforeEach(() => {
  resetConfigStore()
})

describe('loading', () => {
  it('starts from herdr defaults with nothing set', () => {
    expect(store().source).toBe('defaults')
    expect(store().parsed.size).toBe(0)
    expect(store().isDirty()).toBe(false)
    expect(store().changedLeaves()).toEqual([])
  })

  it('takes a file apart into a path map', () => {
    store().loadText(fixture)
    expect(store().source).toBe('file')
    expect(store().originalText).toBe(fixture)
    expect(store().parsed.get('theme.name')).toBe('catppuccin')
    expect(store().parsed.get('keys.command[0].command')).toBe('lazygit')
  })

  it('reports a loaded file as unchanged', () => {
    store().loadText(fixture)
    expect(store().isDirty()).toBe(false)
    expect(store().changedLeaves()).toEqual([])
  })

  it('keeps the current document when the text does not parse', () => {
    store().loadText(fixture)
    const error = store().loadText('name = ')
    expect(error?.name).toBe('TomlSyntaxError')
    expect(store().parseError).toBe(error)
    expect(store().originalText).toBe(fixture)
    expect(store().parsed.get('theme.name')).toBe('catppuccin')
  })

  it('clears a loaded file when starting over from defaults', () => {
    store().loadText(fixture)
    store().set('theme.name', 'nord')
    store().loadDefaults()
    expect(store().source).toBe('defaults')
    expect(store().originalText).toBe('')
    expect(store().parsed.size).toBe(0)
    expect(store().edits.size).toBe(0)
    expect(store().past).toEqual([])
  })
})

describe('effective values', () => {
  beforeEach(() => {
    store().loadText(fixture)
  })

  it('prefers the file over the documented default', () => {
    expect(store().effective('terminal.default_shell')).toBe('/opt/homebrew/bin/fish')
  })

  it('falls through to the documented default when the file is silent', () => {
    expect(store().effective('ui.sidebar_min_width')).toBe(18)
  })

  it('reports a setting herdr documents as unset as having no value', () => {
    expect(store().effective('theme.dark_name')).toBeUndefined()
  })

  it('prefers an edit over both', () => {
    store().set('terminal.default_shell', '/bin/zsh')
    store().set('ui.sidebar_min_width', 20)
    expect(store().effective('terminal.default_shell')).toBe('/bin/zsh')
    expect(store().effective('ui.sidebar_min_width')).toBe(20)
  })

  it('falls back to the documented default once a key is reset', () => {
    store().reset('terminal.default_shell')
    expect(store().edits.get('terminal.default_shell')).toBe(REMOVED)
    expect(store().effective('terminal.default_shell')).toBe('')
  })

  it('reads a whole token-row array as one value', () => {
    expect(store().effective('ui.sidebar.spaces.rows')).toEqual([
      ['state_icon', 'workspace'],
      ['branch', 'git_status'],
    ])
  })
})

describe('set', () => {
  beforeEach(() => {
    store().loadText(fixture)
  })

  it('records the change and reports it as dirty', () => {
    store().set('ui.sidebar_width', 30)
    expect(store().effective('ui.sidebar_width')).toBe(30)
    expect(store().isDirty()).toBe(true)
    expect(store().changedLeaves()).toEqual(['ui.sidebar_width'])
  })

  it('is a no-op when the file already sets that value', () => {
    store().set('ui.sidebar_width', 26)
    expect(store().edits.size).toBe(0)
    expect(store().past).toEqual([])
    expect(store().isDirty()).toBe(false)
  })

  it('records an unset key set to its own documented default', () => {
    expect(store().effective('ui.sidebar_min_width')).toBe(18)
    store().set('ui.sidebar_min_width', 18)
    expect(store().isDirty()).toBe(true)
    expect(store().changedLeaves()).toEqual(['ui.sidebar_min_width'])
  })

  it('compares structured values by content, not identity', () => {
    store().set('ui.sidebar.spaces.rows', [
      ['state_icon', 'workspace'],
      ['branch', 'git_status'],
    ])
    expect(store().edits.size).toBe(0)
    expect(store().isDirty()).toBe(false)
  })

  it('lists changed leaves in schema order', () => {
    store().set('ui.sidebar_width', 30)
    store().set('theme.name', 'nord')
    expect(store().changedLeaves()).toEqual(['theme.name', 'ui.sidebar_width'])
  })
})

describe('reset', () => {
  beforeEach(() => {
    store().loadText(fixture)
  })

  it('marks a key the file set as removed', () => {
    store().reset('theme.name')
    expect(store().edits.get('theme.name')).toBe(REMOVED)
    expect(store().changedLeaves()).toEqual(['theme.name'])
  })

  it('drops the edit for a key the file never set', () => {
    store().set('ui.sidebar_min_width', 20)
    store().reset('ui.sidebar_min_width')
    expect(store().edits.has('ui.sidebar_min_width')).toBe(false)
    expect(store().isDirty()).toBe(false)
  })

  it('is a no-op on a key that is neither set nor edited', () => {
    store().reset('ui.sidebar_min_width')
    expect(store().past).toEqual([])
  })

  it('is a no-op on a key that is already removed', () => {
    store().reset('theme.name')
    const past = store().past
    store().reset('theme.name')
    expect(store().past).toBe(past)
  })
})

describe('paths that are not settings', () => {
  beforeEach(() => {
    store().loadText(fixture)
  })

  it('refuses to set a list of table blocks', () => {
    expect(() =>
      store().set('keys.command', [{ key: 'x', type: 'pane', command: 'zsh' }]),
    ).toThrow(UnwritablePathError)
  })

  it('refuses to set a table of keys', () => {
    expect(() => store().set('theme.custom', { accent: '#ffffff' })).toThrow(
      UnwritablePathError,
    )
    expect(() => store().set('ui.sidebar.agents.rows_by_agent', {})).toThrow(
      UnwritablePathError,
    )
  })

  it('refuses to reset one', () => {
    expect(() => store().reset('keys.command')).toThrow(UnwritablePathError)
  })

  it('leaves the config untouched when it refuses', () => {
    expect(() => store().set('keys.command', [])).toThrow(UnwritablePathError)
    expect(store().edits.size).toBe(0)
    expect(store().changedLeaves()).toEqual([])
    expect(store().exportText()).toBe(fixture)
  })

  it('refuses a path that does not end at a key', () => {
    expect(() =>
      store().set('keys.command[2]', { key: 'x', type: 'pane', command: 'zsh' }),
    ).toThrow(UnwritablePathError)
    expect(() => store().set('', 1)).toThrow(UnwritablePathError)
    expect(() => store().reset('keys.command[0]')).toThrow(UnwritablePathError)
    expect(store().exportText()).toBe(fixture)
  })

  it('refuses a list of tables at a key the schema has not declared as one value', () => {
    store().loadDefaults()
    expect(() => store().set('keys.command', [{ key: 'x', type: 'pane' }])).toThrow(
      UnwritablePathError,
    )
    expect(() =>
      store().set('ui.sidebar.agents.rows_by_agent.claude', [{ token: 'agent' }]),
    ).toThrow(UnwritablePathError)
  })

  it('still takes the list of tables the schema does declare', () => {
    store().set('ui.tab_bar_right', [{ type: 'zoom' }, { type: 'hostname' }])
    expect(store().changedLeaves()).toEqual(['ui.tab_bar_right'])
  })

  it('still takes the fields inside them', () => {
    store().set('keys.command[0].command', 'gitui')
    store().set('theme.custom.accent', '#ffffff')
    store().set('ui.sidebar.agents.rows_by_agent.codex', [['agent']])
    expect(store().changedLeaves()).toEqual([
      'theme.custom.accent',
      'keys.command[0].command',
      'ui.sidebar.agents.rows_by_agent.codex',
    ])
  })
})

describe('values inside an edited value', () => {
  beforeEach(() => {
    store().loadText(fixture)
  })

  it('reads an entry of the array the file parsed to', () => {
    expect(store().effective('ui.tab_bar_right[0].type')).toBe('zoom')
  })

  it('reads through the edit once the whole array is replaced', () => {
    store().set('ui.tab_bar_right', [{ type: 'datetime', format: '%H:%M' }])
    expect(store().effective('ui.tab_bar_right[0].type')).toBe('datetime')
    expect(store().effective('ui.tab_bar_right[0].format')).toBe('%H:%M')
  })

  it('reports an entry the edit dropped as gone', () => {
    store().set('ui.tab_bar_right', [{ type: 'zoom' }])
    expect(store().effective('ui.tab_bar_right[1].type')).toBeUndefined()
  })

  it('reports every entry as gone once the key is reset', () => {
    store().reset('ui.tab_bar_right')
    expect(store().effective('ui.tab_bar_right[0].type')).toBeUndefined()
  })

  it('drops the stale entries from the explicit map', () => {
    store().set('ui.tab_bar_right', [{ type: 'zoom' }])
    expect(store().explicit().has('ui.tab_bar_right[0].type')).toBe(false)
    expect(store().explicit().get('ui.tab_bar_right')).toEqual([{ type: 'zoom' }])
  })

  it('goes back to the file value on undo', () => {
    store().set('ui.tab_bar_right', [{ type: 'datetime', format: '%H:%M' }])
    store().undo()
    expect(store().effective('ui.tab_bar_right[0].type')).toBe('zoom')
  })
})

describe('derived values', () => {
  beforeEach(() => {
    store().loadText(fixture)
  })

  it('hands back the same result until the edits change', () => {
    store().set('ui.sidebar_width', 30)
    const changed = store().changedLeaves()
    const explicit = store().explicit()
    expect(store().changedLeaves()).toBe(changed)
    expect(store().explicit()).toBe(explicit)
    store().select({ key: 'ui.sidebar_width' })
    expect(store().changedLeaves()).toBe(changed)
    expect(store().explicit()).toBe(explicit)
  })

  it('hands back a new result once an edit lands', () => {
    store().set('ui.sidebar_width', 30)
    const changed = store().changedLeaves()
    store().set('theme.name', 'nord')
    expect(store().changedLeaves()).not.toBe(changed)
    expect(store().changedLeaves()).toEqual(['theme.name', 'ui.sidebar_width'])
  })

  it('reuses what it already worked out when history steps back', () => {
    store().set('ui.sidebar_width', 30)
    const changed = store().changedLeaves()
    store().set('theme.name', 'nord')
    store().undo()
    expect(store().changedLeaves()).toBe(changed)
  })
})

describe('undo and redo', () => {
  beforeEach(() => {
    store().loadText(fixture)
  })

  it('steps back to the previous edits and forward again', () => {
    store().set('ui.sidebar_width', 30)
    store().set('ui.sidebar_width', 34)
    store().undo()
    expect(store().effective('ui.sidebar_width')).toBe(30)
    store().undo()
    expect(store().effective('ui.sidebar_width')).toBe(26)
    expect(store().isDirty()).toBe(false)
    store().redo()
    expect(store().effective('ui.sidebar_width')).toBe(30)
    store().redo()
    expect(store().effective('ui.sidebar_width')).toBe(34)
  })

  it('undoes a reset', () => {
    store().reset('theme.name')
    store().undo()
    expect(store().effective('theme.name')).toBe('catppuccin')
    expect(store().isDirty()).toBe(false)
  })

  it('shares the edit maps between the stacks rather than copying them', () => {
    store().set('ui.sidebar_width', 30)
    const edits = store().edits
    store().set('theme.name', 'nord')
    expect(store().past.at(-1)).toBe(edits)
    store().undo()
    expect(store().edits).toBe(edits)
  })

  it('drops the redo stack once a new edit lands', () => {
    store().set('ui.sidebar_width', 30)
    store().undo()
    expect(store().future).toHaveLength(1)
    store().set('theme.name', 'nord')
    expect(store().future).toEqual([])
  })

  it('keeps the stack bounded and drops the oldest steps', () => {
    for (let width = 1; width <= MAX_HISTORY + 20; width++) {
      store().set('ui.sidebar_width', width)
    }
    expect(store().past).toHaveLength(MAX_HISTORY)
    for (let step = 0; step < MAX_HISTORY; step++) store().undo()
    // The 20 oldest states fell off the back, the clean one among them: undo can no
    // longer reach the file's own 26, and stops at the earliest state still held.
    expect(store().effective('ui.sidebar_width')).toBe(20)
    store().undo()
    expect(store().effective('ui.sidebar_width')).toBe(20)
  })

  it('does nothing at either end of the history', () => {
    const before = store().edits
    store().undo()
    store().redo()
    expect(store().edits).toBe(before)
    expect(store().past).toEqual([])
    expect(store().future).toEqual([])
  })
})

describe('selection', () => {
  it('starts on the first section the reference lists', () => {
    expect(store().selection).toEqual({ section: 'ref-general' })
  })

  it('merges a partial selection over the current one', () => {
    store().select({ key: 'ui.sidebar_width' })
    store().select({ region: 'sidebar' })
    expect(store().selection).toEqual({
      section: 'ref-general',
      key: 'ui.sidebar_width',
      region: 'sidebar',
    })
  })

  it('clears the narrower selection when the section changes', () => {
    store().select({ key: 'ui.sidebar_width', region: 'sidebar' })
    store().setSection('ref-theme')
    expect(store().selection).toEqual({ section: 'ref-theme' })
  })
})

describe('the whole effective config', () => {
  it('is herdr defaults alone when nothing has been loaded', () => {
    const values = store().effectiveAll()
    expect(values.get('ui.sidebar_width')).toBe(26)
    expect(values.get('theme.name')).toBe('catppuccin')
    expect(values.get('ui.tab_bar_right')).toEqual([])
    expect(values.get('ui.sidebar.agents.rows_by_agent')).toEqual({})
    // herdr documents these as unset, and TOML has no null to stand in for one.
    expect(values.has('theme.dark_name')).toBe(false)
    expect(values.has('ui.sound.path')).toBe(false)
    // No custom commands, exactly as a parse of such a file would report.
    expect(values.has('keys.command')).toBe(false)
  })

  it('layers the file over the defaults', () => {
    store().loadText(fixture)
    const values = store().effectiveAll()
    expect(values.get('terminal.default_shell')).toBe('/opt/homebrew/bin/fish')
    expect(values.get('ui.sidebar_min_width')).toBe(18)
    expect(values.get('theme.custom.panel_bg')).toBe('reset')
  })

  it('layers edits over the file', () => {
    store().loadText(fixture)
    store().set('ui.sidebar_width', 30)
    store().reset('terminal.default_shell')
    const values = store().effectiveAll()
    expect(values.get('ui.sidebar_width')).toBe(30)
    expect(values.get('terminal.default_shell')).toBe('')
  })

  it('carries the five whole values a validator reads', () => {
    store().loadText(fixture)
    const values = store().effectiveAll()
    expect(values.get('ui.sidebar.spaces.rows')).toEqual([
      ['state_icon', 'workspace'],
      ['branch', 'git_status'],
    ])
    expect(values.get('ui.sidebar.agents.rows_by_agent.claude')).toHaveLength(3)
    expect(values.get('ui.sidebar.agents.rows_by_agent')).toEqual({
      claude: [['state_icon', 'workspace', 'tab'], ['terminal_title_stripped'], ['agent']],
    })
    expect(values.get('ui.tab_bar_right')).toEqual([
      { type: 'zoom' },
      { type: 'hostname' },
      { type: 'datetime', format: '%H:%M' },
    ])
    expect(values.get('keys.command')).toEqual([
      { key: 'prefix+alt+g', type: 'popup', command: 'lazygit', width: '80%', height: '80%' },
      { key: 'prefix+alt+t', type: 'pane', command: 'btop' },
    ])
  })

  it('rebuilds the command list after a per-field edit', () => {
    store().loadText(fixture)
    store().set('keys.command[1].command', 'htop')
    const values = store().effectiveAll()
    expect(values.get('keys.command[1].command')).toBe('htop')
    expect(values.get('keys.command')).toEqual([
      { key: 'prefix+alt+g', type: 'popup', command: 'lazygit', width: '80%', height: '80%' },
      { key: 'prefix+alt+t', type: 'pane', command: 'htop' },
    ])
  })

  it('rebuilds the command list after an append', () => {
    store().loadText(fixture)
    store().set('keys.command[2].key', 'prefix+alt+d')
    store().set('keys.command[2].command', 'dust')
    const values = store().effectiveAll()
    expect(values.get('keys.command')).toHaveLength(3)
    expect(values.get('keys.command[2].command')).toBe('dust')
  })

  it('leaves an empty entry where a reset emptied one', () => {
    store().loadText(fixture)
    for (const field of ['key', 'type', 'command']) {
      store().reset(`keys.command[1].${field}`)
    }
    const values = store().effectiveAll()
    expect(values.get('keys.command')).toEqual([
      { key: 'prefix+alt+g', type: 'popup', command: 'lazygit', width: '80%', height: '80%' },
      {},
    ])
  })

  it('expands a replaced whole value into the paths inside it', () => {
    store().loadText(fixture)
    store().set('ui.tab_bar_right', [{ type: 'datetime', format: '%H:%M' }])
    const values = store().effectiveAll()
    expect(values.get('ui.tab_bar_right[0].type')).toBe('datetime')
    expect(values.get('ui.tab_bar_right[0].format')).toBe('%H:%M')
    expect(values.has('ui.tab_bar_right[1].type')).toBe(false)
  })

  it('agrees with the per-path reader', () => {
    store().loadText(fixture)
    store().set('ui.sidebar_width', 30)
    store().set('keys.command[0].command', 'gitui')
    const values = store().effectiveAll()
    for (const path of values.keys()) {
      expect([path, store().effective(path)]).toEqual([path, values.get(path)])
    }
  })

  it('hands back the same map until the edits change', () => {
    store().loadText(fixture)
    const values = store().effectiveAll()
    store().select({ region: 'sidebar' })
    expect(store().effectiveAll()).toBe(values)
    store().set('ui.sidebar_width', 30)
    expect(store().effectiveAll()).not.toBe(values)
    store().undo()
    expect(store().effectiveAll()).toBe(values)
  })
})

describe('apply', () => {
  it('makes several writes one undo step', () => {
    store().apply([
      { kind: 'set', path: 'keys.command[0].command', value: 'lazygit' },
      { kind: 'set', path: 'keys.command[0].type', value: 'popup' },
      { kind: 'set', path: 'ui.sidebar_width', value: 30 },
    ])
    expect(store().changedLeaves()).toHaveLength(3)

    store().undo()

    expect(store().isDirty()).toBe(false)
    expect(store().past).toHaveLength(0)
  })

  it('takes removals and writes in the order it is given them', () => {
    store().loadText(fixture)
    store().apply([
      { kind: 'remove', path: 'keys.command[0].command' },
      { kind: 'set', path: 'keys.command[0].command', value: 'gitui' },
    ])
    expect(store().effective('keys.command[0].command')).toBe('gitui')
  })

  it('is nothing at all when no op changes anything', () => {
    store().loadText(fixture)
    store().apply([{ kind: 'set', path: 'theme.name', value: 'catppuccin' }])
    expect(store().past).toHaveLength(0)
  })

  it('writes none of a batch that names a path it cannot write', () => {
    expect(() =>
      store().apply([
        { kind: 'set', path: 'ui.sidebar_width', value: 30 },
        { kind: 'set', path: 'theme.custom', value: { base: '#000000' } },
      ]),
    ).toThrow(UnwritablePathError)
    expect(store().isDirty()).toBe(false)
  })
})
