/**
 * The export dialog — the honest half of `:w`.
 *
 * herdr takes the file or it takes none of it, so corral shows what it is about to
 * hand over before handing it over. Two tabs answer the two questions a person has
 * at that moment: the **full file** is what will be written, and **changed hunks**
 * is what is different about it, as a unified diff of the loaded bytes against the
 * export. A session started from the defaults has no original, so every line of
 * that diff is an addition, which is the truth.
 *
 * Three ways out, because a config gets installed differently depending on where
 * herdr is running: download the file, copy it, or copy the shell snippet that
 * writes it to `~/.config/herdr/config.toml` and asks a running herdr to re-read
 * it. **Invariant 6** disables the two that produce a config herdr would act on —
 * the download and the snippet — while any error stands, and names the first one
 * rather than leaving a dead control. Copying the text is always allowed: it puts
 * a string on the clipboard, it does not install anything.
 *
 * The two destructive verbs live here too, because this is the dialog about the
 * file: "start over" throws the document away for herdr's defaults and "open
 * another file" goes back to the landing. Each asks first when there is unsaved
 * work, which is the one modal confirmation ADR-0002 allows.
 */
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDiagnostics } from '@/lib/diagnostics'
import { type DiffKind, lineMarker, unifiedHunks } from '@/lib/diff'
import {
  BLOCKED_REASON,
  FILE_NAME,
  copyText,
  downloadConfig,
  installSnippet,
} from '@/lib/download'
import { exportText, isDirty, resetConfigStore, useConfigStore } from '@/store/config'
import { type ExportTab, useShellStore } from '@/store/shell'
import { useMemo, useState } from 'react'

/** Which destructive verb is waiting on a yes. */
type Pending = 'restart' | 'reopen'

const KIND_CLASS: Record<DiffKind, string> = {
  add: 'text-green',
  remove: 'text-red',
  context: 'text-overlay0',
}

const PENDING_LABEL: Record<Pending, string> = {
  restart: 'discard and start over',
  reopen: 'discard and open another file',
}

