/**
 * Static Console chrome (ADR-0002). This is the placeholder shell: real content
 * arrives with the shell, preview and editor beads, which replace the bodies of
 * these regions rather than inventing a new structure.
 *
 * The visual contract is docs/design/console-direction.html; the tokens are in
 * src/index.css, and this file uses those and nothing else.
 */
import type { ReactNode } from 'react'

const SECTIONS = ['layout', 'sidebar', 'status', 'keys', 'theme', 'all'] as const

/** A 1px frame whose caption interrupts the top edge: `┤ caption ├`. */
function Panel({
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
      {/* The caption sits on the page background so the frame reads as passing
          behind it; it must not be clipped, so the panel body owns the overflow. */}
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

/** One `├ key  value` row of the settings tree. */
function TreeRow({
  branch,
  name,
  value,
  valueClass,
  focused = false,
}: {
  branch: string
  name: string
  value: string
  valueClass: string
  focused?: boolean
}) {
  return (
    <div
      className={
        focused
          ? '-mx-3 flex gap-2 bg-surface0 px-3 text-text'
          : 'flex gap-2 pl-3 text-subtext0'
      }
    >
      {focused && <span className="text-coral">{'▸'}</span>}
      <span>{branch}</span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className={valueClass}>{value}</span>
    </div>
  )
}

export default function App() {
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-crust text-text">
      {/* Top line */}
      <header className="flex h-topline shrink-0 items-center gap-[18px] border-b border-surface0 bg-mantle px-[14px]">
        <span className="font-bold text-coral" aria-label="corral">
          {'▐▛█▜▌'}
        </span>
        <span className="text-subtext0">config.toml</span>
        <nav aria-label="Sections" className="flex items-center gap-[18px]">
          {SECTIONS.map((name, i) => (
            <span
              key={name}
              className={
                i === 0 ? 'bg-surface0 px-2 py-[2px] text-text' : 'text-overlay0'
              }
            >{`[${i + 1}] ${name}`}</span>
          ))}
        </nav>
        <span className="ml-auto text-overlay0">ctrl+b ? help&ensp;&ensp;ctrl+k palette</span>
      </header>

      {/* Body */}
      <div className="grid min-h-0 flex-1 grid-cols-[var(--spacing-tree)_minmax(0,1fr)] gap-[10px] p-[10px]">
        <Panel caption="settings" className="gap-[2px] px-3 py-[14px]">
          <div className="text-overlay0">ui</div>
          <TreeRow branch="├" name="sidebar_width" value="26" valueClass="text-yellow" />
          <TreeRow branch="├" name="tab_bar_position" value="top" valueClass="text-green" />
          <TreeRow
            branch="├"
            name="sidebar.agents.rows"
            value="2"
            valueClass="text-overlay0"
            focused
          />
          <TreeRow branch="└" name="accent" value="cyan" valueClass="text-teal" />
          <div className="mt-[6px] text-overlay0">theme</div>
          <TreeRow branch="├" name="name" value="catppuccin" valueClass="text-green" />
          <TreeRow branch="└" name="auto_switch" value="false" valueClass="text-red" />
          <div className="mt-[6px] text-overlay0">keys</div>
          <TreeRow branch="└" name="prefix" value="ctrl+b" valueClass="text-yellow" />
          <p className="mt-auto border-t border-surface0 pt-[10px] text-overlay0">
            / search&ensp;&ensp;j k move&ensp;&ensp;enter edit
            <br />d reset to default&ensp;&ensp;u undo
          </p>
        </Panel>

        <Panel caption="preview · click anything to edit it">
          <div className="m-[10px] flex flex-1 items-center justify-center bg-base text-[12px] text-overlay0">
            <p className="max-w-[46ch] text-center">
              The herdr mock lands here. Load a <span className="text-subtext0">config.toml</span>{' '}
              or start from herdr&rsquo;s defaults, then click any region to edit the keys that
              draw it.
            </p>
          </div>
        </Panel>
      </div>

      {/* Diagnostics line */}
      <footer className="flex h-diagnostics shrink-0 items-center border-t border-surface0 bg-mantle text-[12px]">
        <span className="flex h-diagnostics items-center bg-coral px-3 font-bold text-crust">
          EDIT
        </span>
        <span className="px-3 text-green">{'●'} 0 errors</span>
        <span className="px-3 text-overlay0">{'▲'} 0 warnings</span>
        <span className="ml-auto px-3 text-subtext0">0 keys changed</span>
        <span className="px-3 text-subtext0">:diff</span>
        <span className="flex h-diagnostics items-center bg-surface0 px-3 text-text">
          :w&ensp;download config.toml
        </span>
      </footer>
    </div>
  )
}
