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

  it('shows the diagnostics line with the mode badge and the export verb', () => {
    render(<App />)

    expect(screen.getByText('EDIT')).toBeInTheDocument()
    expect(screen.getByText(':diff')).toBeInTheDocument()
    expect(screen.getByText(/download config\.toml/)).toBeInTheDocument()
  })
})
