/**
 * The command palette — `ctrl+k` over every key and every action (ADR-0002).
 *
 * Jumping to a key is a *selection*, not a scroll: the palette switches to the
 * section that owns the key, clears the filter that might hide it, and selects it.
 * The tree follows the selection, moves the DOM focus onto the row and puts the
 * user exactly where `j`/`k` and `enter` already work. Nothing else has to know.
 *
 * The jump waits for the dialog to close. Selecting first would move the focus
 * onto a tree row while the dialog still has the rest of the page under
 * `aria-hidden`, which is a focus inside hidden content — Chrome logs it and a
 * screen reader would be looking at an element it has been told is not there. So
 * the key is parked, the dialog closes, and an effect does the jump afterwards.
 */
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { BLOCKED_REASON, FILE_NAME, downloadConfig } from '@/lib/download'
import { summarize, useDiagnostics } from '@/lib/diagnostics'
import { resetKey } from '@/lib/edit'
import { UI_SECTIONS, homeOf } from '@/lib/sections'
import { formatValue } from '@/lib/values'
import { allKeys } from '@/schema'
import { useConfigStore } from '@/store/config'
import { useShellStore } from '@/store/shell'
import { useEffect, useRef } from 'react'

export function CommandPalette() {
  const open = useShellStore((state) => state.paletteOpen)
  const setPaletteOpen = useShellStore((state) => state.setPaletteOpen)
  const setSection = useShellStore((state) => state.setSection)
  // Memoized on the edit map, so this is one map identity per document change.
  const effective = useConfigStore((state) => state.effectiveAll())
  const blocked = summarize(useDiagnostics()).errors > 0
  // The key a jump is waiting to land on, once the dialog is out of the way.
  const pending = useRef<string | null>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'k' || !(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      useShellStore.getState().setPaletteOpen(!useShellStore.getState().paletteOpen)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const key = pending.current
    if (open || key === null) return
    pending.current = null
    setSection(homeOf(key))
    useConfigStore.getState().select({ key })
  }, [open, setSection])

  function jumpTo(key: string) {
    pending.current = key
    setPaletteOpen(false)
  }

  function run(action: () => void) {
    action()
    setPaletteOpen(false)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setPaletteOpen}
      title="Command palette"
      description="Jump to a setting, or run a command."
      className="border border-surface1 bg-mantle"
    >
      {/* This vendored `CommandDialog` puts the dialog around its children and
          nothing else, so the cmdk root that the input and the list read their
          context from has to be supplied here. */}
      <Command className="bg-mantle">
        <CommandInput placeholder="jump to a setting, or run a command" />
        <CommandList>
          <CommandEmpty>nothing matches</CommandEmpty>

          <CommandGroup heading="actions">
            <CommandItem
              value="undo"
              onSelect={() => run(() => useConfigStore.getState().undo())}
            >
              undo
            </CommandItem>
            <CommandItem
              value="redo"
              onSelect={() => run(() => useConfigStore.getState().redo())}
            >
              redo
            </CommandItem>
            <CommandItem
              value="reset key to herdr's default"
              onSelect={() =>
                run(() => {
                  const key = useConfigStore.getState().selection.key
                  if (key !== undefined) resetKey(key)
                })
              }
            >
              reset key to herdr&rsquo;s default
            </CommandItem>
            <CommandItem
              value={`download ${FILE_NAME}`}
              disabled={blocked}
              onSelect={() => run(() => downloadConfig(FILE_NAME))}
            >
              <span>{`:w  download ${FILE_NAME}`}</span>
              {blocked && <span className="ml-auto text-overlay0">{BLOCKED_REASON}</span>}
            </CommandItem>
            {UI_SECTIONS.map((section) => (
              <CommandItem
                key={section}
                value={`switch to ${section}`}
                onSelect={() => run(() => setSection(section))}
              >
                {`switch to ${section}`}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="settings">
            {allKeys().map((key) => (
              <CommandItem key={key} value={key} onSelect={() => jumpTo(key)}>
                <span className="truncate">{key}</span>
                <span className="ml-auto text-overlay0">
                  {formatValue(effective.get(key))}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
