/**
 * The inline popover — ADR-0002 "Inline popover".
 *
 * `--mantle` on a coral frame with a single heavy shadow, anchored to whatever
 * opened it: a settings-tree row today, a region of the herdr preview once that
 * bead lands. The caption names the key path the way a panel caption does,
 * `┤ agents.rows[0] ├`.
 *
 * **The host owns the transaction, not the editor.** `enter` reaches the editor,
 * which calls `commit`; `esc` never reaches the editor at all — the host closes
 * and nothing is written. That is what "cancel" has to mean for an editor that has
 * been changing a draft rather than the store, and putting it here is what makes
 * it mean the same thing in every editor a later bead writes.
 *
 * Focus is trapped while it is open and returns to the element that opened it on
 * close. That is not decoration: the popover is anchored to a tree row the user
 * was standing on, and losing the row means losing the place in a 167-key list.
 */
import { editorFor } from '@/components/shell/editor-registry'
import { ValueEditor } from '@/components/shell/editors'
import { diagnosticsAt, useDiagnostics } from '@/lib/diagnostics'
import { setKey } from '@/lib/edit'
import { POPOVER_WIDTH, placeAt } from '@/lib/popover'
import type { TomlValue } from '@/model/parse'
import { useConfigStore } from '@/store/config'
import { useShellStore } from '@/store/shell'
import { createElement, useEffect, useRef } from 'react'

/** Everything focus can land on inside the frame. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function InlinePopover() {
  const target = useShellStore((state) => state.editor)
  const closeEditor = useShellStore((state) => state.closeEditor)
  const effective = useConfigStore((state) => state.effectiveAll())
  const diagnostics = useDiagnostics()
  const frameRef = useRef<HTMLDialogElement>(null)

  // Take focus on open, and hand it back on close. The restore is the effect's
  // cleanup rather than part of `close`, so it happens however the popover goes
  // away — `esc`, an applied edit, or a section switch that clears it.
  useEffect(() => {
    if (target === null) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    frameRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    return () => opener?.focus()
  }, [target])

  // `esc` cancels; `tab` wraps rather than escaping into the shell behind.
  useEffect(() => {
    const frame = frameRef.current
    if (target === null || frame === null) return
    function onKeyDown(event: KeyboardEvent) {
      if (frame === null) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeEditor()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...frame.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const edge = event.shiftKey ? first : last
      if (document.activeElement !== edge) return
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }
    frame.addEventListener('keydown', onKeyDown)
    return () => frame.removeEventListener('keydown', onKeyDown)
  }, [target, closeEditor])

  if (target === null) return null

  const path = target.key
  const caption = target.caption ?? path
  const { left, top } = placeAt(target.anchor, {
    width: window.innerWidth,
    height: window.innerHeight,
  })

  function commit(next: TomlValue) {
    setKey(path, next)
    closeEditor()
  }

  return (
    <dialog
      ref={frameRef}
      open
      aria-label={caption}
      style={{ left, top, width: POPOVER_WIDTH }}
      className="fixed z-50 m-0 flex flex-col gap-[6px] border border-coral bg-mantle px-3 py-[10px] text-text shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
    >
      <div className="text-coral">{`┤ ${caption} ├`}</div>
      {/* The editor is looked up, not written here, so it is built with
          `createElement`: which component renders is data — see editor-registry.
          The `key` remounts it when the popover moves to another setting, so a
          draft never survives into a different key's form. */}
      {createElement(editorFor(path) ?? ValueEditor, {
        key: path,
        path,
        value: effective.get(path),
        diagnostics: diagnosticsAt(diagnostics, path),
        commit,
        cancel: closeEditor,
      })}
    </dialog>
  )
}
