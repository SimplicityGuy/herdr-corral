/**
 * Every token herdr documents, drawn.
 *
 * The list is not transcribed: it comes from `sidebarTokenBuiltins`, which reads
 * it out of herdr's own default config, so a release that adds a token fails here
 * with "no expectation for X" rather than shipping a preview that silently draws
 * nothing where the new token goes.
 */
import { SAMPLE_AGENTS, SAMPLE_SPACES, type TokenSubject } from '@/components/preview/sample'
import {
  type RowContext,
  cssColor,
  renderRow,
  renderRows,
  renderToken,
  resolvePalette,
  rowText,
  stateIcon,
  tokenColor,
  tokenText,
} from '@/components/preview/tokens'
import { paletteOf, sidebarTokenBuiltins } from '@/schema'
import { describe, expect, it } from 'vitest'

const palette = resolvePalette({ theme: 'catppuccin', custom: {} })
const context: RowContext = { palette, indicators: 'dots' }
const symbols: RowContext = { palette, indicators: 'symbols' }

const claude = SAMPLE_AGENTS[0]
const codex = SAMPLE_AGENTS[1]
const gemini = SAMPLE_AGENTS[2]
const pi = SAMPLE_AGENTS[3]
const phaze = SAMPLE_SPACES[0]

/** What each built-in draws for `claude`, the working agent in `phaze`. */
const AGENT_TOKENS: Readonly<Record<string, string>> = {
  state_icon: '●',
  state_text: 'working',
  workspace: 'phaze',
  tab: 'api',
  pane: '1',
  agent: 'claude',
  terminal_title: '✳ claude — src/api/routes.py',
  terminal_title_stripped: 'claude — src/api/routes.py',
}

/** …and for `phaze`, the working space. */
const SPACE_TOKENS: Readonly<Record<string, string>> = {
  state_icon: '●',
  state_text: 'working',
  workspace: 'phaze',
  branch: 'main',
  git_status: '+2 ~1',
}

describe('built-in tokens', () => {
  it.each(sidebarTokenBuiltins('agents'))('draws the agent token %s', (token) => {
    const expected = AGENT_TOKENS[token]
    expect(expected, `no expectation for the agent token ${token}`).toBeDefined()
    expect(tokenText(token, claude, context)).toBe(expected)
  })

  it.each(sidebarTokenBuiltins('spaces'))('draws the space token %s', (token) => {
    const expected = SPACE_TOKENS[token]
    expect(expected, `no expectation for the space token ${token}`).toBeDefined()
    expect(tokenText(token, phaze, context)).toBe(expected)
  })

  it('covers every built-in of both kinds and invents none', () => {
    expect([...sidebarTokenBuiltins('agents')].sort()).toEqual(Object.keys(AGENT_TOKENS).sort())
    expect([...sidebarTokenBuiltins('spaces')].sort()).toEqual(Object.keys(SPACE_TOKENS).sort())
  })

  it('draws nothing for a token the subject has no field for', () => {
    // `tab` is an agent built-in; a space has no tab, so the token is dropped.
    expect(tokenText('tab', phaze, context)).toBeNull()
  })

  it('draws nothing for a token herdr does not define', () => {
    expect(tokenText('nonsense', claude, context)).toBeNull()
  })
})

describe('status indicators', () => {
  it('tells the four states apart by colour under dots', () => {
    for (const agent of [claude, codex, gemini, pi]) {
      expect(stateIcon(agent.state, 'dots')).toMatch(/[●○]/)
    }
    const colors = [claude, codex, gemini, pi].map((agent) =>
      tokenColor('state_icon', agent, palette),
    )
    expect(new Set(colors).size).toBe(4)
  })

  it('gives each state its own glyph under symbols', () => {
    const glyphs = [claude, codex, gemini, pi].map((agent) => stateIcon(agent.state, 'symbols'))
    expect(glyphs).toEqual(['▶', '!', '·', '✓'])
    expect(new Set(glyphs).size).toBe(4)
  })

  it('reads the indicator setting through renderToken', () => {
    expect(renderToken('state_icon', pi, context)?.text).toBe('●')
    expect(renderToken('state_icon', pi, symbols)?.text).toBe('✓')
  })
})

describe('custom tokens', () => {
  it('draws a $name from the subject metadata', () => {
    expect(tokenText('$model', claude, context)).toBe('opus-5')
    expect(tokenText('$ticket', claude, context)).toBe('PHZ-412')
    expect(tokenText('$jj_status', phaze, context)).toBe('@ wqrs')
  })

  it('draws nothing when nothing reported the value', () => {
    // gemini never reported a ticket; herdr draws no value, so neither does this.
    expect(tokenText('$ticket', gemini, context)).toBeNull()
    expect(renderToken('$ticket', gemini, context)).toBeNull()
  })

  it('gives a custom token its own contextual colour', () => {
    expect(tokenColor('$model', claude, palette)).toBe(palette.peach)
    expect(tokenColor('$model', claude, palette)).not.toBe(tokenColor('workspace', claude, palette))
  })
})

