/**
 * Section `[4] keys` — every keybinding herdr has, on one screen.
 *
 * The reference page lists every `[keys]` setting as one flat run. That is the
 * wrong shape for a person looking for the key that splits a pane, so the rows
 * are grouped by what they act on (`src/lib/keybindings.ts` owns the claims) and
 * keep the reference page's order inside each group. Under them sit the two
 * things the schema does not describe as settings at all: the `[[keys.command]]`
 * list, which is user-invented, and the three legacy `[keys.indexed]` combos.
 *
 * ## What a row is
 *
 * Action, description, the chord **verbatim**, herdr's default, and a reset.
 * Verbatim is invariant 7: `normalizeChord('plus')` answers `'+'`, which
 * `parseChord` does not read back, so a field that printed the normalized label
 * would show some users a chord they could not type in again. Nothing on this
 * screen runs a value through a formatter on the way to the eye.
 *
 * ## Duplicates
 *
 * herdr keeps the first binding on a chord and disables the rest, and
 * `validate()` already says so, with both settings named. The editor reads that
 * back out rather than computing collisions a second time (`conflictsIn`), and
 * marks **both** rows: the one that lost carries herdr's own sentence, and the
 * one that won says what it silently switched off. A second implementation of
 * "these two collide" is a second thing to keep in step with herdr.
 *
 * ## Navigate mode
 *
 * Six actions run inside herdr's navigate mode, which refuses `prefix+`, `esc`
 * and the keys it moves with. Those rows have no `prefix+` toggle, and a
 * `prefix+` chord typed into one is refused with herdr's own message from
 * `navigateRejection` rather than written and then complained about.
 *
 * ## What it writes
 *
 * Only leaves, always through `src/lib/edit.ts`: `keys.<action>` for a binding,
 * `keys.command[i].<field>` for a custom command. A cleared field is a `reset`,
 * which takes the key back out of the file rather than writing an empty string.
 */
import { KeyChordInput } from '@/components/common/KeyChordInput'
import { Panel } from '@/components/shell/Panel'
import { diagnosticsAt, useDiagnostics } from '@/lib/diagnostics'
import { resetKey, setKey } from '@/lib/edit'
import {
  COMMAND_TYPES,
  type Conflict,
  DEFAULT_COMMAND_TYPE,
  INDEXED_KEYS,
  appendCommandOps,
  commandField,
  commandsIn,
  conflictMessage,
  conflictsFor,
  conflictsIn,
  groupedBindings,
  isConflictMessage,
  parseSize,
  removeCommandOps,
} from '@/lib/keybindings'
import type { ExportOp } from '@/model/export'
import { navigateRejection, parseChord } from '@/model/keys'
import type { TomlTable, TomlValue } from '@/model/parse'
import { type Diagnostic, bindingValues } from '@/model/validate'
import { byKey, defaultOf } from '@/schema'
import { useConfigStore } from '@/store/config'
import { type ReactNode, useMemo, useState } from 'react'

/**
 * A draft that follows the store when the store moves under it.
 *
 * A field holds what the user is typing, and the store holds what the config
 * says; they part company for as long as it takes to type a chord and part
 * company for good if the field ignores an undo, a reset, or the same key being
 * recorded in the tree's popover. Comparing the settled value during render is
 * React's own answer to that — an effect would render once with the stale draft
 * and then again with the fresh one.
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

/** The six actions that live inside navigate mode. */
function isNavigate(path: string): boolean {
  return path.startsWith('keys.navigate_')
}

/**
 * Why this field refuses the chord, or `null` when it accepts it.
 *
 * Only navigate mode refuses anything before it is written: everything else is
 * herdr's opinion of a value it has already read, which belongs in the
 * diagnostics line rather than in a field that will not take a keystroke.
 */
