/**
 * Diagnostics that mirror herdr's own, so a config corral calls clean starts
 * clean.
 *
 * ## What goes in
 *
 * `validate` takes the **effective config**: one flat `Map` from dotted path to
 * value, exactly the shape `parse.ts`'s `flattenTree` produces, with the user's
 * file layered over herdr's defaults. Scalars are addressed leaf by leaf
 * (`ui.sidebar_width` → `26`), and the four settings whose *whole* value is the
 * unit of meaning arrive as one entry each:
 *
 * | Path | Value |
 * | --- | --- |
 * | `ui.sidebar.agents.rows` | array of arrays of tokens |
 * | `ui.sidebar.spaces.rows` | array of arrays of tokens |
 * | `ui.sidebar.agents.rows_by_agent.<agent>` | array of arrays of tokens, one entry per agent |
 * | `ui.tab_bar_right` | array of entry tables |
 * | `keys.command` | array of command tables |
 *
 * `flattenTree` also expands arrays of tables into `keys.command[0].key`-style
 * leaves. Those are ignored here — every array rule reads the whole value — so it
 * costs nothing to pass a map that carries both.
 *
 * The second argument is the paths present in the user's file that no schema key
 * claims. `unknownKeysIn` computes it from the parsed paths and is the same
 * function this module uses to decide what "unknown" means, so a caller that
 * uses it cannot drift from the rule.
 *
 * ## What comes out
 *
 * A `Diagnostic[]`, sorted by path, each with a severity that says what herdr
 * would actually do with the file:
 *
 * - **error** — herdr's deserializer rejects the value, so the *whole file* is
 *   thrown away and herdr starts on defaults ("config parse error: …; using
 *   defaults", src/config/io.rs:150). Wrong types, out-of-range integers, a
 *   sidebar layout over the row cap, an unknown sidebar token, a malformed
 *   `tab_bar_right` entry.
 * - **warning** — herdr loads the file and degrades one setting, printing a
 *   diagnostic (`Config::collect_diagnostics`, src/config.rs:84-97). Unknown
 *   keys, an unknown theme name or color, an invalid or colliding keybinding,
 *   `sidebar_min_width` above `sidebar_max_width`.
 *
 * That split is what invariant 6 rests on: download is blocked on errors, because
 * an error means herdr would ignore the file entirely. It is not a guess: the
 * `against herdr config check` block in `validate.test.ts` pins each side of it
 * to what `herdr config check` actually printed for the same input.
 *
 * Every non-obvious rule cites `github.com/herdrdev/herdr` at tag `v0.8.2`.
 *
 * One house rule throughout: any lookup table whose key can come out of a config
 * file is a `Map`, never an object literal. A plain object answers `constructor`
 * and `__proto__` out of `Object.prototype`, which turns a value herdr rejects
 * into one corral quietly accepts.
 */

import {
  allEntries,
  allKeys,
  byKey,
  enumOptions,
  sidebarTokenBuiltins,
  tabBarEntryTypes,
  themeNames,
} from '@/schema'
import {
  formatChord,
  isIndexedChord,
  isUnmodifiedPrintable,
  navigateRejection,
  parseBinding,
  parseChord,
  parseModifierCombo,
} from '@/model/keys'
import type { Chord } from '@/model/keys'
import type { TomlTable, TomlValue } from '@/model/parse'
import { parsePath } from '@/model/paths'

/** How badly herdr reacts: `error` means it discards the file, `warning` that it copes. */
export type Severity = 'error' | 'warning'

/** One thing wrong with a config, addressed by the path it is wrong at. */
export interface Diagnostic {
  readonly severity: Severity
  /** Dotted path in `paths.ts` format, `[n]`-indexed into arrays. */
  readonly path: string
  readonly message: string
}

/** The flat `path → value` map described in this module's docstring. */
export type EffectiveConfig = ReadonlyMap<string, TomlValue>

// ---------------------------------------------------------------------------
// value shapes
// ---------------------------------------------------------------------------

function isTable(value: TomlValue): value is TomlTable {
  if (typeof value !== 'object' || value === null) return false
  return !Array.isArray(value) && !(value instanceof Date)
}

function isArray(value: TomlValue): value is TomlValue[] {
  return Array.isArray(value)
}

function isInteger(value: TomlValue): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

/** How a value reads in a diagnostic. Mirrors Rust's `{:?}` closely enough. */
function show(value: TomlValue): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value instanceof Date) return value.toISOString()
  if (isTable(value) || isArray(value)) return JSON.stringify(value)
  return String(value)
}

/** herdr's own word for a value's type, for "expected X, got Y" messages. */
function typeWord(value: TomlValue): string {
  if (isArray(value)) return 'a list'
  if (value instanceof Date) return 'a date'
  if (isTable(value)) return 'a table'
  if (typeof value === 'number') return Number.isInteger(value) ? 'an integer' : 'a float'
  if (typeof value === 'boolean') return 'a boolean'
  return 'a string'
}

// ---------------------------------------------------------------------------
// colors
// ---------------------------------------------------------------------------

/**
 * Names `parse_color` resolves to `Color::Reset` (src/config/theme.rs:130-133).
 * herdr accepts them for every color setting, so there is no "reset is allowed
 * only here" rule to enforce.
 */
const RESET_COLORS: readonly string[] = ['reset', 'default', 'none', 'transparent']

/** Named colors, with herdr's aliases (src/config/theme.rs:168-189). */
const NAMED_COLORS: readonly string[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'purple',
  'cyan',
  'white',
  'gray',
  'grey',
  'darkgray',
  'darkgrey',
  'lightred',
  'lightgreen',
  'lightyellow',
  'lightblue',
  'lightmagenta',
  'lightcyan',
]

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/
const RGB_COLOR = /^rgb\(([^)]*)\)$/
const RGB_COMPONENT = /^\+?\d+$/

/** True when `#rgb` or `#rrggbb`, the only syntax a sidebar token `fg` accepts. */
export function isHexColor(text: string): boolean {
  return HEX_COLOR.test(text.trim().toLowerCase())
}

/**
 * True when `parse_color` would resolve `text` to something other than its cyan
 * fallback (src/config/theme.rs:126-190). Case and surrounding space are
 * ignored, because herdr trims and lowercases first.
 */
export function isColor(text: string): boolean {
  const value = text.trim().toLowerCase()
  if (RESET_COLORS.includes(value)) return true
  if (HEX_COLOR.test(value)) return true
  const rgb = RGB_COLOR.exec(value)
  if (rgb !== null) {
    const parts = rgb[1].split(',')
    if (
      parts.length === 3 &&
      parts.every((part) => {
        const component = part.trim()
        return RGB_COMPONENT.test(component) && Number.parseInt(component, 10) <= 255
      })
    ) {
      return true
    }
  }
  return NAMED_COLORS.includes(value)
}

// ---------------------------------------------------------------------------
// themes
// ---------------------------------------------------------------------------

