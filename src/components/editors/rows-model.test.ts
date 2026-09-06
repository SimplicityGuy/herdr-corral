import {
  MAX_ROWS,
  MAX_TOKENS_PER_ROW,
  TOO_MANY_ROWS,
  TOO_MANY_TOKENS,
  addRow,
  asRows,
  customToken,
  insertToken,
  isStyled,
  moveRow,
  moveToken,
  nudgeRow,
  nudgeToken,
  removeRow,
  removeToken,
  replaceToken,
  sameRows,
  styleOf,
  tokenNameOf,
  withStyle,
} from '@/components/editors/rows-model'
import { describe, expect, it } from 'vitest'

const DEFAULT_AGENTS = [['state_icon', 'workspace', 'tab'], ['agent']]

function rowOf(length: number): string[] {
  return Array.from({ length }, (_, index) => `$t${index}`)
}

describe('asRows', () => {
  it('reads a rows value back as rows', () => {
    expect(asRows(DEFAULT_AGENTS)).toEqual(DEFAULT_AGENTS)
  })

  it('answers nothing for a value that is not a list', () => {
    expect(asRows('state_icon')).toEqual([])
    expect(asRows(undefined)).toEqual([])
  })

  it('drops a row that is not a list rather than crashing the editor', () => {
    expect(asRows([['agent'], 'workspace'])).toEqual([['agent'], []])
  })

  it('copies, so an edit cannot reach back into the store', () => {
    const source = [['agent']]
    const rows = asRows(source)
    rows[0].push('tab')
    expect(source).toEqual([['agent']])
  })
})

describe('reading an entry', () => {
  it('names the token in both spellings', () => {
    expect(tokenNameOf('workspace')).toBe('workspace')
    expect(tokenNameOf({ token: 'workspace', fg: '#89b4fa' })).toBe('workspace')
    expect(tokenNameOf(42)).toBe('')
  })

  it('reads only the style fields herdr accepts', () => {
    expect(styleOf('workspace')).toEqual({})
    expect(styleOf({ token: 'workspace', fg: '#89b4fa', bold: true, dim: false })).toEqual({
      fg: '#89b4fa',
      bold: true,
    })
  })

  it('calls an entry styled only when a style is actually set', () => {
    expect(isStyled('workspace')).toBe(false)
    expect(isStyled({ token: 'workspace' })).toBe(false)
    expect(isStyled({ token: 'workspace', dim: true })).toBe(true)
  })
})

describe('withStyle', () => {
  it('writes an inline table in herdr’s own field order', () => {
    expect(withStyle('workspace', { fg: '#89b4fa', bold: true, dim: true })).toEqual({
      token: 'workspace',
      fg: '#89b4fa',
      bold: true,
      dim: true,
    })
    expect(Object.keys(withStyle('workspace', { fg: '#89b4fa', bold: true }))).toEqual([
      'token',
      'fg',
      'bold',
    ])
  })

  it('returns a plain string once nothing is set', () => {
    const styled = withStyle('workspace', { bold: true })
    expect(withStyle(styled, { bold: false })).toBe('workspace')
    expect(withStyle(styled, {})).toBe('workspace')
  })

  it('never writes a false flag, because absence is what preserves the default', () => {
    expect(withStyle('workspace', { fg: '#89b4fa', bold: false, dim: false })).toEqual({
      token: 'workspace',
      fg: '#89b4fa',
    })
  })
})

describe('moving a token', () => {
  it('reorders within a row', () => {
    const moved = moveToken(DEFAULT_AGENTS, { row: 0, index: 0 }, { row: 0, index: 2 })
    expect(moved).toEqual({ ok: true, rows: [['workspace', 'tab', 'state_icon'], ['agent']] })
  })

  it('carries a token into another row', () => {
    const moved = moveToken(DEFAULT_AGENTS, { row: 0, index: 2 }, { row: 1, index: 0 })
    expect(moved).toEqual({ ok: true, rows: [['state_icon', 'workspace'], ['tab', 'agent']] })
  })

  it('refuses to overfill the row it lands in', () => {
    const rows = [rowOf(MAX_TOKENS_PER_ROW), ['agent']]
    expect(moveToken(rows, { row: 1, index: 0 }, { row: 0, index: 0 })).toEqual({
      ok: false,
      reason: TOO_MANY_TOKENS,
    })
  })

  it('lets a full row reorder itself, because nothing is being added', () => {
    const rows = [rowOf(MAX_TOKENS_PER_ROW)]
    const moved = moveToken(rows, { row: 0, index: 0 }, { row: 0, index: 15 })
    expect(moved.ok).toBe(true)
    expect(moved.ok && moved.rows[0]).toHaveLength(MAX_TOKENS_PER_ROW)
    expect(moved.ok && moved.rows[0][15]).toBe('$t0')
  })

  it('refuses a token that is no longer there', () => {
    expect(moveToken(DEFAULT_AGENTS, { row: 0, index: 9 }, { row: 1, index: 0 }).ok).toBe(false)
  })
})

