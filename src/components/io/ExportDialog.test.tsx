import { ExportDialog } from '@/components/io/ExportDialog'
import { BLOCKED_REASON, CONFIG_PATH } from '@/lib/download'
import fixture from '@/test/fixture-user-config.toml?raw'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The diff walks the whole file, so the dialog must not run it while it is shut.
 * Counting the calls is the only way to see an optimisation that is invisible on
 * screen — and the test beside it checks the thing such a guard usually breaks,
 * which is showing a stale file after edits made while nobody was looking.
 */
const { hunkCalls } = vi.hoisted(() => ({ hunkCalls: { count: 0 } }))
vi.mock('@/lib/diff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/diff')>()
  return {
    ...actual,
    unifiedHunks: (...args: Parameters<typeof actual.unifiedHunks>) => {
      hunkCalls.count += 1
      return actual.unifiedHunks(...args)
    },
  }
})

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
  // The dialog only exists behind the shell, so these tests start past the
  // landing — otherwise "start over" would look like it sent the user back to it.
  useShellStore.getState().setLanding(false)
  hunkCalls.count = 0
})

/** Load the fixture, the way the landing hands a file over. */
function load() {
  useConfigStore.getState().loadText(fixture)
}

/** Open the dialog on `tab`, as `:w` and `:diff` do, and render it. */
function show(tab: 'file' | 'diff' = 'file') {
  useShellStore.getState().openExport(tab)
  return render(<ExportDialog />)
}

/** A value herdr's deserializer rejects, so it would discard the whole file. */
function makeAnError() {
  useConfigStore.getState().set('ui.sidebar_width', 'wide')
}

/** The open tab's panel — the only one Radix keeps mounted. */
function diffPane() {
  return within(screen.getByRole('tabpanel'))
}

