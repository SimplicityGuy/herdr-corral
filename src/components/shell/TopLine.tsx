/**
 * The top line — ADR-0002 "Shell anatomy".
 *
 * The corral mark, the file being edited with a dirty marker, the six section
 * switches, and the two global chords on the right. The switches are real buttons
 * so the mouse and the keyboard reach the same thing; `1`–`6` press them from
 * anywhere the focus is not a text field.
 */
import { isBareShortcut } from '@/components/shell/keyboard'
import { UI_SECTIONS } from '@/lib/sections'
import { isDirty } from '@/store/config'
import { useConfigStore } from '@/store/config'
import { useShellStore } from '@/store/shell'
import { useEffect } from 'react'

/** The file name the shell shows. corral edits one file and calls it what herdr does. */
export const FILE_NAME = 'config.toml'

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
    <header className="flex h-topline shrink-0 items-center gap-[18px] border-b border-surface0 bg-mantle px-[14px]">
      <span className="font-bold text-coral" aria-label="corral">
        {'▐▛█▜▌'}
      </span>
      <span className="text-subtext0">{FILE_NAME}</span>
      {dirty && (
        <span aria-label="unsaved changes" className="-ml-[14px] text-coral">
          *
        </span>
      )}
      <nav aria-label="Sections" className="flex items-center gap-[18px]">
        {UI_SECTIONS.map((name, index) => (
          <button
            key={name}
            type="button"
            aria-current={name === section ? 'page' : undefined}
            onClick={() => setSection(name)}
            className={
              name === section
                ? 'bg-surface0 px-2 py-[2px] text-text'
                : 'px-2 py-[2px] text-overlay0 hover:text-subtext0'
            }
          >{`[${index + 1}] ${name}`}</button>
        ))}
      </nav>
      <span className="ml-auto text-overlay0">ctrl+b ? help&ensp;&ensp;ctrl+k palette</span>
    </header>
  )
}
