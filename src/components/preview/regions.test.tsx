/**
 * The regions, and what clicking one does.
 *
 * Two halves. The map is checked against the generated schema, so a region can
 * never advertise a key herdr does not have; and the wiring is checked end to
 * end, by clicking a region and looking for the popover — the acceptance is that
 * a click *selects the owning key and opens the editor for it*, and neither half
 * proves that alone.
 */
import { HerdrPreview } from '@/components/preview/HerdrPreview'
import {
  REGIONS,
  REGION_IDS,
  type RegionId,
  allRegionKeys,
  isSchemaKey,
  regionKey,
} from '@/components/preview/regions'
import { InlinePopover } from '@/components/shell/InlinePopover'
import { homeOf } from '@/lib/sections'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
})

/** The preview with the popover host it opens, which is what App wires up. */
function Shell() {
  return (
    <>
      <HerdrPreview />
      <InlinePopover />
    </>
  )
}

describe('the region map', () => {
  it.each(allRegionKeys())('names %s, which the schema documents', (key) => {
    expect(isSchemaKey(key)).toBe(true)
  })

  it('gives every region at least one key and a distinct one to open', () => {
    const primaries = REGION_IDS.map((id) => regionKey(id))
    for (const id of REGION_IDS) expect(REGIONS[id].keys.length).toBeGreaterThan(0)
    expect(new Set(primaries).size).toBe(primaries.length)
  })

  it('draws its keys from the two sections the preview is about', () => {
    // Every region key has a home in the settings tree; none of them fall through
    // to `all`, which would mean the tree has no focused editor for a setting the
    // preview offers to edit.
    for (const key of allRegionKeys()) expect(homeOf(key)).not.toBe('all')
  })

  it('advertises itself and its keys in the DOM', () => {
    render(<HerdrPreview />)
    for (const id of REGION_IDS) {
      const node = document.querySelector<HTMLElement>(`[data-region="${id}"]`)
      expect(node, `region ${id} is not drawn`).not.toBeNull()
      expect(node?.dataset.keys).toBe(REGIONS[id].keys.join(' '))
    }
  })
})

/** The three the acceptance names, plus the ones a person reaches for next. */
const CLICKS: readonly (readonly [string, RegionId, string])[] = [
  ['agent claude', 'agents', 'ui.sidebar.agents.rows'],
  ['tab bar status entries', 'tab-bar-right', 'ui.tab_bar_right'],
  ['notification toast, delivery off', 'toast', 'ui.toast.herdr.position'],
  ['space phaze', 'spaces', 'ui.sidebar.spaces.rows'],
  ['tab bar', 'tab-bar', 'ui.tab_bar_position'],
  ['pane zsh', 'panes', 'ui.pane_borders'],
  ['sidebar width, 26 columns', 'sidebar', 'ui.sidebar_width'],
]

describe('clicking a region', () => {
  it.each(CLICKS)('on %s selects %s and opens %s', (name, region, key) => {
    render(<Shell />)

    fireEvent.click(screen.getByRole('button', { name }))

    expect(useConfigStore.getState().selection).toMatchObject({ key, region })
    expect(useShellStore.getState().editor).toMatchObject({ key, region })
    expect(screen.getByRole('dialog', { name: key })).toBeInTheDocument()
  })

  it('marks the selected region with the coral outline and nothing else with it', () => {
    render(<Shell />)

    fireEvent.click(screen.getByRole('button', { name: 'agent claude' }))

    const selected = document.querySelectorAll<HTMLElement>('[data-selected="true"]')
    expect(selected.length).toBeGreaterThan(0)
    for (const node of selected) {
      expect(node.dataset.region).toBe('agents')
      expect(node.className).toContain('outline-coral')
    }
    // Everything else is still only offering the dashed hover outline.
    const toast = screen.getByRole('button', { name: /notification toast/ })
    expect(toast.dataset.selected).toBeUndefined()
    expect(toast.className).toContain('hover:outline-dashed')
  })

  it('takes the settings tree to the section that owns the key', () => {
    render(<Shell />)
    expect(useShellStore.getState().section).toBe('layout')

    fireEvent.click(screen.getByRole('button', { name: 'agent claude' }))
    expect(useShellStore.getState().section).toBe('sidebar')

    fireEvent.click(screen.getByRole('button', { name: 'theme catppuccin' }))
    expect(useShellStore.getState().section).toBe('theme')
    // The section switch clears any open editor, so the order matters: this one
    // is the editor the second click opened, not nothing at all.
    expect(useShellStore.getState().editor).toMatchObject({ key: 'theme.name' })
  })

  it('moves the selection when another region is clicked', () => {
    render(<Shell />)

    fireEvent.click(screen.getByRole('button', { name: 'agent claude' }))
    fireEvent.click(screen.getByRole('button', { name: 'theme catppuccin' }))

    expect(useConfigStore.getState().selection).toMatchObject({
      key: 'theme.name',
      region: 'theme',
    })
    expect(screen.getByRole('dialog', { name: 'theme.name' })).toBeInTheDocument()
    expect(document.querySelector('[data-region="agents"][data-selected="true"]')).toBeNull()
  })

  it('lets the editor it opened write the key it named', () => {
    render(<Shell />)

    fireEvent.click(screen.getByRole('button', { name: 'sidebar width, 26 columns' }))
    const field = screen.getByRole('spinbutton', { name: 'ui.sidebar_width' })
    fireEvent.change(field, { target: { value: '30' } })
    fireEvent.submit(field.closest('form') as HTMLFormElement)

    expect(useConfigStore.getState().effective('ui.sidebar_width')).toBe(30)
    expect(
      document.querySelector<HTMLElement>('[data-part="sidebar"]')?.style.width,
    ).toBe('30ch')
  })
})
