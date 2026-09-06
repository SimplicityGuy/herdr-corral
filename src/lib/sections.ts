/**
 * Where every setting lives in the Console — invariant 5.
 *
 * The top line offers six switches (ADR-0002 "Shell anatomy"), and each schema key
 * has **exactly one** of them as its home. Five are the focused editors that later
 * beads fill in; `all` is both the catch-all for keys no focused editor claims and
 * the exhaustive view that lists every key. Those are two different questions and
 * this module answers them with two functions:
 *
 * - `homeOf(key)` — the one section that owns the key. Total by construction: the
 *   rule list is ordered, first match wins, and anything unmatched falls to `all`.
 * - `keysOf(section)` — the keys the settings tree lists for a section. For the five
 *   focused sections that is `homeOf`'s fibre; for `all` it is every key, because a
 *   view called "all" that hid two thirds of the config would be a lie.
 * - `centreOf(section)` — which of the two centre frames that switch opens with,
 *   which is a different question from what the tree is listing; see `CentreView`.
 *
 * `sections.test.ts` proves the partition, and also proves that every rule below
 * still matches a real key — a herdr release that renames `ui.pane_gaps` leaves a
 * dead rule behind, and a dead rule is how a key silently drifts into `all`.
 *
 * ## Talking to the store
 *
 * `useConfigStore`'s `selection.section` is a *reference* section id (`ref-ui`,
 * `ref-keys`, …) because the store addresses the generated schema, not the UI. The
 * two vocabularies meet here: `refSectionsOf` derives, from the key map itself,
 * which reference sections a UI section draws from, and `primaryRefSection` picks
 * the first for `store.setSection`. Deriving it rather than writing a second table
 * is what stops the two from disagreeing.
 */
import { allEntries, allKeys, sections } from '@/schema'

/** The six switches on the top line, in `[1]`–`[6]` order. */
export const UI_SECTIONS = ['layout', 'sidebar', 'status', 'keys', 'theme', 'all'] as const

export type UiSection = (typeof UI_SECTIONS)[number]

/** The section the shell opens on. */
export const DEFAULT_UI_SECTION: UiSection = 'layout'

/**
 * What the centre frame is showing: the herdr mock, or a section's own panel.
 *
 * Two orthogonal facts, deliberately: *which* section the tree and the top line
 * are on, and *what* the centre draws. They were one fact while every section
 * either had a panel or fell through to the preview, and clicking a region of
 * the mock then took the mock off the screen — the region's own key belongs to a
 * section with a panel, the section switched so the tree could follow, and the
 * panel replaced what the user had just clicked on. Splitting them is what lets
 * a region click move the tree without moving the eye.
 */
export type CentreView = 'preview' | 'section'

/**
 * The centre a switch opens with.
 *
 * `sidebar` is the mock — the sidebar is the thing the preview draws most of and
 * the rows editor is a popover over it, not a panel. Every other switch has a
 * panel of its own. A region click overrides this; see `openEditor`.
 */
export function centreOf(section: UiSection): CentreView {
  return section === 'sidebar' ? 'preview' : 'section'
}

/**
 * One claim on a key: an exact path, or a plain string prefix of one.
 *
 * A prefix is matched with `startsWith` and is not required to end at a path
 * separator: `ui.sidebar` claims both `ui.sidebar_width` and
 * `ui.sidebar.agents.rows`, and `ui.tab_bar` claims `ui.tab_bar_right`. That is
 * the point — herdr spells one region's settings two ways.
 *
 * Prefixes are spelt out rather than inferred from the TOML tree, because herdr's
 * tree does not group by editor: `ui.sidebar_width` and `ui.sidebar.agents.rows`
 * draw the same region and sit in different branches, while `ui.sound.*` sits in
 * the same branch as everything else under `ui` and belongs to none of them.
 */
export type Rule = { readonly exact: string } | { readonly prefix: string }

