# ADR-0002: "Console" design language — the editor is a TUI in the browser

Status: accepted · Date: 2026-09-05 · Reference mockup: `docs/design/console-direction.html`

## Context

Three directions were sketched: Studio (palette / preview / inspector in neutral light chrome),
Console (the editor looks and behaves like a terminal application), and Pasture (a warm guided
five-step walk). Console was chosen: corral's users live in a terminal multiplexer all day, and an
editor that feels like it ships inside herdr needs no explanation.

## Decision

**The preview is the editor.** A faithful mock of herdr's desktop layout fills the center. Clicking
any region (a sidebar row, the tab bar's right side, a pane border, the toast) opens an inline
popover anchored to that region, editing the keys that draw it. The left column is a settings tree
that reaches every key; the bottom line is diagnostics and the export verb. Keyboard drives all of
it; drag and drop is first-class inside row editors and always has a keyboard equivalent.

### Chrome tokens (catppuccin mocha family, coral accent)

| Token | Value | Use |
| --- | --- | --- |
| `--crust` | `#11111b` | page background |
| `--mantle` | `#181825` | bars, popovers, tree background |
| `--base` | `#1e1e2e` | preview background, editable panels |
| `--surface0` | `#313244` | selected rows, chips |
| `--surface1` | `#45475a` | frame borders |
| `--overlay0` | `#6c7086` | de-emphasized text, hints |
| `--subtext0` | `#a6adc8` | secondary text |
| `--text` | `#cdd6f4` | primary text |
| `--accent` | `#ee6a4f` | corral's coral: mode badge, focus ring, selected region outline |
| semantic | `#a6e3a1` green · `#f9e2af` yellow · `#f38ba8` red · `#cba6f7` mauve · `#89b4fa` blue · `#94e2d5` teal · `#fab387` peach | diagnostics, token chips, agent states |

The chrome is fixed dark. The **preview** renders whichever herdr theme the user picked, including
light themes; the chrome does not follow it.

### Type

One family: **JetBrains Mono** (`@fontsource-variable/jetbrains-mono`), 13px body with 1.45
line-height, 12px in the preview and diagnostics line, 11px for panel captions. No second face.

### Frames and captions

Panels are 1px `--surface1` frames with a caption that interrupts the top edge, drawn as text:
`┤ settings ├`, `┤ preview · click anything to edit it ├`. Captions sit on the page background so
the border appears to pass behind them. Corners are square. No shadows on panels; popovers get a
single heavy shadow so they read as floating.

### Shell anatomy (1280×820 reference; responsive down to 960 wide)

- **Top line (30px, `--mantle`)**: the ▐▛█▜▌ mark in coral, the file name, then section switches
  `[1] layout  [2] sidebar  [3] status  [4] keys  [5] theme  [6] all`. The active one sits on a
  `--surface0` block. Right side lists the two global chords: `ctrl+b ?` help, `ctrl+k` palette.
- **Settings tree (300px)**: sections as dim headers, keys as `├`/`└` rows with the current value
  colored by type (numbers yellow, enums/strings green, booleans red/green, colors as a swatch).
  The focused row is a `--surface0` band with a coral `▸`. Footer lists the tree's keys:
  `/ search  j k move  enter edit  d reset  u undo`.
- **Preview**: the herdr mock inside its frame, at least 700px wide. The selected region gets a
  1px coral outline; a hovered region a dashed `--surface1` outline.
- **Inline popover**: anchored to the selected region, `--mantle` on a coral frame, caption names
  the key path (`┤ agents.rows[0] ├`). Rows inside are terse: `tokens  [$status] [$name] …`,
  `[x] bold  [ ] dim  fg: green ▾`, then a hint line `enter apply  esc cancel  tab next token`.
- **Diagnostics line (28px, `--mantle`)**: a coral **mode badge** (`EDIT`, `DRAG`, `RECORD` while
  capturing a chord), then `● 0 errors`, `▲ 1 warning …` with the first warning's text, then on
  the right `N keys changed`, `:diff`, and the `:w download config.toml` action on a
  `--surface0` block. Download is disabled while errors exist.

### Interaction rules

- Number keys `1`–`6` switch sections when focus is not in a text field. `/` focuses the tree
  filter. `j`/`k` move, `enter` edits, `d` resets a key to herdr's default, `u` undoes, `ctrl+k`
  opens a command palette over every key and action.
- Every drag has a keyboard path: dnd-kit's keyboard sensor for reordering, plus explicit
  "move left/right/up/down" commands in the popover.
- A change is applied on `enter` (or on drop) and reflected in the preview within the same frame.
  No modal confirmation anywhere except the destructive "start over from defaults".
- Controls in the popover are shadcn primitives restyled to these tokens: square corners, 1px
  borders, no gradients, no rounded pills.

## Consequences

- A single font and a single dark chrome keep the implementation small; the theme system only has
  to exist inside the preview.
- The accessibility bar is set by the keyboard rules: every control has an accessible name and a
  visible focus state in coral.
- The mockup in `console-direction.html` is the visual contract for the shell bead; later beads
  follow the tokens in `src/index.css`, not the mockup's inline styles.

## Amendments during v1

Three decisions were settled during implementation rather than at the time this ADR was
accepted; recorded here rather than in a new ADR because none of them reverses the decision
above, they refine it.

- **The coral accent maps to `--color-coral` and feeds `--ring`, not `--primary`.** shadcn/ui
  already owns `--accent` for a component's own hover background, so this ADR's `--accent` token
  is `--color-coral` in the codebase. `--primary` — the fill of every default shadcn `Button` —
  stays `--surface0` on `--text`, so buttons render as the chip the mockup draws
  (`:w download config.toml`) rather than a solid coral call-to-action. Coral is spent on exactly
  the three things above: the mode badge, the focus ring, and the selected region's outline.
- **A region click never changes the centre view.** The shell store holds two separate facts —
  `section` (what the tree and the top line are on) and `centre` (`'preview' | 'section'`, which
  frame the middle column draws). A top-line switch sets both; a click on a region of the herdr
  mock sets only `section`, so the tree's cursor follows the click, and pins `centre` to the
  preview, because a popover anchored to a region must not have that region replaced underneath
  it.
- **Popovers are height-capped with a scrolling body.** An editor with more rows than the window
  has room for is still fully reachable rather than running off-screen; a popover can also be
  registered wide, for an editor whose rows don't fit the mockup's narrower reference width.
