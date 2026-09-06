/**
 * The colours the preview paints with, and the token rows it draws.
 *
 * Two jobs, one module, because the second needs the first: a token's contextual
 * default colour is a palette slot, not a fixed value, so a row drawn under
 * `gruvbox` has to come out gruvbox-coloured.
 *
 * ## The palette
 *
 * `themes.json` ⊕ `[theme.custom]` ⊕ `ui.accent`, in that order, exactly as herdr
 * layers them. Two things have to be translated on the way to CSS:
 *
 * - **`reset`.** herdr's `reset`, `default`, `none` and `transparent` all mean
 *   "whatever the terminal is using there", and a browser has no terminal. The
 *   slot falls back to catppuccin's value for the same slot, which is what herdr
 *   itself falls back to when it has no theme.
 * - **Named colours.** `cyan` is an ANSI slot, not a CSS colour: a terminal draws
 *   it as whatever its own palette says, and CSS's `cyan` is `#0ff`, which no
 *   terminal uses. {@link ANSI} approximates the sixteen herdr accepts. Hex and
 *   `rgb()` values pass through untouched, because those are exact.
 *
 * The chrome's own colours never come from here — those are the tokens in
 * `src/index.css`. These are the *user's* colours, which are data.
 *
 * ## The rows
 *
 * `ui.sidebar.agents.rows` and `ui.sidebar.spaces.rows` are lists of rows, each a
 * list of entries, each entry a bare token name or a `{ token, fg, bold, dim }`
 * table. {@link renderRow} turns one row into the spans the sidebar draws, taking
 * the token's contextual default colour unless `fg` overrides it — "omitted style
 * fields preserve the contextual default", as herdr's own default config puts it.
 *
 * An entry that resolves to nothing is dropped rather than drawn as an empty gap:
 * a `$ticket` on an agent that never reported one is a token herdr has no value
 * for, and herdr draws no value.
 */
import type { AgentState, TokenSubject } from '@/components/preview/sample'
import type { TomlValue } from '@/model/parse'
import { isHexColor } from '@/model/validate'
import { paletteOf, themeTokens } from '@/schema'

// ---------------------------------------------------------------------------
// palette
// ---------------------------------------------------------------------------

/** Every `[theme.custom]` slot, resolved to something CSS can paint. */
export type Palette = Readonly<Record<string, string>>

/** The theme herdr falls back to, and the palette `reset` resolves against. */
export const FALLBACK_THEME = 'catppuccin'

/**
 * The sixteen named colours herdr accepts, approximated.
 *
 * A terminal resolves these against its own palette; the preview cannot know it,
 * so it draws the catppuccin equivalents. `swatchOf` in `src/lib/values.ts` hands
 * named colours straight to CSS instead — that swatch answers "is this a colour
 * herdr accepts", where this table answers "what does it look like", and only the
 * second one needs a terminal's palette guessed at.
 */
const ANSI: Readonly<Record<string, string>> = {
  black: '#181825',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#cba6f7',
  purple: '#cba6f7',
  cyan: '#94e2d5',
  white: '#cdd6f4',
  gray: '#6c7086',
  grey: '#6c7086',
  darkgray: '#45475a',
  darkgrey: '#45475a',
  lightred: '#f5a0b6',
  lightgreen: '#bdead9',
  lightyellow: '#fbead0',
  lightblue: '#a6c8fb',
  lightmagenta: '#dcc0f9',
  lightcyan: '#b3ebe1',
}

/** Spellings herdr resolves to `Color::Reset`. */
const RESET = new Set(['reset', 'default', 'none', 'transparent'])

/**
 * The two colours a chain of fallbacks ends at: a terminal's ground and its ink.
 *
 * A browser has neither, so these are catppuccin's, which is also what herdr
 * falls back to when it has no theme.
 */
const GROUND = '#1e1e2e'
const INK = '#cdd6f4'

/**
 * A herdr colour as a CSS colour, or `null` when it names no colour of its own.
 *
 * `null` covers three cases the caller has to tell apart from a real colour, and
 * cannot once a fallback has been substituted: the slot is unset, the user wrote
 * `reset` (or cleared the field, which is an empty string), or the value is not
 * a colour at all. A wrong colour is `validate()`'s to report; painting a guess
 * here would be a second, worse diagnostic.
 */
export function parseColor(value: TomlValue | undefined): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  if (text === '' || RESET.has(text)) return null
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(text)) return text
  if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(text)) return text
  return ANSI[text] ?? null
}

/** {@link parseColor}, with something to paint when it answers nothing. */
export function cssColor(value: TomlValue | undefined, fallback: string): string {
  return parseColor(value) ?? fallback
}

