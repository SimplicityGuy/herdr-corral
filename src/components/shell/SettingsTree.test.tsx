import { SettingsTree } from '@/components/shell/SettingsTree'
import type { UiSection } from '@/lib/sections'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
})

/** Open the section a test needs, the way the top line would. */
function openSection(section: UiSection): void {
  useShellStore.getState().setSection(section)
}

describe('SettingsTree', () => {
  it('names each row for the setting and its current value', () => {
    openSection('sidebar')
    render(<SettingsTree />)

    expect(screen.getByRole('button', { name: 'ui.sidebar_width = 26' })).toBeInTheDocument()
  })

  it('groups rows under their top-level table', () => {
    openSection('theme')
    render(<SettingsTree />)

    expect(screen.getByText('theme')).toBeInTheDocument()
    expect(screen.getByText('ui')).toBeInTheDocument()
  })

  it('lists only the section it is showing, and everything under `all`', () => {
    openSection('theme')
    const view = render(<SettingsTree />)
    expect(screen.queryByRole('button', { name: /^ui\.sidebar_width/ })).not.toBeInTheDocument()

    openSection('all')
    view.rerender(<SettingsTree />)
    expect(screen.getByRole('button', { name: /^ui\.sidebar_width/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^theme\.name/ })).toBeInTheDocument()
  })

  it('filters the tree when `/` is pressed and a query typed', async () => {
    const user = userEvent.setup()
    openSection('all')
    render(<SettingsTree />)

    await user.keyboard('/')
    expect(screen.getByRole('searchbox', { name: 'Filter settings' })).toHaveFocus()

    await user.keyboard('sidebar_width')

    expect(screen.getByRole('button', { name: /^ui\.sidebar_width/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^theme\.name/ })).not.toBeInTheDocument()
  })

  it('says so when the filter matches nothing', async () => {
    const user = userEvent.setup()
    render(<SettingsTree />)

    await user.keyboard('/')
    await user.keyboard('zzzz')

    expect(screen.getByText('no setting matches that')).toBeInTheDocument()
  })

  it('moves the focused row with j and k', async () => {
    const user = userEvent.setup()
    openSection('theme')
    render(<SettingsTree />)

    const rows = screen.getAllByRole('button')
    rows[0].focus()
    const first = useConfigStore.getState().selection.key

    await user.keyboard('j')
    const second = useConfigStore.getState().selection.key
    expect(second).not.toBe(first)
    expect(screen.getByRole('button', { name: new RegExp(`^${second}`) })).toHaveFocus()

    await user.keyboard('k')
    expect(useConfigStore.getState().selection.key).toBe(first)
  })

  it('opens the editor popover for the focused row on enter', async () => {
    const user = userEvent.setup()
    openSection('sidebar')
    render(<SettingsTree />)

    screen.getByRole('button', { name: 'ui.sidebar_width = 26' }).focus()
    await user.keyboard('{Enter}')

    expect(useShellStore.getState().editor?.key).toBe('ui.sidebar_width')
  })

  it('resets the focused row to herdr default on d', async () => {
    const user = userEvent.setup()
    useConfigStore.getState().set('ui.sidebar_width', 40)
    openSection('sidebar')
    render(<SettingsTree />)

    const row = screen.getByRole('button', { name: 'ui.sidebar_width = 40' })
    row.focus()
    await user.keyboard('d')

    expect(useConfigStore.getState().effective('ui.sidebar_width')).toBe(26)
    expect(screen.getByRole('button', { name: 'ui.sidebar_width = 26' })).toBeInTheDocument()
  })

  it('undoes the last change on u', async () => {
    const user = userEvent.setup()
    useConfigStore.getState().set('ui.sidebar_width', 40)
    openSection('sidebar')
    render(<SettingsTree />)

    screen.getByRole('button', { name: 'ui.sidebar_width = 40' }).focus()
    await user.keyboard('u')

    expect(screen.getByRole('button', { name: 'ui.sidebar_width = 26' })).toBeInTheDocument()
  })

  it('shows a list as its length rather than its contents', () => {
    openSection('sidebar')
    render(<SettingsTree />)

    const rows = screen.getByRole('button', { name: /^ui\.sidebar\.agents\.rows = / })
    expect(rows).toBeInTheDocument()
    expect(rows.getAttribute('aria-label')).toMatch(/= \d+$/)
  })

  it('marks a row that validate() complains about', () => {
    useConfigStore.getState().set('ui.sidebar_min_width', 999)
    openSection('sidebar')
    render(<SettingsTree />)

    expect(
      screen.getByRole('button', { name: 'ui.sidebar_min_width = 999' }),
    ).toHaveAccessibleDescription(/sidebar_max_width|sidebar_width/)
  })

  it('lists the keyboard hints the ADR asks for', () => {
    render(<SettingsTree />)
    const footer = screen.getByText(/reset to default/)

    expect(footer).toHaveTextContent('/ search')
    expect(footer).toHaveTextContent('j k move')
    expect(footer).toHaveTextContent('enter edit')
    expect(footer).toHaveTextContent('u undo')
  })
})
