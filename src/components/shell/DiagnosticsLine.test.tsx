import { DiagnosticsLine } from '@/components/shell/DiagnosticsLine'
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

  it('lists the changed keys behind :diff', async () => {
    const user = userEvent.setup()
    useConfigStore.getState().set('ui.sidebar_width', 40)
    show()

    expect(screen.queryByRole('region', { name: 'changed keys' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: ':diff' }))

    const diff = screen.getByRole('region', { name: 'changed keys' })
    expect(diff).toHaveTextContent('ui.sidebar_width')
  })
})
