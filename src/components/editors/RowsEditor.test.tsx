/**
 * The rows editor, driven the way a person drives it.
 *
 * Two things make this file longer than a form test: dnd-kit measures the DOM,
 * which jsdom reports as a plane of zero-sized rectangles, and the editor writes
 * through the store rather than through `commit`, so the assertion is what the
 * document says afterwards rather than what a spy was handed.
 *
 * {@link layOut} answers the first: every element dnd-kit measures carries a
 * `data-dnd-id`, so a rectangle can be computed from the identifier instead of
 * mocked per element. That is enough geometry for the keyboard sensor's
 * `closestCorners` to have real corners to compare, which is what makes a
 * keyboard drag in a test the same code path as a keyboard drag in a browser.
 */
import { RowsEditor } from '@/components/editors/RowsEditor'
import { HerdrPreview } from '@/components/preview/HerdrPreview'
import { editorFor, editorWidthFor } from '@/components/shell/editor-registry'
import { POPOVER_WIDE_WIDTH } from '@/lib/popover'
import type { TomlValue } from '@/model/parse'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore, useShellStore } from '@/store/shell'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const AGENTS = 'ui.sidebar.agents.rows'
const SPACES = 'ui.sidebar.spaces.rows'
const BY_AGENT = 'ui.sidebar.agents.rows_by_agent'

/** Row height and token width of the synthetic layout the sensors measure. */
const ROW_H = 30
const TOK_W = 80

const realRect = HTMLElement.prototype.getBoundingClientRect

/**
 * A believable layout, derived from `data-dnd-id`.
 *
 * Rows are stacked, tokens run left to right inside them, and the palette sits
 * below everything so a drag out of it moves up into the rows. Anything without
 * an identifier keeps jsdom's zero rectangle, which is what the rest of the
 * shell already assumes.
 */
function layOut(): void {
  HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement) {
    const id = this.dataset.dndId
    const parts = id?.split(':') ?? []
    const box = (top: number, left: number, width: number, height: number) => ({
      top,
      left,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    })
    if (parts[0] === 'row') return box(Number(parts[1]) * ROW_H, 0, 600, ROW_H)
    if (parts[0] === 'rowdrop') return box(Number(parts[1]) * ROW_H, 100, 400, ROW_H)
    if (parts[0] === 'tok') {
      return box(Number(parts[1]) * ROW_H + 4, 100 + Number(parts[2]) * TOK_W, TOK_W, 20)
    }
    if (parts[0] === 'pal') return box(600, 0, TOK_W, 20)
    // The frame is what "off the popover" is measured against.
    if (parts[0] === 'frame') return box(0, 0, 600, 700)
    return box(0, 0, 0, 0)
  } as typeof realRect
}

beforeAll(layOut)

afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect
})

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
})

function noop(): void {}

/** Render the editor for one key, the way the popover does. */
function open(path = AGENTS) {
  const value = useConfigStore.getState().effective(path)
  return render(
    <RowsEditor path={path} value={value} diagnostics={[]} commit={noop} cancel={noop} />,
  )
}

/** What the document says the key is now. */
function rowsOf(path = AGENTS): TomlValue | undefined {
  return useConfigStore.getState().effective(path)
}

/** Seed the store, as a loaded file would. */
function seed(path: string, value: TomlValue): void {
  useConfigStore.getState().set(path, value)
}

function chip(name: string) {
  return screen.getByRole('button', { name })
}

/** The editor's own line — dnd-kit has a live region of its own on the page. */
function message() {
  return screen.getByRole('status', { name: 'editor message' })
}

describe('registration', () => {
  it('claims every key the preview and the tree open', () => {
    for (const key of [AGENTS, SPACES, BY_AGENT, `${BY_AGENT}.claude`]) {
      expect(editorFor(key)).toBe(RowsEditor)
    }
  })

  it('leaves other keys to the generic form', () => {
    expect(editorFor('ui.sidebar_width')).not.toBe(RowsEditor)
  })

  it('asks the popover for a frame a row of chips fits in', () => {
    expect(editorWidthFor(AGENTS)).toBe(POPOVER_WIDE_WIDTH)
  })
})