/**
 * Spellings `canonical_theme_name` accepts on top of the built-in names
 * (src/config/theme.rs:25-47). The names themselves come from the schema, so a
 * herdr release that adds a theme needs no edit here.
 *
 * A `Map`, because the lookup key is the name out of the user's file: a plain
 * object would answer `constructor` out of `Object.prototype` and pass an
 * unknown theme name off as a real one.
 */
const THEME_ALIASES: ReadonlyMap<string, string> = new Map([
  ['catppuccin-mocha', 'catppuccin'],
  ['latte', 'catppuccin-latte'],
  ['light', 'catppuccin-latte'],
  ['tokyonight', 'tokyo-night'],
  ['tokyo-day', 'tokyo-night-day'],
  ['tokyonight-day', 'tokyo-night-day'],
  ['gruvbox-dark', 'gruvbox'],
  ['onedark', 'one-dark'],
  ['onelight', 'one-light'],
  ['solarized-dark', 'solarized'],
  ['lotus', 'kanagawa-lotus'],
  ['rosepine', 'rose-pine'],
  ['rosepine-dawn', 'rose-pine-dawn'],
  ['dawn', 'rose-pine-dawn'],
])

/**
 * The built-in theme `name` selects, or `null` when herdr would fall back.
 *
 * herdr lowercases and turns spaces and underscores into hyphens before it looks
 * the name up, so `Tokyo Night` and `TOKYO_NIGHT` both land on `tokyo-night`
 * (src/config/theme.rs:26).
 */
export function canonicalThemeName(name: string): string | null {
  const normalized = name.toLowerCase().replaceAll(' ', '-').replaceAll('_', '-')
  if (themeNames().includes(normalized)) return normalized
  return THEME_ALIASES.get(normalized) ?? null
}

// ---------------------------------------------------------------------------
// key sets
// ---------------------------------------------------------------------------

/** u16 fields: serde rejects anything outside this, which loses the whole file. */
const U16_MAX = 65_535

/** `MAX_TOAST_DELAY_SECONDS` (src/config/model.rs:12), enforced at line 1203. */
const MAX_TOAST_DELAY_SECONDS = 3_600

/** `MAX_TAB_BAR_COMMAND_INTERVAL_SECONDS` (src/config/tab_bar.rs:5) — one year. */
const MAX_TAB_BAR_COMMAND_INTERVAL_SECONDS = 31_536_000

/** `MAX_TAB_BAR_COMMAND_TIMEOUT_SECONDS` (src/config/tab_bar.rs:6). */
const MAX_TAB_BAR_COMMAND_TIMEOUT_SECONDS = 3_600

/** `MAX_TAB_BAR_RIGHT_ENTRIES` (src/config/tab_bar.rs:7). */
const MAX_TAB_BAR_RIGHT_ENTRIES = 16

/** `MAX_SIDEBAR_ROWS` (src/config/sidebar.rs:7). */
const MAX_SIDEBAR_ROWS = 16

/** `MAX_SIDEBAR_TOKENS_PER_ROW` (src/config/sidebar.rs:8). */
const MAX_SIDEBAR_TOKENS_PER_ROW = 16

/** A custom sidebar token's name may not be longer (src/config/sidebar.rs:200). */
const MAX_CUSTOM_SIDEBAR_TOKEN_LENGTH = 32

/**
 * Documented integer bounds, by path.
 *
 * Everything herdr reads into a `u16` shares the same ceiling; the two settings
 * with a narrower rule of their own are listed explicitly.
 */
const INTEGER_BOUNDS: ReadonlyMap<string, number> = new Map([
  ['server.headless_cols', U16_MAX],
  ['server.headless_rows', U16_MAX],
  ['ui.sidebar_width', U16_MAX],
  ['ui.sidebar_min_width', U16_MAX],
  ['ui.sidebar_max_width', U16_MAX],
  ['ui.mobile_width_threshold', U16_MAX],
  ['ui.sidebar.agents.row_gap', U16_MAX],
  ['ui.sidebar.spaces.row_gap', U16_MAX],
  ['ui.toast.delay_seconds', MAX_TOAST_DELAY_SECONDS],
])

/** Navigate-mode movement, which plays by its own rules (see `keys.ts`). */
const NAVIGATE_KEYS: readonly string[] = [
  'keys.navigate_workspace_up',
  'keys.navigate_workspace_down',
  'keys.navigate_pane_left',
  'keys.navigate_pane_down',
  'keys.navigate_pane_up',
  'keys.navigate_pane_right',
]

/**
 * Actions that select by number and so must bind `1`…`9`
 * (`push_indexed_binding`, src/config/keybinds.rs:917-925).
 */
const INDEXED_KEYS: readonly string[] = [
  'keys.focus_agent',
  'keys.switch_tab',
  'keys.switch_workspace',
]

/** Legacy modifier-only settings that expand over `1`…`9` (src/config/keybinds.rs:936-974). */
const LEGACY_INDEXED_KEYS: readonly string[] = [
  'keys.indexed.tabs',
  'keys.indexed.workspaces',
  'keys.indexed.agents',
]

/**
 * The prefix herdr falls back to when `keys.prefix` will not parse
 * (src/config/keybinds.rs:442-446).
 */
const DEFAULT_PREFIX_LABEL = 'ctrl+b'

/** Chord-valued settings the schema types as plain strings. */
const CHORD_STRING_KEYS: readonly string[] = ['keys.prefix', 'keys.remote_image_paste']

/** Settings whose rules live in a dedicated pass rather than the schema loop. */
const SPECIAL_KEYS: ReadonlySet<string> = new Set([
  ...CHORD_STRING_KEYS,
  ...LEGACY_INDEXED_KEYS,
  'terminal.new_cwd',
  'ui.right_click_passthrough_modifier',
  'ui.window_title',
  'ui.tab_bar_right',
  'ui.sidebar.agents.rows',
  'ui.sidebar.agents.rows_by_agent',
  'ui.sidebar.spaces.rows',
  'ui.sound.path',
  'ui.sound.done_path',
  'ui.sound.request_path',
])

/**
 * Canonical agent ids, from `agent_label` (src/detect/mod.rs:118-143).
 *
 * `rows_by_agent` keys must be *canonical*, not merely recognized:
 * `parse_canonical_agent_label` re-prints the agent and demands the id match, so
 * `claude-code` and `github-copilot` are rejected even though herdr detects them
 * (src/detect/mod.rs:183-186). These also differ from the `ui.sound.agents.*`
 * field names, which spell two of them `open_code` and `github_copilot`.
 */
const CANONICAL_AGENT_IDS: readonly string[] = [
  'pi',
  'claude',
  'codex',
  'gemini',
  'cursor',
  'devin',
  'agy',
  'cline',
  'omp',
  'mastracode',
  'opencode',
  'copilot',
  'kimi',
  'kiro',
  'droid',
  'amp',
  'grok',
  'hermes',
  'kilo',
  'qodercli',
  'qwen',
  'maki',
]

