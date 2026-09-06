/**
 * The sidebar rows editor — the drag surface of ADR-0002.
 *
 * `ui.sidebar.agents.rows`, `ui.sidebar.spaces.rows` and every
 * `ui.sidebar.agents.rows_by_agent.<id>` override are the same value in three
 * places: a list of rows, each a list of token entries. One editor claims all of
 * them and switches between them with the chip strip at the top, because the
 * gesture is identical and an agent override is meant to be read against the
 * default it replaces.
 *
 * ## It writes as you go
 *
 * Every other editor in the shell holds a draft and hands it to `commit`. This
 * one writes through the store on each move, and that is deliberate: the point of
 * the surface is that the herdr preview behind the popover redraws as the token
 * lands, and a draft cannot do that. `esc` therefore leaves rather than reverts —
 * the moves are already in the document, each its own undo step, which is the
 * same bargain the tree makes when it applies a value.
 *
 * It follows that `commit` is never called here. The popover's contract is that
 * an editor calls exactly one of `commit` or `cancel`, and `cancel` is the one
 * this editor means: it has changed the store itself and has nothing left to hand
 * over. `esc` during a drag is therefore safe — the popover closes, the drag dies
 * with it, and nothing was written, which is what cancelling a drag should do.
 *
 * ## Every drag has a keyboard equivalent
 *
 * Three of them, in fact, because a drag surface reachable only by pointer fails
 * ADR-0002's keyboard bar:
 *
 * - dnd-kit's keyboard sensor, so `space` picks a chip up and the arrow keys move
 *   it, exactly as the pointer would;
 * - `alt` with an arrow key on a focused chip or row handle, which moves it one
 *   place without entering a drag at all;
 * - the explicit `move left` / `right` / `up` / `down` buttons in the strip below
 *   the rows, for the token that is selected.
 *
 * Focus follows the thing that moved, so holding `alt` and tapping an arrow walks
 * a token across the layout rather than moving it once and stranding the cursor.
 * Both key handlers run *before* dnd-kit's own, and hand the event on when they
 * do not claim it — spreading the sensor's listeners and then declaring
 * `onKeyDown` would replace the sensor rather than sit in front of it.
 *
 * ## The caps
 *
 * herdr refuses a whole config file over a 17th row or a 17th token in a row, so
 * the editor refuses the move instead and says why on the line under the rows.
 * The rule itself lives in `rows-model.ts` with the rest of the arithmetic.
 */
import {
  MAX_ROWS,
  MAX_TOKENS_PER_ROW,
  type Direction,
  type Outcome,
  type RowEntry,
  type TokenAt,
  type TokenStyle,
  addRow,
  asRows,
  customToken,
  insertToken,
  isStyled,
  moveRow,
  moveToken,
  nudgeRow,
  nudgeToken,
  removeRow,
  removeToken,
  replaceToken,
  sameRows,
  styleOf,
  tokenNameOf,
  withStyle,
} from '@/components/editors/rows-model'
import { FALLBACK_THEME, resolvePalette } from '@/components/preview/tokens'
import { type EditorProps, registerEditor } from '@/components/shell/editor-registry'
import { resetKey, setKey } from '@/lib/edit'
import { POPOVER_WIDE_WIDTH } from '@/lib/popover'
import { cn } from '@/lib/utils'
import type { TomlValue } from '@/model/parse'
import { CANONICAL_AGENT_IDS, canonicalThemeName, isHexColor } from '@/model/validate'
import { sidebarTokenBuiltins, themeTokens } from '@/schema'
import { useConfigStore } from '@/store/config'
import { useShellStore } from '@/store/shell'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DraggableSyntheticListeners,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

const AGENTS_ROWS = 'ui.sidebar.agents.rows'
const SPACES_ROWS = 'ui.sidebar.spaces.rows'
const ROWS_BY_AGENT = 'ui.sidebar.agents.rows_by_agent'

/** Which sidebar panel a path belongs to: the two have different built-in tokens. */
function kindOf(path: string): 'agents' | 'spaces' {
  return path === SPACES_ROWS ? 'spaces' : 'agents'
}