describe('drawing the layout', () => {
  it('shows herdr’s default agent rows as chips', () => {
    open()

    expect(chip('state_icon in row 1, token 1')).toBeInTheDocument()
    expect(chip('workspace in row 1, token 2')).toBeInTheDocument()
    expect(chip('tab in row 1, token 3')).toBeInTheDocument()
    expect(chip('agent in row 2, token 1')).toBeInTheDocument()
  })

  it('offers the built-ins of the panel it was opened for', () => {
    open(SPACES)
    const palette = screen.getByRole('list', { name: 'token palette' })

    expect(within(palette).getByRole('button', { name: 'add branch' })).toBeInTheDocument()
    expect(within(palette).queryByRole('button', { name: 'add pane' })).not.toBeInTheDocument()
  })
})

describe('reordering rows', () => {
  it('moves a row with the explicit command, and the document follows', async () => {
    const user = userEvent.setup()
    open()

    await user.click(chip('move row 2 up'))

    expect(rowsOf()).toEqual([['agent'], ['state_icon', 'workspace', 'tab']])
    expect(useConfigStore.getState().exportText()).toContain(
      'rows = [["agent"], ["state_icon", "workspace", "tab"]]',
    )
  })

  it('refuses to move the first row up, and says why', async () => {
    const user = userEvent.setup()
    open()

    await user.click(chip('move row 1 up'))

    expect(message()).toHaveTextContent('there is no row above this one')
    expect(rowsOf()).toEqual([['state_icon', 'workspace', 'tab'], ['agent']])
  })

  it('moves a row with alt and an arrow on its handle', async () => {
    const user = userEvent.setup()
    open()

    chip('drag row 1').focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

    expect(rowsOf()).toEqual([['agent'], ['state_icon', 'workspace', 'tab']])
  })
})

describe('moving a token between rows', () => {
  it('moves one with dnd-kit’s keyboard sensor', async () => {
    const user = userEvent.setup()
    open()

    // space picks the chip up, the arrow walks it into the row below, space
    // drops it — the sensor's own vocabulary, not the editor's.
    chip('tab in row 1, token 3').focus()
    await user.keyboard('{ }')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ }')

    const rows = rowsOf() as string[][]
    expect(rows[0]).not.toContain('tab')
    expect(rows[1]).toContain('tab')
  })

  it('moves one with alt and an arrow, keeping the cursor on it', async () => {
    const user = userEvent.setup()
    open()

    chip('workspace in row 1, token 2').focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

    expect(rowsOf()).toEqual([['state_icon', 'tab'], ['agent', 'workspace']])
    expect(chip('workspace in row 2, token 2')).toHaveFocus()
  })

  it('moves one along its row with the explicit commands', async () => {
    const user = userEvent.setup()
    open()

    await user.click(chip('state_icon in row 1, token 1'))
    await user.click(chip('move right'))

    expect(rowsOf()).toEqual([['workspace', 'state_icon', 'tab'], ['agent']])
  })
})

describe('the palette', () => {
  it('adds a built-in to the row that was last touched', async () => {
    const user = userEvent.setup()
    open()

    await user.click(chip('agent in row 2, token 1'))
    await user.click(chip('add pane'))

    expect(rowsOf()).toEqual([['state_icon', 'workspace', 'tab'], ['agent', 'pane']])
  })

  it('adds a custom $token, and the export carries it', async () => {
    const user = userEvent.setup()
    open()

    await user.type(screen.getByRole('textbox', { name: 'custom token name' }), 'ticket')
    await user.click(chip('add custom token'))

    expect(rowsOf()).toEqual([['state_icon', 'workspace', 'tab', '$ticket'], ['agent']])
    expect(useConfigStore.getState().exportText()).toContain('"$ticket"')
  })

  it('adds the $ when the user leaves it off, because that is the only valid reading', async () => {
    const user = userEvent.setup()
    open()

    await user.type(screen.getByRole('textbox', { name: 'custom token name' }), '$jj_status{Enter}')

    expect((rowsOf() as string[][])[0]).toContain('$jj_status')
  })
})

