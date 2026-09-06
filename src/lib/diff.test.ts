import {
  DEFAULT_CONTEXT,
  MAX_CELLS,
  diffLines,
  formatUnified,
  hunkHeader,
  splitLines,
  unifiedHunks,
} from '@/lib/diff'
import fixture from '@/test/fixture-user-config.toml?raw'
import { describe, expect, it } from 'vitest'

/** The fixture with one value changed, the way an edit reaches the exporter. */
function editFixture(): string {
  return fixture.replace('name = "catppuccin"', 'name = "gruvbox"')
}

describe('splitLines', () => {
  it('has no lines at all in an empty text', () => {
    expect(splitLines('')).toEqual([])
  })

  it('keeps a trailing newline as a final empty line, so gaining one shows up', () => {
    expect(splitLines('a\n')).toEqual(['a', ''])
    expect(splitLines('a')).toEqual(['a'])
  })
})

describe('diffLines', () => {
  it('calls every line context when nothing changed', () => {
    const lines = diffLines('a\nb\nc', 'a\nb\nc')

    expect(lines.map((line) => line.kind)).toEqual(['context', 'context', 'context'])
  })

  it('reads a changed line as a removal followed by an addition', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc')

    expect(lines.map((line) => `${line.kind}:${line.text}`)).toEqual([
      'context:a',
      'remove:b',
      'add:B',
      'context:c',
    ])
  })

  it('numbers each side independently, so an insert shifts only the after column', () => {
    const lines = diffLines('a\nc', 'a\nb\nc')

    expect(lines.map((line) => [line.before, line.after])).toEqual([
      [1, 1],
      [null, 2],
      [2, 3],
    ])
  })

  it('is all additions when there was no original at all', () => {
    const lines = diffLines('', 'a\nb')

    expect(lines.every((line) => line.kind === 'add')).toBe(true)
    expect(lines).toHaveLength(2)
  })

  it('reports two unrelated blocks past the table cap as a wholesale replacement', () => {
    // Past `MAX_CELLS` the walk stops looking for common lines. Squaring the cap
    // gives two blocks whose product is over it while each stays small enough to
    // build in a test.
    const size = Math.ceil(Math.sqrt(MAX_CELLS)) + 1
    const before = Array.from({ length: size }, (_, index) => `before ${index}`).join('\n')
    const after = Array.from({ length: size }, (_, index) => `after ${index}`).join('\n')

    const kinds = new Set(diffLines(before, after).map((line) => line.kind))

    expect(kinds).toEqual(new Set(['remove', 'add']))
  })
})

describe('unifiedHunks', () => {
  it('has no hunks when the two texts are the same', () => {
    expect(unifiedHunks(fixture, fixture)).toEqual([])
  })

  it('shows only the changed part of a file, with its context', () => {
    const hunks = unifiedHunks(fixture, editFixture())

    expect(hunks).toHaveLength(1)
    const [hunk] = hunks
    expect(hunk.lines.filter((line) => line.kind === 'remove')).toHaveLength(1)
    expect(hunk.lines.filter((line) => line.kind === 'add')).toHaveLength(1)
    expect(hunk.lines).toHaveLength(2 * DEFAULT_CONTEXT + 2)
    expect(hunk.lines.some((line) => line.text.includes('gruvbox'))).toBe(true)
    // The rest of a hundred-line file is not in the hunk, which is the point.
    expect(hunk.lines.some((line) => line.text.includes('default_shell'))).toBe(false)
  })

  it('merges two changes whose context overlaps into one hunk', () => {
    const before = ['a', 'b', 'c', 'd', 'e'].join('\n')
    const after = ['A', 'b', 'c', 'd', 'E'].join('\n')

    expect(unifiedHunks(before, after)).toHaveLength(1)
  })

  it('keeps two changes far apart in hunks of their own', () => {
    const before = Array.from({ length: 40 }, (_, index) => `line ${index}`)
    const after = [...before]
    after[2] = 'changed early'
    after[35] = 'changed late'

    expect(unifiedHunks(before.join('\n'), after.join('\n'))).toHaveLength(2)
  })

  it('counts each side of the hunk the way the @@ header claims', () => {
    const [hunk] = unifiedHunks('a\nc', 'a\nb\nc', 1)

    expect(hunkHeader(hunk)).toBe('@@ -1,2 +1,3 @@')
    expect(hunk.beforeCount).toBe(2)
    expect(hunk.afterCount).toBe(3)
  })

  it('prints the hunks the way diff -u does', () => {
    expect(formatUnified(unifiedHunks('a\nb\nc', 'a\nB\nc'))).toBe(
      ['@@ -1,3 +1,3 @@', ' a', '-b', '+B', ' c'].join('\n'),
    )
  })
})
