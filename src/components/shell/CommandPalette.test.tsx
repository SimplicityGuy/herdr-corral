import { CommandPalette } from '@/components/shell/CommandPalette'
import { BLOCKED_REASON } from '@/lib/download'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
})

describe('CommandPalette', () => {
  it('stays shut until ctrl+k, and closes on the next one', async () => {
    const user = userEvent.setup()
    render(<CommandPalette />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Control>}k{/Control}')
    expect(useShellStore.getState().paletteOpen).toBe(false)
  })

  it('jumps to a key: opens its section and selects it', async () => {
    const user = userEvent.setup()
    useShellStore.getState().setSection('all')
    render(<CommandPalette />)

    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('combobox'), 'theme.auto_switch')
    await user.click(await screen.findByRole('option', { name: /theme\.auto_switch/ }))

    expect(useShellStore.getState().section).toBe('theme')
    expect(useConfigStore.getState().selection.key).toBe('theme.auto_switch')
    expect(useShellStore.getState().paletteOpen).toBe(false)
  })

  it('undoes through the palette', async () => {
    const user = userEvent.setup()
    useConfigStore.getState().set('ui.sidebar_width', 40)
    render(<CommandPalette />)

    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('combobox'), 'undo')
    await user.click(await screen.findByRole('option', { name: 'undo' }))

    expect(useConfigStore.getState().effective('ui.sidebar_width')).toBe(26)
  })

  it('switches sections through the palette', async () => {
    const user = userEvent.setup()
    render(<CommandPalette />)

    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('combobox'), 'switch to keys')
    await user.click(await screen.findByRole('option', { name: 'switch to keys' }))

    expect(useShellStore.getState().section).toBe('keys')
  })

  it('offers the download, and refuses it while an error stands', async () => {
    const user = userEvent.setup()
    render(<CommandPalette />)

    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('combobox'), 'download')
    expect(await screen.findByRole('option', { name: /download config\.toml/ })).not.toHaveAttribute(
      'data-disabled',
      'true',
    )

    await user.keyboard('{Escape}')
    useConfigStore.getState().set('ui.sidebar_width', 'wide')

    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('combobox'), 'download')
    const blocked = await screen.findByRole('option', { name: /download config\.toml/ })
    expect(blocked).toHaveAttribute('data-disabled', 'true')
    expect(blocked).toHaveTextContent(BLOCKED_REASON)
  })

  it('matches the download on the verb the line prints, `:w`', async () => {
    const user = userEvent.setup()
    render(<CommandPalette />)

    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('combobox'), ':w')

    expect(await screen.findByRole('option', { name: /download config\.toml/ })).toBeInTheDocument()
  })

  it('opens the export dialog rather than writing the file behind the user', async () => {
    const user = userEvent.setup()
    render(<CommandPalette />)

    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('combobox'), ':w')
    await user.click(await screen.findByRole('option', { name: /download config\.toml/ }))

    expect(useShellStore.getState().exportTab).toBe('file')
    expect(useShellStore.getState().paletteOpen).toBe(false)
  })

  it('reaches the diff from the palette, and does so while an error stands', async () => {
    const user = userEvent.setup()
    // With an error the write door is shut at both ends, so this is the only way
    // in to the dialog that names what is wrong.
    useConfigStore.getState().set('ui.sidebar_width', 'wide')
    render(<CommandPalette />)

    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('combobox'), ':diff')
    const item = await screen.findByRole('option', { name: /:diff/ })
    expect(item).not.toHaveAttribute('data-disabled', 'true')

    await user.click(item)

    expect(useShellStore.getState().exportTab).toBe('diff')
  })

  it('shows each setting with what it currently reads', async () => {
    const user = userEvent.setup()
    render(<CommandPalette />)

    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('combobox'), 'ui.sidebar_width')

    expect(await screen.findByRole('option', { name: /ui\.sidebar_width\s*26/ })).toBeInTheDocument()
  })
})
