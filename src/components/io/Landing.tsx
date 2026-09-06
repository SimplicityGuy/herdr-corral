/**
 * The landing — the first screen, before there is a document to edit.
 *
 * Four ways in, because the file lives on a machine corral cannot see and every
 * user arrives holding it differently: drop it, pick it, paste it, or start from
 * herdr's own defaults. The chrome is the Console's (ADR-0002) so the editor
 * behind it is not a surprise: crust page, a framed panel with a `┤ caption ├`,
 * square corners, one font.
 *
 * Import is forgiving and says so out loud. A file that is not a config, one
 * larger than the guard, one the browser refuses to read, and one that is not
 * valid TOML each get their own sentence — and the last of them names the line and
 * column, because "invalid" without a position is a file the user has to bisect by
 * hand. **A failed load keeps the user here**: `loadText` changes nothing when the
 * parse fails, so there is no half-loaded state to back out of.
 *
 * Nothing is uploaded. The file is read with `File.text()` in the tab and the
 * bytes never leave it (ADR-0001).
 */
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/shell/Panel'
import { Textarea } from '@/components/ui/textarea'
import { FILE_NAME } from '@/lib/download'
import type { TomlSyntaxError } from '@/model/parse'
import { useConfigStore } from '@/store/config'
import { useShellStore } from '@/store/shell'
import { useId, useRef, useState } from 'react'

/**
 * The largest file corral will open, in bytes.
 *
 * herdr's own default config is under 20 KiB and the fullest hand-written one is a
 * few times that, so a megabyte is far past any real config and well short of a
 * size that would lock the tab up in the parser. The guard exists because a drop
 * zone accepts whatever is dragged onto it, including the wrong file entirely.
 */
export const MAX_BYTES = 1024 * 1024

/** `1 MiB`, and the sizes either side of it, spelled the way the message needs. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  const kib = bytes / 1024
  if (kib < 1024) return `${Math.round(kib)} KiB`
  return `${(kib / 1024).toFixed(1)} MiB`
}

/**
 * True when this file is plausibly a config.
 *
 * The name decides when it has the extension. Otherwise the browser's own type is
 * read, and **an empty type counts**: Chromium has no MIME type for a file with no
 * extension or an unknown one, which is exactly what a config saved as `herdrrc`
 * looks like, so refusing on an empty type would turn the common case away. What
 * that lets through is decided by the parser a moment later, which is the more
 * honest judge of whether a file is TOML — and a real binary still carries a type
 * of its own (`image/png`, `application/pdf`) and is refused here by name.
 */
function looksLikeConfig(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith('.toml') || file.type === 'text/plain' || file.type === ''
  )
}

/**
 * The first paragraph of a smol-toml error — the sentence, without the excerpt.
 *
 * `TomlError.message` is the summary, a blank line, then the same three-line caret
 * excerpt that `codeblock` holds. The landing shows the excerpt in a `<pre>` of its
 * own, so taking the message whole would print it twice. The library's own
 * "Invalid TOML document" preamble goes too, because the sentence around it has
 * already said that.
 */
const PREAMBLE = /^invalid toml document:\s*/i

function errorSummary(error: TomlSyntaxError): string {
  return error.message.split('\n\n')[0].trim().replace(PREAMBLE, '')
}

/** What went wrong, and — for a syntax error — where. */
interface LoadFailure {
  readonly message: string
  readonly position?: TomlSyntaxError
}

