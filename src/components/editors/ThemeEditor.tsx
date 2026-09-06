/**
 * Section `[5] theme` and the popover the preview's theme chip opens — herdr's
 * palette, picked from what it looks like rather than typed as a name.
 *
 * ## Swatches, not a select
 *
 * herdr ships eighteen built-in themes and `theme.name` is a string, so a select
 * is technically enough and tells you nothing: nobody knows what `kanagawa`
 * looks like until they have seen it. Every swatch is painted from
 * `themes.json`'s own palette for that theme — the panel, the sidebar, the text
 * and the accent — through the same `resolvePalette` the preview draws with, so
 * a `reset` slot resolves the way it will resolve in the mock rather than
 * showing as a hole.
 *
 * ## Overrides
 *
 * `[theme.custom]` is nineteen colour slots layered over whichever theme is in
 * force, and `ui.accent` is herdr's one accent setting outside that table and
 * the later word over it. Both are edited with `ColorField` — the shared control
 * that knows herdr's four spellings, hex, the sixteen names, `rgb()` and the
 * reset aliases — and each row carries the colour the slot resolves to right
 * now, so an override reads against what it is overriding.
 *
 * **Reset removes the key.** Emptying a slot is `resetKey`, which takes the line
 * back out of the file (invariant 2) rather than writing an empty string; the
 * per-row reset is the same action reachable without selecting the text first.
 * A slot the user has set carries the coral dot the rest of the editor uses for
 * "this one is yours".
 *
 * ## Where the writes go
 *
 * Straight to the store on every change, like the rows and status bar editors
 * and for the same reason: the preview behind the popover has to repaint as the
 * colour lands, and a colour is judged by looking at it. `esc` closes and what
 * was written stays written.
 */
import { ColorField } from '@/components/common/ColorField'
import { Panel } from '@/components/shell/Panel'
import { registerEditor } from '@/components/shell/editor-registry'
import { FALLBACK_THEME, type Palette, resolvePalette } from '@/components/preview/tokens'
import { Switch } from '@/components/ui/switch'
import { diagnosticsAt, useDiagnostics } from '@/lib/diagnostics'
import { resetKey, setKey } from '@/lib/edit'
import { cn } from '@/lib/utils'
import type { TomlValue } from '@/model/parse'
import { type Diagnostic, canonicalThemeName } from '@/model/validate'
import { byKey, themeNames, themeTokens, themes } from '@/schema'
import { useConfigStore } from '@/store/config'
import { useMemo, useState } from 'react'

const NAME = 'theme.name'
const AUTO_SWITCH = 'theme.auto_switch'
const DARK_NAME = 'theme.dark_name'
const LIGHT_NAME = 'theme.light_name'
const ACCENT = 'ui.accent'
const CUSTOM_PREFIX = 'theme.custom.'

/** The keys this editor claims, for the tree and the preview alike. */
function claims(key: string): boolean {
  return (
    key === NAME ||
    key === AUTO_SWITCH ||
    key === DARK_NAME ||
    key === LIGHT_NAME ||
    key === ACCENT ||
    key.startsWith(CUSTOM_PREFIX)
  )
}

/** The four slots a swatch paints, in the order the eye reads them. */
const SWATCH_SLOTS: readonly string[] = ['panel_bg', 'sidebar_bg', 'text', 'accent']

const SELECT =
  'border border-surface1 bg-base px-2 py-[2px] text-green outline-none focus:border-coral'

const RESET_BUTTON = 'shrink-0 text-overlay0 hover:text-text disabled:opacity-40'

