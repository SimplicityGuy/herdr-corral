import { cancelsRecording, chordFromPress, hasPrefix, withPrefix } from '@/lib/capture'
import { parseChord } from '@/model/keys'
import { describe, expect, it } from 'vitest'

/** A press, with every modifier up unless the test says otherwise. */
function press(key: string, held: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', boolean>> = {}) {
  return {
    key,
    ctrlKey: held.ctrl ?? false,
    altKey: held.alt ?? false,
    shiftKey: held.shift ?? false,
    metaKey: held.meta ?? false,
  }
}

describe('chordFromPress', () => {
  it('spells a plain letter as itself', () => {
    expect(chordFromPress(press('v'))).toBe('v')
  })

  it('spells modifiers in herdr order, whatever order they were pressed in', () => {
    expect(chordFromPress(press('P', { ctrl: true, shift: true }))).toBe('ctrl+shift+p')
    expect(chordFromPress(press('p', { shift: true, ctrl: true }))).toBe('ctrl+shift+p')
  })

  it('writes the command key as super, never as cmd', () => {
    expect(chordFromPress(press('k', { meta: true }))).toBe('super+k')
  })

  it('keeps shift when it is a modifier and drops it when it made the character', () => {
    // shift+p is a letter with a modifier; shift+/ is the character `?` itself,
    // which is how herdr's own default config spells `prefix+?`.
    expect(chordFromPress(press('P', { shift: true }))).toBe('shift+p')
    expect(chordFromPress(press('?', { shift: true }))).toBe('?')
  })

  it('names the keys herdr names', () => {
    expect(chordFromPress(press('Enter'))).toBe('enter')
    expect(chordFromPress(press(' '))).toBe('space')
    expect(chordFromPress(press('ArrowLeft'))).toBe('left')
    expect(chordFromPress(press('Backspace'))).toBe('backspace')
    expect(chordFromPress(press('F12'))).toBe('f12')
  })

  it('spells the plus key as `plus`, because `+` is the separator', () => {
    // The round-trip hole keys.ts documents: `+` does not parse, `plus` does.
    expect(chordFromPress(press('+', { shift: true }))).toBe('plus')
    expect(parseChord('plus')).not.toBeNull()
    expect(parseChord('+')).toBeNull()
  })

  it('waits rather than capturing a modifier the user is still reaching across', () => {
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead']) {
      expect(chordFromPress(press(key, { shift: true }))).toBeNull()
    }
  })

  it('adds the prefix marker only when it is asked to', () => {
    expect(chordFromPress(press('v'), true)).toBe('prefix+v')
    expect(chordFromPress(press('v'), false)).toBe('v')
  })

  it('never returns a string herdr would refuse', () => {
    for (const key of ['a', 'P', '?', '+', 'Enter', 'F5', ' ']) {
      const chord = chordFromPress(press(key, { ctrl: true }))
      expect(chord).not.toBeNull()
      expect(parseChord(chord as string)).not.toBeNull()
    }
  })
})

describe('cancelsRecording', () => {
  it('is a bare esc and nothing else', () => {
    expect(cancelsRecording(press('Escape'))).toBe(true)
    expect(cancelsRecording(press('Escape', { ctrl: true }))).toBe(false)
    expect(cancelsRecording(press('e'))).toBe(false)
  })
})

describe('the prefix marker', () => {
  it('reads and writes the marker without touching the rest of the chord', () => {
    expect(hasPrefix('prefix+v')).toBe(true)
    expect(hasPrefix('ctrl+v')).toBe(false)
    expect(withPrefix('ctrl+v', true)).toBe('prefix+ctrl+v')
    expect(withPrefix('prefix+ctrl+v', false)).toBe('ctrl+v')
    expect(withPrefix('prefix+v', true)).toBe('prefix+v')
  })

  it('leaves an empty value empty rather than writing a marker with no chord', () => {
    expect(withPrefix('', true)).toBe('')
  })
})
