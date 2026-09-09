/**
 * The session the preview draws.
 *
 * The mock is only as useful as what it has to show: every built-in sidebar token
 * has to resolve to something, or a user turning `terminal_title_stripped` on sees
 * a blank row and concludes the token is broken. So the sample carries a whole
 * herdr session — four spaces (one with a worktree child, and that parent in the
 * fifth state, `unknown`, because no agent of its own has reported), four agents
 * in the other four states, two panes and a toast — and every field a token
 * names is set on it.
 *
 * Two exceptions are deliberate. `gemini` has no `$ticket`, because a custom token
 * with nothing behind it is exactly what herdr draws as nothing, and the preview
 * should show that rather than invent a value. And the clock is frozen at
 * {@link SAMPLE_NOW}: a `datetime` entry in the tab bar has to render the same
 * string in a test, in a screenshot and on screen, and a live clock renders three
 * different ones.
 *
 * Anything herdr has no built-in token for — how long an agent has been in its
 * state, how many agents a space holds — is carried as **metadata**, not as a
 * typed field, because metadata is the one way such a value can actually reach a
 * row: `$age` and `$agents` draw them, the same way `$jj_status` draws a value a
 * workspace provider reported. A field no token can name would be data the mock
 * can never show.
 *
 * This is data, not configuration. Nothing here is read from the user's file and
 * nothing here is written back to it.
 */

/**
 * The five states herdr's `status_indicators` distinguishes, spelled as herdr
 * spells them: "blocked, working, done, idle, and unknown" — the words in the
 * prose above `status_indicators` in its own default config, and the ones
 * `herdr agent wait --until` takes. An agent waiting on a person is `blocked`.
 */
export type AgentState = 'working' | 'blocked' | 'idle' | 'done' | 'unknown'

/**
 * What a token row is drawn from.
 *
 * Agents and spaces have different built-in token sets, so this is the union of
 * both field sets; a token whose field is unset on its subject renders as
 * nothing, which is what herdr does.
 */
export interface TokenSubject {
  readonly state: AgentState
  readonly workspace: string
  readonly agent?: string
  readonly tab?: string
  readonly pane?: string
  readonly terminal_title?: string
  readonly terminal_title_stripped?: string
  readonly branch?: string
  readonly git_status?: string
  /** Values a pane or workspace reported, addressed by `$name` tokens. */
  readonly metadata: Readonly<Record<string, string>>
}

export interface SampleSpace extends TokenSubject {
  readonly id: string
  /** 0 for a workspace, 1 for a worktree hanging off the one above it. */
  readonly depth: number
}

export interface SampleAgent extends TokenSubject {
  /** The canonical agent id — what `rows_by_agent` is keyed by. */
  readonly agent: string
}

export interface SampleTab {
  readonly index: number
  readonly name: string
  readonly active: boolean
}

export interface SamplePane {
  /** What the pane's process set as its terminal title — the border caption. */
  readonly title: string
  /** The agent running in it, when one is; drawn as a border label. */
  readonly agent: string | null
  readonly lines: readonly SamplePaneLine[]
  /** Where the scrollbar thumb sits, 0–1, when scrollbars are on. */
  readonly scroll: number
}

/** One line of pane output: a marked prefix and the rest. */
export interface SamplePaneLine {
  /** A glyph drawn before the text, in `tone`. */
  readonly mark?: string
  readonly text: string
  /** Which palette slot colours the mark and, when `dim`, the text. */
  readonly tone?: 'green' | 'yellow' | 'red' | 'blue' | 'accent' | 'dim'
  readonly dim?: boolean
}

/**
 * The instant the tab bar's clock reads.
 *
 * Formatted with the UTC getters so the string does not depend on the machine's
 * time zone — a screenshot taken in two places has to be the same screenshot.
 */
export const SAMPLE_NOW: Date = new Date(Date.UTC(2026, 8, 6, 22, 41, 18))

/** What a `hostname` entry in the tab bar resolves to. */
export const SAMPLE_HOSTNAME = 'mbp'

/** What a `zoom` entry resolves to. */
export const SAMPLE_ZOOM = '100%'

/**
 * Four spaces, and the worktree `groovemap-music` has open.
 *
 * The child is a row of its own rather than a field on its parent, because that
 * is how herdr's sidebar draws it and how a row of tokens has to address it. The
 * parent carries the child's agent in `$agents` and no state of its own: nothing
 * has reported from it, which is what herdr's `unknown` means.
 */
