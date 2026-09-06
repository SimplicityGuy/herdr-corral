import { describe, expect, it } from 'vitest'
import { BOM } from '@/model/parse'
import { TomlDocument, TomlDocumentError } from '@/model/toml-doc'
import fixture from '@/test/fixture-user-config.toml?raw'

/**
 * The lines one edit changed, found by trimming the common prefix and suffix.
 *
 * Every assertion below is stated as "these lines went away, these arrived", which is
 * the only way to prove the patcher left the rest of the file alone.
 */
function diff(before: string, after: string): { removed: string[]; added: string[] } {
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

/** Apply `edit` to a fresh document and report the text plus the lines it touched. */
function edited(source: string, edit: (doc: TomlDocument) => void) {
  const doc = new TomlDocument(source)
  edit(doc)
  const text = doc.text()
  return { doc, text, ...diff(source, text) }
}

const crlf = fixture.replaceAll('\n', '\r\n')

describe('round trip', () => {
  it('gives the fixture back byte for byte when nothing changes', () => {
    expect(new TomlDocument(fixture).text()).toBe(fixture)
  })

  it('round-trips a CRLF file, a BOM file, and both at once', () => {
    expect(new TomlDocument(crlf).text()).toBe(crlf)
    expect(new TomlDocument(`${BOM}${fixture}`).text()).toBe(`${BOM}${fixture}`)
    expect(new TomlDocument(`${BOM}${crlf}`).text()).toBe(`${BOM}${crlf}`)
  })

  it('round-trips files without a trailing newline, and empty ones', () => {
    for (const source of ['', '\n', '[a]\nb = 1', '# just a comment', '\n\n\n']) {
      expect(new TomlDocument(source).text()).toBe(source)
    }
  })

  it('round-trips herdr-style mixed line endings', () => {
    const mixed = '[a]\r\nb = 1\nc = 2\r\n'
    expect(new TomlDocument(mixed).text()).toBe(mixed)
  })
})

describe('indexing', () => {
  it('finds live keys, including inside an array of tables', () => {
    const doc = new TomlDocument(fixture)
    expect(doc.has('theme.name')).toBe(true)
    expect(doc.has('theme.custom.panel_bg')).toBe(true)
    expect(doc.has('keys.command[0].command')).toBe(true)
    expect(doc.has('keys.command[1].command')).toBe(true)
    expect(doc.has('keys.command[2].command')).toBe(false)
    expect(doc.has('ui.sidebar.agents.rows_by_agent.claude')).toBe(true)
  })

  it('reads back the raw text of a value, wrapped arrays included', () => {
    const doc = new TomlDocument(fixture)
    expect(doc.valueText('theme.name')).toBe('"catppuccin"')
    expect(doc.valueText('terminal.shell_mode')).toBe('"login"')
    expect(doc.valueText('ui.sidebar_width')).toBe('26')
    expect(doc.valueText('ui.sidebar.agents.rows')).toContain('$model')
    expect(doc.valueText('ui.sidebar.agents.rows')?.split('\n')).toHaveLength(4)
    expect(doc.valueText('nope.missing')).toBeNull()
  })

  it('lists live headers with array-of-tables occurrences resolved', () => {
    expect(new TomlDocument(fixture).headerPaths()).toEqual([
      'theme',
      'theme.custom',
      'terminal',
      'keys',
      'keys.command[0]',
      'keys.command[1]',
      'ui',
      'ui.sidebar.agents',
      'ui.sidebar.agents.rows_by_agent',
      'ui.sidebar.spaces',
      'ui.toast',
      'advanced',
    ])
  })

  it('records commented-out defaults under the header that owns them', () => {
    const doc = new TomlDocument(fixture)
    expect(doc.hasCommentedDefault('onboarding')).toBe(true)
    expect(doc.hasCommentedDefault('theme.auto_switch')).toBe(true)
    expect(doc.hasCommentedDefault('keys.toggle_sidebar')).toBe(true)
    expect(doc.hasCommentedDefault('ui.toast.delay_seconds')).toBe(true)
    expect(doc.hasCommentedDefault('ui.sound.agents.droid')).toBe(true)
    expect(doc.has('theme.auto_switch')).toBe(false)
  })

  it('does not mistake prose for a commented default', () => {
    // Every commented default in the fixture, in document order. Stated exhaustively
    // because the risk here is the false positive: herdr's own config is full of prose
    // shaped like `# type = "shell" runs detached in the background.`, and uncommenting
    // one of those would corrupt a user's file.
    expect(new TomlDocument(fixture).commentedDefaultPaths()).toEqual([
      'onboarding',
      'theme.auto_switch',
      'theme.dark_name',
      'theme.light_name',
      'terminal.new_cwd',
      'keys.open_worktree',
      'keys.toggle_sidebar',
      'ui.sidebar_start_collapsed',
      'ui.toast.delay_seconds',
      'ui.sound.agents.droid',
    ])
  })
})

describe('set on a live key', () => {
  it('replaces the value and nothing else', () => {
    const { removed, added } = edited(fixture, (doc) => doc.set('theme.name', 'nord'))
    expect(removed).toEqual(['name = "catppuccin"'])
    expect(added).toEqual(['name = "nord"'])
  })

  it('preserves column alignment around the value', () => {
    const { removed, added } = edited(fixture, (doc) =>
      doc.set('theme.custom.sidebar_bg', '#11111b'),
    )
    expect(removed).toEqual(['sidebar_bg    = "#181825"'])
    expect(added).toEqual(['sidebar_bg    = "#11111b"'])
  })

  it('preserves a trailing comment on the same line', () => {
    const { added } = edited(fixture, (doc) => doc.set('terminal.shell_mode', 'non_login'))
    expect(added).toEqual(['shell_mode = "non_login"     # "auto", "login", or "non_login"'])
  })

  it('edits one entry of an array of tables', () => {
    const { removed, added, doc } = edited(fixture, (doc) =>
      doc.set('keys.command[1].command', 'htop'),
    )
    expect(removed).toEqual(['command = "btop"'])
    expect(added).toEqual(['command = "htop"'])
    expect(doc.parse().values.get('keys.command[0].command')).toBe('lazygit')
  })

  it('replaces a wrapped array as one span', () => {
    const { removed, added } = edited(fixture, (doc) =>
      doc.set('ui.sidebar.agents.rows', [['state_icon', 'workspace']]),
    )
    expect(removed).toEqual([
      'rows = [',
      '  ["state_icon", { token = "workspace", fg = "#89b4fa", bold = true }, "tab"],',
      '  [{ token = "agent", fg = "#a6e3a1", dim = true }, "$model"],',
      ']',
    ])
    expect(added).toEqual(['rows = [["state_icon", "workspace"]]'])
  })

  it('wraps a value that no longer fits on one line', () => {
    const { removed, added } = edited(fixture, (doc) =>
      doc.set('ui.sidebar.spaces.rows', [
        ['state_icon', 'workspace', 'branch'],
        ['git_status', '$jj_status'],
        ['terminal_title_stripped', 'agent'],
      ]),
    )
    expect(removed).toEqual(['rows = [["state_icon", "workspace"], ["branch", "git_status"]]'])
    expect(added).toEqual([
      'rows = [',
      '  ["state_icon", "workspace", "branch"],',
      '  ["git_status", "$jj_status"],',
      '  ["terminal_title_stripped", "agent"],',
      ']',
    ])
  })

  it('writes styled tokens as inline tables', () => {
    const { added } = edited(fixture, (doc) =>
      doc.set('ui.sidebar.spaces.rows', [
        [{ token: 'workspace', fg: '#89b4fa', bold: true }, 'branch'],
      ]),
    )
    expect(added).toEqual([
      'rows = [[{ token = "workspace", fg = "#89b4fa", bold = true }, "branch"]]',
    ])
  })

  it('leaves the document parseable and the new value readable', () => {
    const { doc } = edited(fixture, (doc) => doc.set('ui.sidebar_width', 32))
    expect(doc.parse().values.get('ui.sidebar_width')).toBe(32)
  })
})

describe('set on a commented default', () => {
  it('uncomments a root-level default in place', () => {
    const { removed, added } = edited(fixture, (doc) => doc.set('onboarding', false))
    expect(removed).toEqual(['# onboarding = true'])
    expect(added).toEqual(['onboarding = false'])
  })

  it('uncomments a default under a live header in place', () => {
    const { removed, added, doc } = edited(fixture, (doc) =>
      doc.set('keys.toggle_sidebar', 'prefix+t'),
    )
    expect(removed).toEqual(['# toggle_sidebar = "prefix+b"'])
    expect(added).toEqual(['toggle_sidebar = "prefix+t"'])
    expect(doc.parse().values.get('keys.toggle_sidebar')).toBe('prefix+t')
  })

  it('uncomments the commented header a default lives under', () => {
    const { removed, added, doc } = edited(fixture, (doc) =>
      doc.set('ui.sound.agents.droid', 'on'),
    )
    expect(removed).toEqual(['# [ui.sound.agents]', '# droid = "off"'])
    expect(added).toEqual(['[ui.sound.agents]', 'droid = "on"'])
    expect(doc.parse().values.get('ui.sound.agents.droid')).toBe('on')
  })

  it('keeps the trailing comment on the default it uncomments', () => {
    const { removed, added } = edited(fixture, (doc) =>
      doc.set('keys.open_worktree', 'prefix+shift+o'),
    )
    expect(removed).toEqual(['# open_worktree = ""      # optional, unset by default'])
    expect(added).toEqual(['open_worktree = "prefix+shift+o"      # optional, unset by default'])
  })

  it('does not append a duplicate below the comment', () => {
    const { text } = edited(fixture, (doc) => doc.set('ui.toast.delay_seconds', 3))
    expect(text.match(/delay_seconds/g)).toHaveLength(1)
    expect(text).toContain('delay_seconds = 3')
  })
})

describe('set on a missing key', () => {
  it('appends after the last live key of its header', () => {
    const { removed, added } = edited(fixture, (doc) => doc.set('ui.pane_borders', false))
    expect(removed).toEqual([])
    expect(added).toEqual(['pane_borders = false'])
    const { text } = edited(fixture, (doc) => doc.set('ui.pane_borders', false))
    expect(text).toContain('accent = "cyan"\npane_borders = false')
  })

  it('appends right under a header that has no live keys yet', () => {
    const source = '[a]\n# only prose here\n\n[b]\nx = 1\n'
    const { added, text } = edited(source, (doc) => doc.set('a.y', 2))
    expect(added).toEqual(['y = 2'])
    expect(text).toBe('[a]\ny = 2\n# only prose here\n\n[b]\nx = 1\n')
  })

  it('appends a root key above the first header', () => {
    const { added, text } = edited(fixture, (doc) => doc.set('some_new_root_key', 1))
    expect(added).toEqual(['some_new_root_key = 1'])
    expect(text).toContain('# onboarding = true\nsome_new_root_key = 1\n\n[theme]')
  })

  it('creates a missing header at the end of the file', () => {
    const { removed, added, doc } = edited(fixture, (doc) =>
      doc.set('ui.toast.herdr.position', 'top-right'),
    )
    expect(removed).toEqual([])
    expect(added).toEqual(['', '[ui.toast.herdr]', 'position = "top-right"'])
    expect(doc.parse().values.get('ui.toast.herdr.position')).toBe('top-right')
  })

  it('appends a new array-of-tables entry at the next occurrence', () => {
    const { added, doc } = edited(fixture, (doc) => {
      doc.set('keys.command[2].key', 'prefix+alt+p')
      doc.set('keys.command[2].type', 'shell')
    })
    expect(added).toEqual([
      '',
      '[[keys.command]]',
      'key = "prefix+alt+p"',
      'type = "shell"',
    ])
    expect(doc.parse().values.get('keys.command')).toHaveLength(3)
    expect(doc.parse().values.get('keys.command[2].key')).toBe('prefix+alt+p')
  })

  it('refuses to create an array-of-tables entry that would leave a gap', () => {
    const doc = new TomlDocument(fixture)
    expect(() => doc.set('keys.command[5].key', 'x')).toThrow(TomlDocumentError)
  })

  it('creates a header in an empty document', () => {
    const doc = new TomlDocument('')
    doc.set('ui.sidebar_width', 26)
    expect(doc.text()).toBe('[ui]\nsidebar_width = 26\n')
  })

  it('keeps a file that ends without a newline ending without one', () => {
    const doc = new TomlDocument('[a]\nb = 1')
    doc.set('c.d', 2)
    expect(doc.text()).toBe('[a]\nb = 1\n\n[c]\nd = 2')
  })
})

describe('remove', () => {
  it('deletes a live key line and nothing else', () => {
    const { removed, added } = edited(fixture, (doc) => doc.remove('ui.mouse_capture'))
    expect(removed).toEqual(['mouse_capture = true'])
    expect(added).toEqual([])
  })

  it('deletes every line of a wrapped value', () => {
    const { removed, added } = edited(fixture, (doc) => doc.remove('ui.sidebar.agents.rows'))
    expect(removed).toHaveLength(4)
    expect(added).toEqual([])
  })

  it('ignores a path that is not set', () => {
    expect(new TomlDocument(fixture).remove('ui.nope').text()).toBe(fixture)
  })

  it('puts a commented default back exactly as it was', () => {
    const doc = new TomlDocument(fixture)
    doc.set('keys.toggle_sidebar', 'prefix+t')
    doc.remove('keys.toggle_sidebar')
    expect(doc.text()).toBe(fixture)
  })

  it('re-comments the header it uncommented along with the default', () => {
    const doc = new TomlDocument(fixture)
    doc.set('ui.sound.agents.droid', 'on')
    doc.remove('ui.sound.agents.droid')
    expect(doc.text()).toBe(fixture)
  })

  it('keeps an uncommented header while another key still needs it', () => {
    const doc = new TomlDocument(fixture)
    doc.set('ui.sound.agents.droid', 'on')
    doc.set('ui.sound.agents.codex', 'off')
    doc.remove('ui.sound.agents.droid')
    expect(doc.text()).toContain('[ui.sound.agents]\n# droid = "off"\ncodex = "off"')
  })

  it('takes a header it created away with the last key under it', () => {
    const doc = new TomlDocument(fixture)
    doc.set('ui.toast.herdr.position', 'top-right')
    doc.remove('ui.toast.herdr.position')
    expect(doc.text()).toBe(fixture)
  })

  it('takes an array-of-tables entry it created away with its keys', () => {
    const doc = new TomlDocument(fixture)
    doc.set('keys.command[2].key', 'prefix+alt+p')
    doc.remove('keys.command[2].key')
    expect(doc.text()).toBe(fixture)
  })
})

describe('line endings and byte-order marks survive editing', () => {
  it('keeps CRLF on every line, edited and untouched alike', () => {
    const doc = new TomlDocument(crlf)
    doc.set('theme.name', 'nord')
    doc.set('ui.pane_borders', false)
    doc.set('ui.toast.herdr.position', 'top-right')
    const text = doc.text()
    expect(text).toContain('name = "nord"\r\n')
    expect(text).toContain('pane_borders = false\r\n')
    expect(text.endsWith('position = "top-right"\r\n')).toBe(true)
    expect(/[^\r]\n/.test(text)).toBe(false)
  })

  it('keeps the BOM at the front through an edit', () => {
    const doc = new TomlDocument(`${BOM}${fixture}`)
    expect(doc.hasBom()).toBe(true)
    doc.set('theme.name', 'nord')
    const text = doc.text()
    expect(text.startsWith(BOM)).toBe(true)
    expect(text.indexOf(BOM, 1)).toBe(-1)
    expect(text.slice(BOM.length)).toBe(fixture.replace('"catppuccin"', '"nord"'))
  })

  it('reports the line ending it will insert with', () => {
    expect(new TomlDocument(crlf).lineEnding()).toBe('\r\n')
    expect(new TomlDocument(fixture).lineEnding()).toBe('\n')
  })
})

describe('sequences of edits', () => {
  it('applies several edits without disturbing each other', () => {
    const { doc, text } = edited(fixture, (doc) => {
      doc.set('theme.name', 'nord')
      doc.set('onboarding', false)
      doc.set('ui.sidebar_width', 30)
      doc.set('keys.command[1].command', 'htop')
      doc.set('ui.pane_borders', false)
    })
    const values = doc.parse().values
    expect(values.get('theme.name')).toBe('nord')
    expect(values.get('onboarding')).toBe(false)
    expect(values.get('ui.sidebar_width')).toBe(30)
    expect(values.get('keys.command[1].command')).toBe('htop')
    expect(values.get('ui.pane_borders')).toBe(false)
    expect(text).toContain('# Place this file at ~/.config/herdr/config.toml')
    expect(text).toContain('#                  gruvbox, one-dark, solarized, kanagawa, rose-pine, vesper')
  })

  it('undoes back to the original file', () => {
    const doc = new TomlDocument(fixture)
    doc.set('theme.name', 'nord')
    doc.set('onboarding', false)
    doc.set('ui.pane_borders', false)
    doc.set('theme.name', 'catppuccin')
    doc.remove('onboarding')
    doc.remove('ui.pane_borders')
    expect(doc.text()).toBe(fixture)
  })
})