/** Fields a `[[keys.command]]` table accepts (src/config/keybinds.rs:88-104). */
const COMMAND_FIELDS: readonly string[] = [
  'key',
  'command',
  'type',
  'description',
  'width',
  'height',
]

/** Command execution modes (`CommandKeybindType`, src/config/keybinds.rs:78-86). */
const COMMAND_TYPES: readonly string[] = ['shell', 'pane', 'popup', 'plugin_action']

/**
 * Fields each `ui.tab_bar_right` entry type accepts, and which are required.
 *
 * The enum is internally tagged on `type` (src/config/tab_bar.rs:21-40). A
 * missing required field is fatal, but the `deny_unknown_fields` on the
 * declaration never fires: serde does not support it on an internally tagged
 * enum, and the buffered content is invisible to the unknown-key pass too — so
 * a stray field is silently dropped, and corral is the only one who will say so.
 * Both behaviours are verified against `herdr config check` in the tests.
 */
interface TabBarEntryShape {
  readonly required: readonly string[]
  readonly optional: readonly string[]
}

const TAB_BAR_ENTRY_FIELDS: ReadonlyMap<string, TabBarEntryShape> = new Map([
  ['zoom', { required: [], optional: [] }],
  ['hostname', { required: [], optional: [] }],
  ['datetime', { required: [], optional: ['format'] }],
  ['text', { required: ['text'], optional: [] }],
  ['command', { required: ['command'], optional: ['interval_seconds', 'timeout_seconds'] }],
] satisfies readonly (readonly [string, TabBarEntryShape])[])

/** Tokens `ui.window_title` substitutes (src/config/window_title.rs:36-43). */
const WINDOW_TITLE_TOKENS: readonly string[] = [
  'hostname',
  'workspace',
  'tab',
  'pane',
  'terminal_title',
]

/**
 * Modifiers `ui.right_click_passthrough_modifier` accepts.
 *
 * A separate table from the chord one: here `meta` is its own bit and `shift` is
 * rejected outright (src/config/model.rs:179-205).
 */
const RIGHT_CLICK_MODIFIERS: readonly string[] = [
  'ctrl',
  'control',
  'alt',
  'option',
  'cmd',
  'command',
  'super',
  'meta',
  'hyper',
]

/** Spellings that disable right-click passthrough (src/config/model.rs:181-187). */
const RIGHT_CLICK_DISABLED: readonly string[] = ['', 'off', 'none', 'disabled']

// ---------------------------------------------------------------------------
// known keys
// ---------------------------------------------------------------------------

const ROWS_BY_AGENT_PREFIX = 'ui.sidebar.agents.rows_by_agent'

function segmentsOf(path: string): (string | number)[] | null {
  try {
    return parsePath(path).map((segment) =>
      segment.kind === 'key' ? segment.key : segment.index,
    )
  } catch {
    return null
  }
}

function joinKeys(segments: readonly (string | number)[]): string {
  return segments.filter((segment) => typeof segment === 'string').join('.')
}

/**
 * A path with its array indices blanked: `keys.command[2].key` → `keys.command[].key`.
 *
 * Lets the open-ended shapes be matched as literals instead of by index
 * arithmetic.
 */
function shapeOf(segments: readonly (string | number)[]): string {
  let shape = ''
  for (const segment of segments) {
    if (typeof segment === 'number') shape += '[]'
    else shape += shape === '' ? segment : `.${segment}`
  }
  return shape
}

/**
 * True when herdr has somewhere to put this path.
 *
 * The schema covers the fixed settings. Three shapes it cannot enumerate are
 * accepted here: occurrences of `[[keys.command]]`, entries of
 * `ui.tab_bar_right`, and the free-form agent ids under `rows_by_agent` — whose
 * *validity* is a separate rule, so an unrecognized agent is reported as a bad
 * id rather than as an unknown key.
 */
export function isKnownKey(path: string): boolean {
  if (byKey(path) !== undefined) return true
  const segments = segmentsOf(path)
  if (segments === null) return false
  const shape = shapeOf(segments)
  const last = segments.at(-1)

  // `ui.sidebar.agents.rows_by_agent.<agent>` — any id; a bad one is its own rule.
  if (
    segments.length === 5 &&
    joinKeys(segments.slice(0, 4)) === ROWS_BY_AGENT_PREFIX &&
    typeof last === 'string'
  ) {
    return true
  }

  // `keys.command`, `keys.command[i]`, `keys.command[i].<field>`.
  if (shape === 'keys.command' || shape === 'keys.command[]') return true
  // `ui.tab_bar_right[i].<field>`; the list itself is a schema key.
  if (shape === 'ui.tab_bar_right[]') return true

  if (typeof last !== 'string') return false
  if (shape === `keys.command[].${last}`) return COMMAND_FIELDS.includes(last)
  // Every field of an entry counts as known, even a misspelt one. Which fields
  // an entry may carry depends on its `type`, so `checkTabBarEntry` owns that
  // rule and says which type rejected it; letting the unknown-key pass have an
  // opinion too would only report the same field twice.
  if (shape === `ui.tab_bar_right[].${last}`) return true

  return false
}

/** The paths in `paths` that no schema key and no open-ended shape claims. */
export function unknownKeysIn(paths: Iterable<string>): string[] {
  return [...paths].filter((path) => !isKnownKey(path))
}

// ---------------------------------------------------------------------------
// "did you mean"
// ---------------------------------------------------------------------------

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      current.push(Math.min(substitution, previous[j] + 1, current[j - 1] + 1))
    }
    previous = current
  }
  return previous[b.length]
}

/**
 * The schema key `path` most likely meant, or `null` when nothing is close.
 *
 * herdr's own unknown-key diagnostic carries no suggestion — it special-cases
 * only `[toast]` → `[ui.toast]` (src/config/io.rs:405-412). This is corral's
 * addition, and the `toast.*` case falls out of it for free.
 */
export function suggestKey(path: string): string | null {
  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const key of allKeys()) {
    const distance = editDistance(path, key)
    if (distance < bestDistance) {
      bestDistance = distance
      best = key
    }
  }
  if (best === null) return null
  return bestDistance <= 3 && bestDistance * 3 <= path.length ? best : null
}

// ---------------------------------------------------------------------------
// the collector
// ---------------------------------------------------------------------------

class Diagnostics {
  private readonly found: Diagnostic[] = []

  error(path: string, message: string): void {
    this.found.push({ severity: 'error', path, message })
  }

  warn(path: string, message: string): void {
    this.found.push({ severity: 'warning', path, message })
  }

  /** Sorted by path so the diagnostics line reads in config order, not rule order. */
  sorted(): Diagnostic[] {
    return [...this.found.entries()]
      .sort(([leftIndex, left], [rightIndex, right]) =>
        left.path === right.path ? leftIndex - rightIndex : left.path < right.path ? -1 : 1,
      )
      .map(([, diagnostic]) => diagnostic)
  }
}

