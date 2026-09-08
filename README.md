# corral

A visual editor for [herdr](https://herdr.dev)'s `config.toml`.

corral is a static single-page app. Everything runs in the tab you have it open in: read a
config file, edit it in memory against a live mock of herdr, and write the file back with every
comment and untouched line byte-identical. Nothing is uploaded, there is no account, and there
is no server — closing the tab is the only "logout" there is.

## Why "corral"

A corral is the pen where a scattered herd gets gathered and arranged, and "to corral" is
exactly what this app does to a sprawling `config.toml`: take herdr's 167 settings, wherever
they sit in the file, and lay them out somewhere you can see and reach every one of them. herdr
herds coding agents inside your terminal; corral herds the file that tells it how to. The name
follows the rest of the ecosystem's own convention — short, lowercase, one word.

## What it edits

Six switches on the top line (`[1]`–`[6]`) reach every key herdr documents. Five are focused
editors that read and write a herdr region directly; the sixth is the exhaustive fallback.

| Area | Editor | What's distinctive about it |
| --- | --- | --- |
| `[1]` layout | typed form (`SectionForm`) | pane geometry and pointer behaviour — no herdr region to click, so it's a plain form |
| `[2]` sidebar | `RowsEditor` | drag-and-drop token rows, styled per token, with a per-agent override chip strip; every drag has a keyboard equivalent |
| `[3]` status | `StatusBarEditor` | the tab bar's right-hand entries as an ordered list, plus the agent status indicators and toasts |
| `[4]` keys | `KeysEditor` + `ChordEditor` | every keybinding on one screen, grouped by what it acts on; `enter` opens a chord recorder that captures a binding as you press it, plus the user-invented `[[keys.command]]` list |
| `[5]` theme | `ThemeEditor` | herdr's built-in themes as swatches (painted from their own palettes, not named in a `<select>`), plus `[theme.custom]` and `ui.accent` colour overrides |
| `[6]` all | typed form (`SectionForm`) | every one of herdr's 167 settings, grouped by the reference page's own chapters — the exhaustive view, not a preview |

Everything not claimed by a focused editor still gets a typed control in `[1]` or `[6]` —
a checkbox for a boolean, a select for an enum, a number field for an integer, and so on —
through the same registry a focused editor uses to claim its own keys.

## The Console design

The editor is a TUI in the browser: one monospace font, square corners, a fixed dark chrome, a
single coral accent. **The preview is the editor** — click a region of the herdr mock (a
sidebar row, the tab bar, a pane) and an inline popover opens anchored to it, editing exactly
the keys that draw what you clicked.

## Import and export guarantees

- **Export never regenerates a loaded file.** A comment-preserving patcher (`src/model/toml-doc.ts`)
  applies targeted text edits, and every line you didn't touch comes back byte-identical. Only
  "start over from defaults" writes a whole file from scratch.
- **Only changed leaves are written.** Setting a value equal to herdr's default still writes it;
  resetting a key removes the line entirely.
- **Download is blocked while diagnostics contain errors.** herdr discards a config file it can't
  deserialize and starts on defaults, so corral won't hand you one it can't read either. The
  `:w` action and the export dialog's download and install snippet are disabled and say why;
  `:diff` and copying the raw text are never blocked, because seeing what's wrong is exactly
  what you need when something is.
- **Three ways to hand the file back**: download it, copy it, or copy an install snippet — a
  heredoc that writes it to `~/.config/herdr/config.toml` and then runs
  `herdr server reload-config` to make a running herdr pick it up.

## Keyboard cheat sheet

| Keys | Does |
| --- | --- |
| `1`–`6` | switch sections (not while focus is in a text field) |
| `/` | focus the settings tree's filter |
| `j` / `k` | move the tree's focused row |
| `enter` | open the focused row's editor |
| `esc` | close the open editor or popover |
| `d` | reset the focused key to herdr's default |
| `u` | undo |
| `ctrl+k` | open the command palette, over every key and action |

`:w` and `:diff` aren't keystrokes — they're the diagnostics line's own buttons (and, typed into
the command palette above, two of its entries), opening the export dialog on the full file
(blocked while errors stand) and on the changed hunks, respectively.

## Develop

Package manager is **pnpm**. Node 22 or newer.

```bash
pnpm install         # pnpm install --frozen-lockfile in CI
pnpm dev             # Vite dev server, http://localhost:5173
pnpm build           # tsc -b && vite build -> dist/
pnpm preview         # serve dist/ locally
pnpm typecheck       # tsc -b across the app and node tsconfig projects
pnpm lint            # oxlint --deny-warnings
pnpm test            # vitest run — unit and component tests
pnpm test:watch      # vitest, in watch mode
pnpm check           # typecheck && lint && test && build — the gate; run before handoff
pnpm test:e2e        # Playwright, against the built app on :4173 (separate from check)
pnpm gen:reference   # regenerate src/schema/reference.json from herdr.dev
```

