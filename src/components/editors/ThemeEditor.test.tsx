/**
 * The theme editor, against the acceptance of its bead.
 *
 * The preview is the assertion: a theme is a claim about what herdr will look
 * like, so "choosing nord repaints the preview" is read off the mock's own
 * inline colours rather than off the editor's state. The export text is the
 * other half — a reset has to leave no line behind.
 */
import { ThemeEditor, ThemeView } from '@/components/editors/ThemeEditor'
import { HerdrPreview } from '@/components/preview/HerdrPreview'
import { resolvePalette } from '@/components/preview/tokens'
import { DiagnosticsLine } from '@/components/shell/DiagnosticsLine'
import { editorFor } from '@/components/shell/editor-registry'
import { InlinePopover } from '@/components/shell/InlinePopover'
import { TooltipProvider } from '@/components/ui/tooltip'
import { themeNames, themeTokens } from '@/schema'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
})

function open() {
  return render(
    <TooltipProvider>
      <ThemeView />
      <HerdrPreview />
      <DiagnosticsLine />
    </TooltipProvider>,
  )
}

/**
 * The swatch grid, scoped.
 *
 * The preview labels its own theme chip `theme catppuccin` too, which is right —
 * it is the region that opens this editor — so a bare query would find both.
 */
function swatches() {
  return within(screen.getByRole('region', { name: 'built-in themes' }))
}

/** jsdom reports every rect as zero, which is a position like any other. */
const NOWHERE = { top: 0, left: 0, width: 0, height: 0 }

