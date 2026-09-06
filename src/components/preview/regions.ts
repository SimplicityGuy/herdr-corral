/**
 * What each region of the preview owns — the other half of "the preview is the
 * editor" (ADR-0002).
 *
 * A region is a piece of the mock the user can click: the tab bar, its right-hand
 * status entries, the sidebar's edge, a space row, an agent row, a pane, the
 * toast. Each one lists the keys that draw it, **most specific first**, because
 * the first is the key a click opens: clicking an agent row should land on
 * `ui.sidebar.agents.rows`, not on the row gap that happens to share the region.
 *
 * The list is not decoration. It is what the region advertises in `data-keys`, so
 * a test — or a person with the inspector open — can ask a region which settings
 * it is drawn from without reading the component. `regions.test.ts` checks every
 * key against the generated schema, so a herdr release that renames one fails
 * here rather than leaving a region pointing at a setting that no longer exists.
 *
 * Regions never nest. A region is a `<button>`, and a button inside a button is
 * not a thing the DOM has; the sidebar's own region is therefore its resize edge
 * rather than the column that holds the rows.
 */
import { byKey } from '@/schema'

/** Every region the preview draws, in the order the eye meets them. */
export const REGION_IDS = [
  'theme',
  'mobile',
  'tab-bar',
  'tab-bar-right',
  'sidebar',
  'spaces',
  'agents',
  'panes',
  'toast',
] as const

export type RegionId = (typeof REGION_IDS)[number]

export interface RegionDefinition {
  readonly id: RegionId
  /** How the region names itself to a screen reader, and in a test. */
  readonly label: string
  /** The keys that draw it, most specific first. The first is what a click opens. */
  readonly keys: readonly string[]
}

const DEFINITIONS: readonly RegionDefinition[] = [
  {
    id: 'theme',
    label: 'theme',
    keys: ['theme.name', 'theme.auto_switch', 'theme.dark_name', 'theme.light_name', 'ui.accent'],
  },
  {
    id: 'mobile',
    label: 'mobile layout threshold',
    keys: ['ui.mobile_width_threshold'],
  },
  {
    id: 'tab-bar',
    label: 'tab bar',
    keys: ['ui.tab_bar_position', 'ui.hide_tab_bar_when_single_tab'],
  },
  {
    id: 'tab-bar-right',
    label: 'tab bar status entries',
    keys: ['ui.tab_bar_right', 'ui.tab_bar_right_separator'],
  },
  {
    id: 'sidebar',
    label: 'sidebar width',
    keys: [
      'ui.sidebar_width',
      'ui.sidebar_min_width',
      'ui.sidebar_max_width',
      'ui.sidebar_collapsed_mode',
      'ui.sidebar_start_collapsed',
    ],
  },
  {
    id: 'spaces',
    label: 'spaces rows',
    keys: ['ui.sidebar.spaces.rows', 'ui.sidebar.spaces.row_gap'],
  },
  {
    id: 'agents',
    label: 'agents rows',
    keys: [
      'ui.sidebar.agents.rows',
      'ui.sidebar.agents.rows_by_agent',
      'ui.sidebar.agents.row_gap',
      'ui.agent_panel_sort',
      'ui.status_indicators',
    ],
  },
  {
    id: 'panes',
    label: 'panes',
    keys: [
      'ui.pane_borders',
      'ui.pane_outer_borders',
      'ui.pane_gaps',
      'ui.pane_scrollbars',
      'ui.show_agent_labels_on_pane_borders',
    ],
  },
  {
    id: 'toast',
    label: 'notification toast',
    keys: ['ui.toast.herdr.position', 'ui.toast.delivery', 'ui.toast.delay_seconds'],
  },
]

export const REGIONS: Readonly<Record<RegionId, RegionDefinition>> = Object.fromEntries(
  DEFINITIONS.map((definition) => [definition.id, definition]),
) as Readonly<Record<RegionId, RegionDefinition>>

/** The keys a region is drawn from, most specific first. */
export function regionKeys(id: RegionId): readonly string[] {
  return REGIONS[id].keys
}

/** The key a click on this region opens. */
export function regionKey(id: RegionId): string {
  return REGIONS[id].keys[0]
}

export function regionLabel(id: RegionId): string {
  return REGIONS[id].label
}

/** `data-keys`, as the region advertises it. */
export function regionKeysAttribute(id: RegionId): string {
  return REGIONS[id].keys.join(' ')
}

/** Every key any region owns — what the coverage test walks. */
export function allRegionKeys(): readonly string[] {
  return DEFINITIONS.flatMap((definition) => definition.keys)
}

/** True when the schema documents this key. Exported so the test reads plainly. */
export function isSchemaKey(key: string): boolean {
  return byKey(key) !== undefined
}