function rejectionOf(path: string, text: string): string | null {
  if (!isNavigate(path)) return null
  const trimmed = text.trim()
  if (trimmed === '') return null
  const chord = parseChord(trimmed)
  // A string that is not a chord at all is `validate()`'s to report; refusing it
  // here would stop someone typing their way through `pre`, `prefi`, `prefix`.
  return chord === null ? null : navigateRejection(chord)
}

/** herdr's documented default for a binding, as the row prints it. */
function defaultLabel(path: string): string {
  const value = defaultOf(path)
  return typeof value === 'string' && value !== '' ? value : 'unset'
}

/** The one chord a setting holds, or `null` when it holds a list of them. */
function singleChord(value: TomlValue | undefined): string | null {
  if (value === undefined) return ''
  const values = bindingValues(value)
  if (values === null) return null
  if (values.length === 0) return ''
  return values.length === 1 ? values[0] : null
}

/** Apply a list of ops the way the shell writes anything else. */
function applyOps(ops: readonly ExportOp[]): void {
  for (const op of ops) {
    if (op.kind === 'remove') resetKey(op.path)
    else setKey(op.path, op.value)
  }
}

export function KeysEditor() {
  const effective = useConfigStore((state) => state.effectiveAll())
  const diagnostics = useDiagnostics()
  const conflicts = useMemo(() => conflictsIn(diagnostics), [diagnostics])
  const groups = useMemo(() => groupedBindings(), [])
  const commands = useMemo(() => commandsIn(effective), [effective])

  return (
    <Panel caption="keybindings · record a chord or type herdr's spelling">
      <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-3 py-[14px]">
        {groups.map(({ group, keys }) => (
          <section key={group} aria-label={group} className="flex flex-col gap-[6px]">
            <h2 className="border-b border-surface0 pb-[4px] text-subtext0">{group}</h2>
            <ul className="flex flex-col gap-[8px]">
              {keys.map((path) => (
                <BindingRow
                  key={path}
                  path={path}
                  value={effective.get(path)}
                  // A collision is drawn once, as a conflict line naming both
                  // actions; herdr's own warning for it would say the same thing
                  // twice on the row that lost.
                  diagnostics={diagnosticsAt(diagnostics, path).filter(
                    (diagnostic) => !isConflictMessage(diagnostic.message),
                  )}
                  conflicts={conflictsFor(conflicts, path)}
                />
              ))}
            </ul>
          </section>
        ))}

        <CommandList commands={commands} diagnostics={diagnostics} />
        <IndexedBlock effective={effective} diagnostics={diagnostics} />
      </div>
    </Panel>
  )
}

function BindingRow({
  path,
  value,
  diagnostics,
  conflicts,
}: {
  path: string
  value: TomlValue | undefined
  diagnostics: readonly Diagnostic[]
  conflicts: readonly Conflict[]
}) {
  const current = singleChord(value)
  const [draft, setDraft] = useDraft(current ?? '')

  const rejection = rejectionOf(path, draft)
  const action = path.slice('keys.'.length)
  const description = byKey(path)?.description ?? ''

  function apply(next: string): void {
    if (rejectionOf(path, next) !== null) {
      setDraft(next)
      return
    }
    if (next.trim() === '') resetKey(path)
    else setKey(path, next.trim())
  }

  return (
    <li
      className={
        conflicts.length > 0
          ? 'flex flex-col gap-[2px] border-l-2 border-red pl-2'
          : 'flex flex-col gap-[2px] border-l-2 border-transparent pl-2'
      }
    >
      <div className="flex items-center gap-2">
        <span className="w-[24ch] shrink-0 truncate text-text">{action}</span>
        {current === null ? (
          <span className="min-w-0 flex-1 text-overlay0">
            a list of chords, which has no one-line spelling — reset it to edit it here
          </span>
        ) : (
          <KeyChordInput
            name={path}
            value={draft}
            onChange={setDraft}
            onRecord={(next) => {
              setDraft(next)
              apply(next)
            }}
            onCommit={apply}
            allowPrefix={!isNavigate(path)}
          />
        )}
        <span className="shrink-0 text-overlay0">{`default ${defaultLabel(path)}`}</span>
        <button
          type="button"
          aria-label={`reset ${path}`}
          onClick={() => resetKey(path)}
          className="shrink-0 bg-surface0 px-2 py-[2px] text-subtext0 hover:text-text"
        >
          reset
        </button>
      </div>
      <p className="pl-[calc(24ch+8px)] text-overlay0">{description}</p>
      <Messages
        diagnostics={diagnostics}
        extra={[
          ...conflicts.map((conflict) => conflictMessage(conflict, path)),
          ...(rejection === null ? [] : [rejection]),
        ]}
      />
    </li>
  )
}

