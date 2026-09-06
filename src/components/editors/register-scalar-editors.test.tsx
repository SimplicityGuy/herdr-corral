import '@/components/editors/register-scalar-editors'

import { editorFor } from '@/components/shell/editor-registry'
import { InlinePopover } from '@/components/shell/InlinePopover'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
})

const NOWHERE = { top: 0, left: 0, width: 0, height: 0 }

function open(key: string) {
  useShellStore.getState().openEditor({ key, anchor: NOWHERE })
}

describe('register-scalar-editors', () => {
  it('claims every scalar type Field owns', () => {
    for (const key of [
      'ui.pane_borders', // boolean
      'ui.sidebar_width', // integer
      'update.channel', // enum
      'ui.window_title', // string
      'ui.sound.path', // path
      'ui.accent', // color
      'experimental.cjk_ime_agents', // list of strings
    ]) {
      expect(editorFor(key), `expected a claim for ${key}`).not.toBeNull()
    }
  })

  it('leaves keys.*, theme.custom.*, and the structured settings unclaimed', () => {
    for (const key of [
      'keys.help',
      'keys.prefix',
      'theme.custom.accent',
      'ui.tab_bar_right',
      'ui.sidebar.agents.rows',
    ]) {
      expect(editorFor(key), `expected no claim for ${key}`).toBeNull()
    }
  })

  it('supersedes the generic ValueEditor: a boolean row gets a switch, not a checkbox', () => {
    open('ui.pane_borders')
    render(<InlinePopover />)

    expect(screen.getByRole('switch', { name: 'ui.pane_borders' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('applies on enter, same as the generic editor', async () => {
    const user = userEvent.setup()
    open('ui.pane_borders')
    render(<InlinePopover />)

    await user.click(screen.getByRole('switch', { name: 'ui.pane_borders' }))
    await user.keyboard('{Enter}')

    expect(useConfigStore.getState().effective('ui.pane_borders')).toBe(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on esc without applying the draft', async () => {
    const user = userEvent.setup()
    open('ui.pane_borders')
    render(<InlinePopover />)

    await user.click(screen.getByRole('switch', { name: 'ui.pane_borders' }))
    await user.keyboard('{Escape}')

    expect(useConfigStore.getState().isDirty()).toBe(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('offers a toggle group for a three-or-fewer enum, and applies on enter', async () => {
    const user = userEvent.setup()
    open('update.channel')
    render(<InlinePopover />)

    await user.click(screen.getByRole('radio', { name: 'update.channel preview' }))
    await user.keyboard('{Enter}')

    expect(useConfigStore.getState().effective('update.channel')).toBe('preview')
  })

  it('selects-all, retypes, and applies an integer, the way the keyboard walkthrough drives it', async () => {
    const user = userEvent.setup()
    open('ui.sidebar_width')
    render(<InlinePopover />)

    const field = screen.getByRole('textbox', { name: 'ui.sidebar_width' })
    await user.click(field)
    await user.keyboard('{Control>}a{/Control}')
    await user.keyboard('34{Enter}')

    expect(useConfigStore.getState().effective('ui.sidebar_width')).toBe(34)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
