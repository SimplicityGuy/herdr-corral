/**
 * The status bar editor, against the acceptance of its bead.
 *
 * Every test is the same shape: drive the editor the way a person would, then
 * read the *preview* and the *export text*. Asserting the editor's own controls
 * would only prove it agrees with itself; the mock is what the user is looking
 * at, and the text behind `:w` is what herdr will read.
 */
import { StatusBarEditor, StatusBarView } from '@/components/editors/StatusBarEditor'
import { HerdrPreview } from '@/components/preview/HerdrPreview'
import { DiagnosticsLine } from '@/components/shell/DiagnosticsLine'
import { editorFor } from '@/components/shell/editor-registry'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { TomlValue } from '@/model/parse'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
})

/**
 * The editor and the mock on screen together, which is how the section reads.
 *
 * `TooltipProvider` because the diagnostics line has one, and `App` is where it
 * is normally mounted.
 */
function open() {
  return render(
    <TooltipProvider>
      <StatusBarView />
      <HerdrPreview />
      <DiagnosticsLine />
    </TooltipProvider>,
  )
}

function set(path: string, value: TomlValue): void {
  act(() => {
    useConfigStore.getState().set(path, value)
  })
}

function exported(): string {
  return useConfigStore.getState().exportText()
}

function stored(): TomlValue | undefined {
  return useConfigStore.getState().effective('ui.tab_bar_right')
}

/** What the preview draws at the right of the tab bar, in order. */
function drawn(): string[] {
  const region = screen.getByRole('button', { name: 'tab bar status entries' })
  return [...region.querySelectorAll<HTMLElement>('[data-entry]')].map(
    (entry) => `${entry.dataset.entry}:${entry.textContent ?? ''}`,
  )
}

async function add(type: string): Promise<void> {
  const user = userEvent.setup()
  await user.selectOptions(screen.getByLabelText('entry type to add'), type)
  await user.click(screen.getByRole('button', { name: '+ add entry' }))
}

describe('the entry list', () => {
  it('starts empty, and the preview says so', () => {
    open()

    expect(drawn()).toEqual([])
    expect(document.querySelector('[data-part="status-empty"]')).toBeInTheDocument()
  })

  it('adds an entry of the picked type, and the preview draws it', async () => {
    open()

    await add('datetime')

    // SAMPLE_NOW under the default `%H:%M`.
    expect(drawn()).toEqual(['datetime:22:41'])
    expect(stored()).toEqual([{ type: 'datetime' }])
  })

  it('writes the entry as an inline table in the export', async () => {
    open()

    await add('hostname')

    expect(exported()).toContain('tab_bar_right = [{ type = "hostname" }]')
  })

  it('gives a required field an empty value rather than a hole', async () => {
    open()

    await add('text')

    // A `text` entry with no `text` key is a file herdr throws away whole.
    expect(stored()).toEqual([{ type: 'text', text: '' }])
    expect(screen.getByText(/0 errors/)).toBeInTheDocument()
  })

  it('draws one input per field the type accepts, and writes what is typed', async () => {
    const user = userEvent.setup()
    open()

    await add('command')
    expect(screen.getByLabelText('ui.tab_bar_right[0].command')).toBeInTheDocument()
    expect(screen.getByLabelText('ui.tab_bar_right[0].interval_seconds')).toBeInTheDocument()
    expect(screen.getByLabelText('ui.tab_bar_right[0].timeout_seconds')).toBeInTheDocument()

    await user.type(screen.getByLabelText('ui.tab_bar_right[0].command'), 'uptime{Enter}')
    await user.type(screen.getByLabelText('ui.tab_bar_right[0].interval_seconds'), '30{Enter}')

    expect(stored()).toEqual([{ type: 'command', command: 'uptime', interval_seconds: 30 }])
    expect(drawn()).toEqual(['command:⟨uptime⟩'])
  })

  it('deletes an optional field emptied, rather than writing nothing into it', async () => {
    const user = userEvent.setup()
    open()

    await add('datetime')
    const format = screen.getByLabelText('ui.tab_bar_right[0].format')
    await user.type(format, '%a %d{Enter}')
    expect(stored()).toEqual([{ type: 'datetime', format: '%a %d' }])

    await user.clear(format)
    await user.tab()
    expect(stored()).toEqual([{ type: 'datetime' }])
  })

  it('removes an entry from the list and from the preview', async () => {
    const user = userEvent.setup()
    open()
    set('ui.tab_bar_right', [{ type: 'zoom' }, { type: 'hostname' }])
    expect(drawn()).toEqual(['zoom:100%', 'hostname:mbp'])

    await user.click(screen.getByRole('button', { name: 'remove ui.tab_bar_right[0]' }))

    expect(drawn()).toEqual(['hostname:mbp'])
    expect(exported()).not.toContain('zoom')
  })

  it('stops at herdr’s sixteen, and says what the ceiling is', async () => {
    open()
    set(
      'ui.tab_bar_right',
      Array.from({ length: 16 }, () => ({ type: 'zoom' })),
    )

    expect(screen.getByRole('button', { name: '+ add entry' })).toBeDisabled()
    expect(screen.getByText(/at most 16 entries|full at 16 entries/)).toBeInTheDocument()
  })
})

