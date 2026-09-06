import { resetConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
  // A fresh session lands on the import screen; the shell tests below are about
  // what happens after it, so they start with a document already in hand.
  useShellStore.getState().setLanding(false)
})

describe('App landing gate', () => {
  it('opens on the landing, not the shell', () => {
    useShellStore.getState().setLanding(true)
    render(<App />)

    expect(screen.getByRole('button', { name: /drop your config\.toml here/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'settings' })).not.toBeInTheDocument()
  })

  it('hands over to the shell once a config is in hand', async () => {
    const user = userEvent.setup()
    useShellStore.getState().setLanding(true)
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'start from herdr defaults' }))

    expect(screen.getByRole('region', { name: 'settings' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /drop your config\.toml here/ })).not.toBeInTheDocument()
  })
})

describe('App', () => {
  it('renders the Console top line with the corral mark and the file name', () => {
    render(<App />)

    const topLine = within(screen.getByRole('banner'))
    expect(topLine.getByLabelText('corral')).toHaveTextContent('▐▛█▜▌')
    expect(topLine.getByText('config.toml')).toBeInTheDocument()
  })

  it('offers the six sections as numbered switches', () => {
    render(<App />)

    const nav = screen.getByRole('navigation', { name: 'Sections' })
    expect(nav).toHaveTextContent('[1] layout')
    expect(nav).toHaveTextContent('[6] all')
  })

  it('frames the settings panel, and the center frame for the section it opens on', () => {
    render(<App />)

    expect(screen.getByRole('region', { name: 'settings' })).toBeInTheDocument()
    // The shell opens on `layout`, which SectionForm claims as a center-frame
    // view — see "fills the center frame with a typed form" below.
    expect(screen.getByRole('region', { name: 'layout' })).toBeInTheDocument()
  })

  it('fills the settings panel with the section the shell opens on', () => {
    render(<App />)

    const tree = within(screen.getByRole('region', { name: 'settings' }))
    expect(tree.getByRole('button', { name: /^ui\.pane_borders/ })).toBeInTheDocument()
  })

  it('fills the center frame with a typed form for layout, the section it opens on', () => {
    render(<App />)

    const form = within(screen.getByRole('region', { name: 'layout' }))
    expect(form.getByLabelText('ui.pane_borders')).toBeInTheDocument()
  })

  it('fills the preview frame with the herdr mock for the sections layout and all do not claim', () => {
    useShellStore.getState().setSection('sidebar')
    render(<App />)

    const preview = within(screen.getByRole('region', { name: /^preview/ }))
    expect(preview.getByRole('button', { name: 'agent claude' })).toBeInTheDocument()
    expect(preview.getByRole('button', { name: 'tab bar' })).toBeInTheDocument()
  })

  it('draws each of the four section panels on its own switch', () => {
    for (const [section, panel] of [
      ['status', /^status/],
      ['keys', /^keybindings/],
      ['theme', /^theme ·/],
      ['all', /^all$/],
    ] as const) {
      useShellStore.getState().setSection(section)
      const view = render(<App />)
      expect(screen.getByRole('region', { name: panel }), `expected ${section}`).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: /^preview/ })).not.toBeInTheDocument()
      view.unmount()
    }
  })

  it('shows the diagnostics line with the mode badge and the export verb', () => {
    render(<App />)

    expect(screen.getByText('EDIT')).toBeInTheDocument()
    expect(screen.getByText(':diff')).toBeInTheDocument()
    expect(screen.getByText(/download config\.toml/)).toBeInTheDocument()
  })
})

/**
 * Clicking a thing must never take that thing off the screen.
 *
 * A region's key belongs to a section, and the shell moves the tree to that
 * section so the cursor can follow the click. Four of the six sections now draw
 * a panel of their own, so that move used to replace the mock with a panel — the
 * popover then floated over a second copy of its own controls, and `esc` left
 * the user somewhere they had not asked to be. `centre` is the fix: a switch
 * chooses the frame, a region click pins it to the preview.
 */
describe('the centre frame under a region click', () => {
  beforeEach(() => {
    useShellStore.getState().setSection('sidebar')
  })

  it('keeps the mock on screen and moves the tree to the section that owns the key', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'tab bar status entries' }))

    expect(screen.getByRole('region', { name: /^preview/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^status/ })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'ui.tab_bar_right' })).toBeInTheDocument()
    const nav = within(screen.getByRole('navigation', { name: 'Sections' }))
    expect(nav.getByRole('button', { name: '[3] status' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('leaves the user on the preview when the popover is dismissed', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'theme catppuccin' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^preview/ })).toBeInTheDocument()
  })

  it('gives the section its panel back when the switch is pressed again', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'tab bar status entries' }))
    await user.keyboard('{Escape}')
    await user.keyboard('3')

    expect(screen.getByRole('region', { name: /^status/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^preview/ })).not.toBeInTheDocument()
  })

  it('brings the mock back when a region is clicked from a section that hid it', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Into the status panel, back out to the mock, and click its tab bar: the
    // mock is what stays, with the popover over it.
    await user.keyboard('3')
    expect(screen.getByRole('region', { name: /^status/ })).toBeInTheDocument()

    await user.keyboard('2')
    await user.click(screen.getByRole('button', { name: 'tab bar status entries' }))

    expect(screen.getByRole('region', { name: /^preview/ })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'ui.tab_bar_right' })).toBeInTheDocument()
  })

  it('leaves the centre alone when the editor is opened from a tree row', async () => {
    const user = userEvent.setup()
    useShellStore.getState().setSection('all')
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'theme.name: open editor' }))

    expect(screen.getByRole('region', { name: /^all$/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^preview/ })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'theme.name' })).toBeInTheDocument()
  })
})
