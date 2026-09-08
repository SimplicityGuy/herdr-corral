/**
 * The Buy Me a Coffee link — one verb-shaped anchor, drawn in the Console's own
 * chrome rather than the vendor's widget.
 *
 * buymeacoffee.com hands out a `<script>` that injects a yellow, rounded,
 * Cookie-font button. ADR-0002 forbids all three — one font, square corners,
 * coral as the only accent — so the link is a plain anchor styled like `:diff`:
 * `subtext0` at rest, `text` on hover, the same padding as its neighbours. The
 * emoji and the wording are the ones the widget would have carried; only the
 * dress is corral's. Nothing is loaded from the vendor, which also keeps ADR-0001
 * true: corral still talks to no one until the user clicks.
 */
export const SUPPORT_URL = 'https://buymeacoffee.com/robert2'
export const SUPPORT_TEXT = 'support my token budget'

export function SupportLink({ className = '' }: { readonly className?: string }) {
  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="buy me a coffee"
      className={`shrink-0 whitespace-nowrap text-subtext0 hover:text-text ${className}`}
    >
      {'🤖'} {SUPPORT_TEXT}
    </a>
  )
}
