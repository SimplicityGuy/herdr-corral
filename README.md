# corral

Visual editor for [herdr](https://herdr.dev)'s `config.toml`. Corral your agents' layout, keys,
and theme, then download the file.

corral is a static single-page app. Everything runs in your browser: nothing is uploaded, and a
file you load comes back with every comment and untouched line byte-identical.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm check        # typecheck, lint, unit tests, build — what CI gates on
pnpm test:e2e     # Playwright, against the built app
```

## Design

- `docs/design/ADR-0001-stack.md` — Vite, React 19, TypeScript, Tailwind 4, shadcn/ui.
- `docs/design/ADR-0002-console-design-language.md` — the "Console" design language.
- `docs/design/console-direction.html` — the visual contract for the shell.
