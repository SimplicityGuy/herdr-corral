/**
 * Handing the edited config back to the user as a file.
 *
 * A first cut, shared by the two places that offer the verb — the diagnostics
 * line and the command palette — so they cannot drift into offering different
 * things. The io bead replaces both with the export dialog (download, copy,
 * snippet, diff); what it will not have to redo is `exportText()`, which is
 * already the whole answer: the patcher decides whether that is the original
 * bytes with a few lines changed or a file written from scratch.
 */
import { useConfigStore } from '@/store/config'

/** The one file corral edits, named what herdr names it. */
export const FILE_NAME = 'config.toml'

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

/**
 * Save the current config under `fileName`.
 *
 * The anchor is put in the document before it is clicked and taken out after:
 * Firefox ignores a click on an element that is not in the tree, and revoking the
 * object URL in the same tick can cancel the save that click just started.
 */
export function downloadConfig(fileName: string): void {
  const url = URL.createObjectURL(
    new Blob([useConfigStore.getState().exportText()], { type: 'application/toml' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
