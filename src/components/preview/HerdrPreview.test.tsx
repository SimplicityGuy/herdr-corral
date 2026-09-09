/**
 * The preview redraws from the effective config.
 *
 * One test per key the bead's acceptance names, and each one is the same shape:
 * read what the mock draws, change the key in the store, read it again. The
 * component subscribes to `effectiveAll()`, so nothing here re-renders by hand —
 * if a test needs a second `render` to see a change, the preview is not live.
 */
import { HerdrPreview } from '@/components/preview/HerdrPreview'
import { resolvePalette } from '@/components/preview/tokens'
import type { TomlValue } from '@/model/parse'
import { themeTokens } from '@/schema'
import { resetConfigStore, useConfigStore } from '@/store/config'
import { resetShellStore } from '@/store/shell'
import { act, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  resetConfigStore()
  resetShellStore()
})

function set(path: string, value: TomlValue): void {
  act(() => {
    useConfigStore.getState().set(path, value)
  })
}

function part(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-part="${name}"]`)
}

function frame(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-preview="herdr"]')
  if (found === null) throw new Error('the preview frame is not on screen')
  return found
}

function agentRow(agent: string): HTMLElement {
  return screen.getByRole('button', { name: `agent ${agent}` })
}

/** A palette hex as the browser writes it back out of an inline style. */
function rgbOf(hex: string): string {
  const digits =
    hex.length === 4
      ? [...hex.slice(1)].map((digit) => digit + digit)
      : [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
  return `rgb(${digits.map((pair) => Number.parseInt(pair, 16)).join(', ')})`
}

describe('the sidebar', () => {
  it('draws its width in columns and follows ui.sidebar_width', () => {
    render(<HerdrPreview />)
    expect(part('sidebar')?.style.width).toBe('26ch')

    set('ui.sidebar_width', 34)
    expect(part('sidebar')?.style.width).toBe('34ch')
  })

  it('clamps the width between the min and the max herdr enforces', () => {
    render(<HerdrPreview />)

    set('ui.sidebar_width', 90)
    expect(part('sidebar')?.style.width).toBe('36ch')

    set('ui.sidebar_max_width', 40)
    expect(part('sidebar')?.style.width).toBe('40ch')

    set('ui.sidebar_width', 2)
    expect(part('sidebar')?.style.width).toBe('18ch')
  })

  it('names the collapse it will do, and follows ui.sidebar_collapsed_mode', () => {
    render(<HerdrPreview />)
    const chip = screen.getByRole('button', { name: /collapse/ })
    expect(chip).toHaveTextContent('collapse → compact')

    set('ui.sidebar_collapsed_mode', 'hidden')
    expect(screen.getByRole('button', { name: /collapse/ })).toHaveTextContent('collapse → hidden')
  })

  it('collapses to a rail under compact and to nothing under hidden', () => {
    render(<HerdrPreview />)

    set('ui.sidebar_start_collapsed', true)
    expect(part('sidebar')?.dataset.collapsed).toBe('compact')
    expect(part('sidebar')?.style.width).toBe('4ch')
    // The rail still shows one mark per agent, which is what compact means.
    expect(within(part('sidebar') as HTMLElement).getAllByRole('button')).toHaveLength(5)

    set('ui.sidebar_collapsed_mode', 'hidden')
    expect(part('sidebar')).toBeNull()
  })
})

describe('the tab bar', () => {
  it('moves to the bottom on ui.tab_bar_position', () => {
    render(<HerdrPreview />)
    const children = () => [...frame().children]
    const barIndex = () => children().findIndex((child) => child.matches('[data-part="tab-bar"]'))
    expect(barIndex()).toBe(0)

    set('ui.tab_bar_position', 'bottom')
    expect(barIndex()).toBe(children().length - 1)
  })

  it('says so when ui.hide_tab_bar_when_single_tab is on', () => {
    render(<HerdrPreview />)
    expect(part('single-tab-hint')).toBeNull()

    set('ui.hide_tab_bar_when_single_tab', true)
    expect(part('single-tab-hint')).toHaveTextContent('hidden at 1 tab')
  })

  it('draws the ui.tab_bar_right entries, separated by ui.tab_bar_right_separator', () => {
    render(<HerdrPreview />)
    expect(part('status-empty')).toBeInTheDocument()

    set('ui.tab_bar_right', [
      { type: 'zoom' },
      { type: 'hostname' },
      { type: 'datetime', format: '%H:%M' },
      { type: 'text', text: 'corral' },
      { type: 'command', command: 'uptime' },
    ])
    const right = screen.getByRole('button', { name: 'tab bar status entries' })
    expect(part('status-empty')).toBeNull()
    expect(right).toHaveTextContent('100%')
    expect(right).toHaveTextContent('mbp')
    expect(right).toHaveTextContent('22:41')
    expect(right).toHaveTextContent('corral')
    expect(right).toHaveTextContent('⟨uptime⟩')

    const separators = () =>
      [...right.querySelectorAll<HTMLElement>('[data-part="separator"]')].map(
        (node) => node.textContent,
      )
    expect(separators()).toEqual([' ', ' ', ' ', ' '])

    set('ui.tab_bar_right_separator', ' | ')
    expect(separators()).toEqual([' | ', ' | ', ' | ', ' | '])
  })

  it('formats a datetime entry with the entry’s own format', () => {
    render(<HerdrPreview />)
    set('ui.tab_bar_right', [{ type: 'datetime', format: '%a %b %d %Y' }])
    expect(screen.getByRole('button', { name: 'tab bar status entries' })).toHaveTextContent(
      'Sun Sep 06 2026',
    )
  })
})

describe('the theme', () => {
  it('repaints from theme.name', () => {
    render(<HerdrPreview />)
    const before = frame().style.background

    set('theme.name', 'gruvbox')
    expect(screen.getByRole('button', { name: 'theme gruvbox' })).toBeInTheDocument()
    expect(frame().style.background).not.toBe(before)
  })

  it('lets theme.custom.sidebar_bg override the theme', () => {
    render(<HerdrPreview />)
    const before = part('sidebar')?.style.background

    set('theme.custom.sidebar_bg', '#ff0000')
    expect(part('sidebar')?.style.background).toBe('rgb(255, 0, 0)')
    expect(part('sidebar')?.style.background).not.toBe(before)
  })

  it('repaints the accent from ui.accent', () => {
    render(<HerdrPreview />)
    const swatch = () => part('accent-swatch') as HTMLElement
    const before = swatch().style.background

    set('ui.accent', '#00ff00')
    expect(swatch().style.background).toBe('rgb(0, 255, 0)')
    expect(swatch().style.background).not.toBe(before)
  })

  it('offers a light/dark chip only when theme.auto_switch is on', () => {
    render(<HerdrPreview />)
    expect(screen.queryByRole('button', { name: /dark|light/ })).toBeNull()

    set('theme.auto_switch', true)
    set('theme.dark_name', 'tokyo-night')
    set('theme.light_name', 'tokyo-night-day')
    const chip = screen.getByRole('button', { name: '◐ dark' })
    expect(screen.getByRole('button', { name: 'theme tokyo-night' })).toBeInTheDocument()

    act(() => {
      chip.click()
    })
    expect(screen.getByRole('button', { name: 'theme tokyo-night-day' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '◑ light' })).toBeInTheDocument()
  })
})

describe('the sidebar rows', () => {
  it('redraws every agent row from ui.sidebar.agents.rows', () => {
    render(<HerdrPreview />)
    expect(agentRow('claude')).toHaveTextContent('homelab')
    expect(agentRow('claude')).toHaveTextContent('infra')

    set('ui.sidebar.agents.rows', [['agent', '$model']])
    expect(agentRow('claude')).toHaveTextContent('claudeopus-5')
    expect(agentRow('claude')).not.toHaveTextContent('homelab')
  })

  it('lets rows_by_agent override one agent and leave the rest alone', () => {
    render(<HerdrPreview />)
    set('ui.sidebar.agents.rows_by_agent.claude', [['terminal_title_stripped']])

    expect(agentRow('claude')).toHaveTextContent('claude — compose/traefik.yml')
    expect(agentRow('codex')).toHaveTextContent('beadhive')
  })

  it('redraws the space rows from ui.sidebar.spaces.rows', () => {
    render(<HerdrPreview />)
    const homelab = () => screen.getByRole('button', { name: 'space homelab' })
    expect(homelab()).toHaveTextContent('main')

    set('ui.sidebar.spaces.rows', [['workspace', '$jj_status']])
    expect(homelab()).toHaveTextContent('@ wqrs')
    expect(homelab()).not.toHaveTextContent('main')
  })

  it('swaps the state marks on ui.status_indicators', () => {
    render(<HerdrPreview />)
    expect(agentRow('kimi')).toHaveTextContent('●')

    set('ui.status_indicators', 'symbols')
    expect(agentRow('kimi')).toHaveTextContent('✓')
    expect(agentRow('codex')).toHaveTextContent('!')
  })

  it('spells the blocked agent the way herdr does', () => {
    render(<HerdrPreview />)
    set('ui.sidebar.agents.rows', [['agent', 'state_text']])

    expect(agentRow('codex')).toHaveTextContent('codexblocked')
    expect(agentRow('codex')).not.toHaveTextContent('waiting')
  })

  it('marks the row the sidebar cursor is on with selection_bg', () => {
    render(<HerdrPreview />)
    // herdr paints an active row and a selected row differently, so the mock has
    // to show both: the active space band and the cursor's agent row.
    set('theme.custom.selection_bg', '#010203')
    expect(agentRow('claude').style.background).toBe('rgb(1, 2, 3)')
    expect(agentRow('codex').style.background).toBe('')
  })

  it('opens the rows out on row_gap', () => {
    render(<HerdrPreview />)
    expect(part('agents')?.style.rowGap).toBe('0em')

    set('ui.sidebar.agents.row_gap', 1)
    expect(part('agents')?.style.rowGap).toBe('1.45em')

    set('ui.sidebar.spaces.row_gap', 2)
    expect(part('spaces')?.style.rowGap).toBe('2.9em')
  })

  it('reorders the agents on ui.agent_panel_sort', () => {
    render(<HerdrPreview />)
    const order = () =>
      [...(part('agents') as HTMLElement).querySelectorAll<HTMLElement>('[data-agent]')].map(
        (node) => node.dataset.agent,
      )
    // By space: the sample's space order is homelab, beadhive, cronduit,
    // groovemap-music, groovemap-music/design.
    expect(order()).toEqual(['claude', 'codex', 'kimi', 'gemini'])

    // Blocked first: the attention queue leads with the agent waiting on a person.
    set('ui.agent_panel_sort', 'priority')
    expect(order()).toEqual(['codex', 'claude', 'kimi', 'gemini'])
  })

  it('styles a token the way the row asked', () => {
    render(<HerdrPreview />)
    set('ui.sidebar.agents.rows', [[{ token: 'workspace', fg: '#123456', bold: true, dim: true }]])

    const token = agentRow('claude').querySelector<HTMLElement>('[data-token="workspace"]')
    expect(token?.style.color).toBe('rgb(18, 52, 86)')
    expect(token?.style.fontWeight).toBe('700')
    expect(token?.style.opacity).toBe('0.6')
  })
})

describe('the panes', () => {
  it('drops the borders on ui.pane_borders', () => {
    render(<HerdrPreview />)
    const pane = () => screen.getByRole('button', { name: 'pane zsh' })
    expect(pane().style.border).not.toContain('transparent')

    set('ui.pane_borders', false)
    expect(pane().style.border).toContain('transparent')
  })

  it('closes the gaps on ui.pane_gaps and the outer frame on ui.pane_outer_borders', () => {
    render(<HerdrPreview />)
    expect(part('panes')?.style.gap).toBe('6px')

    set('ui.pane_gaps', false)
    expect(part('panes')?.style.gap).toBe('0px')

    const framed = part('panes')?.style.border
    set('ui.pane_outer_borders', false)
    expect(part('panes')?.style.border).not.toBe(framed)
    expect(part('panes')?.style.border).toContain('transparent')
  })

  it('removes the scrollbars on ui.pane_scrollbars', () => {
    render(<HerdrPreview />)
    expect(document.querySelectorAll('[data-part="scrollbar"]')).toHaveLength(2)

    set('ui.pane_scrollbars', false)
    expect(document.querySelectorAll('[data-part="scrollbar"]')).toHaveLength(0)
  })

  it('labels the agent on the border when herdr would', () => {
    render(<HerdrPreview />)
    expect(part('agent-label')).toBeNull()

    set('ui.show_agent_labels_on_pane_borders', true)
    expect(part('agent-label')).toHaveTextContent('[claude]')
  })
})

describe('the toast', () => {
  it('says how long herdr waits before delivering it', () => {
    render(<HerdrPreview />)
    expect(part('toast-delay')).toHaveTextContent('after 1s')

    set('ui.toast.delay_seconds', 5)
    expect(part('toast-delay')).toHaveTextContent('after 5s')
  })

  it('moves to the corner ui.toast.herdr.position names', () => {
    render(<HerdrPreview />)
    const toast = () => screen.getByRole('button', { name: /notification toast/ })
    expect(toast().dataset.position).toBe('bottom-right')
    expect(toast().className).toContain('right-[8px]')

    set('ui.toast.herdr.position', 'top-left')
    expect(toast().dataset.position).toBe('top-left')
    expect(toast().className).toContain('top-[8px]')
    expect(toast().className).toContain('left-[8px]')
  })

  it('is a ghost while ui.toast.delivery is off, and a notification once it is not', () => {
    render(<HerdrPreview />)
    expect(screen.getByRole('button', { name: 'notification toast, delivery off' })).toHaveTextContent(
      'delivery off',
    )

    set('ui.toast.delivery', 'herdr')
    const toast = screen.getByRole('button', { name: 'notification toast' })
    expect(toast).toHaveTextContent('claude · homelab')
    expect(toast.style.border).not.toContain('dashed')
  })
})

describe('the palette', () => {
  it('can paint every slot themes.json defines', () => {
    render(<HerdrPreview />)
    // A slot nothing can paint is a setting the preview silently ignores, which
    // is the one thing a preview must not do. Two of them need the config to ask
    // for them — a delivered toast, and a row with a custom token — so the mock
    // is put in the state that shows everything before the sweep.
    set('ui.toast.delivery', 'herdr')
    set('ui.sidebar.agents.rows', [['state_icon', 'workspace', 'tab'], ['agent', '$model']])
    const painted = new Set<string>()
    for (const node of document.querySelectorAll<HTMLElement>('[data-preview] *')) {
      for (const property of ['color', 'background', 'backgroundColor', 'borderColor'] as const) {
        const value = node.style[property]
        if (value !== '') painted.add(value)
      }
      // Borders are written as a shorthand, so the colour is inside the string.
      if (node.style.border !== '') painted.add(node.style.border)
      if (node.style.borderRight !== '') painted.add(node.style.borderRight)
      if (node.style.borderBottom !== '') painted.add(node.style.borderBottom)
    }
    const all = [...painted].join(' | ')
    const palette = resolvePalette({ theme: 'catppuccin', custom: {} })
    for (const slot of themeTokens()) {
      expect(all, `${slot} (${palette[slot]}) is never painted`).toContain(rgbOf(palette[slot]))
    }
  })
})

describe('the mobile layout', () => {
  it('crosses over at the threshold, which herdr counts as mobile', () => {
    render(<HerdrPreview />)
    expect(frame().dataset.mobile).toBe('false')

    // "at or below which Herdr uses the mobile single-column layout": 120 columns
    // against a threshold of 120 is mobile, and 119 is not.
    set('ui.mobile_width_threshold', 119)
    expect(frame().dataset.mobile).toBe('false')
    set('ui.mobile_width_threshold', 120)
    expect(frame().dataset.mobile).toBe('true')
  })

  it('crosses over when ui.mobile_width_threshold passes the simulated width', () => {
    render(<HerdrPreview />)
    expect(frame().dataset.mobile).toBe('false')
    expect(part('sidebar')).toBeInTheDocument()

    set('ui.mobile_width_threshold', 200)
    expect(frame().dataset.mobile).toBe('true')
    expect(part('sidebar')).toBeNull()
    expect(part('mobile-header')).toBeInTheDocument()
    // One pane, not two, once the terminal is narrow.
    expect(screen.getAllByRole('button', { name: /^pane / })).toHaveLength(1)
  })

  it('is what the column chip simulates', () => {
    render(<HerdrPreview />)
    const chip = screen.getByRole('button', { name: '⌗ 120 cols' })
    expect(frame().style.width).toBe('min(100%, 120ch)')

    act(() => {
      chip.click()
    })
    expect(frame().dataset.mobile).toBe('true')
    expect(frame().style.width).toBe('min(100%, 44ch)')

    // …and the threshold decides where the crossover is, not the chip alone.
    set('ui.mobile_width_threshold', 20)
    expect(frame().dataset.mobile).toBe('false')
  })
})