export function Landing() {
  const [failure, setFailure] = useState<LoadFailure | null>(null)
  const [pasted, setPasted] = useState('')
  const [over, setOver] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const pasteId = useId()

  /** Take `text` as the document, or stay here with the syntax error showing. */
  function accept(text: string): void {
    const error = useConfigStore.getState().loadText(text)
    if (error !== null) {
      setFailure({
        message: `that is not valid TOML — line ${error.line}, column ${error.column}: ${errorSummary(error)}`,
        position: error,
      })
      return
    }
    setFailure(null)
    useShellStore.getState().setLanding(false)
  }

  async function open(file: File | undefined): Promise<void> {
    if (file === undefined) return
    if (!looksLikeConfig(file)) {
      setFailure({
        message: `${file.name} is not a .toml file — corral edits herdr's ${FILE_NAME}`,
      })
      return
    }
    if (file.size > MAX_BYTES) {
      setFailure({
        message: `${file.name} is ${formatBytes(file.size)}; corral opens files up to ${formatBytes(MAX_BYTES)}`,
      })
      return
    }
    let text: string
    try {
      text = await file.text()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      setFailure({ message: `could not read ${file.name}: ${reason}` })
      return
    }
    accept(text)
  }

  function onDrop(event: React.DragEvent): void {
    event.preventDefault()
    setOver(false)
    void open(event.dataTransfer?.files?.[0])
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-crust text-text">
      <header className="flex h-topline shrink-0 items-center gap-[12px] border-b border-surface0 bg-mantle px-[14px] whitespace-nowrap">
        <span className="shrink-0 font-bold text-coral" aria-label="corral">
          {'▐▛█▜▌'}
        </span>
        <span className="shrink-0 text-subtext0">a visual editor for herdr&rsquo;s {FILE_NAME}</span>
      </header>

      <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-[10px]">
        <div className="w-full max-w-[760px] py-[10px]">
          <Panel caption={`open ${FILE_NAME}`}>
            <div className="flex flex-col gap-[14px] p-[14px]">
              {/* The zone is a button, so the pointer path and the keyboard path
                  are the same control: drop onto it, or press it to pick a file. */}
              <button
                type="button"
                onClick={() => picker.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault()
                  setOver(true)
                }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
                className={`flex flex-col items-center justify-center gap-[6px] border border-dashed px-[14px] py-[30px] text-[13px] ${
                  over ? 'border-coral bg-base text-text' : 'border-surface1 bg-base text-subtext0'
                }`}
              >
                <span className="text-text">drop your {FILE_NAME} here</span>
                <span className="text-overlay0">
                  or press to choose a file &middot; up to {formatBytes(MAX_BYTES)}, .toml or plain
                  text
                </span>
              </button>
              <input
                ref={picker}
                type="file"
                accept=".toml,text/plain"
                aria-label={`choose a ${FILE_NAME}`}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  // Clearing the input means picking the same file twice still
                  // fires a change, which is what a user who fixed it by hand and
                  // came back expects.
                  event.target.value = ''
                  void open(file)
                }}
              />

              <div className="flex flex-col gap-[6px]">
                <label htmlFor={pasteId} className="text-[11px] text-overlay0">
                  or paste it
                </label>
                <Textarea
                  id={pasteId}
                  spellCheck={false}
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  placeholder={'[theme]\nname = "catppuccin"'}
                  className="h-[140px] resize-none border-surface1 bg-base font-mono text-[12px] text-text"
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    disabled={pasted.trim() === ''}
                    onClick={() => accept(pasted)}
                    className="border border-surface1"
                  >
                    load pasted config
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-[10px] border-t border-surface0 pt-[14px]">
                <span className="min-w-0 flex-1 text-[12px] text-overlay0">
                  Nothing you open leaves this tab. corral has no server.
                </span>
                <Button
                  type="button"
                  onClick={() => {
                    useConfigStore.getState().loadDefaults()
                    useShellStore.getState().setLanding(false)
                  }}
                  className="shrink-0 border border-surface1"
                >
                  start from herdr defaults
                </Button>
              </div>

              {failure !== null && (
                <div role="alert" className="flex flex-col gap-[6px] border border-red px-[10px] py-[8px]">
                  <p className="text-[12px] text-red">{failure.message}</p>
                  {failure.position !== undefined && failure.position.codeblock !== '' && (
                    <pre className="overflow-x-auto bg-base p-[8px] text-[12px] text-subtext0">
                      {failure.position.codeblock}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </Panel>
        </div>
      </main>
    </div>
  )
}
