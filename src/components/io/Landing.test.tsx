import { Landing, MAX_BYTES } from '@/components/io/Landing'
import fixture from '@/test/fixture-user-config.toml?raw'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
})

function configFile(text = fixture, name = 'config.toml'): File {
  return new File([text], name, { type: 'application/toml' })
}

/** Drop `file` on the zone the way a browser hands one over. */
function drop(file: File): void {
  fireEvent.drop(screen.getByRole('button', { name: /drop your config\.toml here/ }), {
    dataTransfer: { files: [file], types: ['Files'] },
  })
}

function alertText(): string {
  return screen.getByRole('alert').textContent ?? ''
}

describe('Landing', () => {
  it('lands a dropped config in the editor with its comments intact', async () => {
    render(<Landing />)

    drop(configFile())

    await screen.findByRole('button', { name: /drop your config\.toml here/ })
    expect(useConfigStore.getState().source).toBe('file')
    expect(useConfigStore.getState().originalText).toContain('# herdr configuration')
    expect(useShellStore.getState().landing).toBe(false)
  })

  it('gives a dropped config back byte for byte when nothing was edited', async () => {
    render(<Landing />)

    drop(configFile())

    await screen.findByRole('button', { name: /drop your config\.toml here/ })
    expect(useConfigStore.getState().exportText()).toBe(fixture)
  })

  it('opens a config picked through the file chooser', async () => {
    const user = userEvent.setup()
    render(<Landing />)

    await user.upload(screen.getByLabelText('choose a config.toml'), configFile())

    expect(useConfigStore.getState().originalText).toBe(fixture)
    expect(useShellStore.getState().landing).toBe(false)
  })

  it('refuses a file that is neither .toml nor plain text, and says so', async () => {
    render(<Landing />)

    drop(new File(['%PDF-1.7'], 'herdr.pdf', { type: 'application/pdf' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'herdr.pdf is not a .toml file',
    )
    expect(useShellStore.getState().landing).toBe(true)
  })

  it('takes a file the browser calls plain text', async () => {
    render(<Landing />)

    drop(new File(['name = "nord"'], 'herdrrc', { type: 'text/plain' }))

    await screen.findByRole('button', { name: /drop your config\.toml here/ })
    expect(useShellStore.getState().landing).toBe(false)
  })

  it('refuses a file past the size guard, naming the limit', async () => {
    render(<Landing />)
    const huge = configFile()
    Object.defineProperty(huge, 'size', { value: MAX_BYTES + 1 })

    drop(huge)

    expect(await screen.findByRole('alert')).toHaveTextContent('corral opens files up to 1.0 MiB')
    expect(useShellStore.getState().landing).toBe(true)
  })

  it('surfaces a file the browser could not read', async () => {
    render(<Landing />)
    const unreadable = configFile()
    Object.defineProperty(unreadable, 'text', {
      value: () => Promise.reject(new Error('permission denied')),
    })

    drop(unreadable)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'could not read config.toml: permission denied',
    )
  })

  it('shows the line and column of a parse error and keeps the user here', async () => {
    render(<Landing />)

    drop(configFile('[theme]\nname = "catppuccin\n'))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(alertText()).toMatch(/line 2, column \d+/)
    expect(useShellStore.getState().landing).toBe(true)
    expect(useConfigStore.getState().source).toBe('defaults')
  })

  it('shows the caret excerpt once, not once in the sentence and once below', async () => {
    render(<Landing />)

    drop(configFile('[theme]\nname = "catppuccin\n'))

    const alert = await screen.findByRole('alert')
    // smol-toml's `message` is the summary, a blank line, then the same excerpt
    // the `<pre>` renders; taking it whole printed the caret twice.
    const carets = (alert.textContent ?? '').match(/\^/g) ?? []
    expect(carets).toHaveLength(1)
    expect(alert).toHaveTextContent('control characters are not allowed in strings')
    expect(within(alert).getByText(/\^/).tagName).toBe('PRE')
  })

  it('opens an extensionless file the browser gives no type at all', async () => {
    render(<Landing />)

    drop(new File(['name = "nord"'], 'herdrrc', { type: '' }))

    await screen.findByRole('button', { name: /drop your config\.toml here/ })
    expect(useShellStore.getState().landing).toBe(false)
  })

  it('leaves a typeless file that is not TOML to the parser, which says where', async () => {
    render(<Landing />)

    drop(new File(['not = = toml'], 'notes', { type: '' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('not valid TOML')
    expect(useShellStore.getState().landing).toBe(true)
  })

  it('loads a config pasted into the box', async () => {
    const user = userEvent.setup()
    render(<Landing />)

    await user.click(screen.getByLabelText('or paste it'))
    await user.paste('[theme]\nname = "nord"')
    await user.click(screen.getByRole('button', { name: 'load pasted config' }))

    expect(useConfigStore.getState().effective('theme.name')).toBe('nord')
    expect(useShellStore.getState().landing).toBe(false)
  })

  it('will not load an empty paste', () => {
    render(<Landing />)

    expect(screen.getByRole('button', { name: 'load pasted config' })).toBeDisabled()
  })

  it('reports a parse error in pasted text without leaving the landing', async () => {
    const user = userEvent.setup()
    render(<Landing />)

    await user.click(screen.getByLabelText('or paste it'))
    await user.paste('name = ')
    await user.click(screen.getByRole('button', { name: 'load pasted config' }))

    expect(screen.getByRole('alert')).toHaveTextContent('not valid TOML')
    expect(useShellStore.getState().landing).toBe(true)
  })

  it('starts from herdr defaults with no file at all', async () => {
    const user = userEvent.setup()
    render(<Landing />)

    await user.click(screen.getByRole('button', { name: 'start from herdr defaults' }))

    expect(useConfigStore.getState().source).toBe('defaults')
    expect(useConfigStore.getState().originalText).toBe('')
    expect(useShellStore.getState().landing).toBe(false)
  })
})
