/**
 * The herdr mock — the middle of ADR-0002, where "the preview is the editor".
 *
 * Everything on screen here is drawn from the **effective config**: the tab bar's
 * position and its status entries, the sidebar's width and the token rows in it,
 * the pane borders, the toast's corner, the palette. Change a key anywhere — the
 * tree, the palette, an editor opened from the preview itself — and the mock
 * redraws in the same frame, because it reads the store rather than a copy.
 *
 * Clicking a region opens the editor for the keys that draw it. The map lives in
 * `regions.ts` and the click is one call: `openEditor({ key, anchor, region })`,
 * which anchors the popover to the region and mirrors the selection into the
 * config store, so the settings tree's cursor lands on the same key without the
 * two components knowing about each other. Several rows can be drawn by the same
 * key — every agent row comes out of `ui.sidebar.agents.rows` — so the coral
 * outline lights all of them: it marks the setting, not the row.
 *
 * ## What the chips are
 *
 * Three things herdr decides from the terminal rather than from the file — whether
 * the sidebar is collapsed, whether the OS is in light mode, how many columns the
 * terminal has — have no answer in a browser. Rather than pick one and hide the
 * settings that depend on it, the preview puts them on chips above the mock: they
 * are the view's own state, drawn in chrome tokens so they read as instrument
 * panel rather than as part of herdr. The settings they exercise stay honest —
 * `ui.sidebar_start_collapsed` seeds the collapse chip, `ui.mobile_width_threshold`
 * decides what the column chip means, `theme.auto_switch` is what puts the
 * light/dark chip there at all.
 *
 * ## Colours
 *
 * The chrome around the mock is the fixed dark Console palette from
 * `src/index.css`. Inside the mock, every colour is the user's: `resolvePalette`
 * layers `themes.json` ⊕ `[theme.custom]` ⊕ `ui.accent` and hands back CSS
 * colours, which reach the DOM as inline styles because they are data. That is
 * the one place in the app where a colour is not a token.
 */
import {
  type RegionId,
  regionKey,
  regionKeysAttribute,
  regionLabel,
} from '@/components/preview/regions'
import {
  SAMPLE_AGENTS,
  SAMPLE_HOSTNAME,
  SAMPLE_NOW,
  SAMPLE_PANES,
  SAMPLE_SPACES,
  SAMPLE_TABS,
  SAMPLE_TOAST,
  SAMPLE_ZOOM,
  type AgentState,
  type SampleAgent,
  type SamplePane,
  type TokenSubject,
} from '@/components/preview/sample'
import {
  FALLBACK_THEME,
  type Palette,
  type RenderedToken,
  type RowContext,
  renderRows,
  resolvePalette,
  stateIcon,
  tokenColor,
} from '@/components/preview/tokens'
import { homeOf } from '@/lib/sections'
import { cn } from '@/lib/utils'
import type { TomlValue } from '@/model/parse'
import { canonicalThemeName } from '@/model/validate'
import { themeTokens } from '@/schema'
import { useConfigStore } from '@/store/config'
import { anchorOf, useShellStore } from '@/store/shell'
import { type CSSProperties, type ReactNode, useMemo, useState } from 'react'

/** How wide the simulated terminal is on the desktop chip, in columns. */
const DESKTOP_COLUMNS = 120

/** …and on the narrow one, which is under every sane mobile threshold. */
const NARROW_COLUMNS = 44

/** The space the mock treats as focused. */
const ACTIVE_SPACE = 'phaze'

/** The preview's line height, so a `row_gap` of 1 is one blank line. */
const LINE_HEIGHT = 1.45

type Values = ReadonlyMap<string, TomlValue>

function str(values: Values, key: string, fallback: string): string {
  const value = values.get(key)
  return typeof value === 'string' && value !== '' ? value : fallback
}

function num(values: Values, key: string, fallback: number): number {
  const value = values.get(key)
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(values: Values, key: string, fallback: boolean): boolean {
  const value = values.get(key)
  return typeof value === 'boolean' ? value : fallback
}

function table(value: TomlValue | undefined): Readonly<Record<string, TomlValue>> {
  if (typeof value !== 'object' || value === null) return {}
  if (Array.isArray(value) || value instanceof Date) return {}
  return value as Record<string, TomlValue>
}

/** herdr clamps the sidebar between its min and its max; so does the preview. */
function clamp(width: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.max(min, max), width))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * The `datetime` entry's clock, formatted.
 *
 * A documented subset of the strftime the `time` crate compiles for herdr — the
 * specifiers a status line actually uses. Anything else is left as it was typed,
 * which reads as "the preview does not know this one" rather than as a wrong
 * time. UTC getters, because {@link SAMPLE_NOW} is a fixed instant and a
 * screenshot has to look the same in every time zone.
 */
