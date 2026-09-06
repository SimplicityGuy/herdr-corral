/**
 * The Console shell (ADR-0002). Top line, settings tree, centre frame,
 * diagnostics line, with the command palette and the inline popover over them.
 *
 * The visual contract is docs/design/console-direction.html; the tokens are in
 * src/index.css, and this file uses those and nothing else.
 *
 * The centre frame is one line per section — `CentreFrame` below. `SectionForm`
 * draws the two non-visual sections (`layout`, `all`), `KeysEditor` draws `keys`
 * and `StatusBarView` draws `status`; every other section falls through to the
 * herdr mock, which is the default:
 * `HerdrPreview` reads the effective config and opens an editor for whichever
 * region is clicked, through the same `useShellStore.openEditor` the tree uses.
 * That is also why the editor modules are imported here — for the keys they
 * register with `registerEditor`. A bead adding its own editor for a remaining
 * section replaces just its own line.
 *
 * The landing gate is the one branch in this file. There is no document until the
 * user opens one, and a preview drawn over herdr's defaults would claim there is,
 * so `Landing` owns the screen until it hands over. The export dialog mounts
 * beside the shell rather than inside the diagnostics line, because both `:w` and
 * the palette open it and neither should own it.
 */
import '@/components/editors/ChordEditor'
import '@/components/editors/RowsEditor'
import { KeysEditor } from '@/components/editors/KeysEditor'
import { ExportDialog } from '@/components/io/ExportDialog'
import { Landing } from '@/components/io/Landing'
import { HerdrPreview } from '@/components/preview/HerdrPreview'

import '@/components/editors/register-scalar-editors'

// After the scalar editors, deliberately. Importing a view also runs its
// module's `registerEditor` calls, later claims win, and this one takes the four
// tab bar settings back off the generic type-based claim above. A module is
// evaluated where it is *first* imported, so moving the line up would hand those
// keys back to the generic form.
import { SectionForm } from '@/components/editors/SectionForm'
import { StatusBarView } from '@/components/editors/StatusBarEditor'
import { CommandPalette } from '@/components/shell/CommandPalette'
import { DiagnosticsLine } from '@/components/shell/DiagnosticsLine'
import { InlinePopover } from '@/components/shell/InlinePopover'
import { Panel } from '@/components/shell/Panel'
import { SettingsTree } from '@/components/shell/SettingsTree'
import { TopLine } from '@/components/shell/TopLine'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useShellStore } from '@/store/shell'

export default function App() {
  const landing = useShellStore((state) => state.landing)
  if (landing) return <Landing />

  return (
    <TooltipProvider>
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-crust text-text">
        <TopLine />

        <div className="grid min-h-0 flex-1 grid-cols-[var(--spacing-tree)_minmax(0,1fr)] gap-[10px] p-[10px]">
          <SettingsTree />
          <CentreFrame />
        </div>

        <DiagnosticsLine />
        <InlinePopover />
        <CommandPalette />
        <ExportDialog />
      </div>
    </TooltipProvider>
  )
}

/** What the centre column shows: one line per section, then the preview. */
function CentreFrame() {
  const section = useShellStore((state) => state.section)
  switch (section) {
    case 'layout':
      return <SectionForm section="layout" />
    case 'all':
      return <SectionForm section="all" />
    case 'status':
      return <StatusBarView />
    case 'keys':
      return <KeysEditor />
    default:
      return <PreviewFrame />
  }
}

function PreviewFrame() {
  return (
    <Panel caption="preview · click anything to edit it">
      <HerdrPreview />
    </Panel>
  )
}