describe('token styles', () => {
  it('honours fg, bold and dim together', () => {
    const drawn = renderToken(
      { token: 'workspace', fg: '#89b4fa', bold: true, dim: true },
      claude,
      context,
    )
    expect(drawn).toEqual({
      token: 'workspace',
      text: 'phaze',
      color: '#89b4fa',
      bold: true,
      dim: true,
    })
  })

  it('preserves the contextual default for an omitted field', () => {
    const drawn = renderToken({ token: 'branch', bold: true }, phaze, context)
    expect(drawn?.color).toBe(tokenColor('branch', phaze, palette))
    expect(drawn?.bold).toBe(true)
    expect(drawn?.dim).toBe(false)
  })

  it('ignores an fg herdr would reject, leaving the contextual default', () => {
    // Sidebar `fg` takes #RGB / #RRGGBB only; `green` is an error, reported by
    // validate() rather than painted here.
    const drawn = renderToken({ token: 'workspace', fg: 'green' }, claude, context)
    expect(drawn?.color).toBe(tokenColor('workspace', claude, palette))
  })

  it('accepts the short hex form', () => {
    expect(renderToken({ token: 'workspace', fg: '#0f0' }, claude, context)?.color).toBe('#0f0')
  })

  it('drops an entry with no token field at all', () => {
    expect(renderToken({ fg: '#0f0' }, claude, context)).toBeNull()
    expect(renderToken(42, claude, context)).toBeNull()
  })
})

describe('rows', () => {
  it('draws a row in order and reads back as text', () => {
    const row = renderRow(['state_icon', 'workspace', 'tab'], claude, context)
    expect(row.map((token) => token.token)).toEqual(['state_icon', 'workspace', 'tab'])
    expect(rowText(row)).toBe('● phaze api')
  })

  it('drops rows that resolve to nothing rather than leaving a blank line', () => {
    const drawn = renderRows([['workspace'], ['$ticket']], gemini, context)
    expect(drawn).toHaveLength(1)
    expect(rowText(drawn[0])).toBe('phaze/docs')
  })

  it('answers an empty list for a value that is not a list of rows', () => {
    expect(renderRows('nope', claude, context)).toEqual([])
    expect(renderRow('nope', claude, context)).toEqual([])
  })

  it('draws every built-in of one kind in a single row', () => {
    const row = renderRow([...sidebarTokenBuiltins('agents')], claude, context)
    expect(row).toHaveLength(sidebarTokenBuiltins('agents').length)
  })
})

describe('palette', () => {
  it('is themes.json when nothing overrides it', () => {
    const gruvbox = resolvePalette({ theme: 'gruvbox', custom: {} })
    expect(gruvbox.text).toBe(paletteOf('gruvbox')?.text)
  })

  it('lets theme.custom win over the theme', () => {
    const custom = resolvePalette({ theme: 'catppuccin', custom: { sidebar_bg: '#101010' } })
    expect(custom.sidebar_bg).toBe('#101010')
  })

  it('lets ui.accent win over both', () => {
    const accented = resolvePalette({
      theme: 'catppuccin',
      custom: { accent: '#111111' },
      accent: '#222222',
    })
    expect(accented.accent).toBe('#222222')
  })

  it('resolves a reset slot against catppuccin rather than leaving it unpainted', () => {
    // Every built-in theme leaves `sidebar_bg` at `reset`; the preview lands it on
    // the panel background, which is where herdr lands it.
    const terminal = resolvePalette({ theme: 'terminal', custom: {} })
    expect(terminal.sidebar_bg).toBe(terminal.panel_bg)
    expect(terminal.text).toBe(paletteOf('catppuccin')?.text)
  })

  it('falls back to catppuccin for a theme themes.json does not have', () => {
    expect(resolvePalette({ theme: 'no-such-theme', custom: {} })).toEqual(
      resolvePalette({ theme: 'catppuccin', custom: {} }),
    )
  })

  it('translates the colour syntaxes herdr accepts', () => {
    expect(cssColor('#89b4fa', '#000')).toBe('#89b4fa')
    expect(cssColor('rgb(1, 2, 3)', '#000')).toBe('rgb(1, 2, 3)')
    expect(cssColor('cyan', '#000')).not.toBe('#000')
    expect(cssColor('reset', '#000')).toBe('#000')
    expect(cssColor('not a colour', '#000')).toBe('#000')
    expect(cssColor(undefined, '#000')).toBe('#000')
  })

  it('colours a token from the palette in force', () => {
    const gruvbox = resolvePalette({ theme: 'gruvbox', custom: {} })
    const subject: TokenSubject = claude
    expect(tokenColor('branch', subject, gruvbox)).toBe(gruvbox.mauve)
    expect(tokenColor('branch', subject, gruvbox)).not.toBe(tokenColor('branch', subject, palette))
  })
})
