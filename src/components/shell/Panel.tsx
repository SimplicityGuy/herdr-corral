/**
 * A 1px `--surface1` frame whose caption interrupts the top edge — ADR-0002.
 *
 * The caption is text on the page background, so the border reads as passing
 * behind it. That means it must not be clipped, which is why the panel body owns
 * the overflow and the frame itself does not.
 */
import type { ReactNode } from 'react'

export function Panel({
  caption,
  children,
  className = '',
}: {
  caption: string
  children: ReactNode
  className?: string
}) {
  return (
    <section aria-label={caption} className="relative flex min-h-0 flex-col border border-surface1">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-[9px] left-[10px] z-10 bg-crust px-[6px] text-[11px] text-subtext0"
      >
        {`┤ ${caption} ├`}
      </span>
      <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${className}`}>{children}</div>
    </section>
  )
}
