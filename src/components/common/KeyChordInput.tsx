/**
 * A chord field: press the keys, or type the spelling.
 *
 * Recording is the easy path and typing is the fallback, so the control is two
 * controls side by side — a `record` button and a text field — rather than one
 * field that means different things at different times. Focus the button and
 * press `enter` (a button's own behaviour, not a key handler) and the field is
 * in **RECORD** mode; the next combination is captured, written into herdr's
 * chord syntax by `src/lib/capture.ts`, and handed back. `esc` cancels the
 * recording and nothing else.
 *
 * ## Why the recording listener is a capturing document listener
 *
 * A recorder that only heard its own element would miss most of what it exists
 * to capture: `ctrl+k` opens the palette, `1`–`6` switch sections, `j`/`k` move
 * the tree, and `esc` closes the inline popover — all of them document
 * listeners the shell installed on purpose. While a recording is running this
 * one sits in front of them, in the capture phase, and stops every keydown
 * where it lands. That is what lets someone record `esc`-adjacent chords, digits
 * and the shell's own shortcuts without the shell acting on them, and it is why
 * `esc` here cancels the recording instead of closing the popover the field may
 * be sitting in.
 *
 * ## Why `prefix+` is a toggle and never recorded
 *
 * herdr's prefix mode is a state of herdr, not a key: `prefix+v` means "the
 * prefix, then v", and a browser watching a keyboard cannot tell that from two
 * unrelated presses. So a recording writes exactly the combination that was
 * pressed — which is what the acceptance for this bead asks for — and the
 * `prefix+` marker is a checkbox the user sets, on the value, before or after.
 *
 * The field is controlled and holds no draft of its own: what it shows is what
 * its parent passes, verbatim, because a chord is shown as the user spelled it
 * (invariant 7). Applying is the parent's business too — the section view writes
 * a recording straight to the store, and the popover commits and closes.
 */
import { chordFromPress, cancelsRecording, hasPrefix, withPrefix } from '@/lib/capture'
import { useShellStore } from '@/store/shell'
import { useEffect, useState } from 'react'

/** The TUI input, matching the generic value editor's field. */
const FIELD =
  'min-w-0 flex-1 border border-surface1 bg-base px-2 py-[2px] text-yellow outline-none focus:border-coral'

export interface KeyChordInputProps {
  /** The dotted path this field edits. Every accessible name is built from it. */
  readonly name: string
  /** The chord as the config spells it, verbatim; empty when the key is unset. */
  readonly value: string
  /** The value changed by typing or by the `prefix+` toggle. */
  onChange(next: string): void
  /** A recording completed. Defaults to `onChange`. */
  onRecord?(next: string): void
  /** `enter` in the text field: apply what is typed. */
  onCommit?(next: string): void
  /** Offer the `prefix+` toggle. Navigate-mode actions turn it off. */
  readonly allowPrefix?: boolean
}

export function KeyChordInput({
  name,
  value,
  onChange,
  onRecord,
  onCommit,
  allowPrefix = true,
}: KeyChordInputProps) {
  const [recording, setRecording] = useState(false)
  const apply = onRecord ?? onChange

  // The mode badge belongs to the shell, and it is the shell's own word for what
  // this field is doing. Ending the recording puts it back, however the
  // recording ended — including a field that is torn down mid-capture.
  useEffect(() => {
    if (!recording) return
    useShellStore.getState().setMode('RECORD')
    return () => useShellStore.getState().setMode('EDIT')
  }, [recording])

  useEffect(() => {
    if (!recording) return
    function onKeyDown(event: KeyboardEvent) {
      // Nothing typed during a capture belongs to anyone else — see the module
      // docstring. The stop comes first so an unrecordable key (a bare `shift`,
      // `CapsLock`) still does not reach the shell behind the field.
      event.preventDefault()
      event.stopPropagation()
      if (cancelsRecording(event)) {
        setRecording(false)
        return
      }
      const chord = chordFromPress(event)
      if (chord === null) return
      setRecording(false)
      apply(chord)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [recording, apply])

  const prefix = hasPrefix(value)

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <button
        type="button"
        aria-label={`record ${name}`}
        aria-pressed={recording}
        onClick={() => setRecording((on) => !on)}
        className={
          recording
            ? 'shrink-0 bg-coral px-2 py-[2px] font-bold text-crust'
            : 'shrink-0 bg-surface0 px-2 py-[2px] text-text'
        }
      >
        {recording ? '◉ recording' : '◎ record'}
      </button>
      <input
        type="text"
        aria-label={name}
        value={value}
        placeholder="unset"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || onCommit === undefined) return
          event.preventDefault()
          onCommit(event.currentTarget.value)
        }}
        className={FIELD}
      />
      {allowPrefix && (
        <label className="flex shrink-0 items-center gap-1 text-overlay0">
          <input
            type="checkbox"
            aria-label={`prefix+ for ${name}`}
            checked={prefix}
            onChange={(event) => onChange(withPrefix(value, event.target.checked))}
            className="size-[13px] accent-coral"
          />
          prefix+
        </label>
      )}
      {recording && (
        <output className="shrink-0 text-coral">press a combination&ensp;esc cancels</output>
      )}
    </span>
  )
}