/**
 * The `[[keys.command]]` list.
 *
 * herdr's reference does not document these as settings — they are whatever the
 * user invents — so nothing here comes from the schema. Adding one appends at
 * the array's length, never into a gap, because `keys.command[i]` names element
 * *i* of the array herdr reads and a gap becomes an entry herdr disables.
 */
function CommandList({
  commands,
  diagnostics,
}: {
  commands: readonly TomlTable[]
  diagnostics: readonly Diagnostic[]
}) {
  return (
    <section aria-label="custom commands" className="flex flex-col gap-[6px]">
      <h2 className="flex items-center gap-3 border-b border-surface0 pb-[4px] text-subtext0">
        {'[[keys.command]]'}
        <button
          type="button"
          onClick={() => applyOps(appendCommandOps(commands))}
          className="bg-surface0 px-2 py-[2px] text-text"
        >
          + add command
        </button>
      </h2>
      {commands.length === 0 && (
        <p className="text-overlay0">
          none yet — a custom command runs a shell line, opens a pane, or opens a popup.
        </p>
      )}
      <ul className="flex flex-col gap-[10px]">
        {commands.map((entry, index) => (
          <CommandRow
            // The index *is* the identity here: `keys.command[i]` addresses the
            // slot, and removing one renumbers every slot after it.
            key={commandField(index, 'key')}
            index={index}
            entry={entry}
            commands={commands}
            diagnostics={diagnosticsAt(diagnostics, `keys.command[${index}]`)}
          />
        ))}
      </ul>
    </section>
  )
}