function text(value: TomlValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/** Everything herdr has to say about one key. */
function Messages({ diagnostics }: { diagnostics: readonly Diagnostic[] }) {
  if (diagnostics.length === 0) return null
  return (
    <ul className="flex flex-col gap-[2px]">
      {diagnostics.map((diagnostic) => (
        <li
          key={`${diagnostic.severity}:${diagnostic.path}:${diagnostic.message}`}
          className={diagnostic.severity === 'error' ? 'text-red' : 'text-yellow'}
        >
          {diagnostic.severity === 'error' ? '● ' : '▲ '}
          {diagnostic.message}
        </li>
      ))}
    </ul>
  )
}

/** One built-in theme, painted with its own colours. */
function ThemeSwatch({
  name,
  current,
  compact,
}: {
  name: string
  current: boolean
  compact: boolean
}) {
  const palette = useMemo(() => resolvePalette({ theme: name, custom: {} }), [name])

  return (
    <button
      type="button"
      aria-label={`theme ${name}`}
      aria-pressed={current}
      title={themes.themes[name]?.description}
      onClick={() => setKey(NAME, name)}
      // `w-full min-w-0` so the grid cell, not the name, decides the width:
      // `catppuccin-latte` is sixteen characters and would otherwise push its
      // neighbour out of its own column instead of ellipsising.
      className={cn(
        'flex w-full min-w-0 flex-col gap-[4px] border text-left outline-none focus:border-coral',
        compact ? 'px-[4px] py-[2px]' : 'px-[6px] py-[4px]',
        current ? 'border-coral' : 'border-surface1 hover:border-overlay0',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex w-full overflow-hidden border border-surface1',
          compact ? 'h-[10px]' : 'h-[16px]',
        )}
      >
        {SWATCH_SLOTS.map((slot) => (
          <span
            key={slot}
            data-slot={slot}
            className="h-full flex-1"
            style={{ background: palette[slot] }}
          />
        ))}
      </span>
      <span className={cn('truncate', current ? 'text-text' : 'text-subtext0')}>{name}</span>
    </button>
  )
}

/** One colour setting: the slot's current colour, the field, and a reset. */
function ColorRow({
  path,
  label,
  resolved,
  diagnostics,
  autofocus = false,
}: {
  path: string
  label: string
  resolved: string | undefined
  diagnostics: readonly Diagnostic[]
  /** True for the row the popover was opened on; the host puts the cursor here. */
  autofocus?: boolean
}) {
  const value = useConfigStore((state) => state.effective(path))
  const changed = useConfigStore((state) => state.explicit().has(path))

  return (
    <div className="flex flex-col gap-[4px] border-b border-surface0 pb-[8px] last:border-b-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-subtext0">
          {label}
          {changed && (
            <span aria-label="changed" className="ml-[6px] text-coral">
              {'●'}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {resolved !== undefined && (
            <span
              aria-hidden="true"
              data-part="resolved"
              title={`in force: ${resolved}`}
              className="size-[12px] shrink-0 border border-surface1"
              style={{ background: resolved }}
            />
          )}
          <button
            type="button"
            aria-label={`reset ${path}`}
            onClick={() => resetKey(path)}
            disabled={!changed}
            className={RESET_BUTTON}
          >
            reset to theme
          </button>
        </span>
      </div>
      <ColorField
        id={path}
        aria-label={path}
        autofocus={autofocus}
        value={text(value)}
        onChange={(next) => {
          // Emptying the field is "take this back out", not "write nothing":
          // herdr has no empty colour, and invariant 2 says reset removes the key.
          if (next.trim() === '') resetKey(path)
          else setKey(path, next)
        }}
      />
      <Messages diagnostics={diagnostics.filter((diagnostic) => diagnostic.severity === 'error')} />
    </div>
  )
}

/** `theme.dark_name` / `theme.light_name`: a built-in name, or nothing. */
function ThemeNameSelect({ path }: { path: string }) {
  const value = useConfigStore((state) => state.effective(path))
  const current = text(value)
  const names = themeNames()

  return (
    <label className="flex items-center gap-2">
      <span className="w-[16ch] shrink-0 text-subtext0">{path}</span>
      <select
        aria-label={path}
        value={current}
        onChange={(event) => {
          if (event.target.value === '') resetKey(path)
          else setKey(path, event.target.value)
        }}
        className={SELECT}
      >
        <option value="">unset</option>
        {current !== '' && !names.includes(current) && <option value={current}>{current}</option>}
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * The nineteen `[theme.custom]` rows.
 *
 * Collapsed by default in the popover, and only there: nineteen colour rows is
 * two thousand pixels of frame, and the popover's job is the *theme* — the
 * overrides are the thing you go looking for once, not the thing you came for.
 * It opens itself when any slot is already set, because a config that overrides
 * something must not hide it behind a closed section the user has to know to
 * open. The section panel has room and shows them all.
 */
function CustomOverrides({
  tokens,
  palette,
  diagnostics,
  collapsible,
  opened,
}: {
  tokens: readonly string[]
  palette: Palette
  diagnostics: readonly Diagnostic[]
  collapsible: boolean
  /** The `theme.custom.*` slot the popover was opened on, if it was one. */
  opened: string | null
}) {
  const set = useConfigStore(
    (state) => tokens.filter((slot) => state.explicit().has(`${CUSTOM_PREFIX}${slot}`)).length,
  )
  // Folded away by default — but never over the key the popover is captioned
  // with. A popover named `theme.custom.sidebar_bg` whose sidebar_bg row is
  // behind a disclosure is a popover that does not contain its own subject.
  const [open, setOpen] = useState(() => !collapsible || set > 0 || opened !== null)
  const shown = !collapsible || open

  return (
    <section aria-label="colour overrides" className="flex flex-col gap-[6px]">
      {collapsible ? (
        <h2 className="border-b border-surface0 pb-[4px]">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex w-full items-center gap-2 text-left text-subtext0 hover:text-text"
          >
            <span aria-hidden="true" className="text-overlay0">
              {open ? '▾' : '▸'}
            </span>
            {'override colours'}
            <span className="ml-auto text-overlay0">
              {set === 0 ? `${tokens.length} slots` : `${set} set`}
            </span>
          </button>
        </h2>
      ) : (
        <h2 className="border-b border-surface0 pb-[4px] text-subtext0">{'[theme.custom]'}</h2>
      )}
      {shown && (
        <>
          <p className="text-overlay0">
            Each slot sits on top of the theme above. Empty means the theme decides.
          </p>
          <div className="flex flex-col gap-[8px]">
            {tokens.map((slot) => (
              <ColorRow
                key={slot}
                path={`${CUSTOM_PREFIX}${slot}`}
                label={slot}
                resolved={palette[slot]}
                diagnostics={diagnosticsAt(diagnostics, `${CUSTOM_PREFIX}${slot}`)}
                autofocus={slot === opened}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

/**
 * The swatches, the auto-switch pair, the accent, and the token overrides.
 *
 * `compact` is the popover: the same controls, sized for a frame that has to fit
 * a window rather than a panel that scrolls.
 */
function ThemePalette({ compact = false, path }: { compact?: boolean; path?: string }) {
  const effective = useConfigStore((state) => state.effectiveAll())
  const nameChanged = useConfigStore((state) => state.explicit().has(NAME))
  const diagnostics = useDiagnostics()

  const name = text(effective.get(NAME))
  const autoSwitch = effective.get(AUTO_SWITCH) === true
  const tokens = themeTokens()
  // Which row, if any, the popover was opened on. `undefined` is the section
  // panel, which was opened on nothing in particular.
  const openedSlot =
    path !== undefined && path.startsWith(CUSTOM_PREFIX) ? path.slice(CUSTOM_PREFIX.length) : null

  // The palette in force — themes.json ⊕ [theme.custom] ⊕ ui.accent — so each
  // row can show the colour it is overriding. The same call the preview makes.
  const palette = useMemo(() => {
    const custom: Record<string, TomlValue | undefined> = {}
    for (const slot of tokens) custom[slot] = effective.get(`${CUSTOM_PREFIX}${slot}`)
    return resolvePalette({
      theme: canonicalThemeName(name) ?? FALLBACK_THEME,
      custom,
      accent: effective.get(ACCENT),
    })
  }, [effective, name, tokens])

  return (
    <div className="flex flex-col gap-[14px]">
      <section aria-label="built-in themes" className="flex flex-col gap-[6px]">
        <h2 className="flex items-center gap-2 border-b border-surface0 pb-[4px] text-subtext0">
          {NAME}
          <span className="text-green">{name}</span>
          <button
            type="button"
            aria-label={`reset ${NAME}`}
            onClick={() => resetKey(NAME)}
            disabled={!nameChanged}
            className={cn(RESET_BUTTON, 'ml-auto')}
          >
            reset
          </button>
        </h2>
        <ul
          className={cn(
            'grid gap-[6px]',
            compact
              ? 'grid-cols-[repeat(auto-fill,minmax(92px,1fr))]'
              : 'grid-cols-[repeat(auto-fill,minmax(112px,1fr))]',
          )}
        >
          {themeNames().map((option) => (
            <li key={option} className="flex min-w-0">
              <ThemeSwatch name={option} current={option === name} compact={compact} />
            </li>
          ))}
        </ul>
        <Messages diagnostics={diagnosticsAt(diagnostics, NAME)} />
      </section>

      <section aria-label="appearance switching" className="flex flex-col gap-[6px]">
        <h2 className="border-b border-surface0 pb-[4px] text-subtext0">{AUTO_SWITCH}</h2>
        <label className="flex items-center gap-2">
          <Switch
            id={AUTO_SWITCH}
            aria-label={AUTO_SWITCH}
            checked={autoSwitch}
            onCheckedChange={(next) => setKey(AUTO_SWITCH, next)}
          />
          <span className={autoSwitch ? 'text-green' : 'text-red'}>{String(autoSwitch)}</span>
          <span className="text-overlay0">{byKey(AUTO_SWITCH)?.description}</span>
        </label>
        {/* The two names only mean anything while herdr is following the host's
            appearance, so they appear with the setting that reads them. */}
        {autoSwitch && (
          <div className="flex flex-col gap-[6px]">
            <ThemeNameSelect path={DARK_NAME} />
            <ThemeNameSelect path={LIGHT_NAME} />
          </div>
        )}
      </section>

      <section aria-label="accent" className="flex flex-col gap-[6px]">
        <h2 className="border-b border-surface0 pb-[4px] text-subtext0">{ACCENT}</h2>
        <ColorRow
          path={ACCENT}
          label={ACCENT}
          resolved={palette.accent}
          diagnostics={diagnosticsAt(diagnostics, ACCENT)}
          autofocus={path === ACCENT}
        />
      </section>

      <CustomOverrides
        tokens={tokens}
        palette={palette}
        diagnostics={diagnostics}
        collapsible={compact}
        opened={openedSlot}
      />
    </div>
  )
}

/**
 * The popover the preview's theme chip and the settings tree open.
 *
 * Every key it claims opens the same palette, and the controls read and write
 * the store themselves, so neither the value handed in nor `commit` has anything
 * to say — see the module note. `path` is the exception: it is which of those
 * twenty colour rows the user asked for, so the overrides are unfolded and the
 * cursor lands on that row rather than on the first swatch.
 */
export function ThemeEditor({ path }: { path?: string }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <ThemePalette compact path={path} />
      <p className="text-overlay0">enter apply&ensp;&ensp;esc close</p>
    </div>
  )
}

/** Section `[5] theme`. */
export function ThemeView() {
  return (
    <Panel caption="theme · pick one, then override what you like">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-[14px]">
        <ThemePalette />
      </div>
    </Panel>
  )
}

registerEditor(claims, ThemeEditor)