function part(name: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-part="${name}"]`)
  if (found === null) throw new Error(`the preview has no ${name}`)
  return found
}

/** A palette hex as the browser writes it back out of an inline style. */
function rgbOf(hex: string): string {
  const digits =
    hex.length === 4
      ? [...hex.slice(1)].map((digit) => digit + digit)
      : [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
  return `rgb(${digits.map((pair) => Number.parseInt(pair, 16)).join(', ')})`
}

function exported(): string {
  return useConfigStore.getState().exportText()
}

describe('the swatches', () => {
  it('offers every built-in theme, painted with its own palette', () => {
    open()

    const names = themeNames()
    expect(names.length).toBe(18)
    for (const name of names) {
      expect(swatches().getByRole('button', { name: `theme ${name}` })).toBeInTheDocument()
    }

    // Each swatch is themes.json's own colours, resolved the way the preview
    // resolves them — nord's `sidebar_bg` is `reset`, and a hole would be wrong.
    const nord = swatches().getByRole('button', { name: 'theme nord' })
    const palette = resolvePalette({ theme: 'nord', custom: {} })
    const slots = [...nord.querySelectorAll<HTMLElement>('[data-slot]')]
    expect(slots.map((slot) => slot.dataset.slot)).toEqual([
      'panel_bg',
      'sidebar_bg',
      'text',
      'accent',
    ])
    expect(slots[0].style.background).toBe(rgbOf(palette.panel_bg))
    expect(slots[3].style.background).toBe(rgbOf(palette.accent))
  })

  it('marks the theme in force, and moves the mark when another is picked', async () => {
    const user = userEvent.setup()
    open()

    expect(swatches().getByRole('button', { name: 'theme catppuccin' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(swatches().getByRole('button', { name: 'theme nord' }))

    expect(swatches().getByRole('button', { name: 'theme nord' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(swatches().getByRole('button', { name: 'theme catppuccin' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('repaints the preview when a theme is chosen', async () => {
    const user = userEvent.setup()
    open()
    const before = part('sidebar').style.background

    await user.click(swatches().getByRole('button', { name: 'theme nord' }))

    const nord = resolvePalette({ theme: 'nord', custom: {} })
    expect(part('sidebar').style.background).not.toBe(before)
    expect(part('sidebar').style.background).toBe(rgbOf(nord.sidebar_bg))
    expect(exported()).toContain('name = "nord"')
  })
})

describe('the overrides', () => {
  it('offers a colour field for every [theme.custom] slot', () => {
    open()

    const tokens = themeTokens()
    expect(tokens.length).toBe(19)
    for (const slot of tokens) {
      expect(screen.getByLabelText(`theme.custom.${slot}`)).toBeInTheDocument()
    }
  })

  it('repaints only the surface an override names', async () => {
    const user = userEvent.setup()
    open()
    const panelBefore = part('tab-bar').style.background

    await user.type(screen.getByLabelText('theme.custom.sidebar_bg'), '#101010')

    expect(part('sidebar').style.background).toBe('rgb(16, 16, 16)')
    expect(part('tab-bar').style.background).toBe(panelBefore)
  })

  it('takes the key back out of the export when the slot is reset', async () => {
    const user = userEvent.setup()
    open()

    await user.type(screen.getByLabelText('theme.custom.sidebar_bg'), '#101010')
    expect(exported()).toContain('sidebar_bg = "#101010"')

    await user.click(screen.getByRole('button', { name: 'reset theme.custom.sidebar_bg' }))

    expect(exported()).not.toContain('sidebar_bg')
    expect(useConfigStore.getState().explicit().has('theme.custom.sidebar_bg')).toBe(false)
  })

  it('resets a slot the field is emptied, rather than writing an empty colour', async () => {
    const user = userEvent.setup()
    open()

    const field = screen.getByLabelText('theme.custom.text')
    await user.type(field, 'green')
    expect(useConfigStore.getState().effective('theme.custom.text')).toBe('green')

    await user.clear(field)
    expect(useConfigStore.getState().explicit().has('theme.custom.text')).toBe(false)
  })

  it('says what is wrong with a colour herdr cannot read, inline and in the line', async () => {
    const user = userEvent.setup()
    open()

    await user.type(screen.getByLabelText('theme.custom.accent'), 'chartreuse')

    // Once under the field, once in the diagnostics line — the acceptance asks
    // for both, and they are the same sentence because `ColorField` borrows
    // `checkColor`'s own wording rather than writing a second one.
    expect(screen.getAllByText(/unknown color "chartreuse"/)).toHaveLength(2)
    expect(screen.getByText(/1 warning/)).toHaveTextContent('unknown color "chartreuse"')
  })

  it('accepts the reset spellings herdr accepts, without calling them wrong', async () => {
    const user = userEvent.setup()
    open()

    await user.type(screen.getByLabelText('theme.custom.panel_bg'), 'reset')

    expect(screen.queryByText(/unknown color/)).not.toBeInTheDocument()
    expect(exported()).toContain('panel_bg = "reset"')
  })
})

describe('the accent and the appearance pair', () => {
  it('writes ui.accent and repaints the preview with it', async () => {
    const user = userEvent.setup()
    open()

    // `ui.accent` has a documented default, so clearing it does not leave an
    // empty field — it puts `cyan` back. Selecting the value and replacing it is
    // what a person does, and what the store sees as one new colour.
    const accent = screen.getByLabelText('ui.accent')
    await user.tripleClick(accent)
    await user.paste('#ff8800')

    expect(part('accent-swatch').style.background).toBe('rgb(255, 136, 0)')
    expect(exported()).toContain('accent = "#ff8800"')
  })

  it('reveals the two names only when auto_switch is on', async () => {
    const user = userEvent.setup()
    open()

    expect(screen.queryByLabelText('theme.dark_name')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('theme.auto_switch'))

    expect(screen.getByLabelText('theme.dark_name')).toBeInTheDocument()
    expect(screen.getByLabelText('theme.light_name')).toBeInTheDocument()
    expect(useConfigStore.getState().effective('theme.auto_switch')).toBe(true)
  })

  it('picks a dark name from the built-ins, and unsets it again', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByLabelText('theme.auto_switch'))

    const dark = screen.getByLabelText('theme.dark_name')
    await user.selectOptions(dark, 'gruvbox')
    expect(exported()).toContain('dark_name = "gruvbox"')

    await user.selectOptions(dark, '')
    expect(exported()).not.toContain('dark_name')
  })
})

describe('the popover', () => {
  it('claims the theme table and the accent, so the tree and the preview open it', () => {
    for (const key of [
      'theme.name',
      'theme.auto_switch',
      'theme.dark_name',
      'theme.light_name',
      'theme.custom.sidebar_bg',
      'ui.accent',
    ]) {
      expect(editorFor(key), `expected the theme editor to claim ${key}`).toBe(ThemeEditor)
    }
  })

  it('offers the same palette as the section view, with the overrides folded away', () => {
    render(<ThemeEditor />)

    expect(swatches().getByRole('button', { name: 'theme nord' })).toBeInTheDocument()
    expect(screen.getByLabelText('ui.accent')).toBeInTheDocument()
    // Nineteen colour rows is two thousand pixels of frame, and the popover has
    // a window to fit in — see the section's own note.
    expect(screen.queryByLabelText('theme.custom.accent')).not.toBeInTheDocument()
  })

  it('opens the overrides on demand, and the rows are the same rows', async () => {
    const user = userEvent.setup()
    render(<ThemeEditor />)

    const toggle = screen.getByRole('button', { name: /override colours/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    for (const slot of themeTokens()) {
      expect(screen.getByLabelText(`theme.custom.${slot}`)).toBeInTheDocument()
    }
  })

  it('never folds away the row the popover was opened on', () => {
    render(<InlinePopover />)

    act(() => {
      useShellStore.getState().openEditor({ key: 'theme.custom.sidebar_bg', anchor: NOWHERE })
    })

    // The dialog carries the key as its own accessible name, so the field is
    // asked for by role rather than by label alone.
    const field = screen.getByRole('textbox', { name: 'theme.custom.sidebar_bg' })
    expect(field).toBeVisible()
    expect(field).toHaveFocus()
    expect(screen.getByRole('button', { name: /override colours/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('folds them away for a key that is not one of them', () => {
    render(<InlinePopover />)

    act(() => {
      useShellStore.getState().openEditor({ key: 'theme.name', anchor: NOWHERE })
    })

    expect(screen.queryByLabelText('theme.custom.sidebar_bg')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /override colours/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('puts the cursor on the accent field when that is the key asked for', () => {
    render(<InlinePopover />)

    act(() => {
      useShellStore.getState().openEditor({ key: 'ui.accent', anchor: NOWHERE })
    })

    expect(screen.getByRole('textbox', { name: 'ui.accent' })).toHaveFocus()
  })

  it('opens them already unfolded when the config sets one', () => {
    act(() => {
      useConfigStore.getState().set('theme.custom.sidebar_bg', '#101010')
    })

    render(<ThemeEditor />)

    // A config that overrides something must not hide it behind a closed
    // section the user has to know to open.
    expect(screen.getByRole('button', { name: /override colours/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByLabelText('theme.custom.sidebar_bg')).toHaveValue('#101010')
  })

  it('keeps every row on screen in the section panel, with nothing to unfold', () => {
    render(<ThemeView />)

    expect(screen.queryByRole('button', { name: /override colours/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('theme.custom.accent')).toBeInTheDocument()
  })
})
