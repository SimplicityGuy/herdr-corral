import App from '@/App'
import { KeysEditor } from '@/components/editors/KeysEditor'
import { COMMAND_FIELDS, bindingKeys } from '@/lib/keybindings'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
  // corral opens on the import screen; every spec about the editor has to say
  // which document it is editing first.
  useShellStore.getState().setLanding(false)
})

/** Write a setting the way anything outside the editor would. */
function set(path: string, value: string): void {
  act(() => useConfigStore.getState().set(path, value))
}

function exported(): string {
  return useConfigStore.getState().exportText()
}

describe('KeysEditor', () => {
  it('lists every keybinding setting herdr documents', () => {
    render(<KeysEditor />)

    const missing = bindingKeys().filter(
      (path) => screen.queryByRole('textbox', { name: path }) === null,
    )
    expect(missing).toEqual([])
  })

  it('groups the actions under headings a person can scan', () => {
    render(<KeysEditor />)

    for (const group of ['prefix and global', 'panes', 'tabs and workspaces', 'navigate mode']) {
      expect(screen.getByRole('region', { name: group })).toBeInTheDocument()
    }
  })

  it('shows each row with its chord, its description and herdr’s default', () => {
    render(<KeysEditor />)

    expect(screen.getByRole('textbox', { name: 'keys.split_vertical' })).toHaveValue('prefix+v')
    expect(screen.getByText('Split pane vertically (side by side).')).toBeInTheDocument()
    const panes = within(screen.getByRole('region', { name: 'panes' }))
    expect(panes.getAllByText('default prefix+v')).toHaveLength(1)
  })

  it('shows a chord verbatim rather than normalized', () => {
    set('keys.split_horizontal', 'prefix+plus')
    render(<KeysEditor />)

    // `formatChord` would print this `prefix++`, which `parseChord` refuses.
    expect(screen.getByRole('textbox', { name: 'keys.split_horizontal' })).toHaveValue(
      'prefix+plus',
    )
  })

  it('writes a recorded chord into the file under [keys]', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)

    const record = screen.getByRole('button', { name: 'record keys.split_vertical' })
    await user.click(record)
    fireEvent.keyDown(record, { key: 'P', ctrlKey: true, shiftKey: true })

    expect(screen.getByRole('textbox', { name: 'keys.split_vertical' })).toHaveValue(
      'ctrl+shift+p',
    )
    expect(exported()).toContain('[keys]')
    expect(exported()).toContain('split_vertical = "ctrl+shift+p"')
  })

  it('cancels a recording on esc and leaves the setting alone', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)

    const record = screen.getByRole('button', { name: 'record keys.split_vertical' })
    await user.click(record)
    fireEvent.keyDown(record, { key: 'Escape' })

    expect(screen.getByRole('textbox', { name: 'keys.split_vertical' })).toHaveValue('prefix+v')
    expect(useConfigStore.getState().isDirty()).toBe(false)
  })

  it('writes nothing for a row that was only focused and left', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)
    const before = exported()

    // Browsing rows moves focus out of one field group after another, and every
    // one of those is a settle. None of them is an edit: a binding on its schema
    // default is unset, and writing that value back would put a pure-default
    // line in a file whose header promises only what differs from the defaults.
    for (const path of ['keys.zoom', 'keys.split_vertical', 'keys.close_pane']) {
      await user.click(screen.getByRole('textbox', { name: path }))
    }
    await user.click(screen.getByRole('button', { name: 'reset keys.help' }))

    expect(useConfigStore.getState().changedLeaves()).toEqual([])
    expect(useConfigStore.getState().isDirty()).toBe(false)
    expect(exported()).toBe(before)
  })

  it('writes a chord left behind on the way to the prefix+ toggle', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)

    const field = screen.getByRole('textbox', { name: 'keys.zoom' })
    await user.clear(field)
    await user.type(field, 'prefix+f')
    // Tab lands on the toggle, which is inside the control and settles nothing;
    // the click after it leaves the control for good.
    await user.tab()
    await user.click(screen.getByRole('button', { name: 'reset keys.help' }))

    expect(useConfigStore.getState().effective('keys.zoom')).toBe('prefix+f')
  })

  it('writes through when the prefix+ toggle is ticked', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)

    // `keys.remote_image_paste` is a direct chord, so the toggle has somewhere
    // to go: ticking it must reach the file, not just the field.
    await user.click(
      screen.getByRole('checkbox', { name: 'prefix+ for keys.remote_image_paste' }),
    )

    expect(useConfigStore.getState().effective('keys.remote_image_paste')).toBe('prefix+ctrl+v')
    expect(exported()).toContain('remote_image_paste = "prefix+ctrl+v"')

    await user.click(
      screen.getByRole('checkbox', { name: 'prefix+ for keys.remote_image_paste' }),
    )
    expect(useConfigStore.getState().effective('keys.remote_image_paste')).toBe('ctrl+v')
  })

  it('writes a typed chord when focus leaves the field', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)

    const field = screen.getByRole('textbox', { name: 'keys.help' })
    await user.clear(field)
    await user.type(field, 'prefix+f1')
    await user.click(screen.getByRole('button', { name: 'reset keys.settings' }))

    expect(useConfigStore.getState().effective('keys.help')).toBe('prefix+f1')
    expect(exported()).toContain('help = "prefix+f1"')
  })

  it('refuses a chord herdr cannot read, and says so instead of writing it', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)

    const field = screen.getByRole('textbox', { name: 'keys.zoom' })
    await user.clear(field)
    await user.type(field, 'prefix+{Enter}')

    expect(screen.getByText(/cannot read "prefix\+" as a herdr keybinding/)).toBeInTheDocument()
    expect(useConfigStore.getState().effective('keys.zoom')).toBe('prefix+z')
  })

  it('takes the 1..9 range an indexed action binds', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)

    const field = screen.getByRole('textbox', { name: 'keys.switch_workspace' })
    await user.type(field, 'prefix+alt+1..9{Enter}')

    expect(useConfigStore.getState().effective('keys.switch_workspace')).toBe('prefix+alt+1..9')
  })

  it('takes a typed chord on enter', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)

    const field = screen.getByRole('textbox', { name: 'keys.zoom' })
    await user.clear(field)
    await user.type(field, 'prefix+f{Enter}')

    expect(useConfigStore.getState().effective('keys.zoom')).toBe('prefix+f')
  })

  it('resets a row to herdr’s default', async () => {
    const user = userEvent.setup()
    set('keys.zoom', 'prefix+f')
    render(<KeysEditor />)

    await user.click(screen.getByRole('button', { name: 'reset keys.zoom' }))

    expect(useConfigStore.getState().effective('keys.zoom')).toBe('prefix+z')
    expect(screen.getByRole('textbox', { name: 'keys.zoom' })).toHaveValue('prefix+z')
  })

  it('refuses a prefix+ chord on a navigate-mode field, with herdr’s message', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)

    const field = screen.getByRole('textbox', { name: 'keys.navigate_pane_left' })
    await user.clear(field)
    await user.type(field, 'prefix+x{Enter}')

    expect(screen.getByText(/navigate keybindings must not include prefix\+/)).toBeInTheDocument()
    expect(useConfigStore.getState().effective('keys.navigate_pane_left')).toBe('h')
  })

  it('offers no prefix+ toggle on a navigate-mode field', () => {
    render(<KeysEditor />)

    expect(
      screen.queryByRole('checkbox', { name: 'prefix+ for keys.navigate_pane_left' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'prefix+ for keys.split_vertical' }),
    ).toBeInTheDocument()
  })

  it('marks both actions when two of them ask for the same chord', () => {
    set('keys.split_vertical', 'prefix+y')
    set('keys.close_pane', 'prefix+y')
    render(<KeysEditor />)

    const named = screen.getAllByText(
      /kept keys\.split_vertical, disabled keys\.close_pane/,
    )
    expect(named).toHaveLength(2)
    expect(named.some((node) => node.textContent?.includes('keeps the chord'))).toBe(true)
  })

  it('says nothing about a duplicate that is only herdr’s own default', () => {
    // herdr drops a *default* that collides with a user binding, silently.
    set('keys.split_vertical', 'prefix+x')
    render(<KeysEditor />)

    expect(screen.queryByText(/disabled keys\.close_pane/)).not.toBeInTheDocument()
  })
})

