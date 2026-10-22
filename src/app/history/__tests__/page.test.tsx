import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import HistoryPage from '../page'
import type { ClosedTrade, Transaction } from '@/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const trade = (over: Partial<ClosedTrade>): ClosedTrade => ({
  id: 't1', user_id: 'u', ticker: 'NASDAQ:AAPL', open_date: '2026-01-10', close_date: '2026-03-12', days_held: 61,
  avg_cost: 150, close_price: 170, quantity: 10, invested: 1500, proceeds: 1700, pnl: 200, pnl_pct: 0.1333, created_at: '2026-03-12', ...over,
})

async function mount(response: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(response))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<HistoryPage />) })
  await act(async () => {})
  return { el, unmount: () => act(() => root.unmount()) }
}

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('HistoryPage', () => {
  it('renders the new header and view switch, without the old visual system', () => {
    const html = renderToStaticMarkup(<HistoryPage />)
    expect(html).toContain('>Operaciones</h1>')
    expect(html).toMatch(/<input[^>]*type="radio"[^>]*checked=""[^>]*>Posiciones cerradas/)
    expect(html).toContain('role="status"')
    expect(html).not.toMatch(/glass|text-amber|font-mono|text-glow/)
  })

  it('says the load failed instead of claiming there are no closed positions', async () => {
    const { el, unmount } = await mount(async () => new Response('{}', { status: 500 }))
    expect(el.textContent).toContain('No se pudieron cargar las operaciones')
    expect(el.textContent).not.toContain('Todavía no cerraste')
    unmount()
  })

  it('shows realized results in es-AR with an explicit sign', async () => {
    const data = [trade({}), trade({ id: 't2', ticker: 'NYSE:KO', pnl: -50.5, pnl_pct: -0.05 })]
    const { el, unmount } = await mount(async () => new Response(JSON.stringify({ data })))
    expect(el.textContent).toContain('+200,00')
    expect(el.textContent).toContain('−50,50')
    expect(el.textContent).toContain('+13,3 %')
    expect(el.textContent).toContain('US$ 149,50') // total realized
    unmount()
  })
})

describe('HistoryPage — trades to review', () => {
  const tx = (over: Partial<Transaction>): Transaction => ({
    id: 'x1', user_id: 'u', date: '2026-03-02', ticker: 'AAPL', operation: 'COMPRA', quantity: 2, price: 200, commission: 0, total: 400,
    avg_cost_after: null, notes: null, asset_type: 'CEDEAR', moneda: 'ARS', created_at: '2026-03-16T14:00:00+00:00', ...over,
  })
  const rows = [
    tx({ id: 'ok', ticker: 'KO' }),
    tx({ id: 'ced', needs_review: true, review_note: 'Cargada 14 días después de la fecha de operación.', cedear_ratio: 20, trade_currency: 'ARS', trade_quantity: 40, trade_price: 15999.987, trade_commission: 0 }),
    tx({ id: 'dis', ticker: 'DIS', asset_type: 'ACCION', needs_review: true, review_note: 'DIS no figura como CEDEAR.', cedear_ratio: null, trade_currency: 'CCL' }),
  ]

  async function mountAll() {
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.startsWith('/api/transactions?')) return new Response(JSON.stringify({ data: rows }))
      if (url.startsWith('/api/transactions/')) return new Response(JSON.stringify({ success: true }))
      return new Response(JSON.stringify({ data: [] }))
    }))
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(<HistoryPage />) })
    await act(async () => { (el.querySelector('input[value="all"]') as HTMLInputElement).click() })
    await act(async () => {})
    return { el, calls, unmount: () => act(() => root.unmount()) }
  }
  const tableRows = (el: HTMLElement) => [...el.querySelectorAll('tbody tr')].map(r => r.textContent ?? '')

  it('marks the rows to review with a chip and their note', async () => {
    const { el, unmount } = await mountAll()
    const [ko, ced] = ['KO', 'AAPL'].map(t => tableRows(el).find(r => r.includes(t))!)
    expect(ced).toContain('Revisar')
    expect(ced).toContain('Cargada 14 días después de la fecha de operación.')
    expect(ko).not.toContain('Revisar')
    unmount()
  })

  it('filters to the rows to review', async () => {
    const { el, unmount } = await mountAll()
    const toggle = [...el.querySelectorAll('button')].find(b => b.textContent === 'Para revisar (2)')!
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await act(async () => { toggle.click() })
    expect(tableRows(el).some(r => r.includes('KO'))).toBe(false)
    expect(tableRows(el).filter(r => r.includes('Revisar'))).toHaveLength(2)
    unmount()
  })

  it('corrects a CEDEAR from its ticket through PATCH, and offers no correction where no ticket can be derived', async () => {
    const { el, calls, unmount } = await mountAll()
    const fixButtons = [...el.querySelectorAll('table button')].filter(b => b.textContent === 'Corregir')
    expect(fixButtons).toHaveLength(1) // AAPL only; DIS has no ratio
    await act(async () => { (fixButtons[0] as HTMLButtonElement).click() })
    const form = el.querySelector('table form') as HTMLFormElement
    expect((form.querySelector('input[id^="fix-price"]') as HTMLInputElement).value).toBe('15999,99')
    await act(async () => { form.requestSubmit() })
    await act(async () => {})
    const patch = calls.find(c => c.init?.method === 'PATCH')!
    expect(patch.url).toBe('/api/transactions/ced')
    expect(JSON.parse(String(patch.init!.body))).toEqual({
      date: '2026-03-02', ticker: 'AAPL', operation: 'COMPRA', assetType: 'CEDEAR',
      tradeCurrency: 'ARS', tradeQuantity: 40, tradePrice: 15999.99, tradeCommission: 0, notes: '',
    })
    unmount()
  })

  async function openFix() {
    const { el, calls, unmount } = await mountAll()
    const fix = [...el.querySelectorAll('table button')].find(b => b.textContent === 'Corregir') as HTMLButtonElement
    await act(async () => { fix.click() })
    const form = el.querySelector('table form') as HTMLFormElement
    const field = (name: string) => form.querySelector(`input[id^="fix-${name}"]`) as HTMLInputElement
    const type = (name: string, value: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(name), value)
      field(name).dispatchEvent(new Event('input', { bubbles: true }))
    })
    const patched = async () => {
      await act(async () => { form.requestSubmit() })
      await act(async () => {})
      return JSON.parse(String(calls.find(c => c.init?.method === 'PATCH')!.init!.body))
    }
    return { type, patched, unmount }
  }

  it('reads a correction typed the Argentine way: "28.080" is 28080', async () => {
    const { type, patched, unmount } = await openFix()
    type('price', '28.080')
    type('commission', '1.234,5')
    expect(await patched()).toMatchObject({ tradeQuantity: 40, tradePrice: 28080, tradeCommission: 1234.5 })
    unmount()
  })

  it('still reads a plain correction: "10" and "6.69"', async () => {
    const { type, patched, unmount } = await openFix()
    type('qty', '10')
    type('price', '6.69')
    expect(await patched()).toMatchObject({ tradeQuantity: 10, tradePrice: 6.69 })
    unmount()
  })
})