describe('ExportDialog', () => {
  it('stays shut until a door opens it', () => {
    load()
    render(<ExportDialog />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the file it would write, comments and all', () => {
    load()
    show()

    expect(screen.getByLabelText('config.toml as it will be written')).toHaveTextContent(
      '# herdr configuration',
    )
  })

  it('says nothing changed when nothing has', () => {
    load()
    show('diff')

    expect(diffPane().getByText('nothing changed yet')).toBeInTheDocument()
  })

  it('shows only the changed hunk after one edit', async () => {
    const user = userEvent.setup()
    load()
    useConfigStore.getState().set('theme.name', 'gruvbox')
    show()

    await user.click(screen.getByRole('tab', { name: 'changed hunks' }))

    const pane = diffPane()
    expect(pane.getByText('-name = "catppuccin"')).toBeInTheDocument()
    expect(pane.getByText('+name = "gruvbox"')).toBeInTheDocument()
    // The rest of the file is not in the diff, which is what "hunks" buys.
    expect(pane.queryByText(/default_shell/)).not.toBeInTheDocument()
  })

  it('opens straight onto the diff when :diff was the door', () => {
    load()
    show('diff')

    expect(screen.getByRole('tab', { name: 'changed hunks' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('offers the three ways out while the config is clean', () => {
    load()
    show()

    expect(screen.getByRole('button', { name: 'download config.toml' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'copy to clipboard' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'copy install snippet' })).toBeEnabled()
  })

  it('blocks the download and the snippet on one error, and names it', () => {
    load()
    makeAnError()
    show()

    const download = screen.getByRole('button', { name: 'download config.toml' })
    expect(download).toBeDisabled()
    expect(download).toHaveAccessibleDescription(
      expect.stringContaining('ui.sidebar_width') as unknown as string,
    )
    expect(download).toHaveAccessibleDescription(
      expect.stringContaining(BLOCKED_REASON) as unknown as string,
    )
    expect(screen.getByRole('button', { name: 'copy install snippet' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('ui.sidebar_width')
  })

  it('still lets the text be copied while an error stands', () => {
    load()
    makeAnError()
    show()

    expect(screen.getByRole('button', { name: 'copy to clipboard' })).toBeEnabled()
  })

  it('copies the file to the clipboard', async () => {
    const user = userEvent.setup()
    load()
    show()

    await user.click(screen.getByRole('button', { name: 'copy to clipboard' }))

    expect(await navigator.clipboard.readText()).toBe(fixture)
    expect(screen.getByRole('status')).toHaveTextContent('config.toml copied')
  })

  it('copies an install snippet that writes the file and reloads herdr', async () => {
    const user = userEvent.setup()
    load()
    show()

    await user.click(screen.getByRole('button', { name: 'copy install snippet' }))

    const snippet = await navigator.clipboard.readText()
    expect(snippet).toContain(`mkdir -p ~/.config/herdr && cat > ${CONFIG_PATH} <<'EOF'`)
    expect(snippet).toContain(fixture)
    expect(snippet).toContain('\nEOF\nherdr server reload-config\n')
  })

  it('says so when the clipboard is out of reach', async () => {
    const user = userEvent.setup()
    load()
    show()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))

    await user.click(screen.getByRole('button', { name: 'copy to clipboard' }))

    expect(screen.getByRole('status')).toHaveTextContent('could not reach the clipboard')
  })

  it('downloads the config as a file', async () => {
    const user = userEvent.setup()
    const url = 'blob:corral/test'
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(url)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clicked: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download)
    })
    load()
    show()

    await user.click(screen.getByRole('button', { name: 'download config.toml' }))

    expect(clicked).toEqual(['config.toml'])
  })

  it('starts over without asking while nothing is changed', async () => {
    const user = userEvent.setup()
    load()
    show()

    await user.click(screen.getByRole('button', { name: 'start over' }))

    expect(useConfigStore.getState().source).toBe('defaults')
    expect(useShellStore.getState().exportTab).toBeNull()
  })

  it('asks before throwing unsaved work away, and takes no for an answer', async () => {
    const user = userEvent.setup()
    load()
    useConfigStore.getState().set('theme.name', 'gruvbox')
    show()

    await user.click(screen.getByRole('button', { name: 'start over' }))
    expect(screen.getByText('1 key changed and not written. Discard?')).toBeInTheDocument()
    expect(useConfigStore.getState().source).toBe('file')

    await user.click(screen.getByRole('button', { name: 'keep editing' }))
    expect(useConfigStore.getState().effective('theme.name')).toBe('gruvbox')
    expect(screen.getByRole('button', { name: 'start over' })).toBeInTheDocument()
  })

  it('throws the work away once the confirmation is answered', async () => {
    const user = userEvent.setup()
    load()
    useConfigStore.getState().set('theme.name', 'gruvbox')
    show()

    await user.click(screen.getByRole('button', { name: 'start over' }))
    await user.click(screen.getByRole('button', { name: 'discard and start over' }))

    expect(useConfigStore.getState().source).toBe('defaults')
    expect(useConfigStore.getState().originalText).toBe('')
    expect(useShellStore.getState().landing).toBe(false)
  })

  it('goes back to the landing to open another file, asking first when dirty', async () => {
    const user = userEvent.setup()
    load()
    useConfigStore.getState().set('theme.name', 'gruvbox')
    show()

    await user.click(screen.getByRole('button', { name: 'open another file' }))
    await user.click(screen.getByRole('button', { name: 'discard and open another file' }))

    expect(useShellStore.getState().landing).toBe(true)
    expect(useShellStore.getState().exportTab).toBeNull()
    expect(useConfigStore.getState().originalText).toBe('')
  })

  it('diffs nothing while it is shut, however much the document changes', () => {
    load()
    render(<ExportDialog />)

    act(() => {
      for (const width of [30, 31, 32, 33]) useConfigStore.getState().set('ui.sidebar_width', width)
    })

    expect(hunkCalls.count).toBe(0)
  })

  it('diffs once the diff tab is the one showing, and not on the file tab', async () => {
    const user = userEvent.setup()
    load()
    useConfigStore.getState().set('theme.name', 'gruvbox')
    show()

    expect(hunkCalls.count).toBe(0)

    await user.click(screen.getByRole('tab', { name: 'changed hunks' }))

    expect(hunkCalls.count).toBeGreaterThan(0)
    expect(diffPane().getByText('+name = "gruvbox"')).toBeInTheDocument()
  })

  it('shows the edits made while it was shut, not what it last computed', async () => {
    const user = userEvent.setup()
    load()
    render(<ExportDialog />)

    act(() => {
      useConfigStore.getState().set('theme.name', 'gruvbox')
      useShellStore.getState().openExport('file')
    })

    expect(screen.getByLabelText('config.toml as it will be written')).toHaveTextContent(
      'name = "gruvbox"',
    )

    await user.click(screen.getByRole('tab', { name: 'changed hunks' }))
    expect(diffPane().getByText('+name = "gruvbox"')).toBeInTheDocument()
  })

  it('writes a whole file when the session started from the defaults', () => {
    useConfigStore.getState().set('theme.name', 'nord')
    show()

    expect(screen.getByLabelText('config.toml as it will be written')).toHaveTextContent(
      'nord',
    )
    // No original to patch, so every line of the diff is new.
    expect(useConfigStore.getState().source).toBe('defaults')
  })
})
