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
 */
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { summarize, useDiagnostics } from '@/lib/diagnostics'
import { BLOCKED_REASON, FILE_NAME, downloadConfig } from '@/lib/download'
import { changedLeaves, useConfigStore } from '@/store/config'
import { useShellStore } from '@/store/shell'
import { useState } from 'react'

export function DiagnosticsLine({ fileName = FILE_NAME }: { fileName?: string }) {
  const mode = useShellStore((state) => state.mode)
  const diagnostics = useDiagnostics()
  const changed = useConfigStore(changedLeaves)
  const [showDiff, setShowDiff] = useState(false)

  const { errors, warnings, firstWarning } = summarize(diagnostics)
  const blocked = errors > 0

  return (
    <>
      {showDiff && (
        <section
          aria-label="changed keys"
          className="max-h-[30dvh] shrink-0 overflow-y-auto border-t border-surface0 bg-mantle px-3 py-2 text-[12px]"
        >
          {changed.length === 0 ? (
            <p className="text-overlay0">nothing changed yet</p>
          ) : (
            <ul className="flex flex-col">
              {changed.map((path) => (
                <li key={path} className="text-subtext0">
                  {path}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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

        <span className="ml-auto shrink-0 px-3 text-subtext0">
          {changed.length} {changed.length === 1 ? 'key' : 'keys'} changed
        </span>
        <button
          type="button"
          aria-expanded={showDiff}
          onClick={() => setShowDiff((open) => !open)}
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
                onClick={() => downloadConfig(fileName)}
                className="flex h-diagnostics items-center bg-surface0 px-3 text-text disabled:text-overlay0"
              >
                {`:w  download ${fileName}`}
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {blocked ? BLOCKED_REASON : `write ${fileName}, comments and all`}
          </TooltipContent>
        </Tooltip>
      </footer>
    </>
  )
}