// ---------------------------------------------------------------------------
// per-type rules
// ---------------------------------------------------------------------------

function checkInteger(path: string, value: TomlValue, out: Diagnostics): void {
  if (!isInteger(value)) {
    out.error(path, `expected an integer, got ${typeWord(value)}`)
    return
  }
  if (value < 0) {
    out.error(path, `expected a non-negative integer, got ${value}`)
    return
  }
  const max = INTEGER_BOUNDS.get(path)
  if (max !== undefined && value > max) {
    out.error(path, `must be between 0 and ${max}, got ${value}`)
  }
}

function checkEnum(path: string, value: TomlValue, out: Diagnostics): void {
  if (typeof value !== 'string') {
    out.error(path, `expected a string, got ${typeWord(value)}`)
    return
  }
  const options = enumOptions(path)
  if (options.length > 0 && !options.includes(value)) {
    out.error(path, `unknown value ${show(value)}; expected one of ${options.join(', ')}`)
  }
}

function checkColor(path: string, value: TomlValue, out: Diagnostics): void {
  if (typeof value !== 'string') {
    out.error(path, `expected a color string, got ${typeWord(value)}`)
    return
  }
  // `parse_color` never fails: an unrecognized color logs a warning and falls
  // back to cyan (src/config/theme.rs:185-188), so herdr still starts.
  if (!isColor(value)) {
    out.warn(path, `unknown color ${show(value)}; herdr will fall back to cyan`)
  }
}

function checkString(path: string, value: TomlValue, out: Diagnostics): void {
  if (typeof value !== 'string') out.error(path, `expected a string, got ${typeWord(value)}`)
}

function checkBoolean(path: string, value: TomlValue, out: Diagnostics): void {
  if (typeof value !== 'boolean') out.error(path, `expected a boolean, got ${typeWord(value)}`)
}

function checkStringList(path: string, value: TomlValue, out: Diagnostics): void {
  if (!isArray(value)) {
    out.error(path, `expected a list of strings, got ${typeWord(value)}`)
    return
  }
  for (const [index, element] of value.entries()) {
    if (typeof element !== 'string') {
      out.error(`${path}[${index}]`, `expected a string, got ${typeWord(element)}`)
    }
  }
}

/**
 * Type-check every fixed setting against the schema's own type word.
 *
 * Keybinding settings are checked here only for shape; their grammar and their
 * collisions are the keybinding pass's job, because that needs one registry
 * across all of them.
 */
function checkDeclaredTypes(effective: EffectiveConfig, out: Diagnostics): void {
  for (const entry of allEntries()) {
    if (SPECIAL_KEYS.has(entry.key)) continue
    const value = effective.get(entry.key)
    if (value === undefined) continue
    switch (entry.type) {
      case 'boolean':
        checkBoolean(entry.key, value, out)
        break
      case 'integer':
        checkInteger(entry.key, value, out)
        break
      case 'enum':
        checkEnum(entry.key, value, out)
        break
      case 'color':
        checkColor(entry.key, value, out)
        break
      case 'list of strings':
        checkStringList(entry.key, value, out)
        break
      case 'keybinding':
        if (bindingValues(value) === null) {
          out.error(
            entry.key,
            `expected a keybinding string or a list of them, got ${typeWord(value)}`,
          )
        }
        break
      default:
        checkString(entry.key, value, out)
    }
  }
}

// ---------------------------------------------------------------------------
// settings with rules of their own
// ---------------------------------------------------------------------------

function checkSoundPaths(effective: EffectiveConfig, out: Diagnostics): void {
  for (const path of ['ui.sound.path', 'ui.sound.done_path', 'ui.sound.request_path']) {
    const value = effective.get(path)
    if (value === undefined) continue
    if (typeof value !== 'string') {
      out.error(path, `expected a file path, got ${typeWord(value)}`)
      continue
    }
    if (value === '') continue
    // herdr also checks that the file exists and is a regular file
    // (src/config/sound.rs:102-114); a browser cannot, so only the extension
    // rule is mirrored (src/config/sound.rs:89-100).
    if (!/\.mp3$/i.test(value)) {
      out.warn(path, `unsupported sound file format ${show(value)}; expected an mp3 file`)
    }
  }
}

/**
 * `terminal.new_cwd` is an enum with an escape hatch: anything that is not
 * `follow`, `home` or `current` is taken as a directory path
 * (src/config/model.rs:237-250), so only its type can be checked. The `path`
 * option the reference lists is that escape hatch, not a literal value.
 */
function checkNewCwd(effective: EffectiveConfig, out: Diagnostics): void {
  const value = effective.get('terminal.new_cwd')
  if (value !== undefined) checkString('terminal.new_cwd', value, out)
}

function checkRightClickModifier(effective: EffectiveConfig, out: Diagnostics): void {
  const path = 'ui.right_click_passthrough_modifier'
  const value = effective.get(path)
  if (value === undefined) return
  if (typeof value !== 'string') {
    out.error(path, `expected a string, got ${typeWord(value)}`)
    return
  }
  const trimmed = value.trim()
  if (RIGHT_CLICK_DISABLED.includes(trimmed.toLowerCase())) return
  for (const token of trimmed.split('+')) {
    const modifier = token.trim().toLowerCase()
    if (!RIGHT_CLICK_MODIFIERS.includes(modifier)) {
      out.error(
        path,
        `must be empty, off, none, disabled, ctrl/control, alt/option, cmd/command/super, meta, hyper, or a + separated combination without shift; got ${show(value)}`,
      )
      return
    }
  }
}

/**
 * `ui.window_title` is a `{token}` template
 * (`WindowTitleTemplate::parse`, src/config/window_title.rs:62-110). A parse
 * failure leaves the outer terminal title alone rather than stopping herdr, so
 * these are warnings.
 */
function checkWindowTitle(effective: EffectiveConfig, out: Diagnostics): void {
  const path = 'ui.window_title'
  const value = effective.get(path)
  if (value === undefined) return
  if (typeof value !== 'string') {
    out.error(path, `expected a string, got ${typeWord(value)}`)
    return
  }
  const characters = Array.from(value)
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]
    if (character === '{' && characters[index + 1] === '{') {
      index++
      continue
    }
    if (character === '}' && characters[index + 1] === '}') {
      index++
      continue
    }
    if (character === '}') {
      out.warn(path, "has an unmatched '}'; herdr will leave the outer terminal title alone")
      return
    }
    if (character !== '{') continue
    const close = characters.indexOf('}', index + 1)
    if (close === -1) {
      out.warn(path, "has an unclosed '{'; herdr will leave the outer terminal title alone")
      return
    }
    const token = characters.slice(index + 1, close).join('').trim()
    if (!WINDOW_TITLE_TOKENS.includes(token)) {
      out.warn(
        path,
        `has unknown token '{${token}}'; expected one of ${WINDOW_TITLE_TOKENS.join(', ')}`,
      )
      return
    }
    index = close
  }
}