describe('KeysEditor · [[keys.command]]', () => {
  it('starts with none, and says so', () => {
    render(<KeysEditor />)

    expect(screen.getByText(/none yet/)).toBeInTheDocument()
  })

  it('writes a correct [[keys.command]] block for a popup command', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)

    await user.click(screen.getByRole('button', { name: '+ add command' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'keys.command[0].type' }), 'popup')

    const key = screen.getByRole('textbox', { name: 'keys.command[0].key' })
    await user.type(key, 'prefix+t{Enter}')
    await user.type(screen.getByRole('textbox', { name: 'keys.command[0].command' }), 'htop{Enter}')
    await user.type(screen.getByRole('textbox', { name: 'keys.command[0].width' }), '80%{Enter}')
    await user.type(screen.getByRole('textbox', { name: 'keys.command[0].height' }), '24{Enter}')

    const text = exported()
    expect(text).toContain('[[keys.command]]')
    expect(text).toContain('key = "prefix+t"')
    expect(text).toContain('type = "popup"')
    expect(text).toContain('command = "htop"')
    expect(text).toContain('width = "80%"')
    expect(text).toContain('height = 24')
  })

  it('offers every field herdr’s command table accepts', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)

    await user.click(screen.getByRole('button', { name: '+ add command' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'keys.command[0].type' }), 'popup')

    const missing = COMMAND_FIELDS.filter(
      (field) => screen.queryByLabelText(`keys.command[0].${field}`) === null,
    )
    expect(missing).toEqual([])
  })

  it('appends at the next free index rather than into a gap', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)
    const add = screen.getByRole('button', { name: '+ add command' })

    await user.click(add)
    await user.click(add)

    expect(screen.getByRole('textbox', { name: 'keys.command[1].key' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'keys.command[2].key' })).not.toBeInTheDocument()
  })

  it('closes the gap when a command in the middle is removed', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)
    const add = screen.getByRole('button', { name: '+ add command' })

    await user.click(add)
    await user.click(add)
    await user.type(screen.getByRole('textbox', { name: 'keys.command[1].command' }), 'htop{Enter}')
    await user.click(screen.getByRole('button', { name: 'remove keys.command[0]' }))

    expect(screen.getByRole('textbox', { name: 'keys.command[0].command' })).toHaveValue('htop')
    expect(screen.queryByRole('textbox', { name: 'keys.command[1].command' })).not.toBeInTheDocument()
    expect(exported()).toContain('command = "htop"')
  })

  it('undoes a removal in one step', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)
    const add = screen.getByRole('button', { name: '+ add command' })

    await user.click(add)
    await user.click(add)
    await user.type(screen.getByRole('textbox', { name: 'keys.command[1].command' }), 'htop{Enter}')
    await user.click(screen.getByRole('button', { name: 'remove keys.command[0]' }))
    expect(screen.queryByRole('textbox', { name: 'keys.command[1].command' })).not.toBeInTheDocument()

    // Moving every entry down a slot is one thing the user did, so it is one
    // thing to take back.
    act(() => useConfigStore.getState().undo())

    expect(screen.getByRole('textbox', { name: 'keys.command[1].command' })).toHaveValue('htop')
    expect(screen.getByRole('textbox', { name: 'keys.command[0].command' })).toHaveValue('')
  })

  it('records a chord into a custom command', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)

    await user.click(screen.getByRole('button', { name: '+ add command' }))
    const record = screen.getByRole('button', { name: 'record keys.command[0].key' })
    await user.click(record)
    fireEvent.keyDown(record, { key: 'F5' })

    expect(useConfigStore.getState().effective('keys.command[0].key')).toBe('f5')
  })
})