/** Ordered claims, most specific first; the first that matches owns the key. */
const RULES: readonly (readonly [UiSection, Rule])[] = [
  // Keybindings — the whole `[keys]` table, chords and indexed prefixes alike.
  ['keys', { prefix: 'keys.' }],

  // Theme — the palette, plus the one accent that lives under `ui`.
  ['theme', { prefix: 'theme.' }],
  ['theme', { exact: 'ui.accent' }],

  // Sidebar — the panel's own geometry and the token rows it draws.
  ['sidebar', { prefix: 'ui.sidebar' }],
  ['sidebar', { exact: 'ui.agent_panel_sort' }],

  // Status — the tab bar, its right-hand status entries, and the toasts.
  ['status', { prefix: 'ui.tab_bar' }],
  ['status', { exact: 'ui.hide_tab_bar_when_single_tab' }],
  ['status', { exact: 'ui.status_indicators' }],
  ['status', { prefix: 'ui.toast.' }],

  // Layout — panes, the window, and the pointer behaviour inside them.
  ['layout', { prefix: 'ui.pane_' }],
  ['layout', { prefix: 'ui.mouse_' }],
  ['layout', { prefix: 'ui.prompt_' }],
  ['layout', { exact: 'ui.show_agent_labels_on_pane_borders' }],
  ['layout', { exact: 'ui.window_title' }],
  ['layout', { exact: 'ui.mobile_width_threshold' }],
  ['layout', { exact: 'ui.copy_on_select' }],
  ['layout', { exact: 'ui.host_cursor' }],
  ['layout', { exact: 'ui.right_click_passthrough_modifier' }],
  ['layout', { exact: 'ui.redraw_on_focus_gained' }],
  ['layout', { exact: 'ui.confirm_close' }],
]

/** Does one claim cover this key? Exported so the coverage test can reuse it. */
export function ruleMatches(rule: Rule, key: string): boolean {
  return 'exact' in rule ? key === rule.exact : key.startsWith(rule.prefix)
}

const homes = new Map<string, UiSection>()
for (const key of allKeys()) {
  const claim = RULES.find(([, rule]) => ruleMatches(rule, key))
  homes.set(key, claim === undefined ? 'all' : claim[0])
}

/**
 * The one section that owns `key`.
 *
 * A key the schema does not document — an unknown key out of a user's file — has
 * no home and reports `all`, which is where the tree would show it anyway.
 */
export function homeOf(key: string): UiSection {
  return homes.get(key) ?? 'all'
}

/** The keys `homeOf` assigns to a section. `all` gets only its own catch-alls. */
export function ownKeysOf(section: UiSection): readonly string[] {
  return allKeys().filter((key) => homeOf(key) === section)
}

const listed = new Map<UiSection, readonly string[]>(
  UI_SECTIONS.map((section) => [
    section,
    section === 'all' ? allKeys() : ownKeysOf(section),
  ]),
)

/** The keys the settings tree lists for a section — everything, under `all`. */
export function keysOf(section: UiSection): readonly string[] {
  return listed.get(section) ?? []
}

const refOrder = new Map(sections().map((section, index) => [section.id, index]))
const entrySection = new Map(allEntries().map((entry) => [entry.key, entry.section]))

const refSections = new Map<UiSection, readonly string[]>(
  UI_SECTIONS.map((section) => {
    const ids = new Set<string>()
    for (const key of keysOf(section)) {
      const id = entrySection.get(key)
      if (id !== undefined) ids.add(id)
    }
    const ordered = [...ids].sort(
      (a, b) => (refOrder.get(a) ?? 0) - (refOrder.get(b) ?? 0),
    )
    return [section, ordered]
  }),
)

/** The reference sections a UI section draws from, in the reference page's order. */
export function refSectionsOf(section: UiSection): readonly string[] {
  return refSections.get(section) ?? []
}

/**
 * The reference section id to hand `store.setSection` when this switch is picked.
 *
 * A UI section spans several reference sections, so this is the one it leads with
 * rather than the whole story; `refSectionsOf` is the whole story.
 */
export function primaryRefSection(section: UiSection): string {
  return refSectionsOf(section)[0] ?? (sections()[0]?.id ?? '')
}

/** Is this string one of the six switches? Guards values read back from anywhere. */
export function isUiSection(value: string): value is UiSection {
  return (UI_SECTIONS as readonly string[]).includes(value)
}

/** Every rule, for the coverage test. Not part of the shell's API. */
export const SECTION_RULES: readonly (readonly [UiSection, Rule])[] = RULES
