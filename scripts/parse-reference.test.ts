/**
 * Parser tests against the committed fixture — no network, so a herdr.dev
 * outage or a site redesign fails `pnpm gen:reference` rather than `pnpm check`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MIN_ENTRIES, decodeEntities, parseConfigReference, parseDefault } from './parse-reference.ts'

const SOURCE_URL = 'https://herdr.dev/docs/config-reference/'
const fixture = readFileSync(
  path.join(import.meta.dirname, 'fixtures', 'config-reference.html'),
  'utf8',
)
const parsed = parseConfigReference(fixture, SOURCE_URL)

describe('parseConfigReference', () => {
  it('reads every row of the fixture, in page order', () => {
    expect(parsed.entries.length).toBe(167)
    expect(parsed.herdrVersion).toBe('0.8.2')
    expect(parsed.source).toBe(SOURCE_URL)
    expect(parsed.sections[0]).toEqual({ id: 'ref-general', title: 'General' })
    expect(parsed.entries[0].key).toBe('onboarding')
    expect(parsed.sections.map((section) => section.id)).toContain('ref-experimental')
  })

  it('is deterministic', () => {
    expect(parseConfigReference(fixture, SOURCE_URL)).toEqual(parsed)
  })

  it('pulls key, type, default, description and section off a plain row', () => {
    const entry = parsed.entries.find((candidate) => candidate.key === 'server.headless_cols')
    expect(entry).toEqual({
      key: 'server.headless_cols',
      section: 'ref-server',
      type: 'integer',
      default: 120,
      defaultLiteral: '120',
      description:
        'Virtual terminal width used for layout and newly created panes when no client is ' +
        'attached. Must be greater than zero.',
      options: [],
    })
  })

  it('keeps enum options out of the description', () => {
    const entry = parsed.entries.find((candidate) => candidate.key === 'terminal.new_cwd')
    expect(entry?.options).toEqual(['follow', 'home', 'current', 'path'])
    expect(entry?.description).toBe(
      'CWD policy for new interactive panes, tabs, and workspaces.',
    )
    expect(entry?.default).toBe('follow')
  })

  it('reads `unset` as no default at all', () => {
    const entry = parsed.entries.find((candidate) => candidate.key === 'onboarding')
    expect(entry?.default).toBeNull()
    expect(entry?.defaultLiteral).toBeNull()
  })

  it('decodes the quotes the page escapes', () => {
    expect(decodeEntities('&quot;follow&quot; &amp; &lt;b&gt; &#39;x&#39; &#x41;')).toBe(
      '"follow" & <b> \'x\' A',
    )
    expect(parsed.entries.find((c) => c.key === 'keys.prefix')?.default).toBe('ctrl+b')
    expect(parsed.entries.find((c) => c.key === 'ui.window_title')?.default).toBe(
      '{hostname}: {workspace}',
    )
  })

  it('parses structured defaults', () => {
    expect(parsed.entries.find((c) => c.key === 'ui.tab_bar_right')?.default).toEqual([])
    expect(parsed.entries.find((c) => c.key === 'ui.sidebar.agents.rows')?.default).toEqual([
      ['state_icon', 'workspace', 'tab'],
      ['agent'],
    ])
    expect(parsed.entries.find((c) => c.key === 'ui.sidebar.agents.rows_by_agent')?.default).toEqual(
      {},
    )
  })

  it('splits a default that carries trailing prose', () => {
    const entry = parsed.entries.find((candidate) => candidate.key === 'update.channel')
    expect(entry?.default).toBe('stable')
    expect(entry?.defaultNote).toBe('("preview" for Windows preview builds)')
    expect(entry?.defaultLiteral).toBe('"stable" ("preview" for Windows preview builds)')
  })

  it('tolerates an enum default the page left unquoted', () => {
    expect(parsed.entries.find((c) => c.key === 'ui.sidebar_collapsed_mode')?.default).toBe(
      'compact',
    )
    expect(parsed.entries.find((c) => c.key === 'ui.host_cursor')?.default).toBe('auto')
  })

  it('fails loudly when the page stops looking like the reference', () => {
    expect(() => parseConfigReference('<html><body>moved</body></html>', SOURCE_URL)).toThrow(
      /no h2\.config-reference-title/,
    )

    const oneSectionOnly = fixture.slice(0, fixture.indexOf('id="ref-theme"'))
    expect(() => parseConfigReference(oneSectionOnly, SOURCE_URL)).toThrow(
      new RegExp(`expected at least ${MIN_ENTRIES}`),
    )
  })
})

describe('parseDefault', () => {
  it('rejects a shape it cannot account for', () => {
    expect(() => parseDefault('sort of blue', [], 'ui.accent')).toThrow(
      /ui\.accent: cannot parse default/,
    )
  })

  it('accepts a bare word only when it is one of the options', () => {
    expect(parseDefault('compact', ['compact', 'hidden'], 'k')).toEqual({ value: 'compact' })
    expect(() => parseDefault('compact', ['wide'], 'k')).toThrow(/cannot parse default/)
  })
})
