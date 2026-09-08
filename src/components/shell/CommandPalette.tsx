/**
 * The command palette — `ctrl+k` over every key and every action (ADR-0002).
 *
 * It is also the command line. A bare `:` opens it with the colon already typed,
 * so `:w` and `:diff` — the two verbs the diagnostics line prints — are `:`, the
 * verb, enter, exactly as a vi user's fingers expect. The palette's own entries
 * carry the verbs in their values, so the filter lands on the right one and enter
 * runs it; nothing here parses a command string.
 *
 * Jumping to a key is a *selection*, not a scroll: the palette switches to the
 * section that owns the key, clears the filter that might hide it, and selects it.
 * The tree follows the selection, moves the DOM focus onto the row and puts the
 * user exactly where `j`/`k` and `enter` already work. Nothing else has to know.
 *
 * The jump waits for the dialog to be *gone*, which is later than it sounds.
 * Selecting first would move the focus onto a tree row while the dialog still has
 * the rest of the page under `aria-hidden`, which is a focus inside hidden content
 * — Chrome logs "Blocked aria-hidden on an element…" and a screen reader would be
 * looking at an element it has been told is not there. Watching the `open` flag is
 * not enough: it flips at the *start* of the exit animation and Radix keeps the
 * attribute on until the content unmounts at the end of it, so an effect keyed on
 * `open` still lands inside the hidden window. The key is parked instead, and
 * `OnTeardown` — mounted inside the dialog, so it dies with it — does the jump one
 * microtask after that unmount, by which point the attribute is off the page.
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
import { BLOCKED_REASON, FILE_NAME } from '@/lib/download'
import { summarize, useDiagnostics } from '@/lib/diagnostics'
import { resetKey } from '@/lib/edit'
import { UI_SECTIONS, homeOf } from '@/lib/sections'
import { formatValue } from '@/lib/values'
import { allKeys } from '@/schema'
import { isBareShortcut } from '@/components/shell/keyboard'
import { useConfigStore } from '@/store/config'
import { useShellStore } from '@/store/shell'
import { useEffect, useRef, useState } from 'react'

/**
 * Runs `on` when it is unmounted, one microtask later.
 *
 * Mounted inside the dialog content, so its teardown is the dialog's: React has
 * finished deleting the subtree and Radix's `aria-hidden` cleanup has run by the
 * time the microtask drains. `on` is held in a ref because the cleanup must not be
 * re-registered when the callback identity changes mid-render.
 */
function OnTeardown({ on }: { on: () => void }) {
  const latest = useRef(on)
  useEffect(() => {
    latest.current = on
  })
  useEffect(
    () => () => {
      queueMicrotask(() => latest.current())
    },
    [],
  )
  return null
}

/**
 * The search box, starting on whatever the shell seeded — `':'` for the command
 * line, nothing for `ctrl+k`. The dialog unmounts its content when it shuts, so
 * this mounts fresh on every open and the seed is read once, as an initial value.
 */
function SeededInput({ seed }: { readonly seed: string }) {
  const [query, setQuery] = useState(seed)
  return (
    <CommandInput
      value={query}
      onValueChange={setQuery}
      placeholder="jump to a setting, or run a command"
    />
  )
}

export function CommandPalette() {
  const open = useShellStore((state) => state.paletteOpen)
  const seed = useShellStore((state) => state.paletteSeed)
  const setPaletteOpen = useShellStore((state) => state.setPaletteOpen)
  const setSection = useShellStore((state) => state.setSection)
  // Memoized on the edit map, so this is one map identity per document change.
  const effective = useConfigStore((state) => state.effectiveAll())
  const blocked = summarize(useDiagnostics()).errors > 0
  // The key a jump is waiting to land on, once the dialog is out of the way.
  const pending = useRef<string | null>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const shell = useShellStore.getState()
      if (event.key === 'k' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        shell.setPaletteOpen(!shell.paletteOpen)
        return
      }
      // `:` is the command line. Bare, like `1`–`6`: a colon typed into a value
      // field is a colon.
      if (event.key === ':' && isBareShortcut(event) && !shell.paletteOpen) {
        event.preventDefault()
        shell.openPalette(':')
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function land() {
    const key = pending.current
    if (key === null) return
    pending.current = null
    setSection(homeOf(key))
    useConfigStore.getState().select({ key })
  }

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
        <OnTeardown on={land} />
        <SeededInput seed={seed} />
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
            {/* `:w` and `:diff` are in the values, not just the labels, because
                cmdk scores the value and the user types the verb they see on the
                diagnostics line. */}
            <CommandItem
              value={`:w download ${FILE_NAME}`}
              disabled={blocked}
              onSelect={() => run(() => useShellStore.getState().openExport('file'))}
            >
              <span>{`:w  download ${FILE_NAME}`}</span>
              {blocked && <span className="ml-auto text-overlay0">{BLOCKED_REASON}</span>}
            </CommandItem>
            {/* Never disabled, and the whole point of that: with an error standing
                the write door is shut, and this is how the user reaches the dialog
                that names what is wrong. */}
            <CommandItem
              value=":diff review the changes"
              onSelect={() => run(() => useShellStore.getState().openExport('diff'))}
            >
              {':diff  review the changes'}
            </CommandItem>
            <CommandItem
              value="help keyboard shortcuts"
              onSelect={() => run(() => useShellStore.getState().setHelpOpen(true))}
            >
              {'help  keyboard shortcuts'}
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
