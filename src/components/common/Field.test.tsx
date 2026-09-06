import { Field } from '@/components/common/Field'
import { ownedElsewhere } from '@/lib/scalar-fields'
import { integerBoundOf } from '@/model/validate'
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

    // 77 of the schema's 167 keys are Field's: everything but `keys.*`, the
    // whole `theme` table with `ui.accent`, and the four structured settings
    // (invariant 5's split).
    expect(keys.length).toBe(77)

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

  it('writes an integer once it parses, and keeps the last value a keystroke does not', async () => {
    const user = userEvent.setup()
    render(<Field path="ui.sidebar_width" />)

    const input = screen.getByLabelText('ui.sidebar_width')
    await user.clear(input)
    await user.type(input, '42')
    expect(useConfigStore.getState().explicit().get('ui.sidebar_width')).toBe(42)

    await user.click(screen.getByLabelText('ui.sidebar_width decrease'))
    expect(useConfigStore.getState().explicit().get('ui.sidebar_width')).toBe(41)

    // The trailing `x` never parses, so the store keeps the last value that did.
    await user.type(input, 'x')
    expect(useConfigStore.getState().explicit().get('ui.sidebar_width')).toBe(41)
  })

  it("shows the validator's own range, from validate.ts rather than prose", () => {
    render(<Field path="ui.toast.delay_seconds" />)

    expect(screen.getByText('0–3600')).toBeInTheDocument()
  })

  it('clamps the stepper at the documented lower and upper bounds', async () => {
    const user = userEvent.setup()
    render(<Field path="ui.toast.delay_seconds" />)

    // Starts at the default, 1: one decrease reaches the floor, and a second
    // does not go negative.
    await user.click(screen.getByLabelText('ui.toast.delay_seconds decrease'))
    expect(useConfigStore.getState().explicit().get('ui.toast.delay_seconds')).toBe(0)
    await user.click(screen.getByLabelText('ui.toast.delay_seconds decrease'))
    expect(useConfigStore.getState().explicit().get('ui.toast.delay_seconds')).toBe(0)

    const input = screen.getByLabelText('ui.toast.delay_seconds')
    await user.clear(input)
    await user.type(input, '3600')
    await user.click(screen.getByLabelText('ui.toast.delay_seconds increase'))
    expect(useConfigStore.getState().explicit().get('ui.toast.delay_seconds')).toBe(3600)
  })

  it("shows every integer key's range as validate.ts's own bound, not the prose fallback", () => {
    const integerKeys = allEntries()
      .filter((entry) => entry.type === 'integer')
      .map((entry) => entry.key)
    expect(integerKeys.length).toBe(11)

    for (const key of integerKeys) {
      const { unmount } = render(<Field path={key} />)
      const bound = integerBoundOf(key)
      expect(screen.getByText(bound === undefined ? '0–' : `0–${bound}`)).toBeInTheDocument()
      unmount()
    }
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

  it("offers theme.name as a themeNames() select rather than free text, and keeps an unlisted value", async () => {
    const user = userEvent.setup()
    render(<Field path="theme.name" />)

    await user.click(screen.getByRole('combobox', { name: 'theme.name' }))
    await user.click(await screen.findByRole('option', { name: 'gruvbox' }))
    expect(useConfigStore.getState().explicit().get('theme.name')).toBe('gruvbox')
  })

  it("keeps an out-of-list theme.name value selectable, the way the generic enum control does", () => {
    useConfigStore.getState().set('theme.name', 'not-a-real-theme')
    render(<Field path="theme.name" />)

    expect(screen.getByRole('combobox', { name: 'theme.name' })).toHaveTextContent('not-a-real-theme')
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
