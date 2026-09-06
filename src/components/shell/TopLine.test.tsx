import { TopLine } from '@/components/shell/TopLine'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
})

describe('TopLine', () => {
  it('shows the mark, the file and the six switches', () => {
    render(<TopLine />)

    expect(screen.getByLabelText('corral')).toHaveTextContent('▐▛█▜▌')
    expect(screen.getByText('config.toml')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    expect(nav).toHaveTextContent('[1] layout')
    expect(nav).toHaveTextContent('[6] all')
  })

  it('marks the active section, and switches when one is clicked', async () => {
    const user = userEvent.setup()
    render(<TopLine />)

    expect(screen.getByRole('button', { name: '[1] layout' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    await user.click(screen.getByRole('button', { name: '[4] keys' }))

    expect(useShellStore.getState().section).toBe('keys')
    expect(screen.getByRole('button', { name: '[4] keys' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '[1] layout' })).not.toHaveAttribute('aria-current')
  })

  it('points the config store at the reference section behind the switch', async () => {
    const user = userEvent.setup()
    render(<TopLine />)

    await user.click(screen.getByRole('button', { name: '[5] theme' }))

    expect(useConfigStore.getState().selection.section).toBe('ref-theme')
  })

  it('switches sections on the number keys', async () => {
    const user = userEvent.setup()
    render(<TopLine />)

    await user.keyboard('3')
    expect(useShellStore.getState().section).toBe('status')

    await user.keyboard('6')
    expect(useShellStore.getState().section).toBe('all')
  })

  it('leaves the number keys alone while the focus is in a text field', async () => {
    const user = userEvent.setup()
    render(
      <>
        <TopLine />
        <input aria-label="somewhere to type" />
      </>,
    )

    await user.click(screen.getByRole('textbox', { name: 'somewhere to type' }))
    await user.keyboard('2')

    expect(useShellStore.getState().section).toBe('layout')
    expect(screen.getByRole('textbox', { name: 'somewhere to type' })).toHaveValue('2')
  })

  it('marks the file dirty only once something is changed', async () => {
    const user = userEvent.setup()
    render(<TopLine />)

    expect(screen.queryByLabelText('unsaved changes')).not.toBeInTheDocument()

    useConfigStore.getState().set('ui.sidebar_width', 40)
    await user.click(screen.getByRole('button', { name: '[1] layout' }))

    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument()
  })
})
