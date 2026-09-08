/**
 * The help sheet — `ctrl+b ?`, the first of the two global chords the top line
 * advertises (ADR-0002 "Shell anatomy").
 *
 * A prefix chord, as in tmux: `ctrl+b` arms a prefix, and a `?` inside the next
 * couple of seconds opens the sheet. Any other key disarms it, so a `ctrl+b`
 * pressed from habit costs nothing — and a modifier on its own does not count as
 * "another key", because `?` is shift and `/` on most layouts and the shift lands
 * first. The prefix is modified, so it works from inside a text field too; that is
 * what a prefix is for.
 *
 * The sheet is the README's cheat sheet, drawn as the tree's footer draws its
 * hints: the keys in `text`, what they do in `subtext0`. It is the one place the
 * command line is explained, which is why `:` is in the list.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PREFIX_WINDOW_MS, SHORTCUTS } from '@/lib/shortcuts'
import { useShellStore } from '@/store/shell'
import { Fragment, useEffect } from 'react'

const MODIFIERS = new Set(['Shift', 'Control', 'Meta', 'Alt'])

export function HelpDialog() {
  const open = useShellStore((state) => state.helpOpen)
  const setHelpOpen = useShellStore((state) => state.setHelpOpen)

  useEffect(() => {
    let armedUntil = 0
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'b' && (event.ctrlKey || event.metaKey)) {
        // Firefox opens its bookmarks sidebar on ctrl+b; the prefix wins.
        event.preventDefault()
        armedUntil = Date.now() + PREFIX_WINDOW_MS
        return
      }
      if (armedUntil === 0 || MODIFIERS.has(event.key)) return
      const armed = Date.now() <= armedUntil
      armedUntil = 0
      if (!armed || event.key !== '?') return
      event.preventDefault()
      const shell = useShellStore.getState()
      shell.setHelpOpen(!shell.helpOpen)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && setHelpOpen(false)}>
      <DialogContent
        showCloseButton={false}
        className="flex w-full max-w-[min(600px,calc(100%-2rem))] flex-col gap-[10px] border border-surface1 bg-mantle p-[14px] text-[13px] text-text sm:max-w-[min(600px,calc(100%-2rem))]"
      >
        <DialogHeader className="gap-[4px]">
          <DialogTitle className="text-[13px] text-text">help</DialogTitle>
          <DialogDescription className="text-[12px] text-overlay0">
            every key the shell answers to. :w and :diff are also the diagnostics line&rsquo;s
            own buttons.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-[18px] gap-y-[4px] border border-surface0 bg-base p-[10px] text-[12px] leading-[1.45]">
          {SHORTCUTS.map(([keys, does]) => (
            <Fragment key={keys}>
              <dt className="whitespace-nowrap text-text">{keys}</dt>
              <dd className="m-0 text-subtext0">{does}</dd>
            </Fragment>
          ))}
        </dl>
        <p className="text-[12px] text-overlay0">esc closes this</p>
      </DialogContent>
    </Dialog>
  )
}
