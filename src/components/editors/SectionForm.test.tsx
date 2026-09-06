import { SectionForm } from '@/components/editors/SectionForm'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
})

describe('SectionForm', () => {
  it('frames itself with the section name', () => {
    render(<SectionForm section="layout" />)

    expect(screen.getByRole('region', { name: 'layout' })).toBeInTheDocument()
  })

  it('renders layout in one reference-section group, with a typed control per key', () => {
    render(<SectionForm section="layout" />)

    expect(screen.getByRole('heading', { name: 'UI and sidebar' })).toBeInTheDocument()
    expect(screen.getByLabelText('ui.pane_borders')).toBeInTheDocument()
    // Not layout's: home is `sidebar`, and `all` is a different section.
    expect(screen.queryByLabelText('ui.sidebar_width')).not.toBeInTheDocument()
  })

  it('lists every key under all, grouped by reference section', () => {
    render(<SectionForm section="all" />)

    expect(screen.getByRole('heading', { name: 'Sound' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByLabelText('ui.sidebar_width')).toBeInTheDocument()
  })

  it('gives keys.*, the theme table, and the structured settings a row that opens their editor', () => {
    render(<SectionForm section="all" />)

    // Not a `Field` — the proof is that nothing is labelled with the bare path.
    expect(screen.queryByLabelText('keys.help')).not.toBeInTheDocument()
    const help = screen.getByRole('button', { name: 'keys.help: open editor' })
    expect(help).toHaveTextContent('keybinding — edited by its own form')

    for (const path of ['theme.custom.accent', 'ui.tab_bar_right', 'ui.sidebar.agents.rows']) {
      expect(
        screen.getByRole('button', { name: `${path}: open editor` }),
        `expected a door to ${path}`,
      ).toBeInTheDocument()
    }
  })

  it('opens that editor on the key the row names', async () => {
    const user = userEvent.setup()
    render(<SectionForm section="all" />)

    await user.click(screen.getByRole('button', { name: 'theme.name: open editor' }))

    // `all` listed the key and now reaches it: the popover host takes it from
    // here, the same way it does for a tree row or a click on the preview.
    expect(useShellStore.getState().editor?.key).toBe('theme.name')
  })

  it('hands the whole theme table and ui.accent to the theme editor', () => {
    render(<SectionForm section="all" />)

    // They were Field's until the theme editor had swatches to put them in;
    // `all` now names them and points at the form that owns them.
    expect(screen.queryByLabelText('theme.name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('ui.accent')).not.toBeInTheDocument()
    expect(screen.getByText('theme.name')).toBeInTheDocument()
    expect(screen.getByText('ui.accent').closest('div')).toHaveTextContent(
      'color — edited by its own form',
    )
  })

  it('keeps a real control for the tab bar scalars the status editor shares', () => {
    render(<SectionForm section="all" />)

    expect(screen.getByLabelText('ui.tab_bar_right_separator')).toBeInTheDocument()
    expect(screen.getByLabelText('ui.tab_bar_position')).toBeInTheDocument()
    expect(screen.getByLabelText('ui.hide_tab_bar_when_single_tab')).toBeInTheDocument()
  })

  it('groups the per-agent sound overrides into a compact grid', async () => {
    const user = userEvent.setup()
    render(<SectionForm section="all" />)

    const sound = within(screen.getByRole('region', { name: 'Sound' }))
    expect(sound.getByRole('heading', { name: 'per-agent overrides' })).toBeInTheDocument()
    expect(sound.getByText('claude')).toBeInTheDocument()

    await user.click(sound.getByRole('radio', { name: 'ui.sound.agents.claude on' }))

    expect(useConfigStore.getState().explicit().get('ui.sound.agents.claude')).toBe('on')
  })
})
