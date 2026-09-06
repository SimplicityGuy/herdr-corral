/**
 * The store's contract: what a setting reads as, and what an edit costs.
 *
 * Two behaviours here look like bugs until you read invariant 2. Setting a key to a
 * value it already has is a no-op — but only when the key is *already set*; setting an
 * unset key to its own documented default is a real change, because it is the difference
 * between "herdr decides" and "I decided, and I decided this".
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { REMOVED, useConfigStore, resetConfigStore } from '@/store/config'
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
