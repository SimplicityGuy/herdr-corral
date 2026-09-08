import { HelpDialog } from '@/components/shell/HelpDialog'
import { PREFIX_WINDOW_MS } from '@/lib/shortcuts'
import { resetShellStore, useShellStore } from '@/store/shell'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  resetShellStore()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HelpDialog', () => {
  it('opens on ctrl+b then ?, and lists the keys', async () => {
    const user = userEvent.setup()
    render(<HelpDialog />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.keyboard('{Control>}b{/Control}?')

    const sheet = screen.getByRole('dialog', { name: 'help' })
    expect(sheet).toHaveTextContent('ctrl+k')
    expect(sheet).toHaveTextContent(':w')
    expect(sheet).toHaveTextContent(':diff')
  })

  it('closes on esc', async () => {
    const user = userEvent.setup()
    render(<HelpDialog />)

    await user.keyboard('{Control>}b{/Control}?')
    expect(screen.getByRole('dialog', { name: 'help' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(useShellStore.getState().helpOpen).toBe(false)
  })

  it('does nothing on a bare ?', async () => {
    const user = userEvent.setup()
    render(<HelpDialog />)

    await user.keyboard('?')
    expect(useShellStore.getState().helpOpen).toBe(false)
  })

  it('disarms the prefix on any other key', async () => {
    const user = userEvent.setup()
    render(<HelpDialog />)

    await user.keyboard('{Control>}b{/Control}j?')
    expect(useShellStore.getState().helpOpen).toBe(false)
  })

  it('lets the prefix lapse', async () => {
    const user = userEvent.setup()
    render(<HelpDialog />)

    // The prefix keeps a deadline, not a timer, so moving the clock is enough.
    const start = Date.now()
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(start)
    await user.keyboard('{Control>}b{/Control}')
    now.mockReturnValue(start + PREFIX_WINDOW_MS + 1)
    await user.keyboard('?')

    expect(useShellStore.getState().helpOpen).toBe(false)
  })

  it('works from inside a text field, because the prefix is modified', async () => {
    const user = userEvent.setup()
    render(
      <>
        <HelpDialog />
        <input aria-label="somewhere to type" />
      </>,
    )

    await user.click(screen.getByRole('textbox', { name: 'somewhere to type' }))
    await user.keyboard('{Control>}b{/Control}?')

    expect(useShellStore.getState().helpOpen).toBe(true)
  })

  it('shuts the palette when it opens', () => {
    useShellStore.getState().setPaletteOpen(true)
    useShellStore.getState().setHelpOpen(true)

    expect(useShellStore.getState().paletteOpen).toBe(false)
  })
})
