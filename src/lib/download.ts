/**
 * Handing the edited config back to the user: the file, the clipboard, and the
 * shell snippet that installs it.
 *
 * Every verb here is a function of `exportText()` and nothing else, which is what
 * keeps the three of them telling the same story: the patcher has already decided
 * whether that string is the original bytes with a few lines changed or a file
 * written from scratch, and none of this needs to know which.
 *
 * Nothing in this module reaches the network — it is a `Blob`, an anchor click and
 * `navigator.clipboard`, all of it inside the tab (ADR-0001). `no-network.test.ts`
 * holds the whole of `src/` to that.
 */
import { useConfigStore } from '@/store/config'

/** The one file corral edits, named what herdr names it. */
export const FILE_NAME = 'config.toml'

/** Where herdr reads its config from, and so where the install snippet writes. */
export const CONFIG_PATH = '~/.config/herdr/config.toml'

/**
 * Why the download is refused — invariant 6.
 *
 * herdr does not partially accept a config: a value its deserializer rejects
 * throws the whole file away and it starts on defaults. Handing the user a file
 * herdr would ignore is worse than refusing, so the verb is disabled and this is
 * both the tooltip and the accessible description.
 */
export const BLOCKED_REASON =
  'herdr ignores a config file it cannot read and starts on defaults; fix the errors first'

/** The current config as a string — what all three verbs write. */
export function exportedText(): string {
  return useConfigStore.getState().exportText()
}

/**
 * Save the current config under `fileName`.
 *
 * The anchor is put in the document before it is clicked and taken out after:
 * Firefox ignores a click on an element that is not in the tree, and revoking the
 * object URL in the same tick can cancel the save that click just started.
 */
export function downloadConfig(fileName: string): void {
  const url = URL.createObjectURL(new Blob([exportedText()], { type: 'application/toml' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * A heredoc terminator that does not appear as a line of `body`.
 *
 * The shell ends an unindented heredoc at the first line that is exactly the
 * terminator, and TOML can hold one: a multi-line string whose content is the
 * word `EOF` is a legal value, and so is a comment consisting of it. Left alone
 * that would end the heredoc early and write a **truncated config**, silently,
 * because the shell would then try to run the rest of the file as commands. So
 * the word is chosen against the body rather than assumed, and the loop is bounded
 * by the body itself — each candidate that collides is one line of the file.
 */
export function heredocTerminator(body: string): string {
  const lines = new Set(body.split('\n'))
  if (!lines.has('EOF')) return 'EOF'
  if (!lines.has('EOF_CORRAL')) return 'EOF_CORRAL'
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `EOF_CORRAL_${suffix}`
    if (!lines.has(candidate)) return candidate
  }
}

/**
 * The heredoc that installs `text` and tells a running herdr to re-read it.
 *
 * Quoted on purpose: the config is full of `$status`, `#` and backslashes, and an
 * unquoted heredoc would let the shell expand them into a file that no longer says
 * what the editor showed. The body is newline-terminated so the terminator starts
 * its own line whatever the config ends with, and it sits at column zero, which is
 * what an unindented heredoc needs.
 */
export function installSnippet(text: string = exportedText()): string {
  const body = text.endsWith('\n') ? text : `${text}\n`
  const end = heredocTerminator(body)
  return [
    `mkdir -p ~/.config/herdr && cat > ${CONFIG_PATH} <<'${end}'`,
    body + end,
    'herdr server reload-config',
    '',
  ].join('\n')
}

/**
 * Put `text` on the clipboard, reporting whether it landed.
 *
 * The API is unavailable outside a secure context and can be refused by
 * permission, and a copy that quietly did nothing is worse than one that says so,
 * so the caller gets a boolean to show rather than an exception to swallow.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
