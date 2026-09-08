/**
 * The diagnostics line — ADR-0002 "Shell anatomy".
 *
 * The coral mode badge, the error and warning counts with the first warning's own
 * text, then on the right the changed-key count, `:diff`, and the download.
 *
 * **Invariant 6 lives here.** herdr throws away a whole config file it cannot
 * deserialize and starts on defaults, so an error means the file corral would hand
 * back is a file herdr would ignore. The download is disabled while any error
 * stands, and the tooltip says why rather than leaving a dead button.
 *
 * The file name is `FILE_NAME`, not a prop: the dialog behind both verbs writes
 * that one name, and a line that could be told to say something else would be
 * offering to write a file nothing downstream would produce.
 *
 * The repository and support links sit at the head of the right-hand cluster,
 * dressed as two more verbs (`SupportLink` says why it is not the vendor's button,
 * `RepoLink` why it carries no star count).
 *
 * Neither verb writes anything itself any more: both open the export dialog, `:w`
 * on the file and `:diff` on the hunks, and the dialog is where the download, the
 * clipboard and the install snippet live. `:w` stays disabled while an error
 * stands all the same — the dialog blocks the same two actions a second time, and
 * the line is where invariant 6 is meant to be visible. `:diff` is never blocked,
 * because seeing what is wrong is exactly what a user with an error needs.
 */
import { RepoLink } from '@/components/shell/RepoLink'
import { SupportLink } from '@/components/shell/SupportLink'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { summarize, useDiagnostics } from '@/lib/diagnostics'
import { BLOCKED_REASON, FILE_NAME } from '@/lib/download'
import { changedLeaves, useConfigStore } from '@/store/config'
import { useShellStore } from '@/store/shell'

export function DiagnosticsLine() {
  const mode = useShellStore((state) => state.mode)
  const diagnostics = useDiagnostics()
  const changed = useConfigStore(changedLeaves)
  const openExport = useShellStore((state) => state.openExport)

  const { errors, warnings, firstWarning } = summarize(diagnostics)
  const blocked = errors > 0

  return (
    <footer className="flex h-diagnostics shrink-0 items-center border-t border-surface0 bg-mantle text-[12px]">
      <span
        aria-label="mode"
        className="flex h-diagnostics items-center bg-coral px-3 font-bold text-crust"
      >
        {mode}
      </span>
      <span className={`px-3 ${errors > 0 ? 'text-red' : 'text-green'}`}>
        {'●'} {errors} {errors === 1 ? 'error' : 'errors'}
      </span>
      <span
        className={`min-w-0 truncate px-3 ${warnings > 0 ? 'text-yellow' : 'text-overlay0'}`}
      >
        {'▲'} {warnings} {warnings === 1 ? 'warning' : 'warnings'}
        {firstWarning !== undefined && `  ${firstWarning.message}`}
      </span>

      <RepoLink className="ml-auto px-3" />
      <SupportLink className="px-3" />
      <span className="shrink-0 px-3 text-subtext0">
        {changed.length} {changed.length === 1 ? 'key' : 'keys'} changed
      </span>
      <button
        type="button"
        onClick={() => openExport('diff')}
        className="shrink-0 px-3 text-subtext0 hover:text-text"
      >
        :diff
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A disabled button gets no pointer events, so the trigger is the
              wrapper; the button keeps `disabled`, which is what stops the click. */}
          <span className="shrink-0">
            <button
              type="button"
              disabled={blocked}
              title={blocked ? BLOCKED_REASON : undefined}
              onClick={() => openExport('file')}
              className="flex h-diagnostics items-center bg-surface0 px-3 text-text disabled:text-overlay0"
            >
              {`:w  download ${FILE_NAME}`}
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {blocked ? BLOCKED_REASON : `review and write ${FILE_NAME}, comments and all`}
        </TooltipContent>
      </Tooltip>
    </footer>
  )
}
