# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

## Build & Test

Package manager is **pnpm**. Node 22 or newer.

```bash
pnpm install          # pnpm install --frozen-lockfile in CI
pnpm dev              # Vite dev server on :5173
pnpm check            # typecheck && lint && test && build — the gate; run before handoff
pnpm test:e2e         # Playwright against the built app on :4173 (separate from check)
```

| Script | What it does |
| --- | --- |
| `dev` | Vite dev server with HMR |
| `build` | `tsc -b && vite build` → `dist/` |
| `preview` | serve `dist/` locally |
| `typecheck` | `tsc -b` across the app and node tsconfig projects |
| `lint` | `oxlint --deny-warnings` |
| `test` | `vitest run` — unit and component tests only |
| `test:watch` | `vitest` in watch mode |
| `test:e2e` | `playwright test`; builds and previews `dist/` itself |
| `check` | typecheck → lint → test → build |
| `gen:reference` | regenerates `src/schema/reference.json` from herdr.dev; `--offline` parses the committed fixture instead |

`check` deliberately excludes e2e so the inner loop stays fast. CI runs both. Unit tests come
from `src/**` and `scripts/**`, so the schema generator is covered by the same gate as the app.

### Refreshing the generated schema

The three files under `src/schema/` are generated and must never be hand-edited. A herdr
upgrade is a regenerate-and-diff:

```bash
pnpm gen:reference                       # src/schema/reference.json, from herdr.dev
pnpm gen:reference --update-fixture      # ... and refresh scripts/fixtures/config-reference.html
herdr --default-config > src/schema/default-config.toml
```

`reference.json` is deterministic: re-running against an unchanged page leaves the tree clean.
The generator fails rather than writing a thin file if the page yields fewer than 150 settings,
so a site redesign is noticed. The fixture backs `--offline` and the parser's unit test, and is
only rewritten when you ask for it, because the page carries build-hash noise.

`src/schema/themes.json` is lifted from herdr's own source — `src/app/state.rs` (`impl Palette`)
and `src/config/theme.rs` (`THEME_NAMES`, `CustomThemeColors`) at the release tag, cited in the
file's `source` field. Re-derive it from the new tag on a herdr bump; a palette that cannot be
sourced is marked `"approximate": true` rather than invented.

**nvm caveat.** The operator's zsh profile lazy-loads nvm and recurses in non-interactive
shells: `node` and `pnpm` print `_nvm_load: command not found` until the stack overflows. When
that happens, call the binaries directly, or put them first on `PATH`:

```bash
export PATH=/Users/Robert/.nvm/versions/node/v26.7.0/bin:/opt/homebrew/bin:$PATH
unset -f node npm npx pnpm 2>/dev/null   # drop the lazy-load shims in this shell
```

## Architecture Overview

corral is a **static single-page app** (ADR-0001). Everything is client-side: read a
`config.toml`, edit it in memory, render a live mock of herdr, write the file back with the
user's comments intact. No server, no account, no network calls at runtime.

Stack: Vite · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui (Radix) · dnd-kit
(`@dnd-kit/core` + `@dnd-kit/sortable`, the stable API) · zustand · smol-toml for parsing only ·
vitest + Testing Library · Playwright · oxlint.

Layers and ownership — directories marked *(planned)* arrive with later beads:

| Path | Owns |
| --- | --- |
| `src/schema/` | `reference.json` (generated from herdr.dev), `default-config.toml` (from `herdr --default-config`), `themes.json`, shared types and typed accessors |
| `src/model/` | `paths.ts`, `parse.ts`, `toml-value.ts`, the comment-preserving patcher `toml-doc.ts` and the leaf diff / patch-or-generate exporter `export.ts`; chord grammar and validation are still *(planned)* |
| `src/store/` | `config.ts` — zustand: source, original text, parsed values, edits, effective config, undo/redo, selection |
| `src/components/preview/` *(planned)* | `HerdrPreview`, sample data, the region → keys map |
| `src/components/shell/` *(planned)* | `TopLine`, `SettingsTree`, `DiagnosticsLine`, `CommandPalette`, the inline popover host |
| `src/components/editors/` *(planned)* | `RowsEditor`, `StatusBarEditor`, `KeysEditor`, `ThemeEditor`, `SectionForm` |
| `src/components/io/` *(planned)* | `Landing` (import), `ExportDialog` (download / copy / snippet / diff) |
| `src/components/ui/` | vendored shadcn components — regenerate with the CLI, do not hand-restyle |
| `src/lib/` | `cn` and other cross-cutting helpers |
| `src/test/` | vitest setup (jest-dom matchers, cleanup) |
| `e2e/` | Playwright specs, run against `dist/` |
| `scripts/` | `gen-reference.ts`, its parser and fixture, and other build-time generators |

`src/App.tsx` currently holds a **static placeholder** of the Console chrome. The shell bead
replaces the contents of its regions; it should not invent a different structure.

## Conventions & Patterns

### Invariants

Every bead preserves these, and tests enforce them:

1. **Export never regenerates a loaded file.** `TomlDocument` applies targeted text edits and
   untouched lines come back byte-identical (fixture test). Only "start over from defaults"
   generates a whole file.
