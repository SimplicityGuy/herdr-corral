/**
 * When a bare key is a command and when it is a character.
 *
 * ADR-0002's shortcuts are unmodified letters and digits — `1`–`6`, `j`, `k`,
 * `d`, `u`, `/`. Every one of them is also something a person types into the
 * filter box or a value field, so the shell has exactly one rule: a bare key is a
 * command only when the focus is not somewhere text goes.
 */

/** True when typing into this element should produce characters, not commands. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * True when a keydown is a bare shortcut: no modifier, and not in a text field.
 *
 * `shift` is not excluded, because `?` and `:` are shifted characters on most
 * layouts and a shortcut spelled with one would be unreachable otherwise.
 */
export function isBareShortcut(event: {
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  target: EventTarget | null
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  return !isTypingTarget(event.target)
}
