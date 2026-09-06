/**
 * Invariant 5: every schema key belongs to exactly one UI home.
 *
 * The map is generated from an ordered rule list, so "exactly one" is true by
 * construction and the interesting failures are the ones a herdr release causes:
 * a new key nobody claimed landing in `all` unnoticed, or a renamed key leaving a
 * rule behind that matches nothing. Both are checked here.
 */
import {
  DEFAULT_UI_SECTION,
  SECTION_RULES,
  UI_SECTIONS,
  type UiSection,
  homeOf,
  isUiSection,
  keysOf,
  ownKeysOf,
  primaryRefSection,
  refSectionsOf,
  ruleMatches,
} from '@/lib/sections'
import { allKeys, bySection, sections } from '@/schema'
import { describe, expect, it } from 'vitest'

describe('the six UI sections', () => {
  it('are the switches ADR-0002 puts on the top line, in order', () => {
    expect(UI_SECTIONS).toEqual(['layout', 'sidebar', 'status', 'keys', 'theme', 'all'])
    expect(isUiSection(DEFAULT_UI_SECTION)).toBe(true)
  })

  it('reject anything that is not one of them', () => {
    expect(isUiSection('ref-ui')).toBe(false)
    expect(isUiSection('')).toBe(false)
  })
})

describe('every schema key has exactly one home', () => {
  it('gives each key a home that is one of the six', () => {
    for (const key of allKeys()) {
      expect(UI_SECTIONS, `${key} must have a home`).toContain(homeOf(key))
    }
  })

  it('partitions the schema across the six sections', () => {
    const owned = UI_SECTIONS.flatMap((section) => ownKeysOf(section))

    expect(new Set(owned).size, 'no key may be owned twice').toBe(owned.length)
    expect([...owned].sort()).toEqual([...allKeys()].sort())
  })

  it('leaves no focused section empty', () => {
    for (const section of UI_SECTIONS) {
      expect(ownKeysOf(section).length, `${section} owns nothing`).toBeGreaterThan(0)
    }
  })

  it('sends an unknown key to the catch-all rather than throwing', () => {
    expect(homeOf('ui.this_key_does_not_exist')).toBe('all')
  })
})

describe('the rules that produce the map', () => {
  it('has no rule that matches nothing — a rename would leave one behind', () => {
    for (const [section, rule] of SECTION_RULES) {
      const matched = allKeys().filter((key) => ruleMatches(rule, key))
      expect(matched.length, `${section}: ${JSON.stringify(rule)} matches no key`).toBeGreaterThan(
        0,
      )
    }
  })

  it('has no rule shadowed entirely by an earlier one', () => {
    for (const [index, [section, rule]] of SECTION_RULES.entries()) {
      const reachable = allKeys().filter(
        (key) =>
          ruleMatches(rule, key) &&
          !SECTION_RULES.slice(0, index).some(([, earlier]) => ruleMatches(earlier, key)),
      )
      expect(reachable.length, `${section}: ${JSON.stringify(rule)} is shadowed`).toBeGreaterThan(0)
    }
  })
})

describe('what the tree lists', () => {
  it('lists a focused section as exactly the keys it owns', () => {
    for (const section of ['layout', 'sidebar', 'status', 'keys', 'theme'] as const) {
      expect(keysOf(section)).toEqual(ownKeysOf(section))
    }
  })

  it('lists every key under `all`, not just the catch-alls', () => {
    expect(keysOf('all')).toEqual(allKeys())
    expect(ownKeysOf('all').length).toBeLessThan(allKeys().length)
  })

  it('keeps the reference page order inside a section', () => {
    const order = new Map(allKeys().map((key, index) => [key, index]))
    for (const section of UI_SECTIONS) {
      const positions = keysOf(section).map((key) => order.get(key) ?? -1)
      expect([...positions].sort((a, b) => a - b), `${section} is out of order`).toEqual(positions)
    }
  })
})

describe('talking to the store', () => {
  it('names reference sections the store would accept', () => {
    const known = new Set(sections().map((section) => section.id))
    for (const section of UI_SECTIONS) {
      expect(known, `${section} leads with an unknown reference section`).toContain(
        primaryRefSection(section),
      )
      for (const id of refSectionsOf(section)) expect(known).toContain(id)
    }
  })

  it('derives the reference sections from the keys themselves', () => {
    for (const section of UI_SECTIONS) {
      for (const id of refSectionsOf(section)) {
        const keysThere = new Set(bySection(id).map((entry) => entry.key))
        expect(
          keysOf(section).some((key) => keysThere.has(key)),
          `${section} claims ${id} but lists none of its keys`,
        ).toBe(true)
      }
    }
  })

  it('puts the obvious sections where a reader would look for them', () => {
    const expected: Record<UiSection, string> = {
      layout: 'ref-ui',
      sidebar: 'ref-ui',
      status: 'ref-ui',
      keys: 'ref-keys',
      theme: 'ref-theme',
      all: 'ref-general',
    }
    for (const [section, id] of Object.entries(expected)) {
      expect(primaryRefSection(section as UiSection)).toBe(id)
    }
  })
})

describe('the homes themselves', () => {
  it('keeps both spellings of the sidebar together', () => {
    expect(homeOf('ui.sidebar_width')).toBe('sidebar')
    expect(homeOf('ui.sidebar.agents.rows')).toBe('sidebar')
    expect(homeOf('ui.sidebar.agents.rows_by_agent')).toBe('sidebar')
    expect(homeOf('ui.agent_panel_sort')).toBe('sidebar')
  })

  it('puts the tab bar and the toasts on the status line', () => {
    expect(homeOf('ui.tab_bar_right')).toBe('status')
    expect(homeOf('ui.hide_tab_bar_when_single_tab')).toBe('status')
    expect(homeOf('ui.status_indicators')).toBe('status')
    expect(homeOf('ui.toast.delivery')).toBe('status')
  })

  it('claims the accent for the theme, not for the panel it sits under', () => {
    expect(homeOf('ui.accent')).toBe('theme')
    expect(homeOf('theme.custom.mauve')).toBe('theme')
  })

  it('leaves the settings with no region to click in the catch-all', () => {
    expect(homeOf('ui.sound.enabled')).toBe('all')
    expect(homeOf('terminal.shell_mode')).toBe('all')
    expect(homeOf('experimental.allow_nested')).toBe('all')
    expect(homeOf('onboarding')).toBe('all')
  })
})