// ---------------------------------------------------------------------------
// sidebar token rows
// ---------------------------------------------------------------------------

const CUSTOM_TOKEN_NAME = /^[A-Za-z0-9_-]+$/

function checkSidebarToken(
  path: string,
  token: string,
  kind: 'agents' | 'spaces',
  out: Diagnostics,
): void {
  if (sidebarTokenBuiltins(kind).includes(token)) return
  if (!token.startsWith('$')) {
    out.error(path, `unknown sidebar token \`${token}\`; custom tokens must start with \`$\``)
    return
  }
  const name = token.slice(1)
  if (
    name.length === 0 ||
    name.length > MAX_CUSTOM_SIDEBAR_TOKEN_LENGTH ||
    !CUSTOM_TOKEN_NAME.test(name)
  ) {
    out.error(path, `invalid custom sidebar token \`${token}\``)
  }
}

/**
 * One entry in a row: a bare token name, or a table styling it.
 *
 * The styled form is `deny_unknown_fields` (src/config/sidebar.rs:152-162), so a
 * stray field is fatal, and `fg` takes only `#RGB` / `#RRGGBB` — a narrower
 * syntax than every other color setting (src/config/sidebar.rs:66-75).
 */
function checkSidebarEntry(
  path: string,
  entry: TomlValue,
  kind: 'agents' | 'spaces',
  out: Diagnostics,
): void {
  if (typeof entry === 'string') {
    checkSidebarToken(path, entry, kind, out)
    return
  }
  if (!isTable(entry)) {
    out.error(path, `expected a token name or a styled token table, got ${typeWord(entry)}`)
    return
  }
  const token = entry.token
  if (token === undefined) {
    out.error(path, 'a styled sidebar token needs a `token` field')
  } else if (typeof token !== 'string') {
    out.error(`${path}.token`, `expected a string, got ${typeWord(token)}`)
  } else {
    checkSidebarToken(`${path}.token`, token, kind, out)
  }
  for (const [field, value] of Object.entries(entry)) {
    if (field === 'token') continue
    if (field === 'fg') {
      if (typeof value !== 'string' || !isHexColor(value)) {
        out.error(`${path}.fg`, 'sidebar token fg must be #RGB or #RRGGBB')
      }
      continue
    }
    if (field === 'bold' || field === 'dim') {
      if (typeof value !== 'boolean') {
        out.error(`${path}.${field}`, `expected a boolean, got ${typeWord(value)}`)
      }
      continue
    }
    out.error(`${path}.${field}`, `unknown field on a styled sidebar token \`${field}\``)
  }
}

/**
 * A whole `rows` value: a list of rows, each a list of tokens.
 *
 * The caps are `MAX_SIDEBAR_ROWS` and `MAX_SIDEBAR_TOKENS_PER_ROW`, both raised
 * as deserializer errors (`validate_sidebar_rows`, src/config/sidebar.rs:21-36),
 * so exceeding either costs the whole file.
 */
function checkTokenRows(
  path: string,
  value: TomlValue,
  kind: 'agents' | 'spaces',
  out: Diagnostics,
): void {
  if (!isArray(value)) {
    out.error(path, `expected a list of token rows, got ${typeWord(value)}`)
    return
  }
  if (value.length > MAX_SIDEBAR_ROWS) {
    out.error(path, `sidebar layouts may contain at most ${MAX_SIDEBAR_ROWS} rows`)
  }
  for (const [rowIndex, row] of value.entries()) {
    const rowPath = `${path}[${rowIndex}]`
    if (!isArray(row)) {
      out.error(rowPath, `expected a row of tokens, got ${typeWord(row)}`)
      continue
    }
    if (row.length > MAX_SIDEBAR_TOKENS_PER_ROW) {
      out.error(rowPath, `sidebar rows may contain at most ${MAX_SIDEBAR_TOKENS_PER_ROW} tokens`)
    }
    for (const [tokenIndex, entry] of row.entries()) {
      checkSidebarEntry(`${rowPath}[${tokenIndex}]`, entry, kind, out)
    }
  }
}

function checkSidebarRows(effective: EffectiveConfig, out: Diagnostics): void {
  for (const kind of ['agents', 'spaces'] as const) {
    const path = `ui.sidebar.${kind}.rows`
    const value = effective.get(path)
    if (value !== undefined) checkTokenRows(path, value, kind, out)
  }

  const whole = effective.get(ROWS_BY_AGENT_PREFIX)
  if (whole !== undefined && !isTable(whole)) {
    out.error(ROWS_BY_AGENT_PREFIX, `expected a table of token rows, got ${typeWord(whole)}`)
  }

  for (const [path, value] of effective) {
    const segments = segmentsOf(path)
    if (
      segments === null ||
      segments.length !== 5 ||
      joinKeys(segments.slice(0, 4)) !== ROWS_BY_AGENT_PREFIX ||
      typeof segments[4] !== 'string'
    ) {
      continue
    }
    const agent = segments[4]
    if (!CANONICAL_AGENT_IDS.includes(agent)) {
      out.error(path, `unknown canonical agent id \`${agent}\` in sidebar rows_by_agent`)
    }
    checkTokenRows(path, value, 'agents', out)
  }
}

// ---------------------------------------------------------------------------
// ui.tab_bar_right
// ---------------------------------------------------------------------------

function checkSeconds(
  path: string,
  value: TomlValue,
  max: number,
  out: Diagnostics,
): void {
  if (!isInteger(value)) {
    out.error(path, `expected an integer, got ${typeWord(value)}`)
    return
  }
  if (value < 0) {
    out.error(path, `expected a non-negative integer, got ${value}`)
    return
  }
  // Zero and over-max both parse; herdr hides the entry and warns
  // (src/config/tab_bar.rs:85-104).
  if (value === 0) out.warn(path, 'must be at least 1; herdr will hide the entry')
  else if (value > max) out.warn(path, `may be at most ${max}; herdr will hide the entry`)
}

