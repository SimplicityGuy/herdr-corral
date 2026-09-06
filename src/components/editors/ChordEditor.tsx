/**
 * The inline popover for a chord — `enter` on a `[keys]` row in the settings
 * tree records in place.
 *
 * It claims the whole `[keys]` table by predicate rather than key by key, so a
 * herdr release that adds an action gets the recorder without anyone editing a
 * list. Three paths inside the table are *not* chords and are left to the
 * generic editor: `keys.indexed.*`, which names modifiers only, and a custom
 * command's `command`, `type` and size fields.
 *
 * **A recording commits.** Everywhere else in the shell `enter` applies and the
 * popover closes; here the combination the user pressed *is* the `enter`, so
 * capturing one applies it and closes, and focus goes back to the tree row it
 * was anchored to. Typing into the fallback field still ends with `enter`.
 *
 * The popover owns the transaction, so `esc` cancels this editor without it
 * hearing about it — except while a recording is running, when the recorder's
 * capturing listener takes `esc` first and cancels the recording instead. That
 * is the one place the two disagree, and it is the right way round: `esc` ends
 * the innermost thing.
 */
import { KeyChordInput } from '@/components/common/KeyChordInput'
import { type EditorProps, registerEditor } from '@/components/shell/editor-registry'
import { navigateRejection, parseChord } from '@/model/keys'
import { bindingValues } from '@/model/validate'
import { useState } from 'react'

/** A `[keys]` path whose value is one chord the recorder can write. */
function isChordKey(path: string): boolean {
  if (!path.startsWith('keys.')) return false
  if (path.startsWith('keys.indexed.')) return false
  if (path.startsWith('keys.command')) return /^keys\.command\[\d+]\.key$/.test(path)
  return true
}

/** Navigate mode's own refusal, or `null` when the chord is fine here. */
function rejectionOf(path: string, text: string): string | null {
  if (!path.startsWith('keys.navigate_')) return null
  const chord = parseChord(text.trim())
  return chord === null ? null : navigateRejection(chord)
}

export function ChordEditor({ path, value, diagnostics, commit, cancel }: EditorProps) {
  const held = value === undefined ? [] : bindingValues(value)
  const [draft, setDraft] = useState(() => (held !== null && held.length === 1 ? held[0] : ''))

  // A setting holding several chords has no one-line spelling, so there is
  // nothing here to record into — the same answer the generic editor gives for
  // every other value that is a structure rather than a line.
  if (held === null || held.length > 1) {
    return (
      <div className="flex flex-col gap-[6px]">
        <p className="text-subtext0">
          {`${held === null ? 'not a keybinding' : `${held.length} chords`} — reset the key with d to record one`}
        </p>
        <button type="button" onClick={cancel} className="self-start bg-surface0 px-2 text-text">
          esc close
        </button>
      </div>
    )
  }

  const rejection = rejectionOf(path, draft)
  const empty = draft.trim() === ''

  function apply(next: string): void {
    setDraft(next)
    if (next.trim() === '' || rejectionOf(path, next) !== null) return
    commit(next.trim())
  }

  return (
    <div className="flex flex-col gap-[6px]">
      <KeyChordInput
        name={path}
        value={draft}
        onChange={setDraft}
        onRecord={apply}
        onCommit={apply}
        allowPrefix={!path.startsWith('keys.navigate_')}
      />
      {diagnostics.map((diagnostic) => (
        <p
          key={`${diagnostic.severity}:${diagnostic.message}`}
          className={diagnostic.severity === 'error' ? 'text-red' : 'text-yellow'}
        >
          {diagnostic.severity === 'error' ? '● ' : '▲ '}
          {diagnostic.message}
        </p>
      ))}
      {rejection !== null && <p className="text-red">{`● ${rejection}`}</p>}
      <p className="text-overlay0">record, or type&ensp;&ensp;enter apply&ensp;&ensp;esc cancel</p>
      <button
        type="button"
        disabled={empty || rejection !== null}
        onClick={() => apply(draft)}
        className="self-start bg-surface0 px-2 text-text disabled:text-overlay0"
      >
        {`apply ${path}`}
      </button>
    </div>
  )
}

registerEditor(isChordKey, ChordEditor)