export function ExportDialog() {
  const tab = useShellStore((state) => state.exportTab)
  const open = tab !== null
  // Both of these walk the whole file, and the dialog is shut for almost all of a
  // session: patching a megabyte of TOML and diffing it on every keystroke of an
  // edit nobody has asked to see is work with no reader. The selector and the memo
  // are gated on the dialog being open, so a shut dialog costs a boolean.
  const text = useConfigStore((state) => (open ? exportText(state) : ''))
  const original = useConfigStore((state) => (open ? state.originalText : ''))
  const dirty = useConfigStore(isDirty)
  const changed = useConfigStore((state) => state.changedLeaves().length)
  const diagnostics = useDiagnostics()
  const [status, setStatus] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  const hunks = useMemo(
    () => (tab === 'diff' ? unifiedHunks(original, text) : []),
    [tab, original, text],
  )

  const firstError = diagnostics.find((diagnostic) => diagnostic.severity === 'error')
  // The blocked controls are disabled, and a disabled control with no explanation
  // is a dead end, so the first error travels as the accessible description of
  // both of them and as the sentence under the tabs.
  const blockedReason =
    firstError === undefined
      ? undefined
      : `${firstError.path}: ${firstError.message} — ${BLOCKED_REASON}`

  function close(): void {
    setPending(null)
    setStatus(null)
    useShellStore.getState().closeExport()
  }

  async function copy(what: string, label: string): Promise<void> {
    setStatus((await copyText(what)) ? `${label} copied` : `could not reach the clipboard`)
  }

  /** Run a destructive verb, or park it behind a confirmation while dirty. */
  function ask(verb: Pending): void {
    if (dirty && pending !== verb) {
      setPending(verb)
      return
    }
    setPending(null)
    setStatus(null)
    resetConfigStore()
    if (verb === 'reopen') useShellStore.getState().setLanding(true)
    else useShellStore.getState().closeExport()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="flex max-h-[86dvh] w-full max-w-[min(920px,calc(100%-2rem))] flex-col gap-[10px] border border-surface1 bg-mantle p-[14px] text-[13px] text-text sm:max-w-[min(920px,calc(100%-2rem))]"
      >
        <DialogHeader className="gap-[4px]">
          <DialogTitle className="text-[13px] text-text">{`:w  ${FILE_NAME}`}</DialogTitle>
          <DialogDescription className="text-[12px] text-overlay0">
            {dirty
              ? `${changed} ${changed === 1 ? 'key' : 'keys'} changed. Everything you did not touch comes back byte for byte.`
              : 'Nothing changed yet, so this is the file you opened, byte for byte.'}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab ?? 'file'}
          onValueChange={(next) => useShellStore.getState().openExport(next as ExportTab)}
          className="min-h-0 flex-1 gap-[10px]"
        >
          <TabsList variant="line" className="gap-[10px] p-0">
            <TabsTrigger
              value="file"
              className="px-[8px] text-[12px] data-active:bg-surface0 data-active:text-text"
            >
              full file
            </TabsTrigger>
            <TabsTrigger
              value="diff"
              className="px-[8px] text-[12px] data-active:bg-surface0 data-active:text-text"
            >
              changed hunks
            </TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="min-h-0">
            <pre
              aria-label={`${FILE_NAME} as it will be written`}
              className="max-h-[46dvh] overflow-auto border border-surface0 bg-base p-[10px] text-[12px] leading-[1.45] text-subtext0"
            >
              {text}
            </pre>
          </TabsContent>

          <TabsContent value="diff" className="min-h-0">
            <div className="max-h-[46dvh] overflow-auto border border-surface0 bg-base p-[10px] text-[12px] leading-[1.45]"
            >
              {hunks.length === 0 ? (
                <p className="text-overlay0">nothing changed yet</p>
              ) : (
                hunks.map((hunk) => (
                  <section key={`${hunk.beforeStart}:${hunk.afterStart}`}>
                    <p className="text-mauve">
                      {`@@ -${hunk.beforeStart},${hunk.beforeCount} +${hunk.afterStart},${hunk.afterCount} @@`}
                    </p>
                    {hunk.lines.map((line, index) => (
                      <p
                        // Two identical lines can sit next to each other in a hunk,
                        // so position within the hunk is the only stable key.
                        key={`${hunk.beforeStart}:${index}`}
                        className={`whitespace-pre ${KIND_CLASS[line.kind]}`}
                      >
                        {`${lineMarker(line.kind)}${line.text}`}
                      </p>
                    ))}
                  </section>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>

        {blockedReason !== undefined && (
          <p role="alert" className="shrink-0 text-[12px] text-red">
            {blockedReason}
          </p>
        )}
        {status !== null && (
          <output className="shrink-0 text-[12px] text-green">{status}</output>
        )}

        {pending !== null ? (
          <div className="flex shrink-0 flex-wrap items-center gap-[10px] border-t border-surface0 pt-[10px]">
            <span className="min-w-0 flex-1 text-[12px] text-yellow">
              {`${changed} ${changed === 1 ? 'key' : 'keys'} changed and not written. Discard?`}
            </span>
            <Button type="button" onClick={() => ask(pending)} className="border border-red text-red">
              {PENDING_LABEL[pending]}
            </Button>
            <Button type="button" onClick={() => setPending(null)} className="border border-surface1">
              keep editing
            </Button>
          </div>
        ) : (
          <div className="flex shrink-0 flex-wrap items-center gap-[10px] border-t border-surface0 pt-[10px]">
            <Button
              type="button"
              disabled={blockedReason !== undefined}
              title={blockedReason}
              onClick={() => downloadConfig(FILE_NAME)}
              className="border border-surface1"
            >
              {`download ${FILE_NAME}`}
            </Button>
            <Button
              type="button"
              onClick={() => void copy(text, FILE_NAME)}
              className="border border-surface1"
            >
              copy to clipboard
            </Button>
            <Button
              type="button"
              disabled={blockedReason !== undefined}
              title={blockedReason}
              onClick={() => void copy(installSnippet(text), 'install snippet')}
              className="border border-surface1"
            >
              copy install snippet
            </Button>
            <span className="flex-1" />
            <Button
              type="button"
              onClick={() => ask('reopen')}
              className="border border-surface1 text-subtext0"
            >
              open another file
            </Button>
            <Button
              type="button"
              onClick={() => ask('restart')}
              className="border border-surface1 text-subtext0"
            >
              start over
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