describe('reordering', () => {
  beforeEach(() => {
    set('ui.tab_bar_right', [{ type: 'zoom' }, { type: 'hostname' }, { type: 'datetime' }])
  })

  it('moves an entry with the row’s own command, and the preview follows', async () => {
    const user = userEvent.setup()
    open()

    await user.click(screen.getByRole('button', { name: 'move ui.tab_bar_right[2] up' }))

    expect(drawn()).toEqual(['zoom:100%', 'datetime:22:41', 'hostname:mbp'])
    // Three entries is past the exporter's inline budget, so it writes one per
    // line; the order is what this test is about either way.
    expect(exported()).toContain(
      'tab_bar_right = [\n  { type = "zoom" },\n  { type = "datetime" },\n  { type = "hostname" },\n]',
    )
  })

  it('moves an entry with alt and an arrow on its handle, and keeps the focus on it', async () => {
    const user = userEvent.setup()
    open()

    const handle = screen.getByRole('button', { name: 'drag ui.tab_bar_right[0]' })
    handle.focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

    expect(drawn()).toEqual(['hostname:mbp', 'zoom:100%', 'datetime:22:41'])
    // The entry moved to slot 1, so the handle the cursor is on is slot 1's.
    expect(screen.getByRole('button', { name: 'drag ui.tab_bar_right[1]' })).toHaveFocus()
  })

  it('has nothing to move past the ends', async () => {
    open()

    expect(screen.getByRole('button', { name: 'move ui.tab_bar_right[0] up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'move ui.tab_bar_right[2] down' })).toBeDisabled()
  })
})

describe('the bar itself', () => {
  it('draws the separator between entries, as typed', async () => {
    const user = userEvent.setup()
    open()
    set('ui.tab_bar_right', [{ type: 'zoom' }, { type: 'hostname' }])

    const separator = screen.getByLabelText('ui.tab_bar_right_separator')
    await user.clear(separator)
    await user.type(separator, ' | ')

    const region = screen.getByRole('button', { name: 'tab bar status entries' })
    expect(within(region).getByText('|', { exact: false })).toBeInTheDocument()
    expect(exported()).toContain('tab_bar_right_separator = " | "')
  })

  it('moves the whole bar under the panes when the position changes', async () => {
    const user = userEvent.setup()
    open()

    const bar = document.querySelector<HTMLElement>('[data-part="tab-bar"]')
    expect(bar?.style.borderBottom).not.toBe('')

    await user.click(screen.getByRole('radio', { name: 'ui.tab_bar_position bottom' }))

    const moved = document.querySelector<HTMLElement>('[data-part="tab-bar"]')
    expect(moved?.style.borderTop).not.toBe('')
    expect(moved?.style.borderBottom).toBe('')
  })

  it('tells the preview the bar hides itself at one tab', async () => {
    const user = userEvent.setup()
    open()

    await user.click(screen.getByLabelText('ui.hide_tab_bar_when_single_tab'))

    expect(document.querySelector('[data-part="single-tab-hint"]')).toBeInTheDocument()
  })

  it('leaves the toast and indicator settings of the section reachable', () => {
    open()

    expect(screen.getByLabelText('ui.status_indicators')).toBeInTheDocument()
    expect(screen.getByLabelText('ui.toast.delay_seconds')).toBeInTheDocument()
  })
})

describe('the popover', () => {
  it('claims all four tab bar settings, so the tree and the preview open it', () => {
    for (const key of [
      'ui.tab_bar_right',
      'ui.tab_bar_right_separator',
      'ui.tab_bar_position',
      'ui.hide_tab_bar_when_single_tab',
    ]) {
      expect(editorFor(key), `expected the status bar editor to claim ${key}`).toBe(StatusBarEditor)
    }
  })

  it('offers the same list and the same three settings as the section view', () => {
    render(<StatusBarEditor />)

    expect(screen.getByLabelText('entry type to add')).toBeInTheDocument()
    expect(screen.getByLabelText('ui.tab_bar_right_separator')).toBeInTheDocument()
    expect(screen.getByLabelText('ui.tab_bar_position')).toBeInTheDocument()
    expect(screen.getByLabelText('ui.hide_tab_bar_when_single_tab')).toBeInTheDocument()
  })

  it('puts the mode badge back to EDIT when it is torn down mid-drag', () => {
    const view = render(<StatusBarEditor />)
    act(() => {
      useShellStore.getState().setMode('DRAG')
    })

    view.unmount()

    expect(useShellStore.getState().mode).toBe('EDIT')
  })
})