/**
 * Where a slot lands when nothing paints it — neither the theme nor the user.
 *
 * Resolved *inside the palette being built*, so a `reset` follows the theme in
 * force rather than jumping back to catppuccin: under gruvbox, a reset sidebar
 * is gruvbox's panel background. Every chain ends at `surface_dim` or `text`,
 * which are the two slots that have nowhere further to fall.
 *
 * This is the fix for the bug that made a reset sidebar unreadable: the slot has
 * to fall back to something with the same *role*, and a background that falls
 * back to a foreground swallows every row drawn on it.
 */
const RESET_TARGET: Readonly<Record<string, string>> = {
  sidebar_bg: 'panel_bg',
  panel_bg: 'surface_dim',
  active_row_bg: 'surface_dim',
  selection_bg: 'surface0',
  surface0: 'surface_dim',
  surface1: 'surface0',
  overlay1: 'overlay0',
  overlay0: 'subtext0',
  subtext0: 'text',
}

/** Slots that paint a surface. The rest paint ink, and fall back to ink. */
const BACKGROUND_SLOTS: ReadonlySet<string> = new Set([
  'panel_bg',
  'sidebar_bg',
  'active_row_bg',
  'selection_bg',
  'surface_dim',
  'surface0',
  'surface1',
])

export interface PaletteInput {
  /** The built-in theme's canonical name; unknown names take the fallback. */
  readonly theme: string
  /** `[theme.custom]` overrides, keyed by slot. */
  readonly custom: Readonly<Record<string, TomlValue | undefined>>
  /** `ui.accent`, which wins the `accent` slot when it is a colour. */
  readonly accent?: TomlValue
}

/**
 * `themes.json` ⊕ `[theme.custom]` ⊕ `ui.accent`.
 *
 * Every slot comes out a CSS colour, so a component can paint with it without
 * asking whether the user wrote `reset` — and every slot comes out a colour of
 * the *right kind*, so a background is never resolved to a foreground.
 *
 * The three layers are tried in order and the first that names a colour wins,
 * which is what makes a cleared `[theme.custom]` field fall through to the theme
 * rather than to nothing.
 */
export function resolvePalette(input: PaletteInput): Palette {
  const base = paletteOf(input.theme) ?? paletteOf(FALLBACK_THEME) ?? {}
  const ultimate = paletteOf(FALLBACK_THEME) ?? {}
  const out: Record<string, string> = {}

  const resolve = (slot: string, seen: ReadonlySet<string>): string => {
    const done = out[slot]
    if (done !== undefined) return done
    const ground = BACKGROUND_SLOTS.has(slot) ? GROUND : INK
    // A cycle would mean RESET_TARGET has been edited into a loop; answer the
    // ground rather than recurring forever.
    if (seen.has(slot)) return ground

    const layers: (TomlValue | undefined)[] = [input.custom[slot], base[slot]]
    // `ui.accent` is herdr's one accent setting outside `[theme.custom]`, and it
    // is the later word, so it goes on top of both.
    if (slot === 'accent') layers.unshift(input.accent)

    let painted: string | null = null
    for (const layer of layers) {
      painted = parseColor(layer)
      if (painted !== null) break
    }
    if (painted === null) {
      const target = RESET_TARGET[slot]
      painted =
        target === undefined
          ? cssColor(ultimate[slot], ground)
          : resolve(target, new Set([...seen, slot]))
    }
    out[slot] = painted
    return painted
  }

  for (const slot of themeTokens()) resolve(slot, new Set())
  return out
}

// ---------------------------------------------------------------------------
// state marks
// ---------------------------------------------------------------------------

/** `status_indicators = "dots"` — one mark, told apart by colour. */
const DOTS: Readonly<Record<AgentState, string>> = {
  working: '●',
  blocked: '●',
  done: '●',
  idle: '○',
  unknown: '●',
}

/** `status_indicators = "symbols"` — a distinct static glyph per state. */
const SYMBOLS: Readonly<Record<AgentState, string>> = {
  working: '▶',
  blocked: '!',
  done: '✓',
  idle: '·',
  unknown: '?',
}

/** Which palette slot colours each state. */
const STATE_SLOT: Readonly<Record<AgentState, string>> = {
  working: 'green',
  blocked: 'yellow',
  done: 'blue',
  idle: 'overlay0',
  unknown: 'overlay1',
}

/** The word `state_text` draws. */
const STATE_TEXT: Readonly<Record<AgentState, string>> = {
  working: 'working',
  blocked: 'blocked',
  done: 'done',
  idle: 'idle',
  unknown: 'unknown',
}

/** The mark for a state under one `ui.status_indicators` setting. */
export function stateIcon(state: AgentState, indicators: string): string {
  return (indicators === 'symbols' ? SYMBOLS : DOTS)[state]
}

// ---------------------------------------------------------------------------
// token rows
// ---------------------------------------------------------------------------

/**
 * One entry of a row: a bare token name, or a table styling it —
 * `{ token = "workspace", fg = "#89b4fa", bold = true, dim = false }`.
 *
 * Typed as a raw `TomlValue` because that is what comes out of the store: the
 * shape is the user's to get wrong, and `validate()` is what tells them so.
 */
