import { describe, expect, it } from 'vitest'
import { parseToml } from '@/model/parse'
import { TomlDocument, TomlDocumentError } from '@/model/toml-doc'
import defaults from '@/test/fixture-herdr-defaults.toml?raw'
import fixture from '@/test/fixture-user-config.toml?raw'

/** Edit a document and hand back its text, having proved the result still parses. */
function applied(source: string, edit: (doc: TomlDocument) => void): string {
  const doc = new TomlDocument(source)
  edit(doc)
  const text = doc.text()
  parseToml(text)
  return text
}

describe('tables that no header line declares', () => {
  it('finds the tables a dotted key, an inline table, and an array of them imply', () => {
    expect(new TomlDocument('[a]\nb.c = 1\n').implicitTablePaths()).toEqual(['a.b'])
    expect(new TomlDocument('[ui]\nstyle = { fg = "red" }\n').implicitTablePaths()).toEqual([
      'ui.style',
    ])
    expect(
      new TomlDocument('[ui]\ntab_bar_right = [{ type = "zoom" }]\n').implicitTablePaths(),
    ).toEqual(['ui.tab_bar_right[0]'])
    expect(new TomlDocument('[a]\nb.c.d = 1\n').implicitTablePaths()).toEqual(['a.b', 'a.b.c'])
  })

  it('finds them inside the project fixture, styled row tokens included', () => {
    const paths = new TomlDocument(fixture).implicitTablePaths()
    expect(paths).toContain('ui.tab_bar_right[0]')
    expect(paths).toContain('ui.tab_bar_right[2]')
    expect(paths).toContain('ui.sidebar.agents.rows[0][1]')
    expect(paths).not.toContain('ui.tab_bar_right[3]')
  })

  it('does not call an ordinary table or array implicit', () => {
    expect(new TomlDocument('[a]\nb = 1\nc = ["x"]\n').implicitTablePaths()).toEqual([])
  })
})

describe('writing into an inline table', () => {
  it('edits the value in place instead of writing a second header over it', () => {
    expect(applied('[ui]\nstyle = { fg = "red" }\n', (doc) => doc.set('ui.style.fg', 'X'))).toBe(
      '[ui]\nstyle = { fg = "X" }\n',
    )
  })

  it('adds a field the inline table did not have', () => {
    expect(applied('[ui]\nstyle = { fg = "red" }\n', (doc) => doc.set('ui.style.bold', true))).toBe(
      '[ui]\nstyle = { fg = "red", bold = true }\n',
    )
  })

  it('creates a nested table on the way down', () => {
    expect(applied('[ui]\nstyle = { fg = "red" }\n', (doc) => doc.set('ui.style.a.b', 1))).toBe(
      '[ui]\nstyle = { fg = "red", a = { b = 1 } }\n',
    )
  })

  it('removes a field from an inline table', () => {
    expect(
      applied('[ui]\nstyle = { fg = "red", bold = true }\n', (doc) => doc.remove('ui.style.bold')),
    ).toBe('[ui]\nstyle = { fg = "red" }\n')
  })

  it('leaves an inline table alone when the field was not there', () => {
    const source = '[ui]\nstyle = { fg = "red" }\n'
    expect(applied(source, (doc) => doc.remove('ui.style.bold'))).toBe(source)
  })

  it('refuses to descend into a value that is not a table', () => {
    const doc = new TomlDocument('[ui]\nwidth = 26\n')
    expect(() => doc.set('ui.width.fg', 'X')).toThrow(TomlDocumentError)
    expect(() => doc.set('ui.width.fg', 'X')).toThrow(/not a table/)
  })
})

