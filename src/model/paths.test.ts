import { describe, expect, it } from 'vitest'
import {
  TomlPathError,
  childPath,
  escapeBasicString,
  formatPath,
  indexedPath,
  isBareKey,
  locateHeader,
  locateKey,
  normalizePath,
  parsePath,
  quoteKey,
  readDottedKey,
  readKeyToken,
} from '@/model/paths'

describe('key syntax', () => {
  it('accepts the characters TOML allows in a bare key', () => {
    expect(isBareKey('rows_by_agent')).toBe(true)
    expect(isBareKey('tab-bar-right')).toBe(true)
    expect(isBareKey('claude')).toBe(true)
    expect(isBareKey('my agent')).toBe(false)
    expect(isBareKey('')).toBe(false)
    expect(isBareKey('a.b')).toBe(false)
  })

  it('quotes only the keys that need it', () => {
    expect(quoteKey('sidebar_width')).toBe('sidebar_width')
    expect(quoteKey('my agent')).toBe('"my agent"')
    expect(quoteKey('')).toBe('""')
    expect(quoteKey('a"b')).toBe('"a\\"b"')
  })

  it('escapes control characters and quotes in a basic string', () => {
    expect(escapeBasicString('a"b\\c')).toBe('a\\"b\\\\c')
    expect(escapeBasicString('a\nb\tc')).toBe('a\\nb\\tc')
    expect(escapeBasicString('\u0001')).toBe('\\u0001')
    expect(escapeBasicString('\u007f')).toBe('\\u007f')
    expect(escapeBasicString('héllo \u{1f411}')).toBe('héllo \u{1f411}')
  })
})

describe('reading key tokens out of a line', () => {
  it('reads bare, basic-quoted and literal-quoted keys', () => {
    expect(readKeyToken('sidebar_width = 26', 0)).toEqual({ key: 'sidebar_width', end: 13 })
    expect(readKeyToken('"my agent" = 1', 0)).toEqual({ key: 'my agent', end: 10 })
    expect(readKeyToken("'raw key' = 1", 0)).toEqual({ key: 'raw key', end: 9 })
    expect(readKeyToken('= 1', 0)).toBeNull()
    expect(readKeyToken('', 0)).toBeNull()
  })

  it('decodes escapes inside a basic-quoted key', () => {
    expect(readKeyToken('"a\\u0041b" = 1', 0)).toEqual({ key: 'aAb', end: 10 })
    expect(readKeyToken('"unterminated = 1', 0)).toBeNull()
  })

  it('reads a dotted key with whitespace around the dots', () => {
    expect(readDottedKey('a . b."c d" = 1', 0)).toEqual({ keys: ['a', 'b', 'c d'], end: 11 })
    expect(readDottedKey('# prose here', 0)).toBeNull()
  })
})

describe('paths', () => {
  it('round-trips through parse and format', () => {
    for (const path of [
      'onboarding',
      'ui.sidebar_width',
      'theme.custom.accent',
      'keys.command[2].key',
      'ui.sidebar.agents.rows_by_agent."my agent"',
    ]) {
      expect(formatPath(parsePath(path))).toBe(path)
    }
  })

  it('parses array-of-tables indices as their own segments', () => {
    expect(parsePath('keys.command[2].key')).toEqual([
      { kind: 'key', key: 'keys' },
      { kind: 'key', key: 'command' },
      { kind: 'index', index: 2 },
      { kind: 'key', key: 'key' },
    ])
  })

  it('normalizes quoting that was not needed', () => {
    expect(normalizePath('"ui"."sidebar_width"')).toBe('ui.sidebar_width')
    expect(normalizePath("keys.'command'[0].key")).toBe('keys.command[0].key')
  })

  it('rejects malformed paths', () => {
    expect(() => parsePath('ui..width')).toThrow(TomlPathError)
    expect(() => parsePath('keys.command[x]')).toThrow(TomlPathError)
    expect(() => parsePath('keys.command[0')).toThrow(TomlPathError)
    expect(() => parsePath('ui width')).toThrow(TomlPathError)
  })

  it('builds child and indexed paths', () => {
    expect(childPath('', 'ui')).toBe('ui')
    expect(childPath('ui', 'sidebar width')).toBe('ui."sidebar width"')
    expect(indexedPath('keys.command', 1)).toBe('keys.command[1]')
  })
})

describe('splitting a path into a header and a key', () => {
  it('separates the owning table from the leaf key', () => {
    expect(locateKey('onboarding')).toEqual({ header: '', key: 'onboarding' })
    expect(locateKey('ui.sidebar_width')).toEqual({ header: 'ui', key: 'sidebar_width' })
    expect(locateKey('keys.command[2].key')).toEqual({ header: 'keys.command[2]', key: 'key' })
    expect(locateKey('ui.sidebar.agents.rows_by_agent."my agent"')).toEqual({
      header: 'ui.sidebar.agents.rows_by_agent',
      key: 'my agent',
    })
  })

  it('refuses a path that names a table', () => {
    expect(() => locateKey('')).toThrow(TomlPathError)
    expect(() => locateKey('keys.command[2]')).toThrow(TomlPathError)
  })

  it('splits a header into its written name and occurrence', () => {
    expect(locateHeader('ui.sidebar.agents')).toEqual({
      name: 'ui.sidebar.agents',
      index: null,
      nested: false,
    })
    expect(locateHeader('keys.command[1]')).toEqual({
      name: 'keys.command',
      index: 1,
      nested: false,
    })
    expect(locateHeader('keys.command[1].opts')).toEqual({
      name: 'keys.command.opts',
      index: null,
      nested: true,
    })
    expect(() => locateHeader('')).toThrow(TomlPathError)
  })
})
