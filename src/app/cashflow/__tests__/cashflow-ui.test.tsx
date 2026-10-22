import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Cashflow } from '@/types'
import ExpenseList from '../ExpenseList'
import CategoryBreakdown from '../CategoryBreakdown'
import ExpenseDialog from '../ExpenseDialog'

const item = (over: Partial<Cashflow>): Cashflow => ({
  id: 'a', user_id: 'u', date: '2026-10-05', category: 'Supermercado', description: 'Coto',
  amount_usd: 1234.5, status: 'PAGADO', created_at: '2026-10-05', ...over,
})
const noop = () => {}

describe('ExpenseList', () => {
  const html = renderToStaticMarkup(
    <ExpenseList
      items={[item({}), item({ id: 'b', status: 'PENDIENTE', date: '2000-01-01', description: null })]}
      sort={{ key: 'date', dir: 'desc' }}
      onSort={noop} onToggle={noop} onDelete={noop}
    />,
  )

  it('shows each amount as an outflow with an explicit sign', () => {
    expect(html).toContain('−US$ 1.234,50')
  })

  it('names the status in text, overdue included, and says what the toggle does', () => {
    expect(html).toContain('Pagado')
    expect(html).toContain('Vencido')
    expect(html).toContain('aria-label="Pagado. Marcar como pendiente"')
    expect(html).toContain('aria-label="Vencido. Marcar como pagado"')
    expect(html).not.toContain('⏳')
  })

  it('exposes the sort state and names the delete buttons', () => {
    expect(html).toContain('aria-sort="descending"')
    expect(html).toContain('aria-label="Borrar gasto Supermercado del 05/10/2026"')
  })
})

describe('CategoryBreakdown', () => {
  it('lists each category with its amount and share of the total', () => {
    const html = renderToStaticMarkup(
      <CategoryBreakdown items={[{ name: 'Alquiler', value: 750 }, { name: 'Salud', value: 250 }]} total={1000} period="Octubre 2026" />,
    )
    expect(html).toContain('Alquiler')
    expect(html).toContain('US$ 750,00')
    expect(html).toContain('75,0 %')
  })
})

describe('ExpenseDialog', () => {
  it('associates every field with a visible label', () => {
    const html = renderToStaticMarkup(<ExpenseDialog open={false} onClose={noop} onSaved={noop} />)
    for (const id of ['expense-date', 'expense-category', 'expense-amount', 'expense-status', 'expense-desc']) {
      expect(html).toContain(`for="${id}"`)
      expect(html).toContain(`id="${id}"`)
    }
  })
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ExpenseDialog amount', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

  async function submitAmount(typed: string) {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)))
      return new Response('{}', { status: 201 })
    }))
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<ExpenseDialog open onClose={noop} onSaved={noop} />) })
    const input = el.querySelector('#expense-amount') as HTMLInputElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, typed)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { el.querySelector('form')!.requestSubmit() })
    await act(async () => {})
    act(() => root.unmount())
    return bodies
  }

  it('sends "1.234,50" as 1234.5', async () => {
    expect((await submitAmount('1.234,50'))[0]).toMatchObject({ amount_usd: 1234.5 })
  })

  it('still sends a plain "6.69" as 6.69', async () => {
    expect((await submitAmount('6.69'))[0]).toMatchObject({ amount_usd: 6.69 })
  })
})
