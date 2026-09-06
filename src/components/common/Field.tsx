/**
 * The generic scalar field — a typed, labelled control for one setting, wired
 * straight to the config store.
 *
 * `Field` is the live counterpart to `components/shell/editors.tsx`'s
 * `ValueEditor`: where that component holds a draft and waits for an explicit
 * `commit`, this one writes on every valid change, because it sits inline in
 * `SectionForm` rather than in a popover with its own apply/cancel transaction.
 * `components/editors/register-scalar-editors.ts` wraps the same primitive
 * controls this module exports in that transaction instead, so the tree's
 * popover and the section form share one implementation of "what a boolean
 * looks like" and differ only in when the value is written.
 *
 * ## What Field owns, and what it does not
 *
 * `ownedElsewhere` (`lib/scalar-fields.ts`) is the one predicate `SectionForm`
 * and `Field.test.tsx`'s coverage test build on: every `keys.*` chord, every
 * `theme.custom.*` token, and every key whose schema type has no one-line
 * spelling belongs to another bead's editor. Everything else — booleans,
 * integers, enums, strings, paths, colors, and `list of strings` — is Field's.
 *
 * ## The chrome every field shares
 *
 * A label naming the path, a coral dot when the path is in `explicit()`, a
 * reset button that calls it back out, the reference description and default,
 * and the diagnostics at this path — all built once here so every scalar type
 * gets it for free rather than each control re-implementing it.
 */
import { ColorField } from '@/components/common/ColorField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { diagnosticsAt, useDiagnostics } from '@/lib/diagnostics'
import { resetKey, setKey } from '@/lib/edit'
import { parseDraft } from '@/lib/values'
import type { TomlValue } from '@/model/parse'
import { byKey, enumOptions, typeOf } from '@/schema'
import { useConfigStore } from '@/store/config'
import { useState } from 'react'

const TEXT_INPUT =
  'w-full min-w-0 border border-surface1 bg-base px-2 py-[2px] text-text outline-none focus:border-coral' +
  ' [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

const STEP_BUTTON = 'border border-surface1 bg-surface0 px-[6px] text-text hover:border-coral'

/** A numeric ceiling this key's own description documents, or none. */
function documentedMax(description: string): number | undefined {
  const through = /\b\d+\s+through\s+(\d+)\b/i.exec(description)
  if (through) return Number.parseInt(through[1], 10)
  const between = /\bbetween\s+0\s+and\s+(\d+)\b/i.exec(description)
  if (between) return Number.parseInt(between[1], 10)
  return undefined
}

function BooleanControl({
  path,
  value,
  onChange,
}: {
  path: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2">
      <Switch id={path} aria-label={path} checked={value} onCheckedChange={onChange} />
      <span className={value ? 'text-green' : 'text-red'}>{String(value)}</span>
    </label>
  )
}

function IntegerControl({
  path,
  value,
  onChange,
}: {
  path: string
  value: number | undefined
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(() => (value === undefined ? '' : String(value)))
  // A reset or an undo changes `value` out from under an untouched draft.
  // Derived during render (React's own pattern for this) rather than in an
  // effect, which would commit the stale draft for one frame first.
  const [syncedValue, setSyncedValue] = useState(value)
  if (value !== syncedValue) {
    setSyncedValue(value)
    setDraft(value === undefined ? '' : String(value))
  }

  const entry = byKey(path)
  const max = entry === undefined ? undefined : documentedMax(entry.description)

  function apply(text: string) {
    setDraft(text)
    const parsed = parseDraft('integer', text)
    if (parsed !== undefined) onChange(parsed as number)
  }

  function step(delta: number) {
    const current = value ?? 0
    const next = Math.max(0, max === undefined ? current + delta : Math.min(max, current + delta))
    onChange(next)
  }

  return (
    <div className="flex items-center gap-[6px]">
      <input
        id={path}
        aria-label={path}
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(event) => apply(event.target.value)}
        className={TEXT_INPUT}
      />
      <button type="button" aria-label={`${path} decrease`} onClick={() => step(-1)} className={STEP_BUTTON}>
        {'−'}
      </button>
      <button type="button" aria-label={`${path} increase`} onClick={() => step(1)} className={STEP_BUTTON}>
        {'+'}
      </button>
      <span className="shrink-0 text-overlay0">{max === undefined ? '0–' : `0–${max}`}</span>
    </div>
  )
}

/**
 * A select for more than three options, a toggle group for three or fewer —
 * `ui.sound.agents.*`'s per-agent grid reuses this directly, since each of
 * those is a three-option enum on its own.
 */
