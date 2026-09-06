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
})
