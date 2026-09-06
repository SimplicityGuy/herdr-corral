/**
 * The typed form for a whole UI section — the center-frame view for
 * `[1] layout` and `[6] all` (App.tsx), where there is no herdr region to click
 * because the section is either not visual (pane geometry, mouse behaviour) or
 * is "all", the exhaustive listing ADR-0002 promises rather than a preview.
 *
 * Keys render in the reference page's own order (`keysOf`, already ordered),
 * grouped under the reference section that documents them — `ref-ui`'s "UI and
 * sidebar", `ref-notifications`, `ref-sound`, and so on — so `all`'s 167 keys
 * read as the reference page's own chapters rather than one long list. Layout
 * happens to draw from one reference section, so it gets one header; that is a
 * property of what herdr documents under `ui.pane_*` today, not a special case
 * here.
 *
 * `ui.sound.agents.*` is the one deliberate departure: 24 identical three-way
 * enums under `ref-sound` would repeat "Sound override for detected X agents"
 * 24 times if each got a full `Field`, so they are pulled into a compact grid
 * of just the agent name and its toggle group instead, reusing `EnumControl`
 * rather than `Field`'s full chrome.
 *
 * A key `ownedElsewhere` (`keys.*`, `theme.custom.*`, and every structured
 * type) gets a one-line fallback naming the type and pointing at the editor
 * that will claim it, so `all` never simply omits two thirds of the config —
 * it just does not pretend to edit the third it is not responsible for.
 */
import { EnumControl, Field } from '@/components/common/Field'
import { Panel } from '@/components/shell/Panel'
import { setKey } from '@/lib/edit'
import { type UiSection, keysOf } from '@/lib/sections'
import { ownedElsewhere } from '@/lib/scalar-fields'
import { byKey, enumOptions, sections, typeOf } from '@/schema'
import { useConfigStore } from '@/store/config'
import { useMemo } from 'react'

interface ReferenceGroup {
  readonly id: string
  readonly title: string
  readonly keys: readonly string[]
}

/** Keys, in the order given, chunked wherever the reference section changes. */
function groupByReference(keys: readonly string[]): readonly ReferenceGroup[] {
  const titleOf = new Map(sections().map((section) => [section.id, section.title]))
  const groups: ReferenceGroup[] = []
  let current: { id: string; title: string; keys: string[] } | undefined
  for (const key of keys) {
    const id = byKey(key)?.section ?? 'ref-general'
    if (current === undefined || current.id !== id) {
      current = { id, title: titleOf.get(id) ?? id, keys: [] }
      groups.push(current)
    }
    current.keys.push(key)
  }
  return groups
}

const AGENT_SOUND_PREFIX = 'ui.sound.agents.'

export function SectionForm({ section }: { section: UiSection }) {
  const keys = keysOf(section)
  const groups = useMemo(() => groupByReference(keys), [keys])

  return (
    <Panel caption={section}>
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-3 py-[14px]">
        {groups.map((group) => (
          <section key={group.id} aria-label={group.title}>
            <h2 className="mb-[8px] border-b border-surface0 pb-[4px] text-subtext0">{group.title}</h2>
            <SectionGroupBody keys={group.keys} />
          </section>
        ))}
      </div>
    </Panel>
  )
}

function SectionGroupBody({ keys }: { keys: readonly string[] }) {
  const agentKeys = keys.filter((key) => key.startsWith(AGENT_SOUND_PREFIX))
  const rest = keys.filter((key) => !key.startsWith(AGENT_SOUND_PREFIX))

  return (
    <div className="flex flex-col gap-[10px]">
      {rest.map((key) =>
        ownedElsewhere(key) ? <FallbackRow key={key} path={key} /> : <Field key={key} path={key} />,
      )}
      {agentKeys.length > 0 && <AgentSoundGrid keys={agentKeys} />}
    </div>
  )
}

/** The per-agent sound override grid — `ui.sound.agents.*`, all three-option enums. */
function AgentSoundGrid({ keys }: { keys: readonly string[] }) {
  return (
    <div>
      <h3 className="mb-[6px] text-overlay0">per-agent overrides</h3>
      {/* Name over control, not side by side: `github_copilot` is 14 characters
          and a fixed side-by-side basis would still clip it, where stacking
          leaves the full cell width to the name. A long name still ellipsises
          rather than fitting whole — acceptable, with the tooltip, at a floor
          this narrow — but the control cannot: the three-item toggle group has
          an intrinsic width of 177px and never shrinks, so the floor has to fit
          it (177px plus 8px padding on each side) or its last option renders
          outside the cell, unreachable by mouse or by hit test alike. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-[6px]">
        {keys.map((key) => (
          <AgentSoundRow key={key} path={key} />
        ))}
      </div>
    </div>
  )
}

function AgentSoundRow({ path }: { path: string }) {
  const value = useConfigStore((state) => state.effective(path))
  const changed = useConfigStore((state) => state.explicit().has(path))
  const options = enumOptions(path)
  const label = path.slice(AGENT_SOUND_PREFIX.length)

  return (
    <div className="flex flex-col gap-[4px] border border-surface1 bg-base px-2 py-[6px]">
      <span className="truncate text-subtext0" title={path}>
        {label}
        {changed && (
          <span aria-label="changed" className="ml-[4px] text-coral">
            {'●'}
          </span>
        )}
      </span>
      <EnumControl
        path={path}
        value={typeof value === 'string' ? value : ''}
        options={options}
        onChange={(next) => setKey(path, next)}
      />
    </div>
  )
}

/** What a key `ownedElsewhere` gets instead of a `Field`: a name, not a control. */
function FallbackRow({ path }: { path: string }) {
  const declared = typeOf(path)
  return (
    <div className="flex items-center justify-between gap-2 border-b border-surface0 pb-[10px] last:border-b-0">
      <span className="text-subtext0">{path}</span>
      {/* Deliberately no `aria-label` here: a fallback is not a control, and the
          coverage test (`Field.test.tsx`) reads "no labelled control" as proof
          a key is owned elsewhere rather than simply missed. */}
      <span className="text-overlay0">{declared ?? 'value'} — edited by its own form</span>
    </div>
  )
}
