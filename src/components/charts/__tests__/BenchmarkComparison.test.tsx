import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached } from '@/lib/client-cache'
import BenchmarkComparison from '../BenchmarkComparison'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.unstubAllGlobals(); forgetCached(); document.body.innerHTML = '' })

const comparison = (id: string, label: string, priceOnly: boolean) => ({
  benchmark: { id, label, priceOnly, excessPp: 1.25, points: [{ date: '2026-10-01', portfolioPct: 0, benchmarkPct: 0 }, { date: '2026-10-20', portfolioPct: 3, benchmarkPct: 1.75 }] },
})

async function pick(id: string, body: unknown) {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body))))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<BenchmarkComparison universe="total" />) })
  const select = el.querySelector<HTMLSelectElement>('select[aria-label="Índice de comparación"]')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, id)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  return { el, unmount: () => act(() => root.unmount()) }
}

describe('BenchmarkComparison — like for like (odd/tasks/statistics-truth.md S6)', () => {
  it('says the index is compared with its dividends reinvested', async () => {
    const { el, unmount } = await pick('SPY', comparison('SPY', 'S&P 500 (SPY)', false))
    expect(el.textContent).toContain('con sus dividendos reinvertidos')
    expect(el.textContent).toContain('+1,3 pp')
    expect(el.textContent).not.toContain('solo su precio')
    unmount()
  })

  it('a price index says only its price is compared', async () => {
    const { el, unmount } = await pick('MERV_CCL', comparison('MERV_CCL', 'MERVAL (USD CCL)', true))
    expect(el.textContent).toContain('El MERVAL no publica dividendos: se compara solo su precio.')
    unmount()
  })
})