describe('writing into an array of inline tables', () => {
  const source = '[ui]\ntab_bar_right = [{ type = "zoom" }]\n'

  it('edits one entry in place', () => {
    expect(applied(source, (doc) => doc.set('ui.tab_bar_right[0].type', 'X'))).toBe(
      '[ui]\ntab_bar_right = [{ type = "X" }]\n',
    )
  })

  it('appends the next entry', () => {
    expect(applied(source, (doc) => doc.set('ui.tab_bar_right[1].type', 'hostname'))).toBe(
      '[ui]\ntab_bar_right = [{ type = "zoom" }, { type = "hostname" }]\n',
    )
  })

  it('refuses an index that would leave a gap, and says how many entries there are', () => {
    const doc = new TomlDocument(source)
    expect(() => doc.set('ui.tab_bar_right[2].format', 'X')).toThrow(TomlDocumentError)
    expect(() => doc.set('ui.tab_bar_right[2].format', 'X')).toThrow(
      /ui\.tab_bar_right has 1 entry/,
    )
  })

  it('drops an entry on remove', () => {
    expect(
      applied('[ui]\nr = [{ a = 1 }, { b = 2 }]\n', (doc) => doc.remove('ui.r[0].a')),
    ).toBe('[ui]\nr = [{}, { b = 2 }]\n')
  })

  it('edits a styled token inside a wrapped row array in the project fixture', () => {
    const text = applied(fixture, (doc) =>
      doc.set('ui.sidebar.agents.rows[0][1].fg', '#f38ba8'),
    )
    expect(text).toContain('{ token = "workspace", fg = "#f38ba8", bold = true }')
    expect(text).toContain('{ token = "agent", fg = "#a6e3a1", dim = true }')
  })

  it('round-trips a path that parse.ts produced from the fixture', () => {
    const values = parseToml(fixture).values
    expect(values.get('ui.tab_bar_right[2].format')).toBe('%H:%M')
    const doc = new TomlDocument(fixture)
    doc.set('ui.tab_bar_right[2].format', '%H:%M:%S')
    expect(doc.parse().values.get('ui.tab_bar_right[2].format')).toBe('%H:%M:%S')
    expect(doc.text()).not.toContain('[[ui.tab_bar_right]]')
  })
})

describe('writing into a table a dotted key implied', () => {
  it('appends a dotted key rather than a second header', () => {
    expect(applied('[a]\nb.c = 1\n', (doc) => doc.set('a.b.d', 'X'))).toBe(
      '[a]\nb.c = 1\nb.d = "X"\n',
    )
  })

  it('carries every level of a deeper implicit path', () => {
    expect(applied('[a]\nb.c.d = 1\n', (doc) => doc.set('a.b.c.e', 2))).toBe(
      '[a]\nb.c.d = 1\nb.c.e = 2\n',
    )
  })

  it('works at the root, where there is no header to hang it under', () => {
    expect(applied('b.c = 1\n', (doc) => doc.set('b.d', 2))).toBe('b.c = 1\nb.d = 2\n')
  })

  it('still writes a real header when nothing implied the table', () => {
    expect(applied('[a]\nb = 1\n', (doc) => doc.set('c.d', 2))).toBe('[a]\nb = 1\n\n[c]\nd = 2\n')
  })
})

describe('uncommenting a default whose table is already defined', () => {
  it('refuses when a dotted key implied the table', () => {
    const source = '[a]\nb.x = 1\n\n# [a.b]\n# y = 2\n'
    expect(applied(source, (doc) => doc.set('a.b.y', 3))).toBe(
      '[a]\nb.x = 1\nb.y = 3\n\n# [a.b]\n# y = 2\n',
    )
  })

  it('refuses when an inline table holds it, and writes into the value instead', () => {
    const source = '[a]\nb = { x = 1 }\n\n# [a.b]\n# y = 2\n'
    expect(applied(source, (doc) => doc.set('a.b.y', 3))).toBe(
      '[a]\nb = { x = 1, y = 3 }\n\n# [a.b]\n# y = 2\n',
    )
  })

  it('refuses when an array of inline tables holds it', () => {
    const source = '[a]\nb = [{ x = 1 }]\n\n# [[a.b]]\n# y = 2\n'
    expect(applied(source, (doc) => doc.set('a.b[0].y', 3))).toBe(
      '[a]\nb = [{ x = 1, y = 3 }]\n\n# [[a.b]]\n# y = 2\n',
    )
  })

  it('still uncomments in place when nothing else defines the table', () => {
    expect(applied('[a]\nz = 1\n\n# [a.b]\n# y = 2\n', (doc) => doc.set('a.b.y', 3))).toBe(
      '[a]\nz = 1\n\n[a.b]\ny = 3\n',
    )
  })
})

