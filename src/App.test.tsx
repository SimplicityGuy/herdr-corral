import { resetConfigStore } from '@/store/config'
import { resetShellStore } from '@/store/shell'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
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

  it('frames the settings and preview panels', () => {
    render(<App />)

    expect(screen.getByRole('region', { name: 'settings' })).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'preview · click anything to edit it' }),
    ).toBeInTheDocument()
  })

  it('fills the settings panel with the section the shell opens on', () => {
    render(<App />)

    const tree = within(screen.getByRole('region', { name: 'settings' }))
    expect(tree.getByRole('button', { name: /^ui\.pane_borders/ })).toBeInTheDocument()
  })

  it('leaves the preview frame a placeholder for the preview bead', () => {
    render(<App />)

    const preview = within(screen.getByRole('region', { name: /^preview/ }))
    expect(preview.getByText(/The herdr mock lands here/)).toBeInTheDocument()
  })

  it('shows the diagnostics line with the mode badge and the export verb', () => {
    render(<App />)

    expect(screen.getByText('EDIT')).toBeInTheDocument()
    expect(screen.getByText(':diff')).toBeInTheDocument()
    expect(screen.getByText(/download config\.toml/)).toBeInTheDocument()
  })
})