/** The agent an override path names, or `null` for a panel default. */
function agentOf(path: string): string | null {
  return path.startsWith(`${ROWS_BY_AGENT}.`) ? path.slice(ROWS_BY_AGENT.length + 1) : null
}

/** True when this editor claims the key. Both the tree and the preview use it. */
function claims(path: string): boolean {
  return (
    path === AGENTS_ROWS ||
    path === SPACES_ROWS ||
    path === ROWS_BY_AGENT ||
    path.startsWith(`${ROWS_BY_AGENT}.`)
  )
}

/** What is being dragged, carried on the dnd-kit item's `data`. */
type DragData =
  | { readonly kind: 'token'; readonly row: number; readonly index: number }
  | { readonly kind: 'row'; readonly index: number }
  | { readonly kind: 'rowdrop'; readonly row: number }
  | { readonly kind: 'palette'; readonly token: string }

const FIELD =
  'border border-surface1 bg-base px-2 py-[2px] text-text outline-none focus:border-coral'

const CHIP = 'border px-[6px] py-0 text-left outline-none focus:border-coral'

/** The end of a row, wherever that turns out to be. `insert` clamps it. */
const END = Number.MAX_SAFE_INTEGER

/** The arrow keys, as the model spells the directions. */
const ARROWS: Readonly<Record<string, Direction>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

