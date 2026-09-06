/**
 * The popover half of the chord editor, exercised through the real host.
 *
 * `InlinePopover` owns the transaction — `esc`, focus, and "exactly one of
 * commit or cancel" — so the editor is opened the way the settings tree opens
 * it rather than rendered on its own with stub callbacks.
 */
import '@/components/editors/ChordEditor'
import { InlinePopover } from '@/components/shell/InlinePopover'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
})

/** Open the popover on a key, the way a tree row does. */
function open(key: string): void {
  act(() =>
    useShellStore.getState().openEditor({ key, anchor: { top: 0, left: 0, width: 0, height: 0 } }),
  )
}

describe('ChordEditor', () => {
  it('claims every chord in the [keys] table', () => {
    render(<InlinePopover />)
    open('keys.split_vertical')

    expect(screen.getByRole('button', { name: 'record keys.split_vertical' })).toBeInTheDocument()
  })

  it('leaves the modifier-only indexed settings to the generic editor', () => {
    render(<InlinePopover />)
    open('keys.indexed.tabs')

    expect(screen.queryByRole('button', { name: /^record/ })).not.toBeInTheDocument()
  })

  it('leaves a custom command’s other fields to the generic editor', () => {
    render(<InlinePopover />)
    open('keys.command[0].command')

    expect(screen.queryByRole('button', { name: /^record/ })).not.toBeInTheDocument()
  })

  it('applies a recorded chord and closes', async () => {
    const user = userEvent.setup()
    render(<InlinePopover />)
    open('keys.split_vertical')

    const record = screen.getByRole('button', { name: 'record keys.split_vertical' })
    await user.click(record)
    fireEvent.keyDown(record, { key: 'P', ctrlKey: true, shiftKey: true })

    expect(useConfigStore.getState().effective('keys.split_vertical')).toBe('ctrl+shift+p')
    expect(useShellStore.getState().editor).toBeNull()
  })

  it('writes nothing when the walk through it changes nothing', async () => {
    const user = userEvent.setup()
    render(<InlinePopover />)
    open('keys.zoom')

    // The popover traps tab, so this walks the record button, the field and the
    // toggle and comes back round. Every step out of the control settles the
    // field, and none of those settles is an edit: the key is on its schema
    // default, which means unset, and writing it back would put a pure-default
    // line in the file.
    await user.tab()
    await user.tab()
    await user.tab()
    await user.tab()

    expect(useConfigStore.getState().changedLeaves()).toEqual([])
    expect(useConfigStore.getState().isDirty()).toBe(false)
    expect(useShellStore.getState().editor).not.toBeNull()
  })

  it('writes nothing when the apply button is pressed on an unchanged default', async () => {
    const user = userEvent.setup()
    render(<InlinePopover />)
    open('keys.zoom')

    await user.click(screen.getByRole('button', { name: 'apply keys.zoom' }))

    expect(useConfigStore.getState().isDirty()).toBe(false)
  })

  it('still commits once the chord actually changes', async () => {
    const user = userEvent.setup()
    render(<InlinePopover />)
    open('keys.zoom')

    await user.tab()
    const record = screen.getByRole('button', { name: 'record keys.zoom' })
    await user.click(record)
    fireEvent.keyDown(record, { key: 'F5' })

    expect(useConfigStore.getState().effective('keys.zoom')).toBe('f5')
    expect(useShellStore.getState().editor).toBeNull()
  })

  it('applies a typed chord on enter', async () => {
    const user = userEvent.setup()
    render(<InlinePopover />)
    open('keys.zoom')

    const field = screen.getByRole('textbox', { name: 'keys.zoom' })
    await user.clear(field)
    await user.type(field, 'prefix+f{Enter}')

    expect(useConfigStore.getState().effective('keys.zoom')).toBe('prefix+f')
    expect(useShellStore.getState().editor).toBeNull()
  })

  it('cancels the recording on esc, and the popover on the next one', async () => {
    const user = userEvent.setup()
    render(<InlinePopover />)
    open('keys.split_vertical')

    const record = screen.getByRole('button', { name: 'record keys.split_vertical' })
    await user.click(record)
    // The recorder is the innermost thing, so it takes the first esc.
    fireEvent.keyDown(record, { key: 'Escape' })
    expect(useShellStore.getState().editor).not.toBeNull()
    expect(record).toHaveAttribute('aria-pressed', 'false')

    fireEvent.keyDown(record, { key: 'Escape' })
    expect(useShellStore.getState().editor).toBeNull()
    expect(useConfigStore.getState().isDirty()).toBe(false)
  })

  it('refuses a navigate-mode prefix chord rather than writing it', async () => {
    const user = userEvent.setup()
    render(<InlinePopover />)
    open('keys.navigate_pane_left')

    const field = screen.getByRole('textbox', { name: 'keys.navigate_pane_left' })
    await user.clear(field)
    await user.type(field, 'prefix+x{Enter}')

    expect(screen.getByText(/navigate keybindings must not include prefix\+/)).toBeInTheDocument()
    expect(useConfigStore.getState().effective('keys.navigate_pane_left')).toBe('h')
    expect(useShellStore.getState().editor).not.toBeNull()
  })

  it('says so rather than guessing when a setting holds several chords', () => {
    act(() => useConfigStore.getState().loadText('[keys]\nzoom = ["prefix+z", "prefix+f"]\n'))
    render(<InlinePopover />)
    open('keys.zoom')

    expect(screen.getByText(/2 chords/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^record/ })).not.toBeInTheDocument()
  })
})
