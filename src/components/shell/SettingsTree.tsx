/**
 * The settings tree — ADR-0002 "Shell anatomy".
 *
 * Sections as dim headers, keys as `├`/`└` rows with the effective value coloured
 * by type, and the five keys the footer advertises: `/` search, `j`/`k` move,
 * `enter` edit, `d` reset, `u` undo.
 *
 * Two decisions shape the code:
 *
 * - **The focused row is the config store's `selection.key`**, not local state.
 *   The command palette jumps to a key by selecting it, and the preview will
 *   select one when a region is clicked; the tree follows either without a second
 *   channel. `j`/`k` move the selection and an effect moves the DOM focus to match.
 * - **Rows are buttons named `"<key> = <value>"`.** A screen reader hears the whole
 *   setting, and a test can ask for one the way a person would name it. `enter` and
 *   `space` on a button are a click, so opening the editor needs no key handler.
 *
 * The shortcuts are attached to the document in an effect rather than through an
 * `onKeyDown` on the panel. The panel is a container, and giving a container a
 * keyboard handler is what the a11y rules forbid; `/` has to work from anywhere in
 * the shell anyway, and the rest are scoped to events that came from inside the
 * panel — or from nowhere at all, which is where the focus sits on a fresh load.
 */
import { Panel } from '@/components/shell/Panel'
import { isBareShortcut } from '@/components/shell/keyboard'
import { diagnosticsAt, useDiagnostics } from '@/lib/diagnostics'
import { resetKey } from '@/lib/edit'
import { keysOf } from '@/lib/sections'
import { type TreeRowData, groupRows, matchesFilter } from '@/lib/tree'
import { formatValue, swatchOf, toneOf } from '@/lib/values'
import { useConfigStore } from '@/store/config'
import { anchorOf, useShellStore } from '@/store/shell'
import { useCallback, useEffect, useMemo, useRef } from 'react'

export function SettingsTree() {
  const section = useShellStore((state) => state.section)
  const filter = useShellStore((state) => state.filter)
  const setFilter = useShellStore((state) => state.setFilter)
  const openEditor = useShellStore((state) => state.openEditor)
  const selectedKey = useConfigStore((state) => state.selection.key)
  const editing = useShellStore((state) => state.editor !== null)
  const effective = useConfigStore((state) => state.effectiveAll())
  const diagnostics = useDiagnostics()

  const panelRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())

  const keys = useMemo(
    () => keysOf(section).filter((key) => matchesFilter(key, filter)),
    [section, filter],
  )
  const groups = useMemo(() => groupRows(keys, (key) => effective.get(key)), [keys, effective])

  const focused = selectedKey !== undefined && keys.includes(selectedKey) ? selectedKey : keys[0]

  // The DOM focus follows the selection, so `j`/`k` and a palette jump both land
  // the user on the row. Not while a popover is open: the popover took focus on
  // purpose, and it hands it back to this row on close.
  useEffect(() => {
    if (editing || selectedKey === undefined) return
    const row = rowRefs.current.get(selectedKey)
    if (row !== undefined && document.activeElement !== row) row.focus()
  }, [selectedKey, editing])

  const move = useCallback(
    (delta: number) => {
      if (focused === undefined) return
      const next = keys[keys.indexOf(focused) + delta]
      if (next === undefined) return
      useConfigStore.getState().select({ key: next })
    },
    [focused, keys],
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isBareShortcut(event)) return
      if (event.key === '/') {
        event.preventDefault()
        filterRef.current?.focus()
        filterRef.current?.select()
        return
      }
      // Inside the tree, or nowhere in particular. On a fresh load the focus is
      // on `body`, and a TUI whose `j` does nothing until you have clicked
      // something is not a TUI; the first `j` then moves the row and the effect
      // above pulls the focus onto it.
      const panel = panelRef.current
      const target = event.target
      const loose = target === document.body || target === document.documentElement
      if (panel === null && !loose) return
      if (!loose && (!(target instanceof Node) || panel === null || !panel.contains(target))) return
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault()
        move(1)
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault()
        move(-1)
      } else if (event.key === 'd' && focused !== undefined) {
        event.preventDefault()
        resetKey(focused)
      } else if (event.key === 'u') {
        event.preventDefault()
        useConfigStore.getState().undo()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [move, focused])

  const open = useCallback(
    (key: string) => {
      openEditor({ key, anchor: anchorOf(rowRefs.current.get(key)) })
    },
    [openEditor],
  )

  return (
    <Panel caption="settings">
      <div ref={panelRef} className="flex min-h-0 flex-1 flex-col gap-[2px] px-3 py-[14px]">
        <div className="mb-[6px] flex shrink-0 items-center gap-2 border-b border-surface0 pb-[6px]">
          <span aria-hidden="true" className="text-coral">
            /
          </span>
          <input
            ref={filterRef}
            type="search"
            aria-label="Filter settings"
            placeholder="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              setFilter('')
              event.currentTarget.blur()
            }}
            className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-overlay0 [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto">
          {groups.length === 0 && <p className="text-overlay0">no setting matches that</p>}
          {groups.map((group) => (
            <div key={group.name} className="flex flex-col gap-[2px]">
              <div className="mt-[6px] text-overlay0 first:mt-0">{group.name}</div>
              {group.rows.map((row) => (
                <TreeRow
                  key={row.key}
                  row={row}
                  focused={row.key === focused}
                  problem={diagnosticsAt(diagnostics, row.key)[0]?.message}
                  register={(element) => {
                    if (element === null) rowRefs.current.delete(row.key)
                    else rowRefs.current.set(row.key, element)
                  }}
                  onSelect={() => useConfigStore.getState().select({ key: row.key })}
                  onOpen={() => open(row.key)}
                />
              ))}
            </div>
          ))}
        </div>

        <p className="mt-[10px] shrink-0 border-t border-surface0 pt-[10px] text-overlay0">
          / search&ensp;&ensp;j k move&ensp;&ensp;enter edit
          <br />d reset to default&ensp;&ensp;u undo
        </p>
      </div>
    </Panel>
  )
}

