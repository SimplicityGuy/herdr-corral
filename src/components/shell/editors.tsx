/**
 * The generic value editor — what the popover shows for a key nobody has claimed.
 *
 * It builds a control from the schema's own type word: a checkbox for a boolean, a
 * number field for an integer, a select for an enum, a text field for everything
 * else with a one-line spelling. That is enough for `enter`-to-edit to work over
 * most of the config today, and it disappears key by key as the typed forms land
 * and claim their keys through `editor-registry.ts`.
 *
 * The four settings whose value is a whole structure — the sidebar token rows, the
 * tab bar's right side, the command list — have no one-line spelling and no
 * generic form. They say so and wait for the bead that owns them, rather than
 * offering a text field that would let someone paste a broken array into the file.
 */
import type { EditorProps } from '@/components/shell/editor-registry'
import { parseDraft } from '@/lib/values'
import type { Diagnostic } from '@/model/validate'
import { enumOptions, typeOf } from '@/schema'
import { type ReactNode, useState } from 'react'

/** herdr's type words whose value is a structure, not a line. */
const STRUCTURED = new Set(['array', 'list of token rows', 'table of token rows', 'list of strings'])

/**
 * One field, drawn as a TUI input.
 *
 * The spin buttons a number field grows are curved chrome nobody asked for, and
 * ADR-0002 has square corners everywhere, so they are turned off rather than
 * restyled. (Never write the bare utility name in prose here: Tailwind scans
 * comments and would emit it — see CLAUDE.md.)
 */
const FIELD =
  'w-full border border-surface1 bg-base px-2 py-[2px] text-text outline-none focus:border-coral' +
  ' [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

export function ValueEditor({ path, value, diagnostics, commit }: EditorProps) {
  const declared = typeOf(path)
  const options = enumOptions(path)
  const [draft, setDraft] = useState(() => (value === undefined ? '' : String(value)))
  const [checked, setChecked] = useState(value === true)

  if (declared !== undefined && STRUCTURED.has(declared)) {
    return (
      <div className="flex flex-col gap-[6px]">
        <p className="text-subtext0">
          {declared} — edited by its own form, which arrives with a later bead.
        </p>
        <Messages diagnostics={diagnostics} />
        <p className="text-overlay0">esc close</p>
      </div>
    )
  }

  if (declared === 'boolean') {
    return (
      <form
        className="flex flex-col gap-[6px]"
        onSubmit={(event) => {
          event.preventDefault()
          commit(checked)
        }}
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            className="size-[13px] accent-coral"
          />
          <span className={checked ? 'text-green' : 'text-red'}>{String(checked)}</span>
        </label>
        <Messages diagnostics={diagnostics} />
        <ApplyHints />
        <Apply path={path} />
      </form>
    )
  }

  return (
    <form
      className="flex flex-col gap-[6px]"
      onSubmit={(event) => {
        event.preventDefault()
        const parsed = parseDraft(declared, draft)
        if (parsed === undefined) return
        commit(parsed)
      }}
    >
      {declared === 'enum' && options.length > 0 ? (
        <select
          aria-label={path}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className={FIELD}
        >
          {!options.includes(draft) && <option value={draft}>{draft === '' ? 'unset' : draft}</option>}
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          aria-label={path}
          type={declared === 'integer' ? 'number' : 'text'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className={FIELD}
        />
      )}
      <Messages diagnostics={diagnostics} />
      <ApplyHints />
      <Apply path={path} />
    </form>
  )
}

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

/**
 * The submit control every form needs and nobody sees.
 *
 * `enter` in a text field only submits a form that has one, and the hint line
 * above already tells the user what `enter` does — so it is there for the browser
 * rather than for the eye, but it still carries a name a screen reader can read
 * and a test can click.
 */
function Apply({ path }: { path: string }) {
  return (
    <button type="submit" className="sr-only">
      {`apply ${path}`}
    </button>
  )
}
