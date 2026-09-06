import { ColorField } from '@/components/common/ColorField'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

/** A controlled field needs somewhere to put what `onChange` reports back. */
function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <ColorField aria-label="color" value={value} onChange={setValue} />
}

describe('ColorField', () => {
  it.each([
    ['#1a2'],
    ['#1a2b3c'],
    ['blue'],
    ['rgb(10,20,30)'],
    ['reset'],
  ])('accepts %s and reports no warning', async (spelling) => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByLabelText('color'), spelling)

    expect(screen.getByLabelText('color')).toHaveValue(spelling)
    expect(screen.queryByText(/unknown color/)).not.toBeInTheDocument()
  })

  it('rejects garbage with the validate message', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByLabelText('color'), 'notacolor')

    expect(screen.getByText('▲ unknown color "notacolor"; herdr will fall back to cyan')).toBeInTheDocument()
  })

  it('says nothing about an empty value', () => {
    render(<ColorField aria-label="color" value={undefined} onChange={() => {}} />)

    expect(screen.queryByText(/unknown color/)).not.toBeInTheDocument()
  })

  it('offers a named-color picker, including reset', async () => {
    const onChange = vi.fn<(value: string) => void>()
    const user = userEvent.setup()
    render(<ColorField aria-label="color" value="" onChange={onChange} />)

    await user.selectOptions(screen.getByLabelText('color named color'), 'reset')

    expect(onChange).toHaveBeenLastCalledWith('reset')
  })

  it.each([['reset'], ['default'], ['none'], ['transparent']])(
    'shows a terminal-default indicator for %s, not an invalid swatch',
    (spelling) => {
      render(<ColorField aria-label="color" value={spelling} onChange={() => {}} />)

      const indicator = screen.getByTitle('terminal default')
      expect(indicator).toBeInTheDocument()
      // `backgroundColor: 'reset'` is not a color the browser can paint —
      // the indicator must not be handed one at all.
      expect(indicator.style.backgroundColor).toBe('')
      expect(screen.queryByText(/unknown color/)).not.toBeInTheDocument()
    },
  )

  it('warns with the value exactly as typed, not trimmed — the way checkColor shows it', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByLabelText('color'), '  notacolor  ')

    // `getByText`'s default matcher collapses whitespace, which would hide
    // exactly the bug this test is for — read the raw text instead.
    expect(
      screen.getByText('▲ unknown color "  notacolor  "; herdr will fall back to cyan', {
        normalizer: (text) => text,
      }),
    ).toBeInTheDocument()
  })
})