2. **Only changed leaves are written.** An explicit value equal to the default is still
   written; "reset" removes the key.
3. **The schema is generated, never hand-edited.** `schema.test.ts` cross-checks
   `reference.json` against `default-config.toml` in both directions. Neither file is a superset
   of the other, so each direction carries a named exceptions list, and an entry that has stopped
   being an exception fails just as loudly as a new gap.
4. **Validation mirrors herdr**: 16 rows × 16 tokens, `tab_bar_right` entries ≤ 16, chord
   grammar, navigate-mode restrictions, color syntax, enum sets, integer ranges.
5. **Every schema key belongs to exactly one UI home** (`sections.test.ts`).
6. **Download is blocked while diagnostics contain errors.**

### Design language

The editor is a TUI in the browser and **the preview is the editor** (ADR-0002).
`docs/design/console-direction.html` is the visual contract;
`docs/design/ADR-0002-console-design-language.md` is the specification.

- Tokens live in `src/index.css` and nowhere else. Use the Tailwind utilities they generate
  (`bg-crust`, `bg-mantle`, `bg-base`, `bg-surface0`, `border-surface1`, `text-overlay0`,
  `text-subtext0`, `text-text`, `text-coral`, and the semantic `text-green` / `yellow` / `red` /
  `mauve` / `blue` / `teal` / `peach`). Never copy a hex value into a component, and never take
  colors from the mockup's inline styles.
- ADR-0002 calls the coral accent `--accent`. shadcn/ui already owns `--accent` for a
  component's hover background, so the coral is **`--color-coral`** here and feeds shadcn's
  `--primary` and `--ring`. Every other token keeps the ADR's name verbatim.
- One font: JetBrains Mono Variable, self-hosted. 13px / 1.45 body, 12px in the preview and the
  diagnostics line, 11px for panel captions. No second face.
- Square corners everywhere. `--radius: 0` and the collapsed `--radius-*` scale handle the
  named steps, but three shapes have a fixed radius the scale never touches: `rounded-full`,
  arbitrary values like `rounded-[4px]`, and the unsuffixed utility. An unlayered rule at the
  bottom of `src/index.css` zeroes those, and `e2e/square-corners.spec.ts` measures the computed
  radius in a browser so the claim is checked rather than asserted. It must stay unlayered:
  inside `@layer base` it would lose to Tailwind's utilities layer whatever its specificity.
  `rounded-[inherit]` is exempt, because it propagates a parent's radius rather than setting one.
  No gradients, no pills, no shadows on panels; only popovers get a shadow.
- Panels are 1px `--surface1` frames with a `┤ caption ├` caption interrupting the top edge,
  drawn as text on the page background.
- The chrome is fixed dark and never follows the OS theme. Only the herdr preview renders
  themes, including light ones, and it paints its own colors.

### Accessibility

The keyboard rules in ADR-0002 set the bar: every control has an accessible name and a visible
coral focus state, and every drag has a keyboard equivalent (dnd-kit's keyboard sensor plus
explicit move commands). Tests query by role and accessible name, so a missing label fails the
build rather than shipping.

### Tooling

- Import with the `@/` alias, which resolves to `src/`. It is declared in the root `tsconfig.json`
  (the shadcn CLI reads that one) and in `tsconfig.app.json` (tsc reads that one). There is no
  `baseUrl`; TypeScript 6 deprecates it and `tsc -b` errors on it.
- Add shadcn components with the CLI (`pnpm dlx shadcn@latest add -y <name>`), then restyle
  through the tokens rather than editing the vendored file.
- `.oxlintrc.json` relaxes `react/only-export-components` and four `jsx-a11y` rules for
  `src/components/ui/**` only, because those files are vendored upstream code. Our own
  components get the full rule set.
- pnpm 11 reads settings from `pnpm-workspace.yaml`, not from a `pnpm` key in `package.json`.
  `allowBuilds: esbuild: true` lives there; without it `vite build` fails on a missing binary.
- Playwright runs against `dist/`, not the dev server, so e2e exercises the shipped bundle.
  Its specs compile under `tsconfig.e2e.json`, which is the only project with both the Node and
  DOM libraries, because `page.evaluate` callbacks run in the browser.
- Tailwind scans comments too. A bare utility name in prose emits that utility into the bundle,
  so write `rounded-*` rather than the bare word when describing one.

<!-- bh:agf:start (managed by `bh hive init` — edit outside these markers; `-f` refreshes) -->
## AGF — Agentic Git Flow

This repo is onboarded as a **`bh` hive** and develops via **AGF**: work is tracked in beads
and driven through `bh`, **not** raw `git` / `bd` / `gh`.

- **Is this repo set up for AGF?** → run `bh hive ready` (add `-v` for the line-item breakdown).
- **Lifecycle, roles, conventions:** see `docs/AGF.md` and the bh plugin's role skills.
- Drive beads with `bh work`; load the role skill for your seat (coordinator / developer / merger).
- Batch/collapsed work lives in ONE shared `wt/batch/<group>` worktree and completes as a UNIT:
  `bh work submit --group` then `bh work merge --group` — per-bead `submit`/`check` don't apply.
<!-- bh:agf:end -->
