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
 * "Exactly one of `commit` or `cancel`" is enforced rather than asked for: the
 * first of them to be called resolves the popover and every later call is ignored,
 * and an editor that is torn down having called neither has cancelled, because
 * `commit` is the only path that writes.
 *
 * **Dismissal does not depend on the editor.** The `esc` listener sits on the
 * document, not on the frame, and a pointer press outside the frame cancels too.
 * An editor with nothing focusable in it — the note shown for a value that is a
 * whole structure — is still a popover the user can leave.
 *
 * **It is placed so that all of it is on screen.** The shell is
 * `overflow-hidden`, so a popover that runs off the bottom is not scrollable —
 * it is unreachable. `placeAt` flips it above its anchor when there is no room
 * below, which it can only do knowing how tall the frame is, so the frame is
 * measured in a layout effect and placed again before the browser paints. An
 * editor with more rows than the window has is capped at `maxPopoverHeight` and
 * scrolls *inside* the frame instead, under a caption that stays put — a colour
 * palette is nineteen rows, and no anchor makes nineteen rows fit.
 *
 * Focus is trapped while it is open and returns to the element that opened it on
 * close. It lands on the editor's own `[data-autofocus]` control when there is
 * one — an editor drawing more than the key it was opened on says which row that
 * key is — and on the first focusable control otherwise. That is not decoration: the popover is anchored to a tree row the user
 * was standing on, and losing the row means losing the place in a 167-key list.
 */
import { editorFor, editorWidthFor } from '@/components/shell/editor-registry'
import { ValueEditor } from '@/components/shell/editors'
import { diagnosticsAt, useDiagnostics } from '@/lib/diagnostics'
import { setKey } from '@/lib/edit'
import { POPOVER_WIDTH, maxPopoverHeight, placeAt } from '@/lib/popover'
import type { TomlValue } from '@/model/parse'
import { useConfigStore } from '@/store/config'
import { useShellStore } from '@/store/shell'
import { createElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Everything focus can land on inside the frame. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function InlinePopover() {
  const target = useShellStore((state) => state.editor)
  const closeEditor = useShellStore((state) => state.closeEditor)
  const effective = useConfigStore((state) => state.effectiveAll())
  const diagnostics = useDiagnostics()
  const frameRef = useRef<HTMLDialogElement>(null)
  // How tall the editor turned out to be. `placeAt` needs it to keep the frame's
  // bottom on screen, and nothing knows it until the frame exists — so the first
  // pass uses the assumed height and this one corrects it before the paint.
  const [height, setHeight] = useState<number | null>(null)

  /**
   * Settle the popover once. `write` is the commit; its absence is the cancel.
   *
   * The open editor in the store is the latch: `closeEditor` clears it, so the
   * second of a `commit`/`cancel` pair finds nothing open and does nothing. That
   * is what makes "exactly one of them" a property of the host rather than a rule
   * every future editor has to remember.
   */
  const finish = useCallback(
    (write?: () => void) => {
      if (useShellStore.getState().editor === null) return
      write?.()
      closeEditor()
    },
    [closeEditor],
  )

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (frame === null) {
      setHeight(null)
      return
    }
    setHeight(frame.offsetHeight)
    // An editor can change height without the popover moving to another key —
    // the theme editor unfolds its colour overrides — and a top computed for the
    // short frame leaves the tall one hanging off the bottom of a shell that
    // does not scroll. Re-measuring is the same correction as the first pass,
    // applied whenever the content settles rather than only on open.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setHeight(frame.offsetHeight))
    observer.observe(frame)
    return () => observer.disconnect()
  }, [target])

  // Take focus on open, and hand it back on close. The restore is the effect's
  // cleanup rather than part of `finish`, so it happens however the popover goes
  // away — `esc`, an applied edit, or a section switch that clears it.
  useEffect(() => {
    if (target === null) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = frameRef.current
    // An editor that spans more than the key it was opened on says which of its
    // controls belongs to that key — the theme palette is twenty colour rows and
    // one of them is the one asked for. Otherwise the first control, and failing
    // that the frame itself, which is what keeps `esc` and `tab` working inside
    // an editor with nothing focusable in it.
    const asked = frame?.querySelector<HTMLElement>('[data-autofocus]')
    const first = asked ?? frame?.querySelector<HTMLElement>(FOCUSABLE) ?? frame
    first?.focus()
    // Focusing scrolls a control into view on its own in a browser; saying so
    // explicitly is what makes it true in a frame that scrolls its own body.
    first?.scrollIntoView({ block: 'nearest' })
    return () => opener?.focus()
  }, [target])

  // `esc` cancels from anywhere, `tab` wraps rather than escaping into the shell
  // behind, and a press outside the frame cancels. All three are on the document,
  // so none of them depends on the editor having taken focus.
  useEffect(() => {
    if (target === null) return
    function onKeyDown(event: KeyboardEvent) {
      const frame = frameRef.current
      if (frame === null) return
      if (event.key === 'Escape') {
        event.preventDefault()
        finish()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...frame.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (focusable.length === 0) {
        // Nothing to move between: keep focus on the frame rather than letting
        // tab walk into the shell the popover is sitting on top of.
        event.preventDefault()
        frame.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const edge = event.shiftKey ? first : last
      if (document.activeElement !== edge && frame.contains(document.activeElement)) return
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }
    function onPointerDown(event: PointerEvent) {
      const frame = frameRef.current
      if (frame === null || !(event.target instanceof Node)) return
      if (frame.contains(event.target)) return
      finish()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [target, finish])

  if (target === null) return null

  const path = target.key
  const caption = target.caption ?? path
  // The width is the editor's own declaration, not a measurement: a drag surface
  // has to be laid out at its real width before the first paint, or the chips
  // wrap once and then jump.
  const width = editorWidthFor(path) ?? POPOVER_WIDTH
  const { left, top } = placeAt(
    target.anchor,
    { width: window.innerWidth, height: window.innerHeight },
    height ?? undefined,
    width,
  )

  function commit(next: TomlValue) {
    finish(() => setKey(path, next))
  }

  function cancel() {
    finish()
  }

  return (
    <dialog
      ref={frameRef}
      open
      tabIndex={-1}
      aria-label={caption}
      // The cap is the same number `maxPopoverHeight` places against: a window
      // less two gaps. It is inline rather than a utility class because the two
      // have to be one fact — a class the arithmetic did not know about would
      // put the frame back off the bottom of the screen.
      style={{ left, top, width, maxHeight: maxPopoverHeight(window.innerHeight) }}
      className="fixed z-50 m-0 flex flex-col gap-[6px] border border-coral bg-mantle px-3 py-[10px] text-text shadow-[0_10px_30px_rgba(0,0,0,0.5)] outline-none"
    >
      <div className="shrink-0 text-coral">{`┤ ${caption} ├`}</div>
      {/* The caption stays; the editor scrolls under it. An editor with more
          rows than the window has is otherwise unreachable, because the shell is
          `overflow-hidden` and nothing scrolls the frame back into view. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
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
          cancel,
        })}
      </div>
    </dialog>
  )
}
