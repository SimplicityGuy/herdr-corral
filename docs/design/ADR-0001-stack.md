# ADR-0001: Static single-page app on Vite, React, TypeScript, Tailwind, shadcn/ui

Status: accepted · Date: 2026-09-05

## Context

corral is a visual editor for [herdr](https://herdr.dev)'s `config.toml`. The whole job is
client-side: read a TOML file, edit it in memory, render a live mock of herdr, and write the file
back with the user's comments intact. There is no account, no sharing, and nothing that needs a
server. It has to be buildable by autonomous developer agents in one overnight run, so the stack
should be the one those agents get right most reliably.

## Decision

- **Vite 7+ · React 19 · TypeScript** — static SPA, `vite build` to `dist/`, no SSR.
- **Tailwind CSS 4** via `@tailwindcss/vite` and **shadcn/ui** (Radix primitives) for controls.
  Chrome tokens live in `src/index.css`; see ADR-0002 for the design language.
- **dnd-kit** (`@dnd-kit/core` + `@dnd-kit/sortable`, the stable API, not `@dnd-kit/react`) for
  every drag-and-drop surface, always with a keyboard alternative.
- **zustand** for the document store (values, edits, undo/redo, selection, diagnostics).
- **smol-toml** for parsing only. Writing is a comment-preserving patcher we own
  (`src/model/toml-doc.ts`): targeted text edits, never regeneration of a loaded file.
- **vitest + Testing Library** for unit and component tests, **Playwright** for end-to-end flows,
  **oxlint** for linting. Package manager is **pnpm**. `pnpm check` runs typecheck, lint, unit
  tests and build; CI adds e2e.
- **Hosting**: Cloudflare Pages, declared in homelab's OpenTofu like the org's other
  static sites (`herdr-corral.pages.dev`). Production builds from the `release` branch, which only a
  version tag moves (`.github/workflows/release.yml`); `main` and pull requests get previews.

## Alternatives considered

- **SvelteKit static**: smaller bundle, less boilerplate; thinner drag-and-drop and component
  ecosystem, and agents produce it less reliably. Rejected for v1.
- **Astro with React islands**: useful if a marketing page grows around the app; adds a layer the
  editor does not need. Revisit if a landing page is wanted.
- **Next.js**: only pays off with a server (shared configs by link). Not needed.
- **TOML libraries that round-trip comments** (taplo via WASM, @iarna/toml): heavy or lossy. A
  small patcher over the original text is simpler and makes the byte-identical guarantee
  testable.

## Consequences

- Everything runs in the browser; the privacy story is "nothing leaves the page".
- The schema (`src/schema/reference.json`) is generated from herdr.dev's config reference and
  cross-checked against `herdr --default-config`, never hand-edited.
- herdr upgrades are a regenerate-and-diff exercise, not a rewrite.
