import { KeyChordInput, type KeyChordInputProps } from '@/components/common/KeyChordInput'
import { resetShellStore, useShellStore } from '@/store/shell'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  resetShellStore()
})

const NAME = 'keys.split_vertical'

/**
 * The field is controlled, so a test that types into it needs something holding
 * the value — a parent, exactly as the section view and the popover are. It
 * takes a settled value the same way the real ones do, by writing it and
 * handing the field the result.
 */
function Host({
  initial,
  ...props
}: { initial: string } & Omit<KeyChordInputProps, 'name' | 'value' | 'onChange'> & {
    onChange?: (next: string) => void
  }) {
  const [value, setValue] = useState(initial)
  return (
    <KeyChordInput
      name={NAME}
      value={value}
      {...props}
      onChange={(next) => {
        setValue(next)
        props.onChange?.(next)
      }}
      onCommit={(next) => {
        setValue(next)
        props.onCommit?.(next)
      }}
      onRecord={(next) => {
        setValue(next)
        props.onRecord?.(next)
      }}
    />
  )
}

function setup(
  initial = 'prefix+v',
  props: Omit<KeyChordInputProps, 'name' | 'value' | 'onChange'> = {},
) {
  const onChange = vi.fn<(next: string) => void>()
  const onRecord = vi.fn<(next: string) => void>()
  const onCommit = vi.fn<(next: string) => void>()
  const view = render(
    <Host
      initial={initial}
      onChange={onChange}
      onRecord={onRecord}
      onCommit={onCommit}
      {...props}
    />,
  )
  return {
    view,
    onChange,
    onRecord,
    onCommit,
    record: screen.getByRole('button', { name: `record ${NAME}` }),
    field: screen.getByRole('textbox', { name: NAME }),
  }
}

describe('KeyChordInput', () => {
  it('shows the chord exactly as the config spells it', () => {
    const { field } = setup('plus')
    // `normalizeChord('plus')` is `+`, which does not read back — invariant 7.
    expect(field).toHaveValue('plus')
  })

  it('enters RECORD mode on enter, and says so in the shell’s mode badge', async () => {
    const user = userEvent.setup()
    const { record } = setup()

    record.focus()
    await user.keyboard('{Enter}')

    expect(record).toHaveAttribute('aria-pressed', 'true')
    expect(useShellStore.getState().mode).toBe('RECORD')
  })

  it('captures the next combination as a herdr chord', async () => {
    const user = userEvent.setup()
    const { record, onRecord } = setup()

    await user.click(record)
    fireEvent.keyDown(record, { key: 'P', ctrlKey: true, shiftKey: true })

    // What was pressed, and only that: a browser cannot see herdr's prefix mode,
    // so a recording never carries the marker the old value had.
    expect(onRecord).toHaveBeenCalledWith('ctrl+shift+p')
    expect(useShellStore.getState().mode).toBe('EDIT')
  })

  it('keeps waiting while only a modifier is down', async () => {
    const user = userEvent.setup()
    const { record, onRecord } = setup()

    await user.click(record)
    fireEvent.keyDown(record, { key: 'Control', ctrlKey: true })

    expect(onRecord).not.toHaveBeenCalled()
    expect(record).toHaveAttribute('aria-pressed', 'true')
  })

  it('cancels on esc, changing nothing', async () => {
    const user = userEvent.setup()
    const { record, onRecord, onChange } = setup()

    await user.click(record)
    fireEvent.keyDown(record, { key: 'Escape' })

    expect(onRecord).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(record).toHaveAttribute('aria-pressed', 'false')
    expect(useShellStore.getState().mode).toBe('EDIT')
  })

  it('keeps a recording away from the shell’s own shortcuts', async () => {
    const user = userEvent.setup()
    const shell = vi.fn<(event: KeyboardEvent) => void>()
    document.addEventListener('keydown', shell)
    const { record, onRecord } = setup()

    await user.click(record)
    fireEvent.keyDown(record, { key: '4' })
    document.removeEventListener('keydown', shell)

    // `4` is a section switch in the top line; while recording it is a chord.
    expect(onRecord).toHaveBeenCalledWith('4')
    expect(shell).not.toHaveBeenCalled()
  })

  it('puts the mode badge back when the field goes away mid-recording', async () => {
    const user = userEvent.setup()
    const { record, view } = setup()

    await user.click(record)
    expect(useShellStore.getState().mode).toBe('RECORD')

    view.unmount()

    expect(useShellStore.getState().mode).toBe('EDIT')
  })

  it('settles the value when the prefix marker is toggled, rather than only drafting it', async () => {
    const user = userEvent.setup()
    const { onCommit, field } = setup('ctrl+v')
    const toggle = screen.getByRole('checkbox', { name: `prefix+ for ${NAME}` })

    await user.click(toggle)
    // The commit path, not the draft path: a toggle that only moved the draft
    // would show a `prefix+` the file does not have.
    expect(onCommit).toHaveBeenCalledWith('prefix+ctrl+v')
    expect(field).toHaveValue('prefix+ctrl+v')

    await user.click(toggle)
    expect(onCommit).toHaveBeenLastCalledWith('ctrl+v')
    expect(field).toHaveValue('ctrl+v')
  })

  it('settles a typed chord when focus leaves the field', async () => {
    const user = userEvent.setup()
    const { field, onCommit } = setup('')
    render(<button type="button">elsewhere</button>)

    await user.type(field, 'prefix+f1')
    expect(onCommit).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(onCommit).toHaveBeenCalledWith('prefix+f1')
  })

  it('keeps the value in hand while focus moves inside the control', async () => {
    const user = userEvent.setup()
    const { field, onCommit } = setup('')

    await user.type(field, 'ctrl+v')
    await user.click(screen.getByRole('checkbox', { name: `prefix+ for ${NAME}` }))

    // The toggle committed once, for itself; the blur onto it did not.
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('prefix+ctrl+v')
  })

  it('says so when a key has no herdr spelling, instead of looking deaf', async () => {
    const user = userEvent.setup()
    const { record, onRecord } = setup()

    await user.click(record)
    fireEvent.keyDown(record, { key: 'ContextMenu' })

    expect(screen.getByText(/cannot spell that key/)).toBeInTheDocument()
    expect(record).toHaveAttribute('aria-pressed', 'true')
    expect(onRecord).not.toHaveBeenCalled()

    // A modifier on its way to a chord is not a failure and says nothing.
    fireEvent.keyDown(record, { key: 'P', ctrlKey: true, shiftKey: true })
    expect(onRecord).toHaveBeenCalledWith('ctrl+shift+p')
  })

  it('offers no prefix toggle where herdr does not allow one', () => {
    setup('h', { allowPrefix: false })
    expect(screen.queryByRole('checkbox', { name: `prefix+ for ${NAME}` })).not.toBeInTheDocument()
  })

  it('takes a typed chord on enter, which is the fallback path', async () => {
    const user = userEvent.setup()
    const { field, onCommit } = setup('')

    await user.type(field, 'prefix+x{Enter}')

    expect(onCommit).toHaveBeenCalledWith('prefix+x')
  })
})
