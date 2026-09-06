/**
 * How a later bead claims a key for its own editor.
 *
 * ## The contract
 *
 * An editor is a plain component taking `EditorProps`. It reads `value`, and calls
 * exactly one of `commit` (apply and close) or `cancel` (close, changing nothing).
 * It never touches the store itself: `InlinePopover` owns the transaction, so
 * `esc` means the same thing in every editor and the popover can restore focus.
 *
 * ```tsx
 * // src/components/editors/RowsEditor.tsx
 * export function RowsEditor({ path, value, commit, cancel }: EditorProps) { … }
 * registerEditor('ui.sidebar.agents.rows', RowsEditor)
 * registerEditor((key) => key.startsWith('theme.custom.'), ColorEditor)
 * ```
 *
 * Registration happens at module scope; `App.tsx` imports the module that does it.
 * Later claims win, so a bead can take a key the generic form was handling without
 * the generic form knowing, and a test can register a stub over anything.
 *
 * `editorFor` answers `null` rather than a fallback, because the fallback is a
 * component and a registry that imported one would import the module that imports
 * the registry. The popover picks the fallback instead.
 */
import type { Diagnostic } from '@/model/validate'
import type { TomlValue } from '@/model/parse'
import type { ComponentType } from 'react'

export interface EditorProps {
  /** The dotted schema path being edited. */
  readonly path: string
  /** The effective value: what the file says, or herdr's default. */
  readonly value: TomlValue | undefined
  /** Everything `validate()` says about this path right now. */
  readonly diagnostics: readonly Diagnostic[]
  /** Apply the value and close. */
  commit(value: TomlValue): void
  /** Close, changing nothing. */
  cancel(): void
}

export type EditorComponent = ComponentType<EditorProps>

/** A claim on one key, or on a family of them. */
export type EditorClaim = string | ((key: string) => boolean)

const registry: { claim: EditorClaim; editor: EditorComponent }[] = []

/** Claim a key, or a family of keys, for an editor. Later claims win. */
export function registerEditor(claim: EditorClaim, editor: EditorComponent): void {
  registry.push({ claim, editor })
}

/** The editor claiming this key, or `null` when nothing has. */
export function editorFor(path: string): EditorComponent | null {
  for (let index = registry.length - 1; index >= 0; index--) {
    const { claim, editor } = registry[index]
    if (typeof claim === 'string' ? claim === path : claim(path)) return editor
  }
  return null
}

/** Forget every registration. Tests use it; nothing else should. */
export function clearEditors(): void {
  registry.length = 0
}