`check` deliberately excludes e2e so the inner loop stays fast; CI runs both.

`test:e2e` builds and serves `dist/` on port 4173, and that port is one shared resource on the
machine — two worktrees running it at once collide silently. Give each worktree its own port:

```bash
PLAYWRIGHT_PORT=4180 pnpm test:e2e
```

`PLAYWRIGHT_PORT` sets the preview port and `baseURL` together and turns off
`reuseExistingServer`, so the suite always runs against this checkout's own build rather than a
server another worktree started.

## Layout

```
src/
  schema/       reference.json + default-config.toml (both generated), themes.json,
                shared types and typed accessors — never hand-edited
  model/        parsing, the comment-preserving TOML patcher, the leaf diff/patch exporter,
                the chord grammar, validation
  store/        zustand — the document (values, edits, undo/redo, selection) and the shell's
                own view state (section, mode, filter, open popover, palette, export tab)
  components/
    preview/    the herdr mock, drawn from the effective config, with its region → keys map
    shell/      TopLine, SettingsTree, DiagnosticsLine, CommandPalette, InlinePopover, Panel,
                the editor registry and the generic fallback editor
    editors/    KeysEditor/ChordEditor, SectionForm, RowsEditor, StatusBarEditor, ThemeEditor
    common/     Field, ColorField, KeyChordInput — controls shared by more than one editor
    io/         Landing (the first screen) and ExportDialog
    ui/         vendored shadcn/ui components — regenerate with the CLI, don't hand-restyle
  lib/          cn, sections.ts (key → UI home), diagnostics, value formatting, the tree model,
                popover geometry, edit helpers, download/install-snippet, diff, key capture
  test/         vitest setup and fixtures (a sample user config, herdr's own defaults and
                config-check output, for round-trip and upgrade-diff tests)
e2e/            Playwright specs against dist/, one file per area, plus journeys.spec.ts
                (import → edit → download, asserted on the downloaded bytes) and console.ts
scripts/        gen-reference.ts and its parser, the fixture they read offline, and
                no-network.test.ts — the sweep that holds "nothing calls the network" to its word
docs/design/    ADRs and the visual contract mockup
```

## Upgrading for a new herdr release

The three files under `src/schema/` are generated and must never be hand-edited. A herdr
upgrade is a regenerate-and-diff:

```bash
pnpm gen:reference                       # src/schema/reference.json, from herdr.dev
pnpm gen:reference --update-fixture      # ... and refresh scripts/fixtures/config-reference.html
herdr --default-config > src/schema/default-config.toml
```

Then, by hand:

- Refresh `src/schema/themes.json` from herdr's own source at the new release tag —
  `impl Palette` in `src/app/state.rs` and `THEME_NAMES` / `CustomThemeColors` in
  `src/config/theme.rs`. A palette that can't be sourced from there is marked
  `"approximate": true` rather than invented.
- Re-record `src/test/fixture-herdr-check.txt` against `herdr config check` on the new release
  and read the diff — a changed line is a behaviour change worth noticing, not just noise.

`reference.json` is deterministic: re-running the generator against an unchanged page leaves the
tree clean, and it fails outright rather than writing a thin file if the page yields fewer than
150 settings, so a site redesign gets noticed rather than silently accepted.

## Contributing

Bug reports, herdr-release bumps and fixes are all welcome — [CONTRIBUTING.md](CONTRIBUTING.md)
has the setup, the gate, and the handful of invariants every change keeps.

## License

MIT.

## Thanks

corral exists because [herdr](https://herdr.dev) exists. Its documented reference is what
`src/schema/reference.json` is generated from, its default config is what a fresh document starts
on, and its own source is where the theme palettes were lifted from — so every setting corral
knows how to edit, it learned from herdr. Thank you to everyone who builds and documents it.

Built on the shoulders of [Vite](https://vite.dev), [React](https://react.dev),
[Tailwind CSS](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com),
[dnd-kit](https://dndkit.com), [zustand](https://zustand.docs.pmnd.rs),
[smol-toml](https://github.com/squirrelchat/smol-toml) and the
[Catppuccin](https://catppuccin.com) palette, in
[JetBrains Mono](https://www.jetbrains.com/lp/mono/).

---

Made with ❤️ in the PNW.