export function EnumControl({
  path,
  value,
  options,
  onChange,
}: {
  path: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
}) {
  if (options.length <= 3) {
    return (
      <ToggleGroup
        type="single"
        aria-label={path}
        value={value}
        onValueChange={(next) => {
          if (next !== '') onChange(next)
        }}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option} value={option} aria-label={`${path} ${option}`}>
            {option}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    )
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={path} className="w-full bg-base">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function StringControl({
  path,
  declared,
  value,
  onChange,
}: {
  path: string
  declared: string | undefined
  value: string
  onChange: (value: string) => void
}) {
  return (
    <input
      id={path}
      aria-label={path}
      type="text"
      placeholder={declared === 'path' ? 'path on disk' : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={TEXT_INPUT}
    />
  )
}

function StringListControl({
  path,
  value,
  onChange,
}: {
  path: string
  value: readonly string[]
  onChange: (value: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  function commitDraft() {
    const trimmed = draft.trim()
    if (trimmed === '' || value.includes(trimmed)) {
      setDraft('')
      return
    }
    onChange([...value, trimmed])
    setDraft('')
  }

  function removeAt(index: number) {
    onChange(value.filter((_, existing) => existing !== index))
  }

  return (
    <div className="flex flex-col gap-[6px]">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-[4px]">
          {value.map((item, index) => (
            <li
              key={item}
              className="flex items-center gap-1 border border-surface1 bg-surface0 px-2 py-[1px] text-text"
            >
              {item}
              <button
                type="button"
                aria-label={`remove ${item}`}
                onClick={() => removeAt(index)}
                className="text-overlay0 hover:text-text"
              >
                {'×'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={path}
        aria-label={path}
        type="text"
        placeholder="type a value, enter to add"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitDraft()
          } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
            removeAt(value.length - 1)
          }
        }}
        className={TEXT_INPUT}
      />
    </div>
  )
}

/**
 * Picks the control by the schema's own type word.
 *
 * Exported so `register-scalar-editors.ts` can wrap the same dispatch in the
 * popover's draft-then-commit transaction instead of `Field`'s live one.
 */
export function ScalarControl({
  path,
  value,
  onChange,
}: {
  path: string
  value: TomlValue | undefined
  onChange: (value: TomlValue) => void
}) {
  const declared = typeOf(path)

  if (declared === 'boolean') {
    return <BooleanControl path={path} value={value === true} onChange={onChange} />
  }
  if (declared === 'integer') {
    return (
      <IntegerControl path={path} value={typeof value === 'number' ? value : undefined} onChange={onChange} />
    )
  }
  if (declared === 'enum') {
    const options = enumOptions(path)
    return (
      <EnumControl
        path={path}
        value={typeof value === 'string' ? value : ''}
        options={options}
        onChange={onChange}
      />
    )
  }
  if (declared === 'color') {
    return (
      <ColorField
        id={path}
        aria-label={path}
        value={typeof value === 'string' ? value : undefined}
        onChange={onChange}
      />
    )
  }
  if (declared === 'list of strings') {
    return (
      <StringListControl
        path={path}
        value={Array.isArray(value) ? (value as string[]) : []}
        onChange={onChange as (value: string[]) => void}
      />
    )
  }
  // 'string', 'path', and anything the schema has not declared yet.
  return <StringControl path={path} declared={declared} value={typeof value === 'string' ? value : ''} onChange={onChange} />
}

/**
 * One setting, fully dressed: label, changed marker, reset, the typed control,
 * the reference description and default, and any diagnostic at this path.
 *
 * Reads and writes the config store directly — `SectionForm` hands it nothing
 * but the path.
 */
export function Field({ path }: { path: string }) {
  const value = useConfigStore((state) => state.effective(path))
  const changed = useConfigStore((state) => state.explicit().has(path))
  const diagnostics = useDiagnostics()
  const problems = diagnosticsAt(diagnostics, path)
  const entry = byKey(path)
  const declared = typeOf(path)

  return (
    <div className="flex flex-col gap-[4px] border-b border-surface0 pb-[10px] last:border-b-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-subtext0">
          {path}
          {changed && (
            <span aria-label="changed" className="ml-[6px] text-coral">
              {'●'}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => resetKey(path)}
          disabled={!changed}
          className="shrink-0 text-overlay0 hover:text-text disabled:opacity-40"
        >
          reset
        </button>
      </div>

      <ScalarControl path={path} value={value} onChange={(next) => setKey(path, next)} />

      {entry !== undefined && <p className="text-overlay0">{entry.description}</p>}
      {entry?.defaultLiteral !== undefined && entry?.defaultLiteral !== null && (
        <p className="text-overlay0">default: {entry.defaultLiteral}</p>
      )}

      {/* `ColorField` already shows `checkColor`'s own warning inline, so this
          would only repeat it — every other control leaves diagnostics to here. */}
      {declared !== 'color' && problems.length > 0 && (
        <ul className="flex flex-col gap-[2px]">
          {problems.map((problem) => (
            <li
              key={`${problem.severity}:${problem.message}`}
              className={problem.severity === 'error' ? 'text-red' : 'text-yellow'}
            >
              {problem.severity === 'error' ? '● ' : '▲ '}
              {problem.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
