/**
 * Every key the shell answers to, in the order the README lists them.
 *
 * One table, read by the help sheet. The README's cheat sheet is the same list by
 * hand; a key added to the shell goes in both.
 */
import { FILE_NAME } from '@/lib/download'

/** How long `ctrl+b` waits for its `?`. */
export const PREFIX_WINDOW_MS = 2000

export const SHORTCUTS: ReadonlyArray<readonly [keys: string, does: string]> = [
  ['1 – 6', 'switch sections (not while the focus is in a text field)'],
  ['/', "focus the settings tree's filter"],
  ['j  k', "move the tree's focused row"],
  ['enter', "open the focused row's editor"],
  ['esc', 'close the open editor, popover or dialog'],
  ['d', "reset the focused key to herdr's default"],
  ['u', 'undo'],
  ['ctrl+k', 'the command palette, over every key and action'],
  [':', `the command line — :w writes ${FILE_NAME}, :diff reviews the changes`],
  ['ctrl+b ?', 'this sheet'],
]
