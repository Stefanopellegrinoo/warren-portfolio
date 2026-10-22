import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import HistoryPage from '../page'
import type { ClosedTrade } from '@/types'

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
