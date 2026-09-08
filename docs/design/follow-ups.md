# Follow-ups

Deferred findings from review across the v1 molecule, collected here for the planner to turn
into beads. Each line names the file(s) involved; none of these block the v1 gate.

- **Schema coverage test has a stale exception.** `src/schema/schema.test.ts`'s `REFERENCE_ONLY`
  list still names a key that has since been deleted from herdr's reference page; the exception
  should be removed along with the key it excuses.
- **The reference-page row parser can't cross a `>` inside `data-search`.** `scripts/parse-reference.ts`'s
  `ROW_RE` regex breaks on the `worktrees.directory` row, whose `data-search` attribute value
  contains a literal `>`.
- **Generated schema accessors use an unchecked cast and leak mutable arrays.**
  `src/schema/index.ts`'s `as unknown as ReferenceDocument` / `as unknown as ThemesDocument` casts
  bypass structural checking, and the accessors built on them return the underlying arrays live
  rather than copies, so a caller can mutate schema state.
- **`toml-doc.ts`'s `replaceValue` collapses and reshuffles more than it should.**
  `src/model/toml-doc.ts` collapses a short wrapped container onto one line, normalizes
  inline-table spacing on edit, reorders integer-like keys, and reattributes a commented default
  to the wrong key when a blank line sits between the header and it.
- **`toml-doc.ts` mishandles table headers and array-of-table placement.**
  `src/model/toml-doc.ts` leaves a bare header behind after resetting the only key of a table, and
  appends a new `[[keys.command]]` block at the end of the file rather than near its siblings.
- **A test fixture duplicates a generated file.** `src/test/fixture-herdr-defaults.toml` is a
  byte-for-byte duplicate of `src/schema/default-config.toml`; one should be derived from the
  other, or the duplicate removed.
- **Store: a trailing empty `[[keys.command]]` block is dropped on reload.**
  `src/store/config.ts`'s derived value should seed `occurrencesIn` over `0..len-1` rather than
  only indices with content, so a trailing block with no keys of its own survives a reload instead
  of vanishing.
- **Store: a sparse `keys.command` index yields the wrong block count.** On a defaults-only
  config, `src/store/config.ts`'s same `occurrencesIn` gap makes a sparse index collapse to one
  block rather than reporting the actual (larger) index range.
- **Validation only checks a datetime setting for emptiness.** `src/model/validate.ts` accepts any
  non-empty string for a datetime-format field rather than checking it parses as one.
- **Whether the no-network sweep should grep for `import(` is worth revisiting.**
  `scripts/no-network.test.ts:20-30` currently excludes dynamic `import()` on purpose — Vite
  resolves it to a same-origin chunk, not a call home, and the string also appears in type
  positions like `typeof import('@/lib/diff')`, which a blunt grep can't tell apart from a real
  call. Runtime coverage for that boundary lives in the e2e suite instead. Worth a look: whether a
  narrower needle such as `await import(` could restore some static coverage without flagging
  those type positions as false positives.
- **Forms: `enter` on a Radix Select combobox reopens it instead of applying.** Affects the eight
  enum-typed keys drawn by `src/components/common/Field.tsx` in a popover; the apply button is one
  `tab` away, so it's reachable, but `enter`'s normal meaning in the shell doesn't hold here.
- **Rows: four rejection branches in the model are untested, and dragging can't be proven safe.**
  `src/components/editors/rows-model.ts` has four untested paths where a move is rejected, and
  there's no test asserting that a keyboard-driven drag can't remove a row.
- **Preview: clicking an agent's overridden sidebar rows opens the wrong editor.** When
  `ui.sidebar.agents.rows_by_agent.<id>` overrides the default rows for an agent, clicking that
  agent's row in the preview opens the default rows editor rather than that agent's own override —
  an ordering issue in `src/components/preview/regions.ts`.