export const SAMPLE_SPACES: readonly SampleSpace[] = [
  {
    id: 'homelab',
    depth: 0,
    state: 'working',
    workspace: 'homelab',
    branch: 'main',
    git_status: '+2 ~1',
    metadata: { jj_status: '@ wqrs', ahead: '2', agents: '1' },
  },
  {
    id: 'beadhive',
    depth: 0,
    state: 'blocked',
    workspace: 'beadhive',
    branch: 'feat/dispatch',
    git_status: '~3',
    metadata: { jj_status: '@ abcd', agents: '1' },
  },
  {
    id: 'cronduit',
    depth: 0,
    state: 'done',
    workspace: 'cronduit',
    branch: 'main',
    git_status: 'clean',
    metadata: { jj_status: '@ zzyx', agents: '1' },
  },
  {
    id: 'groovemap-music',
    depth: 0,
    state: 'unknown',
    workspace: 'groovemap-music',
    branch: 'main',
    git_status: 'clean',
    metadata: { jj_status: '@ qrst', agents: '1' },
  },
  {
    id: 'groovemap-music-design',
    depth: 1,
    state: 'idle',
    workspace: 'groovemap-music/design',
    branch: 'design/palette',
    git_status: 'clean',
    metadata: { jj_status: '@ mnop', agents: '1' },
  },
]

/** Four agents, one per state herdr draws differently. */
export const SAMPLE_AGENTS: readonly SampleAgent[] = [
  {
    agent: 'claude',
    state: 'working',
    workspace: 'homelab',
    tab: 'infra',
    pane: '1',
    terminal_title: '✳ claude — compose/traefik.yml',
    terminal_title_stripped: 'claude — compose/traefik.yml',
    metadata: { model: 'opus-5', ticket: 'hl-412', age: '12m' },
  },
  {
    agent: 'codex',
    state: 'blocked',
    workspace: 'beadhive',
    tab: 'dispatch',
    pane: '2',
    terminal_title: '● codex — approve edit?',
    terminal_title_stripped: 'codex — approve edit?',
    metadata: { model: 'gpt-5-codex', ticket: 'bh-88', age: '3m' },
  },
  {
    agent: 'gemini',
    state: 'idle',
    workspace: 'groovemap-music/design',
    tab: 'design',
    pane: '1',
    terminal_title: 'gemini',
    terminal_title_stripped: 'gemini',
    // No `$ticket`: a custom token with nothing behind it draws nothing.
    metadata: { model: 'gemini-3-pro', age: '1h' },
  },
  {
    agent: 'kimi',
    state: 'done',
    workspace: 'cronduit',
    tab: 'tests',
    pane: '3',
    terminal_title: '✓ kimi — 25 passed',
    terminal_title_stripped: 'kimi — 25 passed',
    metadata: { model: 'kimi-k2', ticket: 'cd-9', age: '20m' },
  },
]

/** The tabs of the active space, as the tab bar lists them. */
export const SAMPLE_TABS: readonly SampleTab[] = [
  { index: 1, name: 'infra', active: true },
  { index: 2, name: 'compose', active: false },
  { index: 3, name: 'notes', active: false },
]

/** The two panes of the active tab. */
export const SAMPLE_PANES: readonly SamplePane[] = [
  {
    title: 'claude · homelab',
    agent: 'claude',
    scroll: 0.55,
    lines: [
      { mark: '✓', tone: 'green', text: 'Read compose/traefik.yml' },
      { mark: '✓', tone: 'green', text: 'Edit compose/traefik.yml' },
      { mark: '●', tone: 'yellow', text: 'Running docker compose config -q' },
      { text: '......................... ok', dim: true },
      { text: 'Now wiring the new router into traefik…' },
      { text: '▌', dim: true },
    ],
  },
  {
    title: 'zsh',
    agent: null,
    scroll: 0.9,
    lines: [
      { mark: '~/homelab ❯', tone: 'blue', text: 'git status -sb' },
      { text: '## main...origin/main', dim: true },
      { text: ' M compose/traefik.yml', dim: true },
      { mark: '??', tone: 'red', text: 'notes.md' },
      { mark: '~/homelab ❯', tone: 'blue', text: '▌' },
    ],
  },
]

/**
 * The agent the sidebar's cursor is on.
 *
 * herdr paints the *active* row and the *selected* row differently —
 * `active_row_bg` and `selection_bg` — so the mock needs both to exist for
 * either to mean anything.
 */
export const SAMPLE_FOCUSED_AGENT = 'claude'

/** The notification the toast region draws. */
export const SAMPLE_TOAST = {
  title: 'claude · homelab',
  body: 'finished · config ok',
} as const