function checkTabBarEntry(path: string, entry: TomlValue, out: Diagnostics): void {
  if (!isTable(entry)) {
    out.error(path, `expected an entry table, got ${typeWord(entry)}`)
    return
  }
  const type = entry.type
  if (typeof type !== 'string' || !tabBarEntryTypes().includes(type)) {
    out.error(
      `${path}.type`,
      `unknown entry type ${type === undefined ? '(missing)' : show(type)}; expected one of ${tabBarEntryTypes().join(', ')}`,
    )
    return
  }
  const shape = TAB_BAR_ENTRY_FIELDS.get(type)
  if (shape === undefined) return
  for (const field of shape.required) {
    if (entry[field] === undefined) {
      out.error(`${path}.${field}`, `a ${type} entry needs a \`${field}\` field`)
    }
  }
  for (const field of Object.keys(entry)) {
    if (field === 'type' || shape.required.includes(field) || shape.optional.includes(field)) {
      continue
    }
    out.warn(
      `${path}.${field}`,
      `unknown field \`${field}\` on a ${type} entry; herdr will ignore it`,
    )
  }

  if (type === 'text' && entry.text !== undefined && typeof entry.text !== 'string') {
    out.error(`${path}.text`, `expected a string, got ${typeWord(entry.text)}`)
  }

  if (type === 'datetime' && entry.format !== undefined) {
    if (typeof entry.format !== 'string') {
      out.error(`${path}.format`, `expected a string, got ${typeWord(entry.format)}`)
    } else if (entry.format === '') {
      // herdr also rejects formats the `time` crate cannot compile
      // (src/config/tab_bar.rs:42-54); corral does not reproduce that crate's
      // strftime table, so only the empty case is reported here.
      out.warn(`${path}.format`, 'datetime format is empty; herdr will hide the entry')
    }
  }

  if (type !== 'command') return
  const command = entry.command
  if (command !== undefined && typeof command !== 'string') {
    out.error(`${path}.command`, `expected a string, got ${typeWord(command)}`)
  } else if (typeof command === 'string' && command.trim() === '') {
    out.warn(`${path}.command`, 'command is empty; herdr will hide the entry')
  }
  if (entry.interval_seconds !== undefined) {
    checkSeconds(
      `${path}.interval_seconds`,
      entry.interval_seconds,
      MAX_TAB_BAR_COMMAND_INTERVAL_SECONDS,
      out,
    )
  }
  if (entry.timeout_seconds !== undefined) {
    checkSeconds(
      `${path}.timeout_seconds`,
      entry.timeout_seconds,
      MAX_TAB_BAR_COMMAND_TIMEOUT_SECONDS,
      out,
    )
  }
}

function checkTabBarRight(effective: EffectiveConfig, out: Diagnostics): void {
  const path = 'ui.tab_bar_right'
  const value = effective.get(path)
  if (value === undefined) return
  if (!isArray(value)) {
    out.error(path, `expected a list of entries, got ${typeWord(value)}`)
    return
  }
  if (value.length > MAX_TAB_BAR_RIGHT_ENTRIES) {
    out.warn(
      path,
      `may contain at most ${MAX_TAB_BAR_RIGHT_ENTRIES} entries; herdr will ignore the extras`,
    )
  }
  for (const [index, entry] of value.entries()) {
    checkTabBarEntry(`${path}[${index}]`, entry, out)
  }
}

// ---------------------------------------------------------------------------
// keybindings
// ---------------------------------------------------------------------------

/**
 * The strings a keybinding setting holds.
 *
 * `BindingConfig` is untagged `One(String) | Many(Vec<String>)`
 * (src/config/keybinds.rs:19-24), so one action may carry several chords.
 */
export function bindingValues(value: TomlValue): string[] | null {
  if (typeof value === 'string') return [value]
  if (isArray(value) && value.every((element) => typeof element === 'string')) {
    return value as string[]
  }
  return null
}

/**
 * Whether a binding came from the user's file or from herdr's defaults.
 *
 * herdr registers every user-configured setting before any default and drops a
 * *default* that collides with a user binding **silently**
 * (src/config/keybinds.rs:590, 1038-1040). Getting that right is what keeps
 * corral from inventing a conflict every time someone moves a binding onto a
 * chord some default already had.
 */
type BindingSource = 'user' | 'default'

interface Claim {
  readonly field: string
  readonly source: BindingSource
}

interface Registry {
  /** Label → the setting that claimed it first. */
  readonly claimed: Map<string, Claim>
  /** The printed prefix chord, which no prefix-mode binding may re-use. */
  prefixLabel: string
  /** Where the prefix itself came from, which gates the reserved-prefix rule. */
  prefixSource: BindingSource
}

interface RegisterOptions {
  readonly navigate: boolean
  readonly source: BindingSource
}

/**
 * Register a chord, reporting the conflicts herdr reports.
 *
 * `reject_binding` (src/config/keybinds.rs:1017-1060) refuses three things: a
 * prefix-mode binding on the prefix key itself, a chord another setting already
 * claimed, and a direct binding that would swallow ordinary typing. The first
 * two are skipped without a word when the loser is a default and the winner is
 * the user's own binding; the third is unconditional.
 */
function registerChord(
  field: string,
  chord: Chord,
  registry: Registry,
  out: Diagnostics,
  options: RegisterOptions,
): void {
  const label = formatChord(chord)

  if (options.navigate) {
    const rejection = navigateRejection(chord)
    if (rejection !== null) {
      out.warn(field, `${rejection}: ${show(label)}; herdr will disable the binding`)
      return
    }
  } else if (chord.prefix && label === `prefix+${registry.prefixLabel}`) {
    if (options.source === 'default' && registry.prefixSource === 'user') return
    out.warn(
      field,
      `${show(label)} uses keys.prefix as the prefix-mode key; pressing the prefix twice sends a literal prefix key, so herdr will disable the binding`,
    )
    return
  }

  const owner = registry.claimed.get(label)
  if (owner !== undefined) {
    if (options.source === 'default' && owner.source === 'user') return
    out.warn(field, `${label}: kept ${owner.field}, disabled ${field}`)
    return
  }

  if (!options.navigate && !chord.prefix && isUnmodifiedPrintable(chord)) {
    out.warn(
      field,
      `unsafe direct keybinding ${show(label)} would intercept typing; use ${show(`prefix+${label}`)} to require the prefix; herdr will disable the binding`,
    )
    return
  }

  registry.claimed.set(label, { field, source: options.source })
}

function checkBindingField(
  field: string,
  raw: string,
  registry: Registry,
  out: Diagnostics,
  options: RegisterOptions & { readonly indexed: boolean },
): void {
  const binding = parseBinding(raw)
  if (binding === null) {
    out.warn(field, `invalid keybinding ${show(raw)}; herdr will disable the binding`)
    return
  }
  if (binding.kind === 'range') {
    if (!options.indexed) {
      out.warn(
        field,
        `range keybinding ${show(raw)} is only valid for indexed actions; herdr will disable the binding`,
      )
      return
    }
    for (const chord of binding.chords) registerChord(field, chord, registry, out, options)
    return
  }
  if (options.indexed && !isIndexedChord(binding.chord)) {
    out.warn(
      field,
      `indexed keybinding must use 1..9: ${show(formatChord(binding.chord))}; herdr will disable the binding`,
    )
    return
  }
  registerChord(field, binding.chord, registry, out, options)
}

