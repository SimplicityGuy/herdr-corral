/**
 * The top line — ADR-0002 "Shell anatomy".
 *
 * The corral mark, the file being edited with a dirty marker, the six section
 * switches, and the two global chords on the right. The switches are real buttons
 * so the mouse and the keyboard reach the same thing; `1`–`6` press them from
 * anywhere the focus is not a text field.
 */
import { isBareShortcut } from '@/components/shell/keyboard'
import { FILE_NAME } from '@/lib/download'
import { UI_SECTIONS } from '@/lib/sections'
import { isDirty } from '@/store/config'
import { useConfigStore } from '@/store/config'
import { useShellStore } from '@/store/shell'
import { useEffect } from 'react'

export function TopLine() {
  const section = useShellStore((state) => state.section)
  const setSection = useShellStore((state) => state.setSection)
  const dirty = useConfigStore(isDirty)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isBareShortcut(event)) return
      const index = Number.parseInt(event.key, 10) - 1
      const target = UI_SECTIONS[index]
      if (target === undefined || event.key.length !== 1) return
      event.preventDefault()
      setSection(target)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [setSection])

  return (
    <header className="flex h-topline shrink-0 items-center gap-[12px] overflow-hidden border-b border-surface0 bg-mantle px-[14px] whitespace-nowrap lg:gap-[18px]">
      <span className="shrink-0 font-bold text-coral" aria-label="corral">
        {'▐▛█▜▌'}
      </span>
      <span className="shrink-0 text-subtext0">{FILE_NAME}</span>
      {dirty && (
        <span aria-label="unsaved changes" className="-ml-[10px] shrink-0 text-coral">
          *
        </span>
      )}
      <nav
        aria-label="Sections"
        className="flex shrink-0 items-center gap-[12px] whitespace-nowrap lg:gap-[18px]"
      >
        {UI_SECTIONS.map((name, index) => (
          <button
            key={name}
            type="button"
            aria-current={name === section ? 'page' : undefined}
            onClick={() => setSection(name)}
            className={
              name === section
                ? 'shrink-0 bg-surface0 px-2 py-[2px] whitespace-nowrap text-text'
                : 'shrink-0 px-2 py-[2px] whitespace-nowrap text-overlay0 hover:text-subtext0'
            }
          >{`[${index + 1}] ${name}`}</button>
        ))}
      </nav>
      {/* The switches are the line's job and never shrink; the hints give way
          instead. Below 1024 there is no room for them at all, between 1024 and
          1280 only for the chords, and the words come back at the ADR's 1280
          reference width. */}
      <span
        aria-label="Global shortcuts"
        className="ml-auto hidden shrink overflow-hidden text-overlay0 lg:block"
      >
        ctrl+b&nbsp;?<span className="hidden xl:inline"> help</span>&ensp;&ensp;ctrl+k
        <span className="hidden xl:inline"> palette</span>
      </span>
    </header>
  )
}
