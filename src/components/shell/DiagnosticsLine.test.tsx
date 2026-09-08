import { DiagnosticsLine } from '@/components/shell/DiagnosticsLine'
import { REPO_TEXT, REPO_URL } from '@/components/shell/RepoLink'
import { SUPPORT_TEXT, SUPPORT_URL } from '@/components/shell/SupportLink'
import { BLOCKED_REASON } from '@/lib/download'
import { TooltipProvider } from '@/components/ui/tooltip'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
})

function show() {
  return render(
    <TooltipProvider>
      <DiagnosticsLine />
    </TooltipProvider>,
  )
}

/** A value herdr's deserializer rejects, so the whole file would be discarded. */
function makeAnError() {
  useConfigStore.getState().set('ui.sidebar_width', 'wide')
}

describe('DiagnosticsLine', () => {
  it('starts on EDIT with a clean config and nothing changed', () => {
    show()

    expect(screen.getByLabelText('mode')).toHaveTextContent('EDIT')
    expect(screen.getByText(/0 errors/)).toBeInTheDocument()
    expect(screen.getByText(/0 warnings/)).toBeInTheDocument()
    expect(screen.getByText('0 keys changed')).toBeInTheDocument()
  })

  it('shows the mode the store is in, so later beads can say DRAG or RECORD', () => {
    useShellStore.getState().setMode('RECORD')
    show()

    expect(screen.getByLabelText('mode')).toHaveTextContent('RECORD')
  })

  it('counts one changed key as one key', () => {
    useConfigStore.getState().set('ui.sidebar_width', 40)
    show()

    expect(screen.getByText('1 key changed')).toBeInTheDocument()
  })

  it('counts the changed keys', () => {
    useConfigStore.getState().set('ui.sidebar_width', 40)
    useConfigStore.getState().set('theme.name', 'gruvbox')
    show()

    expect(screen.getByText('2 keys changed')).toBeInTheDocument()
  })

  it('counts errors and prints the first warning text', () => {
    useConfigStore.getState().set('theme.name', 'not-a-theme')
    show()

    expect(screen.getByText(/1 warning/)).toHaveTextContent('not-a-theme')
  })

  it('links to buy me a coffee in a new tab, styled as a verb rather than the vendor widget', () => {
    show()

    const link = screen.getByRole('link', { name: new RegExp(SUPPORT_TEXT) })
    expect(link).toHaveAttribute('href', SUPPORT_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(document.querySelector('script[src*="buymeacoffee"]')).toBeNull()
  })

  it('links to the repository in a new tab, with the mark and no fetched star count', () => {
    show()

    const link = screen.getByRole('link', { name: new RegExp(REPO_TEXT) })
    expect(link).toHaveAttribute('href', REPO_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('offers the download while the config is clean', () => {
    show()

    expect(screen.getByRole('button', { name: /download config\.toml/ })).toBeEnabled()
  })

  it('blocks the download while an error stands, and says why', () => {
    makeAnError()
    show()

    const download = screen.getByRole('button', { name: /download config\.toml/ })
    expect(download).toBeDisabled()
    expect(download).toHaveAccessibleDescription(BLOCKED_REASON)
    expect(screen.getByText(/1 error/)).toBeInTheDocument()
  })

  it('opens the export dialog on its diff tab from :diff', async () => {
    const user = userEvent.setup()
    useConfigStore.getState().set('ui.sidebar_width', 40)
    show()

    expect(useShellStore.getState().exportTab).toBeNull()

    await user.click(screen.getByRole('button', { name: ':diff' }))

    expect(useShellStore.getState().exportTab).toBe('diff')
  })

  it('opens the export dialog on the file from :w', async () => {
    const user = userEvent.setup()
    show()

    await user.click(screen.getByRole('button', { name: /download config\.toml/ }))

    expect(useShellStore.getState().exportTab).toBe('file')
  })

  it('refuses to open the write door while an error stands', async () => {
    const user = userEvent.setup()
    makeAnError()
    show()

    await user.click(screen.getByRole('button', { name: /download config\.toml/ }))

    expect(useShellStore.getState().exportTab).toBeNull()
  })

  it('always lets the diff through, error or not', async () => {
    const user = userEvent.setup()
    makeAnError()
    show()

    await user.click(screen.getByRole('button', { name: ':diff' }))

    expect(useShellStore.getState().exportTab).toBe('diff')
  })
})