function formatDateTime(format: string, at: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return format.replaceAll(/%(.)/g, (whole: string, code: string) => {
    switch (code) {
      case 'Y':
        return String(at.getUTCFullYear())
      case 'm':
        return pad(at.getUTCMonth() + 1)
      case 'd':
        return pad(at.getUTCDate())
      case 'H':
        return pad(at.getUTCHours())
      case 'M':
        return pad(at.getUTCMinutes())
      case 'S':
        return pad(at.getUTCSeconds())
      case 'I':
        return pad(at.getUTCHours() % 12 || 12)
      case 'p':
        return at.getUTCHours() < 12 ? 'AM' : 'PM'
      case 'a':
        return DAYS[at.getUTCDay()]
      case 'b':
        return MONTHS[at.getUTCMonth()]
      case '%':
        return '%'
      default:
        return whole
    }
  })
}

/** What one `ui.tab_bar_right` entry draws. */
interface StatusEntry {
  readonly type: string
  readonly text: string
  /** A command's output is not something a browser can have; it is drawn as one. */
  readonly placeholder: boolean
}

function statusEntries(values: Values): readonly StatusEntry[] {
  const raw = values.get('ui.tab_bar_right')
  if (!Array.isArray(raw)) return []
  const out: StatusEntry[] = []
  for (const element of raw) {
    const entry = table(element)
    const type = typeof entry.type === 'string' ? entry.type : ''
    if (type === 'zoom') {
      out.push({ type, text: SAMPLE_ZOOM, placeholder: false })
    } else if (type === 'hostname') {
      out.push({ type, text: SAMPLE_HOSTNAME, placeholder: false })
    } else if (type === 'datetime') {
      const format =
        typeof entry.format === 'string' && entry.format !== '' ? entry.format : '%H:%M'
      out.push({ type, text: formatDateTime(format, SAMPLE_NOW), placeholder: false })
    } else if (type === 'text') {
      out.push({ type, text: typeof entry.text === 'string' ? entry.text : '', placeholder: false })
    } else if (type === 'command') {
      const command = typeof entry.command === 'string' ? entry.command : 'command'
      out.push({ type, text: `⟨${command}⟩`, placeholder: true })
    }
    // An unknown type is a validation error; the diagnostics line is where it is
    // reported, and drawing a guess here would be a second answer to that.
  }
  return out
}

/** Waiting first, then working, then done, then idle — herdr's `priority` order. */
const PRIORITY: Readonly<Record<AgentState, number>> = {
  waiting: 0,
  working: 1,
  done: 2,
  idle: 3,
  unknown: 4,
}

function sortAgents(sort: string): readonly SampleAgent[] {
  const order = SAMPLE_SPACES.map((space) => space.workspace)
  return [...SAMPLE_AGENTS].sort((a, b) =>
    sort === 'priority'
      ? PRIORITY[a.state] - PRIORITY[b.state]
      : order.indexOf(a.workspace) - order.indexOf(b.workspace),
  )
}

const TOAST_CORNERS: Readonly<Record<string, string>> = {
  'top-left': 'top-[8px] left-[8px]',
  'top-center': 'top-[8px] left-1/2 -translate-x-1/2',
  'top-right': 'top-[8px] right-[8px]',
  'bottom-left': 'bottom-[8px] left-[8px]',
  'bottom-center': 'bottom-[8px] left-1/2 -translate-x-1/2',
  'bottom-right': 'bottom-[8px] right-[8px]',
}

/**
 * A clickable piece of the mock.
 *
 * The whole interaction of ADR-0002 is here: hovering dashes a `--surface1`
 * outline around it, the selected one wears the coral outline, and a click opens
 * the popover on the first key the region owns. `data-region` and `data-keys` say
 * what it is and what draws it, for a test and for anyone with the inspector open.
 *
 * A region is a button, so regions never nest — the sidebar's own region is its
 * resize edge rather than the column holding the rows.
 */
