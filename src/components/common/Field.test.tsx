import { Field } from '@/components/common/Field'
import { ownedElsewhere } from '@/lib/scalar-fields'
import { allEntries } from '@/schema'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  resetConfigStore()
})

describe('Field coverage', () => {
  it('renders a labelled control for every key not owned by another editor', () => {
    const keys = allEntries()
      .map((entry) => entry.key)
      .filter((key) => !ownedElsewhere(key))

    // 82 of the schema's 167 keys are Field's: everything but `keys.*`,
    // `theme.custom.*`, and the four structured settings (invariant 5's split).
    expect(keys.length).toBe(82)

    render(
      <>
        {keys.map((key) => (
          <Field key={key} path={key} />
        ))}
      </>,
    )

    for (const key of keys) {
      expect(screen.getByLabelText(key), `expected a control for ${key}`).toBeInTheDocument()
    }
  })
})

describe('Field', () => {
  it('shows the reference description, the default, and no changed marker to start', () => {
    render(<Field path="ui.pane_borders" />)

    expect(screen.getByText(/Draw borders around split panes/i)).toBeInTheDocument()
    expect(screen.getByText('default: true')).toBeInTheDocument()
    expect(screen.queryByLabelText('changed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'reset' })).toBeDisabled()
  })

  it('writes a boolean the moment it is toggled', async () => {
    const user = userEvent.setup()
    render(<Field path="ui.pane_borders" />)

    await user.click(screen.getByLabelText('ui.pane_borders'))

    expect(useConfigStore.getState().explicit().get('ui.pane_borders')).toBe(false)
    expect(screen.getByLabelText('changed')).toBeInTheDocument()
  })

  it('writes an integer once it parses, and clamps the stepper at zero', async () => {
    const user = userEvent.setup()
    render(<Field path="ui.sidebar_width" />)

    const input = screen.getByLabelText('ui.sidebar_width')
    await user.clear(input)
    await user.type(input, '42')
    expect(useConfigStore.getState().explicit().get('ui.sidebar_width')).toBe(42)

    await user.click(screen.getByLabelText('ui.sidebar_width decrease'))
    expect(useConfigStore.getState().explicit().get('ui.sidebar_width')).toBe(41)
  })

  it('shows a documented range and holds an out-of-range integer at 0', async () => {
    const user = userEvent.setup()
    render(<Field path="ui.toast.delay_seconds" />)

    expect(screen.getByText('0–3600')).toBeInTheDocument()

    const input = screen.getByLabelText('ui.toast.delay_seconds')
    await user.clear(input)
    // The trailing `x` never parses, so the store keeps the last value that did.
    await user.type(input, '12x')
    expect(useConfigStore.getState().explicit().get('ui.toast.delay_seconds')).toBe(12)
  })

  it('writes an enum through a toggle group when there are three options or fewer', async () => {
    const user = userEvent.setup()
    render(<Field path="update.channel" />)

    await user.click(screen.getByRole('radio', { name: 'update.channel preview' }))

    expect(useConfigStore.getState().explicit().get('update.channel')).toBe('preview')
  })

  it('writes an enum through a select when there are more than three options', async () => {
    const user = userEvent.setup()
    render(<Field path="ui.toast.delivery" />)

    await user.click(screen.getByRole('combobox', { name: 'ui.toast.delivery' }))
    await user.click(await screen.findByRole('option', { name: 'system' }))

    expect(useConfigStore.getState().explicit().get('ui.toast.delivery')).toBe('system')
  })

  it('writes a string as typed', async () => {
    const user = userEvent.setup()
    render(<Field path="ui.window_title" />)

    const input = screen.getByLabelText('ui.window_title')
    await user.clear(input)
    await user.type(input, 'my herdr')

    expect(useConfigStore.getState().explicit().get('ui.window_title')).toBe('my herdr')
  })

  it('adds and removes chips for a list of strings', async () => {
    const user = userEvent.setup()
    render(<Field path="experimental.cjk_ime_agents" />)

    const input = screen.getByLabelText('experimental.cjk_ime_agents')
    await user.type(input, 'claude{Enter}')
    expect(useConfigStore.getState().explicit().get('experimental.cjk_ime_agents')).toEqual([
      'claude',
    ])

    await user.click(screen.getByRole('button', { name: 'remove claude' }))
    expect(useConfigStore.getState().explicit().get('experimental.cjk_ime_agents')).toEqual([])
  })

  it('resets a changed key: gone from explicit(), back to the default in effective()', async () => {
    const user = userEvent.setup()
    useConfigStore.getState().set('ui.pane_borders', false)
    render(<Field path="ui.pane_borders" />)

    await user.click(screen.getByRole('button', { name: 'reset' }))

    expect(useConfigStore.getState().explicit().has('ui.pane_borders')).toBe(false)
    expect(useConfigStore.getState().effective('ui.pane_borders')).toBe(true)
  })

  it('writes a changed boolean, integer, and enum under the right table headers in the export', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Field path="ui.pane_borders" />
        <Field path="ui.sidebar_width" />
        <Field path="update.channel" />
      </>,
    )

    await user.click(screen.getByLabelText('ui.pane_borders'))
    const width = screen.getByLabelText('ui.sidebar_width')
    await user.clear(width)
    await user.type(width, '42')
    await user.click(screen.getByRole('radio', { name: 'update.channel preview' }))

    const text = useConfigStore.getState().exportText()
    expect(text).toContain('[update]\nchannel = "preview"')
    expect(text).toContain('[ui]\nsidebar_width = 42\npane_borders = false')
  })
})
