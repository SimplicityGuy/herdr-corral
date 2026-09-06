/**
 * Section `[3] status` and the popover the preview's tab bar opens — the
 * right-hand end of herdr's tab bar, edited as the ordered list it is.
 *
 * `ui.tab_bar_right` is one value to herdr: a list of typed entry tables read
 * whole (`isWholeValueKey`, model/export.ts), written back as inline tables the
 * way herdr's own reference spells them. So every gesture here is a move on that
 * array — `status-bar-model.ts` owns the moves, this file owns the controls —
 * and each one is written through `lib/edit.ts` as its own undo step rather than
 * held as a draft, because the preview behind the popover has to redraw as the
 * entry lands. `esc` therefore leaves rather than reverts, which is the same
 * bargain the rows editor makes for the same reason.
 *
 * ## What is on screen
 *
 * The list, and the three settings that decide where it is drawn:
 * `ui.tab_bar_right_separator` between the entries,
 * `ui.tab_bar_position` above or below the panes, and
 * `ui.hide_tab_bar_when_single_tab`. Those three are ordinary scalars, so they
 * are `Field`s — the same control the section form draws, with its label, its
 * changed dot and its reset — rather than three re-implementations of a text
 * box, a toggle group and a switch.
 *
 * The section view adds the rest of what `homeOf` calls `status`: the agent
 * status indicators and the toast settings. They are not the tab bar and they
 * get no special editor, but a section that listed them in the tree and then
 * offered nowhere to change them would be a dead end.
 *
 * ## Fields, and why an entry is never half-written
 *
 * Which fields an entry type accepts is the validator's table, read rather than
 * restated (`fieldsOf`), and a required field is written empty when the entry is
 * added: a `text` entry with no `text` key is a file herdr throws away whole,
 * where `text = ""` is one it loads and draws as nothing. An optional field left
 * empty is deleted instead, because a key herdr never saw and a key set to
 * nothing are different files.
 *
 * ## Reordering
 *
 * dnd-kit, and three keyboard paths to the same move, per ADR-0002: the sortable
 * keyboard sensor on the handle (`space`, then the arrows), `alt` with an arrow
 * on the focused handle, and the explicit move commands on every row. Focus
 * follows the entry that moved, so a held `alt` walks it up the list instead of
 * stranding the cursor where it used to be.
 */
import { Field } from '@/components/common/Field'
import { Panel } from '@/components/shell/Panel'
import { registerEditor } from '@/components/shell/editor-registry'
import {
  MAX_ENTRIES,
  TAB_BAR_RIGHT,
  type TabBarEntry,
  addEntry,
  asEntries,
  fieldsOf,
  moveEntry,
  removeEntry,
  sameEntries,
  typeOf,
  withField,
} from '@/components/editors/status-bar-model'
import { diagnosticsAt, useDiagnostics } from '@/lib/diagnostics'
import { setKey } from '@/lib/edit'
import { POPOVER_WIDE_WIDTH } from '@/lib/popover'
import { keysOf } from '@/lib/sections'
import { cn } from '@/lib/utils'
import type { TomlValue } from '@/model/parse'
import type { Diagnostic } from '@/model/validate'
import { tabBarEntryTypes } from '@/schema'
import { useConfigStore } from '@/store/config'
import { useShellStore } from '@/store/shell'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  type DraggableSyntheticListeners,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'

const SEPARATOR = 'ui.tab_bar_right_separator'
const POSITION = 'ui.tab_bar_position'
const HIDE_SINGLE = 'ui.hide_tab_bar_when_single_tab'

/** The four settings this editor claims, for the tree and the preview alike. */
const CLAIMED: ReadonlySet<string> = new Set([TAB_BAR_RIGHT, SEPARATOR, POSITION, HIDE_SINGLE])

const INPUT =
  'w-full min-w-0 border border-surface1 bg-base px-2 py-[2px] text-text outline-none focus:border-coral'

const CHIP = 'border border-surface1 bg-surface0 px-[6px] py-0 text-subtext0 hover:text-text'

/** The path one entry is addressed by, in diagnostics and in a control's name. */
function entryPath(index: number): string {
  return `${TAB_BAR_RIGHT}[${index}]`
}

