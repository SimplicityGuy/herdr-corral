/**
 * The Console shell (ADR-0002). Top line, settings tree, preview frame,
 * diagnostics line, with the command palette and the inline popover over them.
 *
 * The visual contract is docs/design/console-direction.html; the tokens are in
 * src/index.css, and this file uses those and nothing else.
 *
 * The centre frame is a placeholder until the preview bead fills it. Everything
 * that bead needs is already here: `useShellStore.openEditor` anchors an editor to
 * a region, `selection.region` records which region is selected, and the popover
 * renders whatever `registerEditor` has claimed the key.
 */
import { CommandPalette } from '@/components/shell/CommandPalette'
import { DiagnosticsLine } from '@/components/shell/DiagnosticsLine'
import { InlinePopover } from '@/components/shell/InlinePopover'
import { Panel } from '@/components/shell/Panel'
import { SettingsTree } from '@/components/shell/SettingsTree'
import { TopLine } from '@/components/shell/TopLine'
import { TooltipProvider } from '@/components/ui/tooltip'
import { FILE_NAME } from '@/lib/download'

export default function App() {
  return (
    <TooltipProvider>
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-crust text-text">
        <TopLine />

        <div className="grid min-h-0 flex-1 grid-cols-[var(--spacing-tree)_minmax(0,1fr)] gap-[10px] p-[10px]">
          <SettingsTree />

          <Panel caption="preview · click anything to edit it">
            <div className="m-[10px] flex flex-1 items-center justify-center bg-base text-[12px] text-overlay0">
              <p className="max-w-[46ch] text-center">
                The herdr mock lands here. Load a <span className="text-subtext0">config.toml</span>{' '}
                or start from herdr&rsquo;s defaults, then click any region to edit the keys that
                draw it.
              </p>
            </div>
          </Panel>
        </div>

        <DiagnosticsLine fileName={FILE_NAME} />
        <InlinePopover />
        <CommandPalette />
      </div>
    </TooltipProvider>
  )
}