function checkKeybindings(
  effective: EffectiveConfig,
  out: Diagnostics,
  sourceOf: (path: string) => BindingSource,
): void {
  // Navigate mode keeps a registry of its own, so a navigate binding never
  // collides with a prefix-mode action (src/config/keybinds.rs:456-460).
  const prefixSource = sourceOf('keys.prefix')
  const actions: Registry = { claimed: new Map(), prefixLabel: DEFAULT_PREFIX_LABEL, prefixSource }
  const navigate: Registry = {
    claimed: new Map(),
    prefixLabel: DEFAULT_PREFIX_LABEL,
    prefixSource,
  }

  // There is always a prefix, and it is always reserved. herdr parses
  // `keys.prefix`, falls back to `ctrl+b` when it will not parse, and registers
  // whichever it ended up with in both registries
  // (src/config/keybinds.rs:442-459) — so a binding on the fallback collides
  // with the prefix just as a binding on a good one does.
  const rawPrefix = effective.get('keys.prefix')
  let prefixChord: Chord | null = null
  if (rawPrefix === undefined) {
    // nothing to say; the fallback below is also herdr's default
  } else if (typeof rawPrefix !== 'string') {
    out.error('keys.prefix', `expected a string, got ${typeWord(rawPrefix)}`)
  } else {
    prefixChord = parseChord(rawPrefix)
    if (prefixChord === null) {
      out.warn('keys.prefix', `invalid keybinding ${show(rawPrefix)}; herdr will use ctrl+b`)
    }
  }
  const prefixLabel = prefixChord === null ? DEFAULT_PREFIX_LABEL : formatChord(prefixChord)
  const prefixClaim: Claim = { field: 'keys.prefix', source: prefixSource }
  actions.prefixLabel = prefixLabel
  navigate.prefixLabel = prefixLabel
  actions.claimed.set(prefixLabel, prefixClaim)
  navigate.claimed.set(prefixLabel, prefixClaim)

  const rawPaste = effective.get('keys.remote_image_paste')
  if (rawPaste !== undefined) {
    if (typeof rawPaste !== 'string') {
      out.error('keys.remote_image_paste', `expected a string, got ${typeWord(rawPaste)}`)
    } else if (rawPaste.trim() !== '' && parseChord(rawPaste) === null) {
      out.warn(
        'keys.remote_image_paste',
        `invalid keybinding ${show(rawPaste)}; herdr will disable the binding`,
      )
    }
  }

  // herdr's two passes: everything the user set, then everything left on its
  // default (src/config/keybinds.rs:590).
  for (const source of ['user', 'default'] as const) {
    for (const entry of allEntries()) {
      if (entry.type !== 'keybinding') continue
      if (sourceOf(entry.key) !== source) continue
      const value = effective.get(entry.key)
      if (value === undefined) continue
      const values = bindingValues(value)
      if (values === null) continue // already reported as a type error
      const isNavigate = NAVIGATE_KEYS.includes(entry.key)
      const options = {
        navigate: isNavigate,
        indexed: INDEXED_KEYS.includes(entry.key),
        source,
      }
      for (const raw of values) {
        if (raw.trim() === '') continue
        checkBindingField(entry.key, raw, isNavigate ? navigate : actions, out, options)
      }
    }
    if (source !== 'user') continue
    // Both of these are user configuration by construction: `[keys.indexed]`
    // and `[[keys.command]]` have no defaults, and herdr only reads custom
    // commands in the user pass (src/config/keybinds.rs:703-710).
    checkLegacyIndexed(effective, actions, out)
    checkCommands(effective, actions, out)
  }
}

/**
 * `[keys.indexed]` names only the modifiers `1`…`9` are held with, and herdr
 * expands each setting into nine direct bindings
 * (`append_legacy_indexed_bindings`, src/config/keybinds.rs:936-974).
 */
function checkLegacyIndexed(
  effective: EffectiveConfig,
  registry: Registry,
  out: Diagnostics,
): void {
  for (const field of LEGACY_INDEXED_KEYS) {
    const value = effective.get(field)
    if (value === undefined) continue
    if (typeof value !== 'string') {
      out.error(field, `expected a string, got ${typeWord(value)}`)
      continue
    }
    if (value.trim() === '') continue
    const modifiers = parseModifierCombo(value.trim())
    if (modifiers === null) {
      out.warn(field, `invalid indexed keybinding ${show(value)}; herdr will disable the binding`)
      continue
    }
    for (let digit = 1; digit <= 9; digit++) {
      registerChord(field, { prefix: false, modifiers, key: String(digit) }, registry, out, {
        navigate: false,
        source: 'user',
      })
    }
  }
}

/** A popup size: a cell count, or a percentage string (src/popup_size.rs:20-41). */
function checkPopupSize(path: string, value: TomlValue, out: Diagnostics): void {
  if (isInteger(value)) {
    if (value < 0 || value > U16_MAX) {
      out.error(path, `cell count must be between 0 and ${U16_MAX}, got ${value}`)
    }
    return
  }
  if (typeof value !== 'string') {
    out.error(
      path,
      `expected a cell count or a percentage string like "80%", got ${typeWord(value)}`,
    )
    return
  }
  if (!value.endsWith('%')) {
    out.error(path, 'string sizes must be percentages like "80%"; use a number for cells')
    return
  }
  const percent = value.slice(0, -1)
  if (!/^\+?\d+$/.test(percent)) {
    out.error(path, `expected a percentage like "80%", got ${show(value)}`)
    return
  }
  const number = Number.parseInt(percent, 10)
  if (number < 1 || number > 100) out.error(path, 'percentage must be between 1% and 100%')
}

function checkCommands(
  effective: EffectiveConfig,
  registry: Registry,
  out: Diagnostics,
): void {
  const value = effective.get('keys.command')
  if (value === undefined) return
  if (!isArray(value)) {
    out.error('keys.command', `expected a list of command tables, got ${typeWord(value)}`)
    return
  }

  for (const [index, entry] of value.entries()) {
    const path = `keys.command[${index}]`
    if (!isTable(entry)) {
      out.error(path, `expected a command table, got ${typeWord(entry)}`)
      continue
    }

    const command = entry.command
    if (command !== undefined && typeof command !== 'string') {
      out.error(`${path}.command`, `expected a string, got ${typeWord(command)}`)
    } else if (command === undefined || command.trim() === '') {
      // src/config/keybinds.rs:749-754 — herdr drops the whole entry.
      out.warn(`${path}.command`, 'empty custom command; herdr will disable it')
    }

    if (entry.description !== undefined && typeof entry.description !== 'string') {
      out.error(`${path}.description`, `expected a string, got ${typeWord(entry.description)}`)
    }

    const type = entry.type
    if (type !== undefined && (typeof type !== 'string' || !COMMAND_TYPES.includes(type))) {
      out.error(
        `${path}.type`,
        `unknown value ${show(type)}; expected one of ${COMMAND_TYPES.join(', ')}`,
      )
    }

    const isPopup = type === 'popup'
    for (const field of ['width', 'height'] as const) {
      const size = entry[field]
      if (size === undefined) continue
      checkPopupSize(`${path}.${field}`, size, out)
      if (!isPopup) {
        // src/config/keybinds.rs:776-782 — kept, but ignored.
        out.warn(
          `${path}.${field}`,
          'popup size on a non-popup custom command; herdr will ignore it',
        )
      }
    }

    const key = entry.key
    if (key === undefined) continue
    const keys = bindingValues(key)
    if (keys === null) {
      out.error(
        `${path}.key`,
        `expected a keybinding string or a list of them, got ${typeWord(key)}`,
      )
      continue
    }
    for (const raw of keys) {
      if (raw.trim() === '') continue
      checkBindingField(`${path}.key`, raw, registry, out, {
        navigate: false,
        indexed: false,
        source: 'user',
      })
    }
  }
}

