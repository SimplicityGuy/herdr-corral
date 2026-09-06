import { describe, expect, it } from 'vitest'
import {
  BOM,
  TomlSyntaxError,
  flattenTree,
  isCompleteValue,
  parseToml,
  stripBom,
  tryParseToml,
} from '@/model/parse'
import fixture from '@/test/fixture-user-config.toml?raw'

describe('parsing', () => {
  it('parses the fixture into a tree', () => {
    const { tree } = parseToml(fixture)
    expect(Object.keys(tree)).toEqual(['theme', 'terminal', 'keys', 'ui', 'advanced'])
  })

  it('flattens leaves onto the paths that address them', () => {
    const { values } = parseToml(fixture)
    expect(values.get('theme.name')).toBe('catppuccin')
    expect(values.get('theme.custom.panel_bg')).toBe('reset')
    expect(values.get('ui.sidebar_width')).toBe(26)
    expect(values.get('ui.mouse_capture')).toBe(true)
    expect(values.get('advanced.scrollback_limit_bytes')).toBe(10_000_000)
  })

  it('expands an array of tables into indexed paths and keeps the array itself', () => {
    const { values } = parseToml(fixture)
    expect(values.get('keys.command[0].command')).toBe('lazygit')
    expect(values.get('keys.command[1].type')).toBe('pane')
    expect(values.get('keys.command[1].width')).toBeUndefined()
    expect(values.get('keys.command')).toHaveLength(2)
  })

  it('treats an array of scalars or arrays as one leaf', () => {
    const { values } = parseToml(fixture)
    expect(values.get('ui.sidebar.spaces.rows')).toEqual([
      ['state_icon', 'workspace'],
      ['branch', 'git_status'],
    ])
    expect(values.get('ui.sidebar.agents.rows_by_agent.claude')).toHaveLength(3)
  })

  it('records styled tokens inside a row array', () => {
    const { values } = parseToml(fixture)
    expect(values.get('ui.sidebar.agents.rows')).toEqual([
      ['state_icon', { token: 'workspace', fg: '#89b4fa', bold: true }, 'tab'],
      [{ token: 'agent', fg: '#a6e3a1', dim: true }, '$model'],
    ])
  })

  it('quotes a flattened key that is not a bare identifier', () => {
    const values = flattenTree(parseToml('[a]\n"my agent" = 1\n').tree)
    expect([...values.keys()]).toEqual(['a."my agent"'])
  })
})

describe('byte-order marks', () => {
  it('strips a leading BOM before handing text to the parser', () => {
    expect(stripBom(`${BOM}a = 1`)).toBe('a = 1')
    expect(stripBom('a = 1')).toBe('a = 1')
    expect(parseToml(`${BOM}${fixture}`).values.get('theme.name')).toBe('catppuccin')
  })
})

describe('syntax errors', () => {
  it('reports the line and column of the offending character', () => {
    const outcome = tryParseToml('a = 1\nb = = 2\n')
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toBeInstanceOf(TomlSyntaxError)
    expect(outcome.error.line).toBe(2)
    expect(outcome.error.column).toBe(5)
    expect(outcome.error.codeblock).toContain('b = = 2')
  })

  it('reports a position on a later line too', () => {
    const outcome = tryParseToml('[a]\nb = 1\n[a]\n')
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.line).toBe(3)
    expect(outcome.error.message).toMatch(/redefine|already/i)
  })

  it('throws rather than returning for the throwing entry point', () => {
    expect(() => parseToml('a = ')).toThrow(TomlSyntaxError)
  })

  it('reports an unterminated string where it opens', () => {
    const outcome = tryParseToml('name = "catppuccin\n')
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.line).toBe(1)
  })
})

describe('probing a value in isolation', () => {
  it('accepts complete values and rejects prose', () => {
    expect(isCompleteValue('"catppuccin"')).toBe(true)
    expect(isCompleteValue('[["a"], ["b"]]')).toBe(true)
    expect(isCompleteValue('{ token = "workspace", bold = true }')).toBe(true)
    expect(isCompleteValue('26')).toBe(true)
    expect(isCompleteValue('"shell" runs detached in the background.')).toBe(false)
    expect(isCompleteValue('')).toBe(false)
    expect(isCompleteValue('[')).toBe(false)
  })
})