/**
 * A draft that follows the store when the store moves under it.
 *
 * The same shape the keys editor uses: a field holds what is being typed, the
 * store holds what the config says, and an undo or a reset that changes the
 * second has to reach the first. Compared during render, which is React's own
 * answer to this — an effect would render the stale draft once first.
 */
function useDraft(current: string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(current)
  const [settled, setSettled] = useState(current)
  if (settled !== current) {
    setSettled(current)
    setDraft(current)
  }
  return [draft, setDraft]
}

/**
 * A key handler that runs in front of dnd-kit's rather than instead of it.
 *
 * `{...listeners}` puts the sensor's `onKeyDown` on the element; declaring one
 * after it replaces it, and the handle stops being draggable from the keyboard.
 */
function beforeSensor(
  listeners: DraggableSyntheticListeners,
  mine: (event: KeyboardEvent<HTMLElement>) => boolean,
): (event: KeyboardEvent<HTMLElement>) => void {
  return (event) => {
    if (mine(event)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    listeners?.onKeyDown?.(event)
  }
}

/** Everything herdr has to say about one entry, or one setting. */
function Messages({ diagnostics }: { diagnostics: readonly Diagnostic[] }) {
  if (diagnostics.length === 0) return null
  return (
    <ul className="flex flex-col gap-[2px]">
      {diagnostics.map((diagnostic) => (
        <li
          key={`${diagnostic.severity}:${diagnostic.path}:${diagnostic.message}`}
          className={diagnostic.severity === 'error' ? 'text-red' : 'text-yellow'}
        >
          {diagnostic.severity === 'error' ? '● ' : '▲ '}
          {diagnostic.message}
        </li>
      ))}
    </ul>
  )
}

/**
 * One field of one entry, written on `enter` or on leaving it.
 *
 * Writing per keystroke would put an undo step on the stack per character;
 * writing only on `enter` would lose what someone typed and clicked away from.
 * Emptying an optional field deletes it, and emptying a required one writes the
 * empty value — see the module note.
 */
function EntryField({
  index,
  name,
  kind,
  required,
  hint,
  value,
  onWrite,
}: {
  index: number
  name: string
  kind: 'string' | 'seconds'
  required: boolean
  hint: string
  value: TomlValue | undefined
  onWrite: (value: TomlValue | undefined) => void
}) {
  const current = value === undefined || value === null ? '' : String(value)
  const [draft, setDraft] = useDraft(current)
  const path = `${entryPath(index)}.${name}`

  function commit(next: string): void {
    if (next === current) return
    const trimmed = next.trim()
    if (kind === 'seconds') {
      if (trimmed === '') {
        onWrite(required ? 0 : undefined)
        return
      }
      const parsed = Number.parseInt(trimmed, 10)
      // A number the field cannot read is left on screen rather than written as
      // a guess: `validate()` reports what is in the file, and this is not in it.
      if (Number.isNaN(parsed)) return
      onWrite(parsed)
      return
    }
    if (next === '' && !required) {
      onWrite(undefined)
      return
    }
    onWrite(next)
  }

  return (
    <label className="flex min-w-0 flex-1 flex-col gap-[2px]">
      <span className="text-overlay0">
        {name}
        {required ? '' : ' (optional)'}
      </span>
      <input
        type="text"
        aria-label={path}
        inputMode={kind === 'seconds' ? 'numeric' : undefined}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          commit(event.currentTarget.value)
        }}
        className={INPUT}
      />
      <span className="text-overlay0">{hint}</span>
    </label>
  )
}

