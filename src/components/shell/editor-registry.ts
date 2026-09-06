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
 *
 * ## Asking for room
 *
 * ADR-0002's popover is a 360px column and every editor gets that by default. An
 * editor whose subject is a *line* — the sixteen token chips of a sidebar row —
 * says so once, at registration, with `{ width }`. The claim carries it rather
 * than the component, so the host knows how wide the frame is before it renders
 * what goes in it, and `placeAt` can keep the whole frame on screen on the first
 * pass instead of measuring and moving.
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

/** What an editor asks of the popover hosting it. */
export interface EditorOptions {
  /** A wider frame than ADR-0002's default column, in pixels. */
  readonly width?: number
}

interface Registration {
  readonly claim: EditorClaim
  readonly editor: EditorComponent
  readonly options: EditorOptions
}

const registry: Registration[] = []

/** Claim a key, or a family of keys, for an editor. Later claims win. */
export function registerEditor(
  claim: EditorClaim,
  editor: EditorComponent,
  options: EditorOptions = {},
): void {
  registry.push({ claim, editor, options })
}

function claimFor(path: string): Registration | null {
  for (let index = registry.length - 1; index >= 0; index--) {
    const registration = registry[index]
    const { claim } = registration
    if (typeof claim === 'string' ? claim === path : claim(path)) return registration
  }
  return null
}

/** The editor claiming this key, or `null` when nothing has. */
export function editorFor(path: string): EditorComponent | null {
  return claimFor(path)?.editor ?? null
}

/** The width the claiming editor asked for, or `null` for the default column. */
export function editorWidthFor(path: string): number | null {
  return claimFor(path)?.options.width ?? null
}

/** Forget every registration. Tests use it; nothing else should. */
export function clearEditors(): void {
  registry.length = 0
}