function TreeRow({
  row,
  focused,
  problem,
  register,
  onSelect,
  onOpen,
}: {
  row: TreeRowData
  focused: boolean
  /** The first diagnostic's text, when this key has one. */
  problem: string | undefined
  register: (element: HTMLButtonElement | null) => void
  onSelect: () => void
  onOpen: () => void
}) {
  const text = formatValue(row.value)
  const swatch = swatchOf(row.key, row.value)
  return (
    <button
      ref={register}
      type="button"
      // One tab stop for the whole tree: `j`/`k` move inside it, tab leaves it.
      tabIndex={focused ? 0 : -1}
      // ADR-0002's accessible name for a row. A diagnostic rides on `title`, which
      // becomes the accessible *description*, so the name stays the setting itself.
      aria-label={`${row.key} = ${text}`}
      title={problem}
      onFocus={onSelect}
      onClick={onOpen}
      className={
        focused
          ? '-mx-3 flex items-center gap-2 bg-surface0 px-3 text-left text-text'
          : 'flex items-center gap-2 text-left text-subtext0'
      }
    >
      <span aria-hidden="true" className={focused ? 'text-coral' : 'text-transparent'}>
        {'▸'}
      </span>
      <span aria-hidden="true">{row.last ? '└' : '├'}</span>
      <span aria-hidden="true" className="min-w-0 flex-1 truncate">
        {row.label}
      </span>
      {swatch !== null && (
        <span
          aria-hidden="true"
          className="size-[10px] border border-surface1"
          // The user's own colour, not a design token — the one place a value
          // reaches the screen as a colour rather than as text.
          style={{ backgroundColor: swatch }}
        />
      )}
      <span aria-hidden="true" className={toneOf(row.key, row.value)}>
        {text}
      </span>
      {problem !== undefined && (
        <span aria-hidden="true" className="text-red">
          {'●'}
        </span>
      )}
    </button>
  )
}
