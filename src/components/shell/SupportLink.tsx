/**
 * The Ko-fi link — one verb-shaped anchor, drawn in the Console's own chrome
 * rather than the vendor's widget.
 *
 * ko-fi.com hands out a `<script>` that injects a rounded, branded button in
 * its own font. ADR-0002 forbids all of that — one font, square corners, coral
 * as the only accent — so the link is a plain anchor styled like `:diff`:
 * `subtext0` at rest, `text` on hover, the same padding as its neighbours.
 * Nothing is loaded from the vendor, which also keeps ADR-0001 true:
 * herdr-corral still talks to no one until the user clicks.
 */
export const SUPPORT_URL = 'https://ko-fi.com/robertwlodarczyk'
export const SUPPORT_TEXT = 'support my token budget'

export function SupportLink({ className = '' }: { readonly className?: string }) {
  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="support me on ko-fi"
      className={`shrink-0 whitespace-nowrap text-subtext0 hover:text-text ${className}`}
    >
      {'🤖'} {SUPPORT_TEXT}
    </a>
  )
}
