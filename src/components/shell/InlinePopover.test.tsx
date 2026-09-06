import { clearEditors, registerEditor } from '@/components/shell/editor-registry'
import { InlinePopover } from '@/components/shell/InlinePopover'
import { POPOVER_WIDTH } from '@/lib/popover'
import { SettingsTree } from '@/components/shell/SettingsTree'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
})

afterEach(() => {
  clearEditors()
})

const NOWHERE = { top: 0, left: 0, width: 0, height: 0 }

function open(key: string) {
  useShellStore.getState().openEditor({ key, anchor: NOWHERE })
}

describe('InlinePopover', () => {
  it('shows nothing until an editor is opened', () => {
    render(<InlinePopover />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('captions itself with the key path', () => {
    open('ui.sidebar_width')
    render(<InlinePopover />)

    expect(screen.getByRole('dialog', { name: 'ui.sidebar_width' })).toHaveTextContent(
      '┤ ui.sidebar_width ├',
    )
  })

  it('takes a caption from the caller when one is given', () => {
    useShellStore.getState().openEditor({
      key: 'ui.sidebar.agents.rows',
      anchor: NOWHERE,
      caption: 'agents.rows[0]',
    })
    render(<InlinePopover />)

    expect(screen.getByRole('dialog', { name: 'agents.rows[0]' })).toBeInTheDocument()
  })

  it('applies on enter and closes', async () => {
    const user = userEvent.setup()
    open('ui.sidebar_width')
    render(<InlinePopover />)

    const field = screen.getByRole('spinbutton', { name: 'ui.sidebar_width' })
    await user.clear(field)
    await user.type(field, '42{Enter}')

    expect(useConfigStore.getState().effective('ui.sidebar_width')).toBe(42)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on esc without applying anything', async () => {
    const user = userEvent.setup()
    open('ui.sidebar_width')
    render(<InlinePopover />)

    const field = screen.getByRole('spinbutton', { name: 'ui.sidebar_width' })
    await user.clear(field)
    await user.type(field, '99')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useConfigStore.getState().effective('ui.sidebar_width')).toBe(26)
    expect(useConfigStore.getState().isDirty()).toBe(false)
  })

  it('takes focus on open and gives it back to the row on close', async () => {
    const user = userEvent.setup()
    useShellStore.getState().setSection('sidebar')
    render(
      <>
        <SettingsTree />
        <InlinePopover />
      </>,
    )

    const row = screen.getByRole('button', { name: 'ui.sidebar_width = 26' })
    row.focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('spinbutton', { name: 'ui.sidebar_width' })).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ui.sidebar_width = 26' })).toHaveFocus()
  })

  it('traps tab inside the frame', async () => {
    const user = userEvent.setup()
    open('ui.sidebar_width')
    render(
      <>
        <button type="button">outside</button>
        <InlinePopover />
      </>,
    )

    const field = screen.getByRole('spinbutton', { name: 'ui.sidebar_width' })
    const apply = screen.getByRole('button', { name: 'apply ui.sidebar_width' })

    field.focus()
    await user.tab()
    expect(apply).toHaveFocus()

    await user.tab()
    expect(field).toHaveFocus()

    await user.tab({ shift: true })
    expect(apply).toHaveFocus()
  })

  it('gives an editor the frame width it registered for', () => {
    registerEditor('ui.sidebar_width', () => <p>wide</p>, { width: 560 })
    open('ui.sidebar_width')
    render(<InlinePopover />)

    expect(screen.getByRole('dialog')).toHaveStyle({ width: '560px' })
  })

  it('keeps ADR-0002’s column for an editor that asked for nothing', () => {
    open('ui.sidebar_width')
    render(<InlinePopover />)

    expect(screen.getByRole('dialog')).toHaveStyle({ width: `${POPOVER_WIDTH}px` })
  })

  it('hands the key to whichever editor claimed it', () => {
    registerEditor('ui.sidebar_width', ({ path }) => <p>{`claimed ${path}`}</p>)
    open('ui.sidebar_width')
    render(<InlinePopover />)

    expect(screen.getByText('claimed ui.sidebar_width')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('offers a select for an enum and applies the choice', async () => {
    const user = userEvent.setup()
    open('ui.tab_bar_position')
    render(<InlinePopover />)

    const select = screen.getByRole('combobox', { name: 'ui.tab_bar_position' })
    await user.selectOptions(select, 'bottom')
    await user.click(screen.getByRole('button', { name: 'apply ui.tab_bar_position' }))

    expect(useConfigStore.getState().effective('ui.tab_bar_position')).toBe('bottom')
  })

  it('offers a checkbox for a boolean', async () => {
    const user = userEvent.setup()
    open('theme.auto_switch')
    render(<InlinePopover />)

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'apply theme.auto_switch' }))

    expect(useConfigStore.getState().effective('theme.auto_switch')).toBe(true)
  })

  it('refuses to invent a form for a value that is a whole structure', () => {
    open('ui.sidebar.agents.rows')
    render(<InlinePopover />)

    expect(screen.getByText(/edited by its own form/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it.each([
    'ui.sidebar.agents.rows',
    'ui.sidebar.agents.rows_by_agent',
    'ui.sidebar.spaces.rows',
    'ui.tab_bar_right',
    'experimental.cjk_ime_agents',
  ])('closes %s on esc, though its editor has no field to focus', async (key) => {
    const user = userEvent.setup()
    open(key)
    render(<InlinePopover />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useConfigStore.getState().isDirty()).toBe(false)
  })

  it('offers a control to leave a structured editor, for the pointer as well', async () => {
    const user = userEvent.setup()
    open('ui.tab_bar_right')
    render(<InlinePopover />)

    await user.click(screen.getByRole('button', { name: 'esc close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps focus inside a structured editor rather than letting tab escape', async () => {
    const user = userEvent.setup()
    open('ui.tab_bar_right')
    render(
      <>
        <button type="button">outside</button>
        <InlinePopover />
      </>,
    )

    await user.tab()

    expect(screen.getByRole('button', { name: 'outside' })).not.toHaveFocus()
    const focused = document.activeElement
    expect(focused).toBeInstanceOf(HTMLElement)
    expect(screen.getByRole('dialog')).toContainElement(focused as HTMLElement)
  })

  it('cancels when the pointer goes down outside the frame', async () => {
    const user = userEvent.setup()
    open('ui.sidebar_width')
    render(
      <>
        <button type="button">outside</button>
        <InlinePopover />
      </>,
    )

    const field = screen.getByRole('spinbutton', { name: 'ui.sidebar_width' })
    await user.clear(field)
    await user.type(field, '99')
    await user.click(screen.getByRole('button', { name: 'outside' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useConfigStore.getState().effective('ui.sidebar_width')).toBe(26)
  })

  it('settles once: only the first of commit and cancel is heard', () => {
    let props: { commit(value: number): void; cancel(): void } | null = null
    registerEditor('ui.sidebar_width', (given) => {
      props = given as unknown as typeof props
      return <p>stub</p>
    })
    open('ui.sidebar_width')
    render(<InlinePopover />)

    act(() => props?.commit(42))
    // A second write and a late cancel both arrive after the popover settled.
    act(() => props?.commit(7))
    act(() => props?.cancel())

    expect(useConfigStore.getState().effective('ui.sidebar_width')).toBe(42)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows what validate() says about the key being edited', () => {
    useConfigStore.getState().set('theme.name', 'not-a-theme')
    open('theme.name')
    render(<InlinePopover />)

    expect(screen.getByRole('dialog')).toHaveTextContent(/not-a-theme/)
  })
})