function Region({
  id,
  name,
  className,
  style,
  data,
  children,
}: {
  id: RegionId
  /** Overrides the region's generic label, for one of several rows drawing it. */
  name?: string
  className?: string
  style?: CSSProperties
  /** Extra `data-*` attributes, for what this instance of the region is showing. */
  data?: Readonly<Record<string, string | undefined>>
  children?: ReactNode
}) {
  const openEditor = useShellStore((state) => state.openEditor)
  const setSection = useShellStore((state) => state.setSection)
  const selected = useConfigStore((state) => state.selection.region === id)
  return (
    <button
      type="button"
      data-region={id}
      data-keys={regionKeysAttribute(id)}
      data-selected={selected ? 'true' : undefined}
      {...Object.fromEntries(
        Object.entries(data ?? {}).map(([key, value]) => [`data-${key}`, value]),
      )}
      aria-label={name ?? regionLabel(id)}
      className={cn(
        'relative block text-left font-sans outline-offset-[-1px]',
        selected
          ? 'outline-1 outline-solid outline-coral'
          : 'hover:outline-1 hover:outline-dashed hover:outline-surface1',
        className,
      )}
      style={style}
      onClick={(event) => {
        const key = regionKey(id)
        // The tree cursor is meant to follow the click, and it can only land on a
        // key the open section lists — so the section moves first. `setSection`
        // clears any open editor, which is why it comes before `openEditor` and
        // not after.
        setSection(homeOf(key))
        openEditor({ key, anchor: anchorOf(event.currentTarget), region: id })
      }}
    >
      {children}
    </button>
  )
}

/** One row of tokens, styled as the config asked. */
function TokenRow({ row }: { row: readonly RenderedToken[] }) {
  return (
    <span className="flex gap-[6px] whitespace-pre">
      {row.map((token, index) => (
        <span
          // Tokens are positional and may repeat, so the position is the identity.
          key={`${token.token}-${index}`}
          data-token={token.token}
          style={{
            color: token.color,
            fontWeight: token.bold ? 700 : undefined,
            opacity: token.dim ? 0.6 : undefined,
          }}
        >
          {token.text}
        </span>
      ))}
    </span>
  )
}

/** The rows one subject draws, or a dim note when its layout resolves to nothing. */
function SubjectRows({
  rows,
  subject,
  context,
}: {
  rows: TomlValue | undefined
  subject: TokenSubject
  context: RowContext
}) {
  const drawn = renderRows(rows, subject, context)
  if (drawn.length === 0) {
    return (
      <span className="block whitespace-pre" style={{ color: context.palette.overlay0 }}>
        no tokens
      </span>
    )
  }
  return (
    <>
      {drawn.map((row, index) => (
        <TokenRow key={index} row={row} />
      ))}
    </>
  )
}

function PanelCaption({ text, palette }: { text: string; palette: Palette }) {
  return (
    <span
      className="block px-[8px] pb-[2px] text-[10px] tracking-[0.08em]"
      style={{ color: palette.overlay0 }}
    >
      {text}
    </span>
  )
}