export type RowEntry = TomlValue

/** One token, ready to draw. */
export interface RenderedToken {
  /** The token as the config spelled it, `$name` included. */
  readonly token: string
  readonly text: string
  readonly color: string
  readonly bold: boolean
  readonly dim: boolean
}

export interface RowContext {
  readonly palette: Palette
  /** `ui.status_indicators`. */
  readonly indicators: string
}

/** Which palette slot a token takes when nothing styles it. */
const TOKEN_SLOT: Readonly<Record<string, string>> = {
  state_text: 'subtext0',
  workspace: 'text',
  tab: 'mauve',
  pane: 'teal',
  agent: 'text',
  terminal_title: 'subtext0',
  terminal_title_stripped: 'subtext0',
  branch: 'mauve',
  git_status: 'yellow',
}

/** The text a token resolves to, or `null` when the subject has nothing for it. */
export function tokenText(
  token: string,
  subject: TokenSubject,
  context: RowContext,
): string | null {
  if (token.startsWith('$')) {
    const value = subject.metadata[token.slice(1)]
    return value === undefined || value === '' ? null : value
  }
  switch (token) {
    case 'state_icon':
      return stateIcon(subject.state, context.indicators)
    case 'state_text':
      return STATE_TEXT[subject.state]
    case 'workspace':
      return subject.workspace
    case 'tab':
      return subject.tab ?? null
    case 'pane':
      return subject.pane ?? null
    case 'agent':
      return subject.agent ?? null
    case 'terminal_title':
      return subject.terminal_title ?? null
    case 'terminal_title_stripped':
      return subject.terminal_title_stripped ?? null
    case 'branch':
      return subject.branch ?? null
    case 'git_status':
      return subject.git_status ?? null
    default:
      // An unknown token is a validation error, reported in the diagnostics line.
      // Drawing a guess here would be a second answer to a question already put.
      return null
  }
}

/** The colour a token takes when its entry does not name one. */
export function tokenColor(token: string, subject: TokenSubject, palette: Palette): string {
  if (token === 'state_icon') return palette[STATE_SLOT[subject.state]] ?? palette.text
  if (token.startsWith('$')) return palette.peach ?? palette.text
  if (token === 'state_text') return palette[STATE_SLOT[subject.state]] ?? palette.subtext0
  return palette[TOKEN_SLOT[token] ?? 'text'] ?? palette.text
}

function isStyled(entry: RowEntry): entry is Record<string, TomlValue> {
  return (
    typeof entry === 'object' && entry !== null && !Array.isArray(entry) && !(entry instanceof Date)
  )
}

/**
 * One entry, drawn — or `null` when it names nothing to draw.
 *
 * `fg` is honoured only when it is `#RGB` / `#RRGGBB`, which is the only syntax
 * herdr accepts on a sidebar token; anything else keeps the contextual default
 * and is reported as an error by `validate()` rather than painted here.
 */
export function renderToken(
  entry: RowEntry,
  subject: TokenSubject,
  context: RowContext,
): RenderedToken | null {
  const name = typeof entry === 'string' ? entry : isStyled(entry) ? entry.token : undefined
  if (typeof name !== 'string' || name === '') return null
  const text = tokenText(name, subject, context)
  if (text === null) return null
  const style: Record<string, TomlValue | undefined> = isStyled(entry) ? entry : {}
  const fg = typeof style.fg === 'string' && isHexColor(style.fg) ? style.fg.trim() : null
  return {
    token: name,
    text,
    color: fg ?? tokenColor(name, subject, context.palette),
    bold: style.bold === true,
    dim: style.dim === true,
  }
}

/** One row of entries, drawn. Entries that resolve to nothing are dropped. */
export function renderRow(
  row: TomlValue,
  subject: TokenSubject,
  context: RowContext,
): readonly RenderedToken[] {
  if (!Array.isArray(row)) return []
  const out: RenderedToken[] = []
  for (const entry of row) {
    const rendered = renderToken(entry, subject, context)
    if (rendered !== null) out.push(rendered)
  }
  return out
}

/**
 * A whole `rows` value, drawn. Rows that come out empty are dropped, so a layout
 * whose only token is one this subject lacks does not leave a blank line behind.
 */
export function renderRows(
  rows: TomlValue | undefined,
  subject: TokenSubject,
  context: RowContext,
): readonly (readonly RenderedToken[])[] {
  if (!Array.isArray(rows)) return []
  const out: (readonly RenderedToken[])[] = []
  for (const row of rows) {
    const drawn = renderRow(row, subject, context)
    if (drawn.length > 0) out.push(drawn)
  }
  return out
}

/** The plain text of a drawn row — the accessible name a region reads out. */
export function rowText(row: readonly RenderedToken[]): string {
  return row.map((token) => token.text).join(' ')
}
