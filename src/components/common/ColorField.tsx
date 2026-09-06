/**
 * Editing side of a herdr color value — the swatch reading of `lib/values.ts`
 * plus a way to change it.
 *
 * herdr's `parse_color` accepts four spellings, and never rejects a file over
 * one: hex (`#rgb`, `#rrggbb`), one of 16 named colors, `rgb(r, g, b)`, and the
 * four spellings that resolve to the terminal's own color (`reset`, `default`,
 * `none`, `transparent`) — accepted for every color setting, not just some, so
 * there is no "reset is allowed only here" rule to leave out of the picker
 * (src/config/theme.rs:126-190). `isColor` is that rule, imported rather than
 * re-decided here.
 *
 * An unrecognized spelling is not blocked — herdr logs a warning and falls back
 * to cyan (`checkColor`, model/validate.ts), so typing keeps working and the
 * field says why underneath, in the same words that diagnostic uses.
 *
 * Reused wherever a scalar `color` key is edited: `Field` claims every one
 * except `theme.custom.*`, which the theme editor claims for itself and reuses
 * this component to do it.
 */
import { isColor } from '@/model/validate'
import { useId } from 'react'

/**
 * herdr's named colors (src/config/theme.rs:168-189), plus `reset` — the
 * spelling `parse_color` maps to the terminal's own foreground/background
 * (src/config/theme.rs:130-133) and the one every color setting accepts.
 */
const COLOR_NAMES: readonly string[] = [
  'reset',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'purple',
  'cyan',
  'white',
  'gray',
  'grey',
  'darkgray',
  'darkgrey',
  'lightred',
  'lightgreen',
  'lightyellow',
  'lightblue',
  'lightmagenta',
  'lightcyan',
] as const

const TEXT_INPUT =
  'w-full min-w-0 border border-surface1 bg-base px-2 py-[2px] text-text outline-none focus:border-coral'

export interface ColorFieldProps {
  readonly id?: string
  readonly value: string | undefined
  readonly onChange: (value: string) => void
  /** The accessible name for the text input — the schema path, by convention. */
  readonly 'aria-label': string
}

export function ColorField(props: ColorFieldProps) {
  const autoId = useId()
  const inputId = props.id ?? autoId
  const label = props['aria-label']
  const value = props.value ?? ''
  const trimmed = value.trim()
  const swatch = trimmed !== '' && isColor(trimmed) ? trimmed : null
  const invalid = trimmed !== '' && !isColor(trimmed)

  return (
    <div className="flex flex-col gap-[4px]">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          title={swatch ?? undefined}
          className="size-[18px] shrink-0 border border-surface1 bg-base"
          style={swatch !== null ? { backgroundColor: swatch } : undefined}
        />
        <input
          id={inputId}
          aria-label={label}
          type="text"
          value={value}
          onChange={(event) => props.onChange(event.target.value)}
          className={TEXT_INPUT}
        />
        <select
          aria-label={`${label} named color`}
          value=""
          onChange={(event) => {
            if (event.target.value === '') return
            props.onChange(event.target.value)
          }}
          className="shrink-0 border border-surface1 bg-base px-1 py-[2px] text-text outline-none focus:border-coral"
        >
          <option value="">picker…</option>
          {COLOR_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      {/* Mirrors `checkColor`'s own wording (model/validate.ts), so a garbage
          value reads the same warning here as it would in the diagnostics line. */}
      {invalid && (
        <p className="text-yellow">
          {'▲ '}unknown color {JSON.stringify(trimmed)}; herdr will fall back to cyan
        </p>
      )}
    </div>
  )
}