function CommandRow({
  index,
  entry,
  commands,
  diagnostics,
}: {
  index: number
  entry: TomlTable
  commands: readonly TomlTable[]
  diagnostics: readonly Diagnostic[]
}) {
  const keyPath = commandField(index, 'key')
  const chord = singleChord(entry.key)
  const [draft, setDraft] = useDraft(chord ?? '')

  const type = typeof entry.type === 'string' ? entry.type : DEFAULT_COMMAND_TYPE
  const popup = type === 'popup'
  const sized = popup || entry.width !== undefined || entry.height !== undefined

  return (
    <li className="flex flex-col gap-[4px] border border-surface1 px-2 py-[6px]">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-overlay0">{`[${index}]`}</span>
        {chord === null ? (
          <span className="min-w-0 flex-1 text-overlay0">a list of chords</span>
        ) : (
          <KeyChordInput
            name={keyPath}
            value={draft}
            onChange={setDraft}
            onRecord={(next) => {
              setDraft(next)
              setKey(keyPath, next)
            }}
            onCommit={(next) => {
              if (next.trim() === '') resetKey(keyPath)
              else setKey(keyPath, next.trim())
            }}
          />
        )}
        <select
          aria-label={commandField(index, 'type')}
          value={type}
          onChange={(event) => setKey(commandField(index, 'type'), event.target.value)}
          className="shrink-0 border border-surface1 bg-base px-2 py-[2px] text-green outline-none focus:border-coral"
        >
          {COMMAND_TYPES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={`remove keys.command[${index}]`}
          onClick={() => applyOps(removeCommandOps(commands, index))}
          className="shrink-0 bg-surface0 px-2 py-[2px] text-subtext0 hover:text-red"
        >
          remove
        </button>
      </div>

      <DraftField path={commandField(index, 'command')} value={entry.command} label="command" />
      <DraftField
        path={commandField(index, 'description')}
        value={entry.description}
        label="description"
      />
      {sized && (
        <div className="flex gap-2">
          <DraftField
            path={commandField(index, 'width')}
            value={entry.width}
            label="width"
            parse={parseSize}
          />
          <DraftField
            path={commandField(index, 'height')}
            value={entry.height}
            label="height"
            parse={parseSize}
          />
        </div>
      )}
      <Messages diagnostics={diagnostics} extra={[]} />
    </li>
  )
}

/**
 * The three legacy `[keys.indexed]` combos.
 *
 * They are not chords: each names only the modifiers `1`…`9` are held with, and
 * herdr expands one into nine direct bindings. herdr still reads them and still
 * documents them, so corral shows them — with the note, and with no automatic
 * migration to `keys.switch_tab` and friends, which would silently rewrite a
 * file the user did not ask to have rewritten.
 */
function IndexedBlock({
  effective,
  diagnostics,
}: {
  effective: ReadonlyMap<string, TomlValue>
  diagnostics: readonly Diagnostic[]
}) {
  return (
    <section aria-label="indexed shortcuts" className="flex flex-col gap-[6px]">
      <h2 className="border-b border-surface0 pb-[4px] text-subtext0">{'[keys.indexed]'}</h2>
      <p className="text-overlay0">
        Legacy: a modifier combo such as <span className="text-yellow">alt</span>, which herdr
        expands over 1&ndash;9. Superseded by switch_tab, switch_workspace and focus_agent; corral
        does not migrate them for you.
      </p>
      <ul className="flex flex-col gap-[6px]">
        {INDEXED_KEYS.map((path) => (
          <li key={path} className="flex flex-col gap-[2px]">
            <div className="flex items-center gap-2">
              <span className="w-[24ch] shrink-0 truncate text-text">
                {path.slice('keys.'.length)}
              </span>
              <DraftField path={path} value={effective.get(path)} label="modifiers" />
              <button
                type="button"
                aria-label={`reset ${path}`}
                onClick={() => resetKey(path)}
                className="shrink-0 bg-surface0 px-2 py-[2px] text-subtext0 hover:text-text"
              >
                reset
              </button>
            </div>
            <Messages diagnostics={diagnosticsAt(diagnostics, path)} extra={[]} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * A text field that writes on `enter` or on leaving it.
 *
 * Writing on every keystroke would put one undo step on the stack per character;
 * writing only on `enter` would lose what someone typed and then clicked away
 * from. Emptying it is a `reset`, so a field nobody filled in leaves no key
 * behind in the file.
 */
function DraftField({
  path,
  value,
  label,
  parse = (draft: string) => draft,
}: {
  path: string
  value: TomlValue | undefined
  label: string
  parse?: (draft: string) => TomlValue
}) {
  const current = value === undefined || value === null ? '' : String(value)
  const [draft, setDraft] = useDraft(current)

  function commit(next: string): void {
    if (next.trim() === '') resetKey(path)
    else setKey(path, parse(next))
  }

  return (
    <label className="flex min-w-0 flex-1 items-center gap-2">
      <span className="shrink-0 text-overlay0">{label}</span>
      <input
        type="text"
        aria-label={path}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          commit(event.currentTarget.value)
        }}
        className="min-w-0 flex-1 border border-surface1 bg-base px-2 py-[2px] text-text outline-none focus:border-coral"
      />
    </label>
  )
}

/** Everything herdr and the editor have to say about one row. */
function Messages({
  diagnostics,
  extra,
}: {
  diagnostics: readonly Diagnostic[]
  extra: readonly string[]
}): ReactNode {
  if (diagnostics.length === 0 && extra.length === 0) return null
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
      {extra.map((message) => (
        <li key={message} className="text-yellow">
          {'▲ '}
          {message}
        </li>
      ))}
    </ul>
  )
}