/** One entry: a handle, its move commands, its fields, and a remove. */
function SortableEntry({
  index,
  entry,
  count,
  diagnostics,
  onMove,
  onRemove,
  onField,
}: {
  index: number
  entry: TabBarEntry
  count: number
  diagnostics: readonly Diagnostic[]
  onMove: (to: number) => void
  onRemove: () => void
  onField: (field: string, value: TomlValue | undefined) => void
}) {
  // Destructured rather than kept as one object: oxlint's `react(refs)` rule
  // treats a variable handed to a `ref` prop as a ref, and then every other read
  // of it during render as reading a ref.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `entry:${index}`,
  })
  const path = entryPath(index)
  const type = typeOf(entry)
  const fields = fieldsOf(type)

  return (
    <li
      ref={setNodeRef}
      data-entry-index={index}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex flex-col gap-[6px] border px-[6px] py-[6px]',
        isDragging ? 'border-coral' : 'border-surface1',
      )}
    >
      <div className="flex items-center gap-[6px]">
        <button
          type="button"
          {...attributes}
          {...listeners}
          data-handle={path}
          aria-label={`drag ${path}`}
          onKeyDown={beforeSensor(listeners, (event) => {
            if (!event.altKey) return false
            if (event.key === 'ArrowUp') {
              onMove(index - 1)
              return true
            }
            if (event.key === 'ArrowDown') {
              onMove(index + 1)
              return true
            }
            return false
          })}
          className={cn(CHIP, 'border-transparent text-overlay0')}
        >
          ⠿
        </button>
        <span className="shrink-0 text-overlay0">{`${index + 1}/${count}`}</span>
        <span className="shrink-0 text-green">{type === '' ? '(no type)' : type}</span>
        <span className="ml-auto flex shrink-0 items-center gap-[4px]">
          <button
            type="button"
            aria-label={`move ${path} up`}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
            className={cn(CHIP, 'disabled:opacity-40')}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`move ${path} down`}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
            className={cn(CHIP, 'disabled:opacity-40')}
          >
            ↓
          </button>
          <button
            type="button"
            aria-label={`remove ${path}`}
            onClick={onRemove}
            className={cn(CHIP, 'hover:text-red')}
          >
            remove
          </button>
        </span>
      </div>

      {fields.length > 0 && (
        <div className="flex flex-wrap gap-[8px]">
          {fields.map((field) => (
            <EntryField
              key={field.name}
              index={index}
              name={field.name}
              kind={field.kind}
              required={field.required}
              hint={field.hint}
              value={entry[field.name]}
              onWrite={(value) => onField(field.name, value)}
            />
          ))}
        </div>
      )}

      <Messages diagnostics={diagnostics} />
    </li>
  )
}

