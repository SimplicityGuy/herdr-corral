/**
 * The moves, as arithmetic.
 *
 * Every gesture the status bar editor offers is one of these functions, so the
 * cap, the renumbering and the delete-versus-empty rule are all provable without
 * a drag, a popover or a store.
 */
import {
  MAX_ENTRIES,
  TOO_MANY_ENTRIES,
  type TabBarEntry,
  addEntry,
  asEntries,
  fieldsOf,
  moveEntry,
  newEntry,
  removeEntry,
  sameEntries,
  typeOf,
  withField,
} from '@/components/editors/status-bar-model'
import { describe, expect, it } from 'vitest'

const ZOOM: TabBarEntry = { type: 'zoom' }
const HOST: TabBarEntry = { type: 'hostname' }
const CLOCK: TabBarEntry = { type: 'datetime', format: '%H:%M' }

describe('asEntries', () => {
  it('reads the stored list back as tables', () => {
    expect(asEntries([ZOOM, CLOCK])).toEqual([ZOOM, CLOCK])
  })

  it('answers an empty list for a value that is not a list at all', () => {
    expect(asEntries(undefined)).toEqual([])
    expect(asEntries('zoom')).toEqual([])
  })

  it('keeps an unreadable element as a blank rather than closing the gap', () => {
    // The user's file is theirs to get wrong; the entry still has to keep its
    // place in the list, and its own remove button.
    expect(asEntries([ZOOM, 'nonsense', HOST])).toEqual([ZOOM, {}, HOST])
  })

  it('copies, so editing the result cannot reach the store', () => {
    const stored = [{ type: 'text', text: 'hi' }]
    const entries = asEntries(stored)
    entries[0] = { ...entries[0], text: 'changed' }
    expect(stored[0].text).toBe('hi')
  })
})

describe('fieldsOf', () => {
  it('reads the validator’s own table, required fields first', () => {
    expect(fieldsOf('command').map((field) => field.name)).toEqual([
      'command',
      'interval_seconds',
      'timeout_seconds',
    ])
    expect(fieldsOf('command')[0].required).toBe(true)
    expect(fieldsOf('command')[1].required).toBe(false)
  })

  it('gives the two entry types with no fields nothing to draw', () => {
    expect(fieldsOf('zoom')).toEqual([])
    expect(fieldsOf('hostname')).toEqual([])
  })

  it('bounds the seconds fields the way herdr does', () => {
    const [, interval, timeout] = fieldsOf('command')
    expect(interval.kind).toBe('seconds')
    expect(interval.max).toBe(31_536_000)
    expect(timeout.max).toBe(3_600)
  })

  it('has nothing to say about a type herdr does not have', () => {
    expect(fieldsOf('weather')).toEqual([])
  })
})

describe('newEntry', () => {
  it('writes the required field empty rather than leaving it out', () => {
    // A `text` entry with no `text` key is a file herdr throws away whole.
    expect(newEntry('text')).toEqual({ type: 'text', text: '' })
    expect(newEntry('command')).toEqual({ type: 'command', command: '' })
  })

  it('leaves the optional fields alone', () => {
    expect(newEntry('datetime')).toEqual({ type: 'datetime' })
  })
})

describe('addEntry', () => {
  it('appends at the end', () => {
    const outcome = addEntry([ZOOM], 'hostname')
    expect(outcome.ok && outcome.entries).toEqual([ZOOM, HOST])
  })

  it('refuses a seventeenth entry, and says why', () => {
    const full = Array.from({ length: MAX_ENTRIES }, () => ZOOM)
    const outcome = addEntry(full, 'zoom')
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.reason).toBe(TOO_MANY_ENTRIES)
  })

  it('fills the bar exactly to the cap', () => {
    const nearly = Array.from({ length: MAX_ENTRIES - 1 }, () => ZOOM)
    const outcome = addEntry(nearly, 'zoom')
    expect(outcome.ok && outcome.entries.length).toBe(MAX_ENTRIES)
  })
})

describe('removeEntry', () => {
  it('drops one and closes the gap', () => {
    expect(removeEntry([ZOOM, HOST, CLOCK], 1)).toEqual([ZOOM, CLOCK])
  })

  it('leaves a list an out-of-range index cannot address', () => {
    expect(removeEntry([ZOOM], 4)).toEqual([ZOOM])
  })
})

describe('moveEntry', () => {
  it('moves an entry down the list', () => {
    expect(moveEntry([ZOOM, HOST, CLOCK], 0, 2)).toEqual([HOST, CLOCK, ZOOM])
  })

  it('moves an entry up the list', () => {
    expect(moveEntry([ZOOM, HOST, CLOCK], 2, 0)).toEqual([CLOCK, ZOOM, HOST])
  })

  it('clamps at the ends rather than refusing', () => {
    // "further left" at the left edge is a no-op, not an error to explain.
    expect(moveEntry([ZOOM, HOST], 0, -1)).toEqual([ZOOM, HOST])
    expect(moveEntry([ZOOM, HOST], 1, 9)).toEqual([ZOOM, HOST])
  })

  it('leaves a list alone when the source is not in it', () => {
    expect(moveEntry([ZOOM], 3, 0)).toEqual([ZOOM])
  })
})

describe('withField', () => {
  it('sets a field on one entry and leaves the others', () => {
    expect(withField([ZOOM, CLOCK], 1, 'format', '%a %d')).toEqual([
      ZOOM,
      { type: 'datetime', format: '%a %d' },
    ])
  })

  it('deletes a field asked for as undefined', () => {
    // A key herdr never saw and a key set to nothing are different files.
    expect(withField([CLOCK], 0, 'format', undefined)).toEqual([{ type: 'datetime' }])
  })

  it('writes a number as a number', () => {
    expect(withField([{ type: 'command', command: 'date' }], 0, 'interval_seconds', 30)).toEqual([
      { type: 'command', command: 'date', interval_seconds: 30 },
    ])
  })
})

describe('typeOf and sameEntries', () => {
  it('reports a missing type as the empty string', () => {
    expect(typeOf(ZOOM)).toBe('zoom')
    expect(typeOf({})).toBe('')
  })

  it('sees two lists that would be written the same way as the same', () => {
    expect(sameEntries([ZOOM], [{ type: 'zoom' }])).toBe(true)
    expect(sameEntries([ZOOM], [HOST])).toBe(false)
  })
})
