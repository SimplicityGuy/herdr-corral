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
 * A herdr colour as a CSS colour, or `fallback` when it names the terminal's own.
 *
 * An unparseable value also takes the fallback: `validate()` is what tells the
 * user their colour is wrong, and a preview that paints such a value black would
 * be a second, worse diagnostic.
 */
export function cssColor(value: TomlValue | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const text = value.trim().toLowerCase()
  if (text === '' || RESET.has(text)) return fallback
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(text)) return text
  if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(text)) return text
  return ANSI[text] ?? fallback
}

export interface PaletteInput {
  /** The built-in theme's canonical name; unknown names take the fallback. */
  readonly theme: string
  /** `[theme.custom]` overrides, keyed by slot. */
  readonly custom: Readonly<Record<string, TomlValue | undefined>>
  /** `ui.accent`, which wins the `accent` slot when it is set. */
  readonly accent?: TomlValue
}

/**
 * `themes.json` ⊕ `[theme.custom]` ⊕ `ui.accent`.
 *
 * Every slot comes out a CSS colour, so a component can paint with it without
 * asking whether the user wrote `reset`.
 */
export function resolvePalette(input: PaletteInput): Palette {
  const base = paletteOf(input.theme) ?? paletteOf(FALLBACK_THEME) ?? {}
  const fallbacks = paletteOf(FALLBACK_THEME) ?? {}
  const out: Record<string, string> = {}
  for (const slot of themeTokens()) {
    const fallback = cssColor(fallbacks[slot], '#cdd6f4')
    const custom = input.custom[slot]
    const chosen = custom === undefined || custom === null ? base[slot] : custom
    out[slot] = cssColor(chosen, fallback)
  }
  // `ui.accent` is herdr's one accent setting outside `[theme.custom]`, and it is
  // the later word, so it wins the slot when the user set it to a colour.
  if (input.accent !== undefined && input.accent !== null) {
    out.accent = cssColor(input.accent, out.accent)
  }
  // A sidebar that is `reset` in every built-in theme has to land somewhere, and
  // the panel background is where herdr lands it.
  if (input.custom.sidebar_bg === undefined || input.custom.sidebar_bg === null) {
    const themeSidebar = base.sidebar_bg
    if (typeof themeSidebar !== 'string' || RESET.has(themeSidebar.trim().toLowerCase())) {
      out.sidebar_bg = out.panel_bg
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// state marks
// ---------------------------------------------------------------------------

/** `status_indicators = "dots"` — one mark, told apart by colour. */
const DOTS: Readonly<Record<AgentState, string>> = {
  working: '●',
  waiting: '●',
  done: '●',
  idle: '○',
  unknown: '●',
}

/** `status_indicators = "symbols"` — a distinct static glyph per state. */
const SYMBOLS: Readonly<Record<AgentState, string>> = {
  working: '▶',
  waiting: '!',
  done: '✓',
  idle: '·',
  unknown: '?',
}

/** Which palette slot colours each state. */
const STATE_SLOT: Readonly<Record<AgentState, string>> = {
  working: 'green',
  waiting: 'yellow',
  done: 'blue',
  idle: 'overlay0',
  unknown: 'overlay1',
}

/** The word `state_text` draws. */
const STATE_TEXT: Readonly<Record<AgentState, string>> = {
  working: 'working',
  waiting: 'waiting',
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