describe('KeysEditor · [keys.indexed]', () => {
  it('says the indexed shortcuts are legacy and does not migrate them', () => {
    render(<KeysEditor />)

    const block = within(screen.getByRole('region', { name: 'indexed shortcuts' }))
    expect(block.getByText(/Legacy/)).toBeInTheDocument()
    expect(block.getByText(/does not migrate them for you/)).toBeInTheDocument()
  })

  it('writes a modifier combo under [keys.indexed]', async () => {
    const user = userEvent.setup()
    render(<KeysEditor />)

    await user.type(screen.getByRole('textbox', { name: 'keys.indexed.tabs' }), 'alt{Enter}')

    expect(exported()).toContain('[keys.indexed]')
    expect(exported()).toContain('tabs = "alt"')
  })
})

describe('the [4] keys section', () => {
  it('takes the centre frame when the section is open, and gives it back', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '[4] keys' }))
    expect(screen.getByRole('region', { name: /^keybindings/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^preview/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '[1] layout' }))
    expect(screen.getByRole('region', { name: /^preview/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^keybindings/ })).not.toBeInTheDocument()
  })

  it('records in place from a tree row, and the tree says so', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '[4] keys' }))
    const tree = within(screen.getByRole('region', { name: 'settings' }))
    await user.click(tree.getByRole('button', { name: 'keys.zoom = prefix+z' }))

    const popover = within(screen.getByRole('dialog', { name: 'keys.zoom' }))
    const record = popover.getByRole('button', { name: 'record keys.zoom' })
    await user.click(record)
    fireEvent.keyDown(record, { key: 'F5' })

    expect(tree.getByRole('button', { name: 'keys.zoom = f5' })).toBeInTheDocument()
  })
})