// ---------------------------------------------------------------------------
// cross-field
// ---------------------------------------------------------------------------

/**
 * A valid integer at `path`, or `null`.
 *
 * A value that already failed its own type or range rule is treated as absent,
 * so a cross-field rule never piles a second complaint onto a bad number.
 */
function integerAt(effective: EffectiveConfig, path: string): number | null {
  const value = effective.get(path)
  if (value === undefined || !isInteger(value) || value < 0) return null
  const max = INTEGER_BOUNDS.get(path)
  return max !== undefined && value > max ? null : value
}

function checkCrossFields(effective: EffectiveConfig, out: Diagnostics): void {
  const width = integerAt(effective, 'ui.sidebar_width')
  const min = integerAt(effective, 'ui.sidebar_min_width')
  const max = integerAt(effective, 'ui.sidebar_max_width')

  if (min !== null && max !== null && min > max) {
    // src/config.rs:116-125 — herdr keeps running and stops clamping.
    out.warn(
      'ui.sidebar_min_width',
      `ui.sidebar_min_width (${min}) is greater than sidebar_max_width (${max})`,
    )
  } else if (width !== null) {
    // herdr clamps the width into the bounds rather than warning
    // (`validated_sidebar_bounds`, src/config/model.rs:302-313); corral says so
    // first, because a silently clamped width looks like a setting that did not
    // take.
    if (min !== null && width < min) {
      out.warn(
        'ui.sidebar_width',
        `ui.sidebar_width (${width}) is below sidebar_min_width (${min}); herdr will clamp it`,
      )
    }
    if (max !== null && width > max) {
      out.warn(
        'ui.sidebar_width',
        `ui.sidebar_width (${width}) is above sidebar_max_width (${max}); herdr will clamp it`,
      )
    }
  }

  const cols = integerAt(effective, 'server.headless_cols')
  const rows = integerAt(effective, 'server.headless_rows')
  if (cols !== null && rows !== null && (cols === 0 || rows === 0)) {
    // src/config.rs:107-114 — one diagnostic naming both sizes, as herdr does,
    // anchored at whichever of the two is actually zero.
    out.warn(
      cols === 0 ? 'server.headless_cols' : 'server.headless_rows',
      `server.headless_cols and server.headless_rows must be greater than zero (got ${cols}x${rows})`,
    )
  }
}

// ---------------------------------------------------------------------------
// theme names
// ---------------------------------------------------------------------------

function checkThemeNames(effective: EffectiveConfig, out: Diagnostics): void {
  const fallbacks: Readonly<Record<string, string>> = {
    'theme.name': 'catppuccin',
    'theme.dark_name': 'catppuccin',
    'theme.light_name': 'catppuccin-latte',
  }
  for (const [path, fallback] of Object.entries(fallbacks)) {
    const value = effective.get(path)
    if (value === undefined) continue
    if (typeof value !== 'string') continue // reported by the type pass
    if (canonicalThemeName(value) !== null) continue
    // src/config/theme.rs:75-96 — herdr names the fallback it will use.
    out.warn(
      path,
      `unknown theme name ${show(value)}; herdr will use ${show(fallback)}; valid themes: ${themeNames().join(', ')}`,
    )
  }
}

// ---------------------------------------------------------------------------
// unknown keys
// ---------------------------------------------------------------------------

function checkUnknownKeys(unknownKeys: readonly string[], out: Diagnostics): void {
  for (const path of unknownKeys) {
    const suggestion = suggestKey(path)
    // src/config/io.rs:493-496 — herdr ignores the key and carries on.
    out.warn(
      path,
      suggestion === null
        ? `unknown config key ${path}; herdr will ignore it`
        : `unknown config key ${path}; did you mean ${suggestion}? herdr will ignore it`,
    )
  }
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/** True when two config values are the same as far as a keybinding is concerned. */
function sameValue(left: TomlValue | undefined, right: TomlValue | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  if (isArray(left) && isArray(right)) {
    return left.length === right.length && left.every((element, index) => element === right[index])
  }
  return left === right
}

/**
 * Decide which keybinding settings the user actually wrote.
 *
 * herdr knows because it keeps the file's own overlay; corral is handed one
 * merged config, so when the caller does not say, a setting counts as the user's
 * when its value differs from the documented default. That gets the case that
 * matters right — moving a binding onto a chord some default already had is not
 * a conflict, because herdr drops the default without a word.
 */
function bindingSources(
  effective: EffectiveConfig,
  userKeys: Iterable<string> | undefined,
): (path: string) => BindingSource {
  if (userKeys !== undefined) {
    const set = new Set(userKeys)
    return (path) => (set.has(path) ? 'user' : 'default')
  }
  return (path) => {
    const value = effective.get(path)
    if (value === undefined) return 'default'
    const declared = byKey(path)?.default
    return sameValue(value, (declared ?? undefined) as TomlValue | undefined) ? 'default' : 'user'
  }
}

/**
 * Every diagnostic herdr would print for this config, plus corral's own.
 *
 * @param effective the flat `path → value` map described in the module docstring
 * @param unknownKeys paths in the user's file that no schema key claims; see
 *   `unknownKeysIn`
 * @param userKeys the paths the user's file sets, when the caller knows them.
 *   Only keybinding conflict attribution uses it, and only to tell a binding the
 *   user wrote from one that is still on its default; without it that is
 *   inferred from the value.
 */
export function validate(
  effective: EffectiveConfig,
  unknownKeys: readonly string[] = [],
  userKeys?: Iterable<string>,
): Diagnostic[] {
  const out = new Diagnostics()
  checkDeclaredTypes(effective, out)
  checkThemeNames(effective, out)
  checkSoundPaths(effective, out)
  checkNewCwd(effective, out)
  checkRightClickModifier(effective, out)
  checkWindowTitle(effective, out)
  checkSidebarRows(effective, out)
  checkTabBarRight(effective, out)
  checkKeybindings(effective, out, bindingSources(effective, userKeys))
  checkCrossFields(effective, out)
  checkUnknownKeys(unknownKeys, out)
  return out.sorted()
}

/** True when any diagnostic is an error, which is what blocks a download. */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
}