/** The list, the add picker, and the three settings around it. */
function TabBarControls() {
  const stored = useConfigStore((state) => state.effective(TAB_BAR_RIGHT))
  const diagnostics = useDiagnostics()
  const setMode = useShellStore((state) => state.setMode)
  const entries = useMemo(() => asEntries(stored), [stored])
  const types = tabBarEntryTypes()
  const [adding, setAdding] = useState(() => types[0] ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const focusIndex = useRef<number | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)

  // The badge says DRAG while an entry is in flight, and goes back to EDIT
  // however the drag ends — including by the popover being torn down under it.
  useEffect(() => () => setMode('EDIT'), [setMode])

  // A move renumbers every row after it, so the browser drops focus. Putting it
  // back on the handle that moved is what makes a held `alt` walk an entry up
  // the list. A ref rather than state, because clearing it is not a render.
  useEffect(() => {
    const at = focusIndex.current
    if (at === null) return
    focusIndex.current = null
    frameRef.current?.querySelector<HTMLElement>(`[data-handle="${entryPath(at)}"]`)?.focus()
  })

  const sensors = useSensors(
    // A handle is a button first and a drag handle second: without a distance,
    // the click that focuses it would start a drag instead.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  /** Write a new list, unless it would be the list that is already there. */
  function write(next: readonly TabBarEntry[]): boolean {
    if (sameEntries(entries, next)) return false
    setKey(TAB_BAR_RIGHT, next as unknown as TomlValue)
    return true
  }

  function move(from: number, to: number): void {
    const target = Math.max(0, Math.min(entries.length - 1, to))
    if (target === from) return
    setMessage(null)
    // The cursor is asked to follow only a move that happened. Two adjacent
    // entries that are written identically — two `zoom`s — swap into the same
    // list, so the write is a no-op and the focus request would otherwise be
    // left behind for whatever renders next to consume.
    if (write(moveEntry(entries, from, target))) focusIndex.current = target
  }

  function add(): void {
    const outcome = addEntry(entries, adding)
    if (!outcome.ok) {
      setMessage(outcome.reason)
      return
    }
    setMessage(null)
    write(outcome.entries)
  }

  function onDragEnd(event: DragEndEvent): void {
    setMode('EDIT')
    const from = Number.parseInt(String(event.active.id).slice('entry:'.length), 10)
    const over = event.over
    if (over === null) return
    const to = Number.parseInt(String(over.id).slice('entry:'.length), 10)
    if (Number.isNaN(from) || Number.isNaN(to)) return
    move(from, to)
  }

  const full = entries.length >= MAX_ENTRIES

  return (
    <div ref={frameRef} className="flex flex-col gap-[10px]">
      <section aria-label="tab bar entries" className="flex flex-col gap-[6px]">
        <h2 className="flex items-center gap-2 border-b border-surface0 pb-[4px] text-subtext0">
          {TAB_BAR_RIGHT}
          <span className="text-overlay0">{`${entries.length}/${MAX_ENTRIES}`}</span>
        </h2>

        {entries.length === 0 && (
          <p className="text-overlay0">
            none yet — the right of the tab bar is empty until you add an entry.
          </p>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={() => setMode('DRAG')}
          onDragCancel={() => setMode('EDIT')}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={entries.map((_, index) => `entry:${index}`)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-[6px]">
              {entries.map((entry, index) => (
                <SortableEntry
                  // The index *is* the identity: `ui.tab_bar_right[i]` addresses
                  // the slot, and a move renumbers every slot after it.
                  key={entryPath(index)}
                  index={index}
                  entry={entry}
                  count={entries.length}
                  diagnostics={diagnosticsAt(diagnostics, entryPath(index))}
                  onMove={(to) => move(index, to)}
                  onRemove={() => {
                    setMessage(null)
                    write(removeEntry(entries, index))
                  }}
                  onField={(field, value) => write(withField(entries, index, field, value))}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        <div className="flex items-center gap-[6px]">
          <select
            aria-label="entry type to add"
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
            className="border border-surface1 bg-base px-2 py-[2px] text-green outline-none focus:border-coral"
          >
            {types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <button type="button" onClick={add} disabled={full} className={cn(CHIP, 'disabled:opacity-40')}>
            + add entry
          </button>
          {full && (
            <span className="text-yellow">
              {'▲ '}
              {`the bar is full at ${MAX_ENTRIES} entries; herdr ignores the extras`}
            </span>
          )}
        </div>

        {message !== null && (
          <p role="alert" className="text-yellow">
            {'▲ '}
            {message}
          </p>
        )}
        <Messages
          diagnostics={diagnostics.filter((diagnostic) => diagnostic.path === TAB_BAR_RIGHT)}
        />
      </section>

      <section aria-label="tab bar" className="flex flex-col gap-[10px]">
        <h2 className="border-b border-surface0 pb-[4px] text-subtext0">the bar itself</h2>
        <Field path={SEPARATOR} />
        <Field path={POSITION} />
        <Field path={HIDE_SINGLE} />
      </section>
    </div>
  )
}

/**
 * The popover the preview's tab bar regions and the settings tree open.
 *
 * It takes no `EditorProps`: all four keys it claims open the same controls, and
 * those read and write the store themselves, so neither the value handed in nor
 * the popover's `commit` has anything to say here. `esc` closes and what was
 * already written stays written — see the module note.
 */
export function StatusBarEditor() {
  return (
    <div className="flex flex-col gap-[6px]">
      <TabBarControls />
      <p className="text-overlay0">enter apply&ensp;&ensp;esc close</p>
    </div>
  )
}

/**
 * Section `[3] status` — the tab bar, then the rest of what the section owns.
 *
 * `keysOf('status')` is the list the tree shows for this switch, so taking the
 * four tab bar settings out of it leaves exactly the keys that would otherwise
 * have nowhere to be changed from here.
 */
export function StatusBarView() {
  const rest = useMemo(() => keysOf('status').filter((key) => !CLAIMED.has(key)), [])

  return (
    <Panel caption="status · the tab bar and what it reports">
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-3 py-[14px]">
        <TabBarControls />
        <section aria-label="other status settings" className="flex flex-col gap-[10px]">
          <h2 className="border-b border-surface0 pb-[4px] text-subtext0">indicators and toasts</h2>
          {rest.map((key) => (
            <Field key={key} path={key} />
          ))}
        </section>
      </div>
    </Panel>
  )
}

// The wider frame the rows editor introduced: an entry is a row of fields, and
// wrapping a command's three of them into ADR-0002's 360px column turns one
// entry into four lines of chrome around one input.
registerEditor((key) => CLAIMED.has(key), StatusBarEditor, { width: POPOVER_WIDE_WIDTH })
