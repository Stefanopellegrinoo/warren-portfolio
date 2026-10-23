import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { OnPaymentsView, type OnPaymentsData } from '../OnPayments'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { document.body.innerHTML = '' })

const DATA: OnPaymentsData = {
  payments: [
    { ticker: 'VSCXD', date: '2026-10-09', kind: 'coupon', amount: 1141.875, corrected: false },
    { ticker: 'CS50D', date: '2026-09-10', kind: 'amortization', amount: 1088.49, corrected: false },
    { ticker: 'MGCRD', date: '2026-05-14', kind: 'coupon', amount: 2363.75, corrected: true },
    { ticker: 'TTCDD', date: '2026-05-04', kind: 'coupon', amount: null, corrected: true },
  ],
  missing: [{ ticker: 'LMS8D', payments: [{ date: '2026-06-21', estimate: 225 }, { date: '2026-09-21', estimate: null }] }],
}

function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const buttons = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].filter(b => b.textContent?.trim() === text)
const labelled = (el: HTMLElement, text: string) => {
  const label = [...el.querySelectorAll('label')].find(l => l.textContent?.includes(text))!
  return (label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector('input')) as HTMLInputElement
}

function mount(data = DATA) {
  const onSave = vi.fn(async () => null)
  const onRevert = vi.fn(async () => null)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(<OnPaymentsView data={data} onSave={onSave} onRevert={onRevert} />))
  return { el, onSave, onRevert }
}

describe('OnPaymentsView — Pagos cobrados (S10)', () => {
  it('lists every payment in order with date, ticker, kind, amount and its action', () => {
    const { el } = mount()
    expect(el.querySelector('h2')?.textContent).toContain('Pagos cobrados')
    const rows = [...el.querySelectorAll('li[data-payment]')].map(li => [...li.children].map(c => c.textContent).join(' '))
    expect(rows).toEqual([
      '09/10/2026 VSCXD Cupón US$\u00a01.141,88 Corregir',
      '10/09/2026 CS50D Amortización US$\u00a01.088,49 Corregir',
      '14/05/2026 MGCRD Cupón US$\u00a02.363,75 Corregido por vos',
      '04/05/2026 TTCDD Cupón No lo cobré Corregido por vos',
    ])
  })

  it('names the missing payments of each bond with a "Cargar" action (S8)', () => {
    const { el } = mount()
    expect(el.textContent).toContain('⚠ Faltan pagos de LMS8D: 21/06/2026, 21/09/2026')
    expect(buttons(el, 'Cargar')).toHaveLength(1)
  })

  it('"Corregir" saves the amount the broker paid', async () => {
    const { el, onSave } = mount()
    act(() => buttons(el, 'Corregir')[0].click())
    const amount = labelled(el, 'Monto que pagó el broker')
    expect(amount.value).toBe('1141,88')
    setValue(amount, '1.140,5')
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    expect(onSave).toHaveBeenCalledWith({ ticker: 'VSCXD', pay_date: '2026-10-09', kind: 'coupon', amount: 1140.5 })
  })

  it('"No lo cobré" saves the payment as not received', async () => {
    const { el, onSave } = mount()
    act(() => buttons(el, 'Corregir')[0].click())
    act(() => labelled(el, 'No lo cobré').click())
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    expect(onSave).toHaveBeenCalledWith({ ticker: 'VSCXD', pay_date: '2026-10-09', kind: 'coupon', amount: null })
  })

  it('"Cargar" is pre-filled with the estimate and saves the chosen date', async () => {
    const { el, onSave } = mount()
    act(() => buttons(el, 'Cargar')[0].click())
    expect(labelled(el, 'Monto que pagó el broker').value).toBe('225')
    expect(el.textContent).toContain('Estimado por la app')
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    expect(onSave).toHaveBeenCalledWith({ ticker: 'LMS8D', pay_date: '2026-06-21', kind: 'coupon', amount: 225 })
  })

  it('"Cargar" with no estimate starts empty', () => {
    const { el } = mount({ payments: [], missing: [{ ticker: 'LMS8D', payments: [{ date: '2026-09-21', estimate: null }] }] })
    act(() => buttons(el, 'Cargar')[0].click())
    expect(labelled(el, 'Monto que pagó el broker').value).toBe('')
    expect(el.textContent).not.toContain('Estimado por la app')
  })

  it('a corrected payment can go back to automatic', async () => {
    const { el, onRevert } = mount()
    await act(async () => { buttons(el, 'Corregido por vos')[0].click() })
    await act(async () => { buttons(el, 'Volver al automático')[0].click() })
    expect(onRevert).toHaveBeenCalledWith({ ticker: 'MGCRD', pay_date: '2026-05-14', kind: 'coupon' })
  })

  it('renders nothing when there are no payments and nothing missing', () => {
    const { el } = mount({ payments: [], missing: [] })
    expect(el.textContent).toBe('')
  })
})