export function HerdrPreview() {
  const values = useConfigStore((state) => state.effectiveAll())

  // View state herdr reads from the terminal and a browser cannot: which way the
  // OS theme is leaning, whether the user has collapsed the sidebar, how wide the
  // terminal is. `null` means "whatever the config implies", so the config still
  // drives the preview until someone touches a chip.
  const [appearance, setAppearance] = useState<'dark' | 'light' | null>(null)
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null)
  const [columnsOverride, setColumnsOverride] = useState<number | null>(null)

  const autoSwitch = bool(values, 'theme.auto_switch', false)
  const shown = appearance ?? 'dark'
  const themeName = autoSwitch
    ? shown === 'light'
      ? str(values, 'theme.light_name', 'catppuccin-latte')
      : str(values, 'theme.dark_name', str(values, 'theme.name', FALLBACK_THEME))
    : str(values, 'theme.name', FALLBACK_THEME)

  const palette = useMemo(() => {
    const custom: Record<string, TomlValue | undefined> = {}
    for (const slot of themeTokens()) custom[slot] = values.get(`theme.custom.${slot}`)
    return resolvePalette({
      theme: canonicalThemeName(themeName) ?? FALLBACK_THEME,
      custom,
      accent: values.get('ui.accent'),
    })
  }, [values, themeName])

  const indicators = str(values, 'ui.status_indicators', 'dots')
  const context: RowContext = { palette, indicators }

  const sidebarWidth = clamp(
    num(values, 'ui.sidebar_width', 26),
    num(values, 'ui.sidebar_min_width', 18),
    num(values, 'ui.sidebar_max_width', 36),
  )
  const collapsedMode = str(values, 'ui.sidebar_collapsed_mode', 'compact')
  const collapsed = collapsedOverride ?? bool(values, 'ui.sidebar_start_collapsed', false)

  const threshold = num(values, 'ui.mobile_width_threshold', 64)
  const columns = columnsOverride ?? DESKTOP_COLUMNS
  const mobile = columns < threshold

  const tabPosition = str(values, 'ui.tab_bar_position', 'top')
  const tabBarEdge = `1px solid ${palette.surface0}`
  const hideSingleTab = bool(values, 'ui.hide_tab_bar_when_single_tab', false)
  const rawSeparator = values.get('ui.tab_bar_right_separator')
  const separator = typeof rawSeparator === 'string' ? rawSeparator : ' '
  const entries = statusEntries(values)

  const spacesRows = values.get('ui.sidebar.spaces.rows')
  const spacesGap = num(values, 'ui.sidebar.spaces.row_gap', 0)
  const agentsRows = values.get('ui.sidebar.agents.rows')
  const agentsGap = num(values, 'ui.sidebar.agents.row_gap', 0)
  const rowsByAgent = table(values.get('ui.sidebar.agents.rows_by_agent'))
  const agents = sortAgents(str(values, 'ui.agent_panel_sort', 'spaces'))

  const paneBorders = bool(values, 'ui.pane_borders', true)
  const paneOuterBorders = bool(values, 'ui.pane_outer_borders', true)
  const paneGaps = bool(values, 'ui.pane_gaps', true)
  const paneScrollbars = bool(values, 'ui.pane_scrollbars', true)
  const agentLabels = bool(values, 'ui.show_agent_labels_on_pane_borders', false)

  const delivery = str(values, 'ui.toast.delivery', 'off')
  const toastPosition = str(values, 'ui.toast.herdr.position', 'bottom-right')

  const panes: readonly SamplePane[] = mobile ? SAMPLE_PANES.slice(0, 1) : SAMPLE_PANES

  const tabBar = (
    <div
      data-part="tab-bar"
      className="flex h-[26px] shrink-0 items-center gap-[10px] px-[6px]"
      style={{
        background: palette.panel_bg,
        borderTop: tabPosition === 'bottom' ? tabBarEdge : undefined,
        borderBottom: tabPosition === 'bottom' ? undefined : tabBarEdge,
      }}
    >
      <Region id="tab-bar" className="flex items-center gap-[12px] px-[4px] py-[2px]">
        {SAMPLE_TABS.map((tab) => (
          <span
            key={tab.index}
            data-tab={tab.name}
            style={{
              color: tab.active ? palette.text : palette.overlay0,
              borderBottom: `2px solid ${tab.active ? palette.accent : 'transparent'}`,
            }}
          >
            {`${tab.index}:${tab.name}`}
          </span>
        ))}
        {hideSingleTab ? (
          <span data-part="single-tab-hint" style={{ color: palette.overlay0 }}>
            · hidden at 1 tab
          </span>
        ) : null}
      </Region>

      <Region
        id="tab-bar-right"
        className="ml-auto flex items-center whitespace-pre px-[4px] py-[2px]"
        style={{ color: palette.subtext0 }}
      >
        {entries.length === 0 ? (
          <span data-part="status-empty" style={{ color: palette.overlay0 }}>
            + status entries
          </span>
        ) : (
          entries.map((entry, index) => (
            <span key={`${entry.type}-${index}`}>
              {index > 0 ? (
                <span data-part="separator" style={{ color: palette.overlay0 }}>
                  {separator}
                </span>
              ) : null}
              <span
                data-entry={entry.type}
                style={{ color: entry.placeholder ? palette.overlay0 : undefined }}
              >
                {entry.text}
              </span>
            </span>
          ))
        )}
      </Region>
    </div>
  )

  const sidebar =
    collapsed && collapsedMode === 'hidden' ? null : (
      <div
        data-part="sidebar"
        data-collapsed={collapsed ? collapsedMode : undefined}
        className="relative flex shrink-0 flex-col gap-[10px] overflow-hidden py-[6px]"
        style={{
          width: collapsed ? '4ch' : `${sidebarWidth}ch`,
          background: palette.sidebar_bg,
          borderRight: `1px solid ${palette.surface0}`,
        }}
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-[4px]">
            {agents.map((agent) => (
              <Region
                key={agent.agent}
                id="agents"
                name={`agent ${agent.agent}`}
                data={{ agent: agent.agent }}
                className="px-[4px]"
              >
                <span data-token="state_icon" style={{ color: tokenColor('state_icon', agent, palette) }}>
                  {stateIcon(agent.state, indicators)}
                </span>
              </Region>
            ))}
          </div>
        ) : (
          <>
            <div
              data-part="spaces"
              className="flex flex-col"
              style={{ rowGap: `${spacesGap * LINE_HEIGHT}em` }}
            >
              <PanelCaption text="SPACES" palette={palette} />
              {SAMPLE_SPACES.map((space) => (
                <Region
                  key={space.id}
                  id="spaces"
                  name={`space ${space.workspace}`}
                  data={{ space: space.id }}
                  className="w-full py-[1px] pr-[8px]"
                  style={{
                    paddingLeft: `${8 + space.depth * 10}px`,
                    background: space.id === ACTIVE_SPACE ? palette.active_row_bg : undefined,
                  }}
                >
                  <SubjectRows rows={spacesRows} subject={space} context={context} />
                </Region>
              ))}
            </div>

            <div
              data-part="agents"
              className="flex flex-col"
              style={{ rowGap: `${agentsGap * LINE_HEIGHT}em` }}
            >
              <PanelCaption text="AGENTS" palette={palette} />
              {agents.map((agent) => {
                const override = rowsByAgent[agent.agent]
                return (
                  <Region
                    key={agent.agent}
                    id="agents"
                    name={`agent ${agent.agent}`}
                    data={{ agent: agent.agent }}
                    className="w-full px-[8px] py-[1px]"
                  >
                    <SubjectRows
                      rows={Array.isArray(override) ? override : agentsRows}
                      subject={agent}
                      context={context}
                    />
                  </Region>
                )
              })}
            </div>
          </>
        )}

        {/* The sidebar's own region is its edge: a region is a button, and the
            rows above are buttons already. This is where a herdr user drags the
            width, which is the setting it opens. */}
        <Region
          id="sidebar"
          name={`sidebar width, ${sidebarWidth} columns`}
          className="absolute inset-y-0 right-0 w-[6px]"
        />
      </div>
    )

  const paneArea = (
    <div
      data-part="panes"
      className="relative grid min-h-0 flex-1"
      style={{
        gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
        gap: paneGaps ? '6px' : '0px',
        padding: paneGaps ? '6px' : '0px',
        border: paneOuterBorders ? `1px solid ${palette.surface1}` : '1px solid transparent',
      }}
    >
      {panes.map((pane) => (
        <Region
          key={pane.title}
          id="panes"
          name={`pane ${pane.title}`}
          // A button centres its content when it is taller than it; a pane's
          // output starts at the top, so the region lays itself out as a column.
          className="flex min-h-0 flex-col overflow-hidden px-[8px] py-[5px]"
          style={{
            border: `1px solid ${paneBorders ? palette.surface1 : 'transparent'}`,
            background: palette.panel_bg,
          }}
        >
          <span data-part="pane-caption" className="block" style={{ color: palette.overlay0 }}>
            {`┤ ${pane.title} ├`}
            {agentLabels && pane.agent !== null ? (
              <span data-part="agent-label" style={{ color: palette.accent }}>
                {` [${pane.agent}]`}
              </span>
            ) : null}
          </span>
          {pane.lines.map((line, index) => (
            <span key={index} className="block truncate">
              {line.mark === undefined ? null : (
                <span
                  style={{
                    color:
                      line.tone === undefined || line.tone === 'dim'
                        ? palette.overlay0
                        : palette[line.tone],
                  }}
                >
                  {`${line.mark} `}
                </span>
              )}
              <span style={{ color: line.dim ? palette.overlay0 : palette.text }}>{line.text}</span>
            </span>
          ))}
          {paneScrollbars ? (
            <span
              data-part="scrollbar"
              aria-hidden="true"
              className="absolute top-[6px] right-[2px] bottom-[6px] w-[4px]"
              style={{ background: palette.surface0 }}
            >
              <span
                className="absolute left-0 h-[30%] w-full"
                style={{ top: `${pane.scroll * 60}%`, background: palette.overlay0 }}
              />
            </span>
          ) : null}
        </Region>
      ))}

      <Region
        id="toast"
        name={delivery === 'off' ? 'notification toast, delivery off' : 'notification toast'}
        data={{ delivery, position: toastPosition }}
        className={cn(
          'absolute flex w-[46%] max-w-[220px] flex-col px-[8px] py-[5px]',
          TOAST_CORNERS[toastPosition] ?? TOAST_CORNERS['bottom-right'],
        )}
        style={{
          background: palette.panel_bg,
          border:
            delivery === 'off' ? `1px dashed ${palette.surface1}` : `1px solid ${palette.accent}`,
          opacity: delivery === 'off' ? 0.65 : undefined,
        }}
      >
        {delivery === 'off' ? (
          <span className="block truncate" style={{ color: palette.overlay0 }}>
            toast · delivery off
          </span>
        ) : (
          <>
            <span className="block truncate" style={{ color: palette.text }}>
              <span style={{ color: palette.green }}>● </span>
              {SAMPLE_TOAST.title}
            </span>
            <span className="block truncate" style={{ color: palette.subtext0 }}>
              {SAMPLE_TOAST.body}
            </span>
          </>
        )}
      </Region>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-[6px] px-[10px] pt-[8px] pb-[6px] text-[11px] text-overlay0">
        <Region id="theme" name={`theme ${themeName}`} className="px-[6px] py-[1px]">
          {'theme '}
          <span className="text-subtext0">{themeName}</span>
          <span
            aria-hidden="true"
            data-part="accent-swatch"
            className="ml-[6px] inline-block h-[8px] w-[8px] align-middle"
            style={{ background: palette.accent }}
          />
        </Region>

        {autoSwitch ? (
          <button
            type="button"
            data-chip="appearance"
            className="px-[6px] py-[1px] text-subtext0 hover:bg-surface0"
            onClick={() => setAppearance(shown === 'dark' ? 'light' : 'dark')}
          >
            {shown === 'dark' ? '◐ dark' : '◑ light'}
          </button>
        ) : null}

        <button
          type="button"
          data-chip="collapse"
          className="px-[6px] py-[1px] text-subtext0 hover:bg-surface0"
          onClick={() => setCollapsedOverride(!collapsed)}
        >
          {collapsed ? `▸ collapsed · ${collapsedMode}` : `◂ collapse → ${collapsedMode}`}
        </button>

        <button
          type="button"
          data-chip="columns"
          className="px-[6px] py-[1px] text-subtext0 hover:bg-surface0"
          onClick={() =>
            setColumnsOverride(columns === DESKTOP_COLUMNS ? NARROW_COLUMNS : DESKTOP_COLUMNS)
          }
        >
          {`⌗ ${columns} cols`}
        </button>

        <Region id="mobile" name={`mobile below ${threshold} columns`} className="px-[6px] py-[1px]">
          {mobile ? `mobile · under ${threshold}` : `mobile below ${threshold}`}
        </Region>
      </div>

      <div className="flex min-h-0 flex-1 justify-center overflow-hidden px-[10px] pb-[10px]">
        <div
          data-preview="herdr"
          data-mobile={mobile ? 'true' : 'false'}
          className="flex min-h-0 flex-col text-[12px]"
          style={{
            width: `min(100%, ${columns}ch)`,
            background: palette.surface_dim,
            color: palette.text,
          }}
        >
          {tabPosition === 'top' ? tabBar : null}

          <div className="flex min-h-0 flex-1">
            {mobile ? null : sidebar}
            <div className="flex min-h-0 flex-1 flex-col">
              {mobile ? (
                <div
                  data-part="mobile-header"
                  className="flex shrink-0 items-center gap-[6px] px-[8px] py-[2px]"
                  style={{ background: palette.sidebar_bg }}
                >
                  <span style={{ color: palette.accent }}>▸</span>
                  <span>{ACTIVE_SPACE}</span>
                  <span style={{ color: palette.overlay0 }}>
                    {`· ${SAMPLE_AGENTS.length} agents`}
                  </span>
                </div>
              ) : null}
              {paneArea}
            </div>
          </div>

          {tabPosition === 'bottom' ? tabBar : null}
        </div>
      </div>
    </div>
  )
}
