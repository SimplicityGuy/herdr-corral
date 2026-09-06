/**
 * Field-backed popover editors — claims a key by its schema type for the
 * settings tree's popover (`enter` on a row), so `components/shell/editors.tsx`'s
 * generic `ValueEditor` stops applying to it.
 *
 * Reuses `Field`'s own `ScalarControl` dispatch, wrapped in the popover's usual
 * draft-then-commit transaction — a local draft, applied on submit (`enter`) —
 * rather than `Field`'s live write on every change, because the popover is one
 * transaction and `SectionForm` is not. `esc` never reaches this file: the
 * popover host calls `cancel` before an editor hears about it.
 *
 * Registered by type, not by key, so a bead adding a new `boolean` setting to
 * the schema gets this editor for free. `ownedElsewhere` (`lib/scalar-fields.ts`)
 * excludes exactly what the keys, theme, rows and tab-bar editors claim for
 * themselves — the same predicate `SectionForm` and the coverage test read the
 * split from.
 *
 * Registration happens at import time; `App.tsx` imports this module once for
 * its effect, per `editor-registry.ts`'s own contract.
 */
import { ScalarControl } from '@/components/common/Field'
import { type EditorProps, registerEditor } from '@/components/shell/editor-registry'
import { ownedElsewhere } from '@/lib/scalar-fields'
import type { Diagnostic } from '@/model/validate'
import type { TomlValue } from '@/model/parse'
import { typeOf } from '@/schema'
import { type ReactNode, useState } from 'react'

/** herdr type words with a one-line spelling, claimed here rather than by
 * `keys.*`, `theme.custom.*`, or a structured editor. */
const SCALAR_TYPES: ReadonlySet<string> = new Set([
  'boolean',
  'integer',
  'enum',
  'string',
  'path',
  'color',
  'list of strings',
])

function Messages({ diagnostics }: { diagnostics: readonly Diagnostic[] }): ReactNode {
  if (diagnostics.length === 0) return null
  return (
    <ul className="flex flex-col gap-[2px]">
      {diagnostics.map((diagnostic) => (
        <li
          key={`${diagnostic.severity}:${diagnostic.path}:${diagnostic.message}`}
          className={diagnostic.severity === 'error' ? 'text-red' : 'text-yellow'}
        >
          {diagnostic.severity === 'error' ? '● ' : '▲ '}
          {diagnostic.message}
        </li>
      ))}
    </ul>
  )
}

/** The two conventions every transactional editor shares — ADR-0002. */
function ApplyHints() {
  return <p className="text-overlay0">enter apply&ensp;&ensp;esc cancel</p>
}

/** The submit control every form needs and nobody sees — see `editors.tsx`. */
function Apply({ path }: { path: string }) {
  return (
    <button type="submit" className="sr-only">
      {`apply ${path}`}
    </button>
  )
}

/** `Field`'s control, held as a draft until `enter` commits it. Exported for
 * `register-scalar-editors.test.tsx`, which renders it directly. */
export function ScalarPopoverEditor({ path, value, diagnostics, commit, cancel }: EditorProps) {
  const declared = typeOf(path)
  const [draft, setDraft] = useState<TomlValue | undefined>(value)

  function apply() {
    if (draft !== undefined) commit(draft)
  }

  return (
    <form
      className="flex flex-col gap-[6px]"
      onSubmit={(event) => {
        event.preventDefault()
        apply()
      }}
      onKeyDownCapture={(event) => {
        // The switch and the toggle-group items ADR-0002 asks for are real
        // `<button>`s (Radix), so their own default action for `enter` is
        // "click", which never reaches the form's `submit` event. Intercept it
        // before that default fires, so `enter` still means "apply" for those
        // two controls specifically, same as it does in every text-shaped
        // field. `space` is untouched, so it still toggles the ordinary way.
        //
        // Read by ARIA role (`switch`, and `radio` for a toggle-group item)
        // rather than a data attribute this file would have to add to
        // `Field.tsx`'s shared controls — Radix already sets both roles for
        // its own reasons, and no other button here carries either one, so a
        // button with its own meaning for `enter` — the chip list's remove
        // button, the cancel button, the stepper — keeps it. Removing a chip
        // via `enter` and applying the popover via `enter` are different
        // actions on different buttons, not the same button doing two things.
        if (event.key !== 'Enter') return
        const target = event.target
        if (!(target instanceof HTMLElement)) return
        const role = target.getAttribute('role')
        if (role !== 'switch' && role !== 'radio') return
        event.preventDefault()
        apply()
      }}
    >
      <ScalarControl path={path} value={draft} onChange={setDraft} />
      {/* `ColorField` already shows its own inline warning, in the same words
          `checkColor` would produce, so this would only repeat it. */}
      {declared !== 'color' && <Messages diagnostics={diagnostics} />}
      <ApplyHints />
      <Apply path={path} />
      {/* `esc` already cancels (`InlinePopover`'s document listener); this is
          the same action reachable by tab, for the same reason `Apply` is a
          real button rather than only a hint. */}
      <button type="button" onClick={cancel} className="sr-only">
        {`cancel ${path}`}
      </button>
    </form>
  )
}

registerEditor(
  (key) => !ownedElsewhere(key) && SCALAR_TYPES.has(typeOf(key) ?? ''),
  ScalarPopoverEditor,
)