describe('a commented header owns its own comment block and no more', () => {
  it('reads herdr’s stray accent default as a key of [ui]', () => {
    const paths = new TomlDocument(defaults).commentedDefaultPaths()
    expect(paths).toContain('ui.accent')
    expect(paths).not.toContain('ui.sidebar.spaces.accent')
    expect(paths).toContain('ui.sidebar.spaces.rows')
    expect(paths).toContain('ui.sidebar.agents.rows_by_agent.claude')
    expect(paths).toContain('theme.custom.sidebar_bg')
    expect(paths).toContain('keys.command[0].key')
  })

  it('uncomments that accent line in place, inventing no table', () => {
    const before = defaults.split('\n')
    const doc = new TomlDocument(defaults)
    doc.set('ui.accent', 'mauve')
    const after = doc.text().split('\n')
    expect(after).toHaveLength(before.length)
    const changed = before.flatMap((line, index) => (line === after[index] ? [] : [index]))
    expect(changed).toHaveLength(1)
    expect(before[changed[0]]).toBe('# accent = "cyan"')
    expect(after[changed[0]]).toBe('accent = "mauve"')
    expect(doc.headerPaths()).not.toContain('ui.sidebar.spaces')
    expect(doc.parse().values.get('ui.accent')).toBe('mauve')
  })

  it('puts that accent line back exactly on remove', () => {
    const doc = new TomlDocument(defaults)
    doc.set('ui.accent', 'mauve')
    doc.remove('ui.accent')
    expect(doc.text()).toBe(defaults)
  })

  it('round-trips the whole default config untouched', () => {
    expect(new TomlDocument(defaults).text()).toBe(defaults)
  })

  it('finds only real settings among the defaults, never prose', () => {
    const doc = new TomlDocument(defaults)
    expect(doc.commentedDefaultPaths()).toHaveLength(135)
    expect(doc.activePaths()).toEqual(['experimental.pane_history'])
    for (const path of doc.commentedDefaultPaths()) {
      expect(path).toMatch(/^[a-z][\w.[\]]*$/)
    }
  })

  it('edits several defaults across the file, each in place', () => {
    const doc = new TomlDocument(defaults)
    doc.set('theme.name', 'nord')
    doc.set('theme.custom.sidebar_bg', '#111111')
    doc.set('keys.command[0].key', 'prefix+alt+z')
    doc.set('ui.sidebar_width', 30)
    const text = doc.text()
    expect(text.split('\n')).toHaveLength(defaults.split('\n').length)
    const values = doc.parse().values
    expect(values.get('theme.name')).toBe('nord')
    expect(values.get('theme.custom.sidebar_bg')).toBe('#111111')
    expect(values.get('keys.command[0].key')).toBe('prefix+alt+z')
    expect(values.get('ui.sidebar_width')).toBe(30)
  })
})

describe('a number keeps the TOML type it was written with', () => {
  it('writes a whole number over a float as a float', () => {
    expect(applied('[a]\ndelay = 1.5\n', (doc) => doc.set('a.delay', 2))).toBe('[a]\ndelay = 2.0\n')
    expect(applied('[a]\ndelay = 1.5\n', (doc) => doc.set('a.delay', 2.25))).toBe(
      '[a]\ndelay = 2.25\n',
    )
  })

  it('recognizes every way TOML spells a float', () => {
    for (const written of ['1.5', '1e3', '1E3', '2.0', 'inf', '-inf', 'nan']) {
      expect(applied(`[a]\nd = ${written}\n`, (doc) => doc.set('a.d', 2))).toBe('[a]\nd = 2.0\n')
    }
  })

  it('leaves an integer an integer, prefixed forms included', () => {
    for (const written of ['1', '10_000', '0xE', '0o17', '0b101', '-3']) {
      expect(applied(`[a]\nd = ${written}\n`, (doc) => doc.set('a.d', 2))).toBe('[a]\nd = 2\n')
    }
  })

  it('does not float numbers nested inside a replaced container', () => {
    expect(applied('[a]\nd = 1.5\n', (doc) => doc.set('a.d', [1, 2]))).toBe('[a]\nd = [1, 2]\n')
  })

  it('writes an integer as an integer where no value existed', () => {
    expect(applied('[a]\nb = 1\n', (doc) => doc.set('a.c', 2))).toBe('[a]\nb = 1\nc = 2\n')
  })
})

describe('a new root key clears the leading comment block', () => {
  it('lands above the first live header, not inside a commented one', () => {
    const source = '# prose\n# [theme]\n# name = "x"\n\n[terminal]\nshell = "fish"\n'
    expect(applied(source, (doc) => doc.set('onboarding', false))).toBe(
      '# prose\n# [theme]\n# name = "x"\nonboarding = false\n\n[terminal]\nshell = "fish"\n',
    )
  })
})
