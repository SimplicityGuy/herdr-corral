# Contributing to herdr-corral

Thanks for looking at herdr-corral. It's a static single-page app that edits
[herdr](https://herdr.dev)'s `config.toml` in the browser: no backend, no account, nothing
leaves the tab. Most changes are front-end work in React and TypeScript, and the whole thing is
built to be picked up quickly by someone who has never seen it before.

## Ways to help

- **Report a bug.** Open an issue with the `config.toml` (or the part of it) that misbehaves,
  what you did, what you expected, and what happened. A file herdr-corral round-trips wrongly
  is the most useful report there is — see invariant 1 below for why.
- **Track a herdr release.** When herdr adds or renames a setting, the schema needs
  regenerating; "Upgrading for a new herdr release" in the README is the recipe.
- **Fix or add something.** Open an issue first for anything larger than a bug fix, so the
  shape can be agreed on before the work is done.

## Development setup

Package manager is **pnpm**. Node 22 or newer.

```sh
pnpm install
pnpm dev             # Vite dev server, http://localhost:5173
```

Stack: Vite · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui (Radix) · dnd-kit · zustand ·
smol-toml. See `docs/design/ADR-0001-stack.md` for why each was chosen.

## Before you open a pull request

```sh
pnpm check           # typecheck && lint && test && build
pnpm test:e2e        # Playwright, against the built app
```

Both must be green — it's the same bar `.github/workflows/ci.yml` enforces on every push and
pull request. `check` runs in under a minute; `test:e2e` builds `dist/` and serves it on port
4173, so if that port is taken (another checkout running the suite, say) give it its own:

```sh
PLAYWRIGHT_PORT=4180 pnpm test:e2e
```

## Invariants

herdr-corral hands users back a file they will keep, so a handful of rules are enforced by
tests rather than by review. A change that breaks one of these fails the build; a change that needs
to break one is a design change, and wants an issue first.

1. **Export never regenerates a loaded file.** Edits are applied as targeted text patches, and
   every line the user did not touch comes back byte-identical. Only "start from herdr
   defaults" writes a whole file.
2. **Only changed leaves are written.** Setting a value equal to the default still writes it;
   resetting a key removes the line.
3. **The schema is generated, never hand-edited.** The three files under `src/schema/` come from
   `pnpm gen:reference` and `herdr --default-config`; a test cross-checks them against each
   other.
4. **Validation mirrors herdr.** Row and token limits, chord grammar, enum sets, integer ranges,
   colour syntax — the same rules herdr applies, so an error here is an error there.
5. **Every schema key has exactly one UI home** (`src/lib/sections.ts`), and a test fails a key
   that has none.
6. **Download is blocked while diagnostics contain errors.** herdr discards a config it cannot
   deserialize, so herdr-corral will not hand one over. `:diff` and copying the text are never
   blocked.
7. **No network calls at runtime.** `scripts/no-network.test.ts` sweeps `src/` for them. Fonts
   are self-hosted; third-party widgets are redrawn as plain links, not loaded as scripts.

## The Console design language

The editor is a TUI in the browser. `docs/design/ADR-0002-console-design-language.md` is the
specification and `docs/design/console-direction.html` is the visual contract; the short
version:

- **Tokens live in `src/index.css`** and nowhere else. Use the utilities they generate
  (`bg-crust`, `bg-mantle`, `border-surface1`, `text-subtext0`, `text-coral`, …). Never put a
  hex value in a component.
- **Coral is spent on three things** — the mode badge, the focus ring, the selected region.
  Buttons are `surface0` chips, not calls to action.
- **One font**, JetBrains Mono, at 13px; 12px in the preview and the diagnostics line; 11px for
  panel captions.
- **Square corners, no gradients, no pills, no shadows** except on popovers. An e2e spec measures
  the rendered corner radius, so this is checked, not assumed.
- **The preview is the editor.** Anything drawn in the herdr mock should open the editor for the
  keys that draw it when clicked.
- **Every drag has a keyboard equivalent, every control has an accessible name.** Tests query by
  role and name, so a missing label fails the build.

## Conventions

- Import with the `@/` alias (it resolves to `src/`).
- Add shadcn components with `pnpm dlx shadcn@latest add -y <name>` and restyle them through the
  tokens; do not hand-edit the vendored files under `src/components/ui/`.
- No new runtime dependencies without a reason in the pull request; the app must stay a static
  bundle.
- Unit and component tests sit beside the code they test (`Foo.test.tsx`). Playwright specs live
  in `e2e/`, one file per area, and claims about the exported file belong in
  `e2e/journeys.spec.ts`, asserted on the downloaded bytes.
- Commit subjects follow conventional commits (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`,
  `deps:`). Keep pull requests to one change; a refactor that enables a feature is welcome as
  its own commit ahead of it.
- Write comments for the next reader: what a piece of code is for and why it is shaped this way,
  not what the next line does. The existing module headers are the house style.

## Where things live

| Path | Owns |
| --- | --- |
| `src/schema/` | generated reference, defaults and themes — never hand-edited |
| `src/model/` | parsing, the comment-preserving patcher, the exporter, validation |
| `src/store/` | zustand: the document and the shell's view state |
| `src/components/preview/` | the herdr mock, and its region → keys map |
| `src/components/shell/` | the chrome: top line, tree, diagnostics line, palette, popover |
| `src/components/editors/` | the per-section editors |
| `src/components/common/` | controls shared by more than one editor |
| `src/components/io/` | the landing screen and the export dialog |
| `src/lib/` | small pure helpers |
| `e2e/` | Playwright specs |
| `scripts/` | the schema generator and the no-network sweep |
| `docs/design/` | ADRs and the visual contract |

## Issue tracking for maintainers

The maintainer drives work through [beads](https://github.com/gastownhall/beads), the
git-backed issue tracker, and [BeadHive](https://github.com/beadhive/beadhive) (`bh`), the
agentic git-flow tooling that dispatches beads to worktrees and merges them; both are described
in `AGENTS.md` and `CLAUDE.md`. Outside contributors do not need any of that: a GitHub issue
and a pull request are the whole process.

## License

By contributing you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