describe('styling a token', () => {
  it('writes an inline table, and unstyling gives the plain string back', async () => {
    const user = userEvent.setup()
    open()

    await user.click(chip('agent in row 2, token 1'))
    await user.click(screen.getByRole('checkbox', { name: 'bold' }))
    expect(rowsOf()).toEqual([['state_icon', 'workspace', 'tab'], [{ token: 'agent', bold: true }]])

    await user.click(screen.getByRole('checkbox', { name: 'dim' }))
    expect(rowsOf()).toEqual([
      ['state_icon', 'workspace', 'tab'],
      [{ token: 'agent', bold: true, dim: true }],
    ])

    await user.click(screen.getByRole('checkbox', { name: 'bold' }))
    await user.click(screen.getByRole('checkbox', { name: 'dim' }))
    expect(rowsOf()).toEqual([['state_icon', 'workspace', 'tab'], ['agent']])
  })

  it('takes a foreground from the theme’s own palette', async () => {
    const user = userEvent.setup()
    open()

    await user.click(chip('agent in row 2, token 1'))
    await user.click(screen.getByRole('button', { name: /^fg blue / }))

    const entry = (rowsOf() as TomlValue[][])[1][0] as Record<string, TomlValue>
    expect(entry.token).toBe('agent')
    expect(String(entry.fg)).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('takes a hex the user types, and refuses one herdr would not', async () => {
    const user = userEvent.setup()
    open()

    await user.click(chip('agent in row 2, token 1'))
    const field = screen.getByRole('textbox', { name: 'fg hex' })

    await user.type(field, 'cornflower')
    expect(screen.getByRole('button', { name: 'set fg' })).toBeDisabled()

    await user.clear(field)
    await user.type(field, '#89b4fa')
    await user.click(screen.getByRole('button', { name: 'set fg' }))

    expect(rowsOf()).toEqual([
      ['state_icon', 'workspace', 'tab'],
      [{ token: 'agent', fg: '#89b4fa' }],
    ])
  })

  it('goes back to the contextual default', async () => {
    seed(AGENTS, [['state_icon'], [{ token: 'agent', fg: '#89b4fa', bold: true }]])
    const user = userEvent.setup()
    open()

    await user.click(chip('agent in row 2, token 1'))
    await user.click(chip('contextual default'))

    expect(rowsOf()).toEqual([['state_icon'], [{ token: 'agent', bold: true }]])
  })
})

describe('herdr’s caps', () => {
  it('refuses the seventeenth row and explains', async () => {
    seed(AGENTS, Array.from({ length: 16 }, () => ['agent']))
    const user = userEvent.setup()
    open()

    await user.click(chip('+ row'))

    expect(message()).toHaveTextContent(
      'sidebar layouts may contain at most 16 rows',
    )
    expect(rowsOf()).toHaveLength(16)
  })

  it('refuses the seventeenth token in a row and explains', async () => {
    seed(AGENTS, [Array.from({ length: 16 }, () => 'agent')])
    const user = userEvent.setup()
    open()

    await user.click(chip('add pane'))

    expect(message()).toHaveTextContent(
      'sidebar rows may contain at most 16 tokens',
    )
    expect((rowsOf() as string[][])[0]).toHaveLength(16)
  })
})

describe('removing', () => {
  it('drops a token from the strip', async () => {
    const user = userEvent.setup()
    open()

    await user.click(chip('workspace in row 1, token 2'))
    await user.click(chip('remove token'))

    expect(rowsOf()).toEqual([['state_icon', 'tab'], ['agent']])
  })

  it('drops a whole row', async () => {
    const user = userEvent.setup()
    open()

    await user.click(chip('remove row 1'))

    expect(rowsOf()).toEqual([['agent']])
  })
})

describe('per-agent overrides', () => {
  it('starts an override as a copy of the default rows, and the export writes it', async () => {
    const user = userEvent.setup()
    open()

    await user.selectOptions(screen.getByRole('combobox', { name: 'agent to override' }), 'claude')
    await user.click(chip('add override'))

    expect(rowsOf(`${BY_AGENT}.claude`)).toEqual([['state_icon', 'workspace', 'tab'], ['agent']])

    const text = useConfigStore.getState().exportText()
    expect(text).toContain('[ui.sidebar.agents.rows_by_agent]')
    expect(text).toContain('claude = [["state_icon", "workspace", "tab"], ["agent"]]')
  })

  it('edits the override rather than the default once it is picked', async () => {
    seed(`${BY_AGENT}.claude`, [['agent']])
    const user = userEvent.setup()
    open(`${BY_AGENT}.claude`)

    await user.click(chip('add tab'))

    expect(rowsOf(`${BY_AGENT}.claude`)).toEqual([['agent', 'tab']])
    expect(rowsOf()).toEqual([['state_icon', 'workspace', 'tab'], ['agent']])
  })

  it('offers only ids herdr calls canonical', () => {
    open()
    const select = screen.getByRole('combobox', { name: 'agent to override' })

    expect(within(select).getByRole('option', { name: 'claude' })).toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: 'claude-code' })).not.toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: 'open_code' })).not.toBeInTheDocument()
  })

  it('removes an override and goes back to the default', async () => {
    seed(`${BY_AGENT}.claude`, [['agent']])
    const user = userEvent.setup()
    open(`${BY_AGENT}.claude`)

    await user.click(chip('remove the claude override'))

    expect(rowsOf(`${BY_AGENT}.claude`)).toBeUndefined()
    expect(useConfigStore.getState().changedLeaves()).not.toContain(`${BY_AGENT}.claude`)
  })
})