export function RowsEditor({ path, value, diagnostics, cancel }: EditorProps) {
  const kind = kindOf(path)
  const effective = useConfigStore((state) => state.effectiveAll())
  const setMode = useShellStore((state) => state.setMode)

  // Which of the three values is on screen: the panel default, or one agent's
  // override. The path the popover opened on decides where it starts.
  const [agent, setAgent] = useState<string | null>(() => agentOf(path))
  const [message, setMessage] = useState<string | null>(null)
  const [selected, setSelected] = useState<TokenAt | null>(null)
  const [activeRow, setActiveRow] = useState(0)
  const [custom, setCustom] = useState('')
  const [hex, setHex] = useState('')
  const focusAt = useRef<TokenAt | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)

  const defaultPath = kind === 'spaces' ? SPACES_ROWS : AGENTS_ROWS
  const targetPath = agent === null ? defaultPath : `${ROWS_BY_AGENT}.${agent}`

  const stored = effective.get(targetPath) ?? (targetPath === path ? value : undefined)
  const rows = useMemo(() => asRows(stored), [stored])

  const overrides = useMemo(() => {
    const table = effective.get(ROWS_BY_AGENT)
    if (typeof table !== 'object' || table === null || Array.isArray(table)) return []
    return Object.keys(table as Record<string, TomlValue>).sort()
  }, [effective])

  const palette = useMemo(() => {
    const slots: Record<string, TomlValue | undefined> = {}
    for (const slot of themeTokens()) slots[slot] = effective.get(`theme.custom.${slot}`)
    const name = effective.get('theme.name')
    return resolvePalette({
      theme: canonicalThemeName(typeof name === 'string' ? name : '') ?? FALLBACK_THEME,
      custom: slots,
      accent: effective.get('ui.accent'),
    })
  }, [effective])

  // The badge says DRAG while something is in flight, and goes back to EDIT
  // however the drag ends — including by the popover being torn down under it,
  // which is what `esc` mid-drag does.
  useEffect(() => () => setMode('EDIT'), [setMode])

  // A move renumbers every chip after it, so the browser drops focus. Putting it
  // back on the chip that moved is what makes a held `alt` walk a token across
  // the layout instead of moving it once. The request is a ref rather than state
  // because clearing it is not a render: the effect runs after every commit and
  // acts only when a move has left something for it to do.
  useEffect(() => {
    const at = focusAt.current
    if (at === null) return
    focusAt.current = null
    const selector = `[data-dnd-id="tok:${at.row}:${at.index}"] button`
    frameRef.current?.querySelector<HTMLElement>(selector)?.focus()
  })

  const write = useCallback(
    (next: RowEntry[][]) => {
      if (sameRows(rows, next)) return
      setKey(targetPath, next as TomlValue)
    },
    [rows, targetPath],
  )

  /** Apply a move, or show what stopped it. */
  const apply = useCallback(
    (outcome: Outcome, focus?: TokenAt) => {
      if (!outcome.ok) {
        setMessage(outcome.reason)
        return
      }
      setMessage(null)
      write(outcome.rows)
      if (focus !== undefined) {
        focusAt.current = focus
        setSelected(focus)
      }
    },
    [write],
  )

  /**
   * Move one token one place, and take the cursor with it.
   *
   * Where the token lands is arithmetic the model has already agreed to, so this
   * repeats it rather than asking: the outcome says the move is legal, and these
   * are the coordinates it made legal.
   */
  const nudge = useCallback(
    (at: TokenAt, direction: Direction) => {
      const outcome = nudgeToken(rows, at, direction)
      if (!outcome.ok) {
        setMessage(outcome.reason)
        return
      }
      if (direction === 'left' || direction === 'right') {
        apply(outcome, { row: at.row, index: at.index + (direction === 'left' ? -1 : 1) })
        return
      }
      const row = at.row + (direction === 'up' ? -1 : 1)
      apply(outcome, { row, index: Math.min(at.index, rows[row].length) })
    },
    [apply, rows],
  )

  /**
   * Nothing is under the pointer once it has left the popover.
   *
   * `closestCenter` answers the nearest droppable however far away it is, which
   * is what you want inside the frame and exactly wrong outside it: carrying a
   * token off the popover is how a pointer says "take this out", and a nearest
   * neighbour would put it back instead. A keyboard drag reports no pointer at
   * all, so it can never remove a token by accident.
   */
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const point = args.pointerCoordinates
    const frame = frameRef.current?.getBoundingClientRect()
    if (
      point !== null &&
      frame !== undefined &&
      (point.x < frame.left || point.x > frame.right || point.y < frame.top || point.y > frame.bottom)
    ) {
      return []
    }
    return closestCenter(args)
  }, [])

  const sensors = useSensors(
    // A chip is a button first and a drag handle second: without a distance, the
    // click that selects it for styling would start a drag instead.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragEnd(event: DragEndEvent) {
    setMode('EDIT')
    const from = event.active.data.current as DragData | undefined
    if (from === undefined) return
    const over = event.over?.data.current as DragData | undefined

    // Dropped on nothing: the token was carried off the popover, which is how a
    // pointer says "take this out".
    if (over === undefined) {
      if (from.kind === 'token') apply(removeToken(rows, from))
      return
    }

    const targetRow =
      over.kind === 'token'
        ? over.row
        : over.kind === 'rowdrop'
          ? over.row
          : over.kind === 'row'
            ? over.index
            : null
    if (targetRow === null) return
    const targetIndex = over.kind === 'token' ? over.index : END

    if (from.kind === 'row') {
      apply(moveRow(rows, from.index, targetRow))
      return
    }
    if (from.kind === 'token') {
      apply(moveToken(rows, from, { row: targetRow, index: targetIndex }))
      return
    }
    if (from.kind === 'palette') {
      apply(insertToken(rows, { row: targetRow, index: targetIndex }, from.token))
    }
  }

  function addToken(token: string) {
    if (rows.length === 0) {
      const seeded = addRow(rows)
      if (!seeded.ok) {
        setMessage(seeded.reason)
        return
      }
      apply(insertToken(seeded.rows, { row: 0, index: END }, token))
      return
    }
    apply(insertToken(rows, { row: Math.min(activeRow, rows.length - 1), index: END }, token))
  }

  function styleSelected(next: TokenStyle) {
    if (selected === null) return
    const entry = rows[selected.row]?.[selected.index]
    if (entry === undefined) return
    apply(replaceToken(rows, selected, withStyle(entry, next)))
  }

  const selectedEntry = selected === null ? undefined : rows[selected.row]?.[selected.index]
  const selectedStyle = selectedEntry === undefined ? {} : styleOf(selectedEntry)

  const swatches = useMemo(
    () =>
      themeTokens()
        .map((slot) => [slot, palette[slot]] as const)
        .filter(([, color]) => typeof color === 'string' && isHexColor(color)),
    [palette],
  )

  return (
    <div ref={frameRef} data-dnd-id="frame" className="flex flex-col gap-[6px]">
      {kind === 'agents' && (
        <TargetStrip
          agent={agent}
          overrides={overrides}
          onPick={(next) => {
            setAgent(next)
            setSelected(null)
            setActiveRow(0)
            setMessage(null)
          }}
          onAdd={(id) => {
            setKey(`${ROWS_BY_AGENT}.${id}`, asRows(effective.get(AGENTS_ROWS)) as TomlValue)
            setAgent(id)
            setSelected(null)
            setActiveRow(0)
            setMessage(null)
          }}
          onRemove={(id) => {
            resetKey(`${ROWS_BY_AGENT}.${id}`)
            setAgent(null)
            setSelected(null)
            setActiveRow(0)
            setMessage(null)
          }}
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={() => setMode('DRAG')}
        onDragCancel={() => setMode('EDIT')}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={rows.map((_, index) => `row:${index}`)}
          strategy={verticalListSortingStrategy}
        >
          <ul aria-label={`${targetPath} rows`} className="flex flex-col gap-[2px]">
            {rows.map((row, index) => (
              <SortableRow
                // Rows are positional and their contents may repeat, so the
                // position is the identity — the rule the preview uses too.
                key={index}
                index={index}
                row={row}
                count={rows.length}
                active={index === activeRow}
                selected={selected}
                onFocusRow={() => setActiveRow(index)}
                onSelect={(at) => {
                  setSelected(at)
                  setActiveRow(at.row)
                }}
                onNudgeToken={nudge}
                onNudgeRow={(direction) => apply(nudgeRow(rows, index, direction))}
                onRemoveRow={() => {
                  setSelected(null)
                  apply(removeRow(rows, index))
                }}
              />
            ))}
          </ul>
        </SortableContext>

        <div className="flex items-center gap-[8px]">
          <button
            type="button"
            onClick={() => apply(addRow(rows))}
            className={cn(CHIP, 'border-surface1 bg-surface0 text-text')}
          >
            + row
          </button>
          <span className="text-overlay0">{`${rows.length}/${MAX_ROWS} rows`}</span>
        </div>

        <Palette
          kind={kind}
          row={rows.length === 0 ? 1 : Math.min(activeRow, rows.length - 1) + 1}
          custom={custom}
          onCustom={setCustom}
          onAdd={addToken}
        />
      </DndContext>

      {selected !== null && selectedEntry !== undefined ? (
        <StyleStrip
          name={tokenNameOf(selectedEntry)}
          at={selected}
          style={selectedStyle}
          swatches={swatches}
          hex={hex}
          onHex={setHex}
          onStyle={styleSelected}
          onMove={(direction) => nudge(selected, direction)}
          onRemove={() => {
            const at = selected
            setSelected(null)
            apply(removeToken(rows, at))
          }}
        />
      ) : (
        <p className="text-overlay0">
          pick a token to style it&ensp;&ensp;space picks one up, arrows move it
        </p>
      )}

      {/* dnd-kit puts its own live region on the page, so this one is named:
          "the editor's line" has to be answerable without counting regions. */}
      <output
        aria-label="editor message"
        className={message === null ? 'text-overlay0' : 'text-yellow'}
      >
        {message ?? `${MAX_ROWS} rows of ${MAX_TOKENS_PER_ROW} tokens is herdr's ceiling`}
      </output>

      {diagnostics.length > 0 && (
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
      )}

      <div className="flex items-center gap-[8px]">
        <button type="button" onClick={cancel} className="bg-surface0 px-2 text-text">
          esc close
        </button>
        <span className="text-overlay0">every move is applied as you make it</span>
      </div>
    </div>
  )
}

/** The chip row that picks between the panel default and the agent overrides. */
function TargetStrip({
  agent,
  overrides,
  onPick,
  onAdd,
  onRemove,
}: {
  agent: string | null
  overrides: readonly string[]
  onPick: (agent: string | null) => void
  onAdd: (agent: string) => void
  onRemove: (agent: string) => void
}) {
  const available = CANONICAL_AGENT_IDS.filter((id) => !overrides.includes(id))
  const [pick, setPick] = useState('')
  const chosen = available.includes(pick) ? pick : (available[0] ?? '')

  return (
    <div className="flex flex-col gap-[4px]">
      <ul aria-label="rows shown" className="flex flex-wrap items-center gap-[4px]">
        <li>
          <button
            type="button"
            aria-pressed={agent === null}
            onClick={() => onPick(null)}
            className={cn(
              CHIP,
              agent === null ? 'border-coral text-coral' : 'border-surface1 text-subtext0',
            )}
          >
            default
          </button>
        </li>
        {overrides.map((id) => (
          <li key={id}>
            <button
              type="button"
              aria-pressed={agent === id}
              onClick={() => onPick(id)}
              className={cn(
                CHIP,
                agent === id ? 'border-coral text-coral' : 'border-surface1 text-subtext0',
              )}
            >
              {id}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-[4px]">
        <select
          aria-label="agent to override"
          value={chosen}
          onChange={(event) => setPick(event.target.value)}
          disabled={available.length === 0}
          className={FIELD}
        >
          {available.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={chosen === ''}
          onClick={() => onAdd(chosen)}
          className={cn(CHIP, 'border-surface1 bg-surface0 text-text disabled:text-overlay0')}
        >
          add override
        </button>
        {agent !== null && (
          <button
            type="button"
            onClick={() => onRemove(agent)}
            className={cn(CHIP, 'border-surface1 text-red')}
          >
            {`remove the ${agent} override`}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * A key handler that runs in front of dnd-kit's rather than instead of it.
 *
 * `{...listeners}` puts the sensor's `onKeyDown` on the element; declaring one
 * after it replaces it, and the chip stops being draggable from the keyboard.
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

/** One row: a drag handle, its move commands, and the tokens in it. */
function SortableRow({
  index,
  row,
  count,
  active,
  selected,
  onFocusRow,
  onSelect,
  onNudgeToken,
  onNudgeRow,
  onRemoveRow,
}: {
  index: number
  row: readonly RowEntry[]
  count: number
  active: boolean
  selected: TokenAt | null
  onFocusRow: () => void
  onSelect: (at: TokenAt) => void
  onNudgeToken: (at: TokenAt, direction: Direction) => void
  onNudgeRow: (direction: 'up' | 'down') => void
  onRemoveRow: () => void
}) {
  // Destructured rather than kept as one object: oxlint's `react(refs)` rule
  // treats a variable handed to a `ref` prop as a ref, and then every other read
  // of it during render as reading a ref.
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: `row:${index}`,
    data: { kind: 'row', index },
  })
  const { setNodeRef: setDropRef } = useDroppable({
    id: `rowdrop:${index}`,
    data: { kind: 'rowdrop', row: index },
  })
  const label = `row ${index + 1}`

  return (
    <li
      ref={setNodeRef}
      data-dnd-id={`row:${index}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'flex items-start gap-[6px] border px-[4px] py-[2px]',
        active ? 'border-surface1' : 'border-transparent',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`drag ${label}`}
        onFocus={onFocusRow}
        onKeyDown={beforeSensor(listeners, (event) => {
          const direction = ARROWS[event.key]
          if (!event.altKey || (direction !== 'up' && direction !== 'down')) return false
          onNudgeRow(direction)
          return true
        })}
        className={cn(CHIP, 'border-transparent text-overlay0 hover:text-text')}
      >
        ⠿
      </button>
      <span className="w-[36px] shrink-0 text-overlay0">{`${index + 1}/${count}`}</span>

      <SortableContext
        items={row.map((_, at) => `tok:${index}:${at}`)}
        strategy={horizontalListSortingStrategy}
      >
        <ul
          ref={setDropRef}
          data-dnd-id={`rowdrop:${index}`}
          aria-label={`${label} tokens`}
          className="flex min-h-[18px] min-w-[40px] flex-1 flex-wrap items-center gap-[4px]"
        >
          {row.length === 0 && <li className="text-overlay0">empty</li>}
          {row.map((entry, at) => (
            <SortableToken
              key={at}
              row={index}
              index={at}
              entry={entry}
              label={label}
              selected={selected?.row === index && selected.index === at}
              onSelect={() => onSelect({ row: index, index: at })}
              onNudge={(direction) => onNudgeToken({ row: index, index: at }, direction)}
            />
          ))}
        </ul>
      </SortableContext>

      <button
        type="button"
        aria-label={`move ${label} up`}
        onClick={() => onNudgeRow('up')}
        className={cn(CHIP, 'border-transparent text-subtext0 hover:text-text')}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={`move ${label} down`}
        onClick={() => onNudgeRow('down')}
        className={cn(CHIP, 'border-transparent text-subtext0 hover:text-text')}
      >
        ↓
      </button>
      <button
        type="button"
        aria-label={`remove ${label}`}
        onClick={onRemoveRow}
        className={cn(CHIP, 'border-transparent text-red')}
      >
        ✕
      </button>
    </li>
  )
}

/** One token chip: a drag handle that is also the thing you click to style it. */
function SortableToken({
  row,
  index,
  entry,
  label,
  selected,
  onSelect,
  onNudge,
}: {
  row: number
  index: number
  entry: RowEntry
  label: string
  selected: boolean
  onSelect: () => void
  onNudge: (direction: Direction) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: `tok:${row}:${index}`,
    data: { kind: 'token', row, index },
  })
  const name = tokenNameOf(entry)
  const styled = isStyled(entry)

  return (
    <li
      ref={setNodeRef}
      data-dnd-id={`tok:${row}:${index}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`${name} in ${label}, token ${index + 1}`}
        aria-pressed={selected}
        data-styled={styled ? 'true' : undefined}
        onFocus={onSelect}
        onClick={onSelect}
        onKeyDown={beforeSensor(listeners, (event) => {
          const direction = ARROWS[event.key]
          if (!event.altKey || direction === undefined) return false
          onNudge(direction)
          return true
        })}
        className={cn(
          CHIP,
          'bg-base',
          selected ? 'border-coral text-coral' : 'border-surface1 text-text',
          styled && 'italic',
        )}
      >
        {styled ? `${name}*` : name}
      </button>
    </li>
  )
}

/** The tokens that can be added: the panel's built-ins, plus a custom `$name`. */
function Palette({
  kind,
  row,
  custom,
  onCustom,
  onAdd,
}: {
  kind: 'agents' | 'spaces'
  row: number
  custom: string
  onCustom: (value: string) => void
  onAdd: (token: string) => void
}) {
  function addCustom() {
    const token = customToken(custom)
    if (token === '') return
    onAdd(token)
    onCustom('')
  }

  return (
    <div className="flex flex-col gap-[4px] border-t border-surface0 pt-[6px]">
      <p className="text-overlay0">
        {`palette — a click adds to row ${row}, a drag drops where you let go`}
      </p>
      <ul aria-label="token palette" className="flex flex-wrap gap-[4px]">
        {sidebarTokenBuiltins(kind).map((token) => (
          <PaletteToken key={token} token={token} onAdd={onAdd} />
        ))}
      </ul>
      <div className="flex items-center gap-[4px]">
        <input
          aria-label="custom token name"
          value={custom}
          placeholder="$ticket"
          onChange={(event) => onCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            addCustom()
          }}
          className={cn(FIELD, 'min-w-0 flex-1')}
        />
        <button
          type="button"
          onClick={addCustom}
          className={cn(CHIP, 'shrink-0 border-surface1 bg-surface0 text-text')}
        >
          add custom token
        </button>
      </div>
    </div>
  )
}

function PaletteToken({ token, onAdd }: { token: string; onAdd: (token: string) => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `pal:${token}`,
    data: { kind: 'palette', token },
  })
  return (
    <li
      ref={setNodeRef}
      data-dnd-id={`pal:${token}`}
      style={{ transform: CSS.Transform.toString(transform) }}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`add ${token}`}
        onClick={() => onAdd(token)}
        className={cn(CHIP, 'border-surface1 bg-mantle text-subtext0 hover:text-text')}
      >
        {token}
      </button>
    </li>
  )
}

/** Everything you can do to the token that is selected. */
function StyleStrip({
  name,
  at,
  style,
  swatches,
  hex,
  onHex,
  onStyle,
  onMove,
  onRemove,
}: {
  name: string
  at: TokenAt
  style: TokenStyle
  swatches: readonly (readonly [string, string])[]
  hex: string
  onHex: (value: string) => void
  onStyle: (style: TokenStyle) => void
  onMove: (direction: Direction) => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-col gap-[4px] border-t border-surface0 pt-[6px]">
      <p className="text-subtext0">
        {`${name} — row ${at.row + 1}, token ${at.index + 1}`}
        {style.fg !== undefined && <span className="text-overlay0">{`  fg ${style.fg}`}</span>}
      </p>

      <ul aria-label="token colour" className="flex flex-wrap items-center gap-[4px]">
        <li>
          <button
            type="button"
            aria-pressed={style.fg === undefined}
            onClick={() => onStyle({ ...style, fg: undefined })}
            className={cn(
              CHIP,
              style.fg === undefined ? 'border-coral text-coral' : 'border-surface1 text-subtext0',
            )}
          >
            contextual default
          </button>
        </li>
        {swatches.map(([slot, color]) => (
          <li key={slot}>
            <button
              type="button"
              aria-label={`fg ${slot} ${color}`}
              aria-pressed={style.fg === color}
              onClick={() => onStyle({ ...style, fg: color })}
              style={{ background: color }}
              className={cn(
                'block size-[13px] border outline-none focus:border-coral',
                style.fg === color ? 'border-coral' : 'border-surface1',
              )}
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-[6px]">
        <input
          aria-label="fg hex"
          value={hex}
          placeholder="#89b4fa"
          onChange={(event) => onHex(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            if (isHexColor(hex)) onStyle({ ...style, fg: hex.trim() })
          }}
          className={cn(FIELD, 'w-[92px]')}
        />
        <button
          type="button"
          disabled={!isHexColor(hex)}
          onClick={() => onStyle({ ...style, fg: hex.trim() })}
          className={cn(CHIP, 'border-surface1 bg-surface0 text-text disabled:text-overlay0')}
        >
          set fg
        </button>
        <label className="flex items-center gap-[4px]">
          <input
            type="checkbox"
            checked={style.bold === true}
            onChange={(event) => onStyle({ ...style, bold: event.target.checked })}
            className="size-[13px] accent-coral"
          />
          <span className={style.bold === true ? 'text-text' : 'text-overlay0'}>bold</span>
        </label>
        <label className="flex items-center gap-[4px]">
          <input
            type="checkbox"
            checked={style.dim === true}
            onChange={(event) => onStyle({ ...style, dim: event.target.checked })}
            className="size-[13px] accent-coral"
          />
          <span className={style.dim === true ? 'text-text' : 'text-overlay0'}>dim</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-[4px]">
        {(['left', 'right', 'up', 'down'] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            onClick={() => onMove(direction)}
            className={cn(CHIP, 'border-surface1 text-subtext0 hover:text-text')}
          >
            {`move ${direction}`}
          </button>
        ))}
        <button type="button" onClick={onRemove} className={cn(CHIP, 'border-surface1 text-red')}>
          remove token
        </button>
      </div>
    </div>
  )
}

// The preview's agents and spaces regions open the first key they list, and the
// tree lists all three; one claim covers every way in.
registerEditor(claims, RowsEditor, { width: POPOVER_WIDE_WIDTH })
