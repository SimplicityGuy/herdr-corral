/**
 * View state for the Console shell — what is on screen, not what is in the file.
 *
 * `config.ts` owns the document; this owns the chrome around it. The split is the
 * usual one: nothing here changes what an export would write, and nothing here
 * survives a reload. It is a separate store rather than four `useState`s in
 * `App.tsx` because later beads need to reach it without being handed props
 * through the whole tree — the preview opens editors, a chord recorder flips the
 * mode badge, the palette jumps sections.
 *
 * ## What later beads call
 *
 * ```ts
 * const { openEditor, closeEditor, setMode } = useShellStore.getState()
 *
 * // Open the editor for a key, anchored to the region the user clicked.
 * openEditor({ key: 'ui.sidebar.agents.rows', anchor: element.getBoundingClientRect(), region: 'agents' })
 *
 * // Tell the diagnostics line what the user is doing.
 * setMode('RECORD')   // …and setMode('EDIT') when the chord capture ends.
 * ```
 *
 * `openEditor` also writes the config store's `selection`, so the preview's
 * "selected region" outline and the tree's focused row follow the popover without
 * either component knowing about the other. A target carrying a `region` also
 * pins the centre frame to the preview, because a region click is a click on the
 * mock and the mock has to still be there when the popover opens over it. That is the one place the two stores
 * touch, and it is deliberate: a caller should not have to remember to make two
 * calls to keep the shell coherent.
 *
 * ## Sections
 *
 * The shell thinks in the six switches of ADR-0002 (`layout` … `all`); the config
 * store thinks in the generated schema's `ref-*` section ids. `setSection` takes
 * the former and mirrors the latter into the config store via `primaryRefSection`,
 * so a bead reading `selection.section` still sees a reference section id.
 */
import {
  type CentreView,
  DEFAULT_UI_SECTION,
  type UiSection,
  centreOf,
  primaryRefSection,
} from '@/lib/sections'
import { useConfigStore } from '@/store/config'
import { create } from 'zustand'

/**
 * What the diagnostics badge says the user is doing.
 *
 * `EDIT` is the resting state. `DRAG` belongs to the row editors while a token is
 * in flight, `RECORD` to the keybinding editor while it is capturing a chord —
 * both set by the beads that own those editors, both reset to `EDIT` when done.
 */
export type Mode = 'EDIT' | 'DRAG' | 'RECORD'

/**
 * Which face of the export dialog is showing: the whole file, or the hunks.
 *
 * `null` is the dialog being shut, so one field answers both "is it open" and
 * "on what", and the two doors into it — `:w` and `:diff` — differ only in the
 * value they pass.
 */
export type ExportTab = 'file' | 'diff'

/** Where a popover should sit: a viewport rectangle, as `getBoundingClientRect` gives. */
export interface Anchor {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

/** An open editor: the key it edits and the thing on screen it belongs to. */
export interface EditorTarget {
  /** Dotted schema path. The popover's caption, and what the editor registry matches. */
  readonly key: string
  readonly anchor: Anchor
  /** The preview region that opened it, when one did. Mirrored into `selection`. */
  readonly region?: string
  /** Overrides the caption, which is the key path by default. */
  readonly caption?: string
}

export interface ShellState {
  readonly section: UiSection
  /**
   * What the centre frame draws: the herdr mock, or the open section's panel.
   *
   * Separate from `section` on purpose. A switch sets both — that is what
   * picking a switch means — but a click on a region of the mock sets only the
   * section, so the tree can follow the click without the mock disappearing out
   * from under the popover that click just opened. See `openEditor`.
   */
  readonly centre: CentreView
  readonly mode: Mode
  /** The settings tree's `/` filter. Empty means "show the section". */
  readonly filter: string
  readonly editor: EditorTarget | null
  readonly paletteOpen: boolean
  /**
   * True until a config is in the editor: the landing owns the screen first.
   *
   * A session that has not started and one that started from herdr's defaults are
   * the same document — `source` is `'defaults'` either way — so the difference is
   * not something the config store can be asked. It is a fact about what is on
   * screen, which is this store's job.
   */
  readonly landing: boolean
  readonly exportTab: ExportTab | null
}

export interface ShellActions {
  /**
   * Switch sections: the tree, the config store's selection, and the centre
   * frame, which the switch chooses through `centreOf`.
   */
  setSection(section: UiSection): void
  setMode(mode: Mode): void
  setFilter(filter: string): void
  /**
   * Open an editor popover for a key, selecting it in the config store.
   *
   * A target that names a `region` came from a click on the mock, and that
   * keeps the mock on screen: the popover is anchored to the thing that was
   * clicked, and replacing it with a section panel would leave the popover
   * floating over a copy of its own controls. Everything else — a tree row, the
   * palette — leaves the centre frame as it found it.
   */
  openEditor(target: EditorTarget): void
  /** Close the popover. The value stays whatever the editor last applied. */
  closeEditor(): void
  setPaletteOpen(open: boolean): void
  /** Leave the landing for the editor, or send the user back to it. */
  setLanding(landing: boolean): void
  /** Open the export dialog on one of its tabs. */
  openExport(tab?: ExportTab): void
  closeExport(): void
}

export type ShellStore = ShellState & ShellActions

/** `anchor` for an element, or a zero rect when there is nothing to anchor to. */
export function anchorOf(element: Element | null | undefined): Anchor {
  if (!element) return { top: 0, left: 0, width: 0, height: 0 }
  const rect = element.getBoundingClientRect()
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

export function initialShellState(): ShellState {
  return {
    section: DEFAULT_UI_SECTION,
    centre: centreOf(DEFAULT_UI_SECTION),
    mode: 'EDIT',
    filter: '',
    editor: null,
    paletteOpen: false,
    landing: true,
    exportTab: null,
  }
}

export const useShellStore = create<ShellStore>()((write) => ({
  ...initialShellState(),

  setSection(section) {
    // The filter belongs to the section it was typed in; carrying it across would
    // open the next section on an empty tree with no visible reason why.
    write({ section, centre: centreOf(section), filter: '', editor: null })
    useConfigStore.getState().setSection(primaryRefSection(section))
  },

  setMode(mode) {
    write({ mode })
  },

  setFilter(filter) {
    write({ filter })
  },

  openEditor(target) {
    const fromRegion = target.region !== undefined
    write({
      editor: target,
      paletteOpen: false,
      ...(fromRegion ? { centre: 'preview' as const } : {}),
    })
    useConfigStore.getState().select({ key: target.key, region: target.region })
  },

  closeEditor() {
    write({ editor: null })
  },

  setPaletteOpen(open) {
    write({ paletteOpen: open })
  },

  setLanding(landing) {
    // Going back to the landing takes the chrome's own overlays with it; leaving
    // one open over a screen that no longer has a document behind it is a popover
    // editing a key nobody can see.
    write({ landing, editor: null, paletteOpen: false, exportTab: null })
  },

  openExport(tab = 'file') {
    write({ exportTab: tab, paletteOpen: false })
  },

  closeExport() {
    write({ exportTab: null })
  },
}))

/** Put the shell back to a fresh session. Tests use it. */
export function resetShellStore(): void {
  useShellStore.setState(initialShellState())
}