interface Point {
  readonly clientX: number
  readonly clientY: number
}

/**
 * A pointer drag, in the events dnd-kit's pointer sensor listens for.
 *
 * Two moves, not one. The first is what meets the sensor's distance threshold
 * and starts the drag, and a drag starts where the pointer went down — so the
 * translation the collision detection reads only exists from the second move
 * onwards. Each is flushed on its own, because the drop targets are measured in
 * the render the drag start causes.
 */
async function dragWithPointer(handle: HTMLElement, from: Point, to: Point): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(handle, { button: 0, isPrimary: true, ...from })
  })
  await act(async () => {
    fireEvent.pointerMove(document, { clientX: from.clientX + 8, clientY: from.clientY })
  })
  await act(async () => {
    fireEvent.pointerMove(document, to)
  })
  await act(async () => {
    fireEvent.pointerUp(document, to)
  })
}

describe('dragging with the pointer', () => {
  it('says DRAG while a chip is in flight, and drops it into the row it lands on', async () => {
    open()
    const handle = chip('tab in row 1, token 3')

    await act(async () => {
      fireEvent.pointerDown(handle, { button: 0, isPrimary: true, clientX: 260, clientY: 14 })
    })
    await act(async () => {
      fireEvent.pointerMove(document, { clientX: 268, clientY: 14 })
    })
    expect(useShellStore.getState().mode).toBe('DRAG')

    await act(async () => {
      fireEvent.pointerMove(document, { clientX: 140, clientY: 44 })
    })
    await act(async () => {
      fireEvent.pointerUp(document, { clientX: 140, clientY: 44 })
    })

    expect(useShellStore.getState().mode).toBe('EDIT')
    expect(rowsOf()).toEqual([['state_icon', 'workspace'], ['tab', 'agent']])
  })

  it('takes a token out when it is dropped on nothing — carried off the popover', async () => {
    open()

    await dragWithPointer(
      chip('workspace in row 1, token 2'),
      { clientX: 180, clientY: 14 },
      { clientX: 4000, clientY: 4000 },
    )

    expect(rowsOf()).toEqual([['state_icon', 'tab'], ['agent']])
  })

  it('reorders rows when a row handle is the thing dragged', async () => {
    open()

    await dragWithPointer(
      chip('drag row 1'),
      { clientX: 10, clientY: 14 },
      { clientX: 10, clientY: 44 },
    )

    expect(rowsOf()).toEqual([['agent'], ['state_icon', 'workspace', 'tab']])
  })

  it('drops a palette token into the row it is let go over', async () => {
    open()

    await dragWithPointer(
      chip('add pane'),
      { clientX: 40, clientY: 610 },
      { clientX: 140, clientY: 44 },
    )

    expect((rowsOf() as string[][])[1]).toContain('pane')
  })
})

describe('the mode badge', () => {
  it('is back to EDIT once the editor goes away', () => {
    useShellStore.getState().setMode('DRAG')
    const view = open()

    view.unmount()

    expect(useShellStore.getState().mode).toBe('EDIT')
  })
})

describe('the preview behind it', () => {
  it('redraws as the layout changes', async () => {
    const user = userEvent.setup()
    render(
      <>
        <HerdrPreview />
        <RowsEditor
          path={AGENTS}
          value={useConfigStore.getState().effective(AGENTS)}
          diagnostics={[]}
          commit={noop}
          cancel={noop}
        />
      </>,
    )

    const row = screen.getByRole('button', { name: 'agent claude' })
    expect(row).toHaveTextContent('homelab')
    expect(row).not.toHaveTextContent('working')

    await user.click(chip('agent in row 2, token 1'))
    await user.click(chip('add state_text'))

    expect(screen.getByRole('button', { name: 'agent claude' })).toHaveTextContent('working')
  })
})

describe('a value herdr would not load', () => {
  it('draws what it can and lets the diagnostics say the rest', () => {
    vi.spyOn(console, 'error').mockImplementation(noop)
    render(
      <RowsEditor
        path={AGENTS}
        value={'state_icon'}
        diagnostics={[
          { severity: 'error', path: AGENTS, message: 'expected a list of token rows, got a string' },
        ]}
        commit={noop}
        cancel={noop}
      />,
    )

    expect(screen.getByText(/expected a list of token rows/)).toBeInTheDocument()
  })
})
