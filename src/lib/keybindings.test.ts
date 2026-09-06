import {
  COMMAND_FIELDS,
  COMMAND_TYPES,
  appendCommandOps,
  bindingKeys,
  commandField,
  commandsIn,
  conflictMessage,
  conflictsFor,
  conflictsIn,
  groupOf,
  groupedBindings,
  isConflictMessage,
  parseSize,
  removeCommandOps,
} from '@/lib/keybindings'
import type { TomlTable } from '@/model/parse'
import type { Diagnostic } from '@/model/validate'
import { allKeys } from '@/schema'
import { describe, expect, it } from 'vitest'

describe('grouping', () => {
  it('gives every keybinding setting exactly one group', () => {
    const grouped = groupedBindings().flatMap((entry) => entry.keys)
    expect(new Set(grouped).size).toBe(grouped.length)
    expect([...grouped].sort()).toEqual([...bindingKeys()].sort())
  })

  it('covers the whole `[keys]` table apart from the indexed block', () => {
    const table = allKeys().filter((key) => key.startsWith('keys.'))
    const missing = table.filter(
      (key) => !key.startsWith('keys.indexed.') && !bindingKeys().includes(key),
    )
    expect(missing).toEqual([])
  })

  it('keeps the reference page order inside a group', () => {
    const panes = groupedBindings().find((entry) => entry.group === 'panes')?.keys ?? []
    const order = allKeys()
    const positions = panes.map((key) => order.indexOf(key))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('files the actions where someone would look for them', () => {
    expect(groupOf('keys.prefix')).toBe('prefix and global')
    expect(groupOf('keys.split_vertical')).toBe('panes')
    expect(groupOf('keys.switch_tab')).toBe('tabs and workspaces')
    expect(groupOf('keys.navigate_pane_left')).toBe('navigate mode')
    expect(groupOf('keys.focus_agent')).toBe('agents')
    expect(groupOf('keys.toggle_sidebar')).toBe('misc')
  })

  it('leaves no group empty, so a heading always has rows under it', () => {
    for (const { group, keys } of groupedBindings()) {
      expect(keys.length, `${group} must have rows`).toBeGreaterThan(0)
    }
  })
})

describe('conflicts', () => {
  const collision: Diagnostic = {
    severity: 'warning',
    path: 'keys.close_pane',
    message: 'prefix+y: kept keys.split_vertical, disabled keys.close_pane',
  }
  const unrelated: Diagnostic = {
    severity: 'warning',
    path: 'keys.help',
    message: 'invalid keybinding "wat"; herdr will disable the binding',
  }

  it('reads herdr’s own warning back into a pair of actions', () => {
    expect(conflictsIn([collision, unrelated])).toEqual([
      { label: 'prefix+y', kept: 'keys.split_vertical', disabled: 'keys.close_pane' },
    ])
  })

  it('finds the pair from either side of it', () => {
    const conflicts = conflictsIn([collision])
    expect(conflictsFor(conflicts, 'keys.split_vertical')).toHaveLength(1)
    expect(conflictsFor(conflicts, 'keys.close_pane')).toHaveLength(1)
    expect(conflictsFor(conflicts, 'keys.zoom')).toHaveLength(0)
  })

  it('names both actions on both rows', () => {
    const [conflict] = conflictsIn([collision])
    for (const key of ['keys.split_vertical', 'keys.close_pane']) {
      const message = conflictMessage(conflict, key)
      expect(message).toContain('keys.split_vertical')
      expect(message).toContain('keys.close_pane')
      expect(message).toContain('prefix+y')
    }
  })

  it('recognizes only the collision warning', () => {
    expect(isConflictMessage(collision.message)).toBe(true)
    expect(isConflictMessage(unrelated.message)).toBe(false)
  })
})

describe('[[keys.command]]', () => {
  it('reads the array the store derives from the per-field leaves', () => {
    const effective = new Map([['keys.command', [{ key: 'prefix+t', command: 'htop' }]]])
    expect(commandsIn(effective)).toEqual([{ key: 'prefix+t', command: 'htop' }])
    expect(commandsIn(new Map())).toEqual([])
  })

  it('appends at the array length, never into a gap', () => {
    expect(appendCommandOps([{ command: 'a' }, { command: 'b' }])).toEqual([
      { kind: 'set', path: 'keys.command[2].type', value: 'shell' },
      { kind: 'set', path: 'keys.command[2].command', value: '' },
    ])
  })

  it('closes the gap a removal leaves rather than going sparse', () => {
    const commands: TomlTable[] = [
      { command: 'a' },
      { command: 'b', key: 'prefix+b' },
      { command: 'c' },
    ]
    const ops = removeCommandOps(commands, 0)

    // Entry 1 moves into slot 0 and entry 2 into slot 1; slot 2 is cleared.
    expect(ops).toContainEqual({ kind: 'set', path: 'keys.command[0].command', value: 'b' })
    expect(ops).toContainEqual({ kind: 'set', path: 'keys.command[0].key', value: 'prefix+b' })
    expect(ops).toContainEqual({ kind: 'set', path: 'keys.command[1].command', value: 'c' })
    for (const field of COMMAND_FIELDS) {
      expect(ops).toContainEqual({ kind: 'remove', path: commandField(2, field) })
    }
  })

  it('clears a field the entry moving in does not have', () => {
    const commands: TomlTable[] = [{ command: 'a' }, { command: 'b' }]
    const ops = removeCommandOps(commands, 0)
    expect(ops).toContainEqual({ kind: 'remove', path: 'keys.command[0].key' })
  })

  it('does nothing for an index that is not there', () => {
    expect(removeCommandOps([{ command: 'a' }], 3)).toEqual([])
  })

  it('offers herdr’s four execution modes', () => {
    expect(COMMAND_TYPES).toContain('popup')
    expect(COMMAND_TYPES).toContain('shell')
  })
})

describe('parseSize', () => {
  it('reads digits as cells and everything else as the string herdr wants', () => {
    expect(parseSize('80')).toBe(80)
    expect(parseSize(' 24 ')).toBe(24)
    expect(parseSize('80%')).toBe('80%')
    expect(parseSize('wide')).toBe('wide')
  })
})