describe('moving a row', () => {
  it('reorders the layout', () => {
    expect(moveRow(DEFAULT_AGENTS, 0, 1)).toEqual({
      ok: true,
      rows: [['agent'], ['state_icon', 'workspace', 'tab']],
    })
  })

  it('refuses a row that is no longer there', () => {
    expect(moveRow(DEFAULT_AGENTS, 4, 0).ok).toBe(false)
  })
})

describe('the caps herdr enforces', () => {
  it('refuses the seventeenth row, with the sentence the file would be rejected for', () => {
    const rows = Array.from({ length: MAX_ROWS }, () => ['agent'])
    expect(addRow(rows)).toEqual({ ok: false, reason: TOO_MANY_ROWS })
    expect(TOO_MANY_ROWS).toContain('16')
  })

  it('allows the sixteenth row', () => {
    const rows = Array.from({ length: MAX_ROWS - 1 }, () => ['agent'])
    const added = addRow(rows)
    expect(added.ok && added.rows).toHaveLength(MAX_ROWS)
  })

  it('refuses the seventeenth token in a row', () => {
    const rows = [rowOf(MAX_TOKENS_PER_ROW)]
    expect(insertToken(rows, { row: 0, index: 0 }, 'agent')).toEqual({
      ok: false,
      reason: TOO_MANY_TOKENS,
    })
  })

  it('allows the sixteenth token', () => {
    const rows = [rowOf(MAX_TOKENS_PER_ROW - 1)]
    const added = insertToken(rows, { row: 0, index: 99 }, 'agent')
    expect(added.ok && added.rows[0]).toHaveLength(MAX_TOKENS_PER_ROW)
    expect(added.ok && added.rows[0].at(-1)).toBe('agent')
  })
})

describe('adding and removing', () => {
  it('inserts at a position, clamping past the end', () => {
    expect(insertToken([['agent']], { row: 0, index: 99 }, 'tab')).toEqual({
      ok: true,
      rows: [['agent', 'tab']],
    })
  })

  it('takes a token out — what dragging one off the popover does', () => {
    expect(removeToken(DEFAULT_AGENTS, { row: 0, index: 1 })).toEqual({
      ok: true,
      rows: [['state_icon', 'tab'], ['agent']],
    })
  })

  it('replaces one entry, which is how a style lands', () => {
    const styled = replaceToken(DEFAULT_AGENTS, { row: 1, index: 0 }, { token: 'agent', bold: true })
    expect(styled).toEqual({ ok: true, rows: [['state_icon', 'workspace', 'tab'], [{ token: 'agent', bold: true }]] })
  })

  it('drops a row and everything in it', () => {
    expect(removeRow(DEFAULT_AGENTS, 0)).toEqual({ ok: true, rows: [['agent']] })
  })
})

describe('the keyboard equivalents', () => {
  it('walks a token along its row', () => {
    const moved = nudgeToken(DEFAULT_AGENTS, { row: 0, index: 0 }, 'right')
    expect(moved.ok && moved.rows[0]).toEqual(['workspace', 'state_icon', 'tab'])
  })

  it('says so rather than doing nothing at the end of a row', () => {
    expect(nudgeToken(DEFAULT_AGENTS, { row: 0, index: 0 }, 'left')).toEqual({
      ok: false,
      reason: 'this token is already at the start of its row',
    })
  })

  it('carries a token into the row below, keeping its place in the line', () => {
    const rows = [
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]
    const moved = nudgeToken(rows, { row: 0, index: 1 }, 'down')
    expect(moved.ok && moved.rows).toEqual([
      ['a', 'c'],
      ['d', 'b', 'e', 'f'],
    ])
  })

  it('clamps into a shorter row rather than leaving a gap', () => {
    const moved = nudgeToken([['a', 'b', 'c'], ['d']], { row: 0, index: 2 }, 'down')
    expect(moved.ok && moved.rows).toEqual([
      ['a', 'b'],
      ['d', 'c'],
    ])
  })

  it('says there is no row past the last one', () => {
    expect(nudgeToken(DEFAULT_AGENTS, { row: 1, index: 0 }, 'down')).toEqual({
      ok: false,
      reason: 'there is no row below this one',
    })
  })

  it('moves a row up and down, and says when it cannot', () => {
    expect(nudgeRow(DEFAULT_AGENTS, 1, 'up')).toEqual({
      ok: true,
      rows: [['agent'], ['state_icon', 'workspace', 'tab']],
    })
    expect(nudgeRow(DEFAULT_AGENTS, 0, 'up')).toEqual({
      ok: false,
      reason: 'there is no row above this one',
    })
  })
})

describe('customToken', () => {
  it('adds the $ that makes a token custom', () => {
    expect(customToken('ticket')).toBe('$ticket')
    expect(customToken(' $ticket ')).toBe('$ticket')
  })

  it('answers nothing for nothing', () => {
    expect(customToken('   ')).toBe('')
  })
})

describe('sameRows', () => {
  it('is true for the same layout and false for a moved token', () => {
    expect(sameRows(DEFAULT_AGENTS, [['state_icon', 'workspace', 'tab'], ['agent']])).toBe(true)
    expect(sameRows(DEFAULT_AGENTS, [['workspace', 'state_icon', 'tab'], ['agent']])).toBe(false)
  })
})
