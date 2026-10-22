import { describe, it, expect, afterEach } from 'vitest'
import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { EsNumberInput } from '../es-number-input'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { document.body.innerHTML = '' })

function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

function mount({ allowNegative = false } = {}) {
  const reported: (number | null)[] = []
  let setOutside: (n: number | null) => void = () => {}
  function Host() {
    const [value, setValue] = useState<number | null>(null)
    setOutside = setValue
    return <EsNumberInput id="n" value={value} allowNegative={allowNegative} onValue={n => { reported.push(n); setValue(n) }} />
  }
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(<Host />))
  const input = el.querySelector<HTMLInputElement>('#n')!
  return { input, reported, setOutside: (n: number | null) => act(() => setOutside(n)), unmount: () => act(() => root.unmount()) }
}

describe('EsNumberInput', () => {
  it('renders a text field with a decimal keypad and passes other props through', () => {
    const html = renderToStaticMarkup(
      <EsNumberInput id="p" value={28080.5} onValue={() => {}} placeholder="28.080,50" required aria-describedby="h" className="c" />,
    )
    expect(html).toContain('type="text"')
    expect(html).toContain('inputMode="decimal"')
    expect(html).toContain('autoComplete="off"')
    expect(html).toContain('id="p"')
    expect(html).toContain('placeholder="28.080,50"')
    expect(html).toContain('required=""')
    expect(html).toContain('aria-describedby="h"')
    expect(html).toContain('class="c"')
    expect(html).toContain('value="28080,5"')
  })

  it.each([
    ['28.080', 28080],
    ['28.080,5', 28080.5],
    ['6,69', 6.69],
    ['6.69', 6.69],
    ['10', 10],
    ['abc', null],
  ])('reads "%s" as %s and keeps the typed text', (typed, expected) => {
    const { input, reported, unmount } = mount()
    setValue(input, typed)
    expect(reported.at(-1)).toBe(expected)
    expect(input.value).toBe(typed)
    unmount()
  })

  it('flags unreadable text as invalid so the form does not submit it', () => {
    const { input, unmount } = mount()
    setValue(input, 'abc')
    expect(input.validity.valid).toBe(false)
    setValue(input, '28.080')
    expect(input.validity.valid).toBe(true)
    unmount()
  })

  it('accepts a leading minus only with allowNegative', () => {
    const plain = mount()
    setValue(plain.input, '-6,69')
    expect(plain.reported.at(-1)).toBeNull()
    plain.unmount()
    const signed = mount({ allowNegative: true })
    setValue(signed.input, '-6,69')
    expect(signed.reported.at(-1)).toBe(-6.69)
    signed.unmount()
  })

  it('keeps an intermediate keystroke while the user types', () => {
    const { input, unmount } = mount()
    for (const t of ['2', '28', '28.', '28.0', '28.08', '28.080', '28.080,', '28.080,5']) {
      setValue(input, t)
      expect(input.value).toBe(t)
    }
    unmount()
  })

  it('shows an external value with a comma decimal and no grouping, and clears on reset', () => {
    const { input, setOutside, unmount } = mount()
    setValue(input, '12')
    setOutside(28080.5)
    expect(input.value).toBe('28080,5')
    setOutside(null)
    expect(input.value).toBe('')
    unmount()
  })
})
