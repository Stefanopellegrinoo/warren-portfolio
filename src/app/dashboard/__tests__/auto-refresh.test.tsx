// The Resumen keeps refreshing on its own: opened before the open, it starts polling when the
// market opens, and coming back to the app asks for fresh numbers at once.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached } from '@/lib/client-cache'

for (const m of ['ValueSection', 'HoldingsList', 'HoldingsTable', 'DistributionList', 'MovementsList', 'AdjustCashDialog', 'ValueChart']) {
  vi.doMock(`@/components/resumen/${m}`, () => ({ default: () => null }))
}
const market = { open: false }
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), isMarketOpen: () => market.open }))
vi.mock('@/lib/resumen/currency', async (orig) => ({ ...(await orig<object>()), headline: () => ({ prefix: 'USD ' }), viewsOf: () => null }))
vi.mock('@/lib/resumen/holdings', async (orig) => ({ ...(await orig<object>()), buildHoldings: () => [], distribution: () => [] }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); forgetCached(); document.body.innerHTML = ''; market.open = false })

async function mount() {
  const positions = vi.fn(() => new Response(JSON.stringify({ summary: { total_market_value: 100, cash: { balance: 5 } } })))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/positions' ? positions() : new Response('[]'))))
  const { default: DashboardPage } = await import('../page')
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<DashboardPage />) })
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  return { el, positions, unmount: () => act(() => root.unmount()) }
}

describe('Resumen auto-refresh', () => {
  it('opened with the market closed, it starts refreshing once the market opens', async () => {
    vi.useFakeTimers()
    const { el, positions, unmount } = await mount()
    expect(el.textContent).toContain('Mercado cerrado, precios al cierre.')
    expect(positions).toHaveBeenCalledTimes(1)

    market.open = true
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(el.textContent).toContain('Mercado abierto. Se actualiza en')
    expect(el.textContent).not.toContain('Actualización en pausa')

    const before = positions.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(positions.mock.calls.length).toBeGreaterThan(before)
    unmount()
  })

  it('a pause the user chose survives while the market stays open', async () => {
    vi.useFakeTimers()
    market.open = true
    const { el, unmount } = await mount()
    await act(async () => { [...el.querySelectorAll('button')].find(b => b.textContent === 'Pausar')!.click() })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(el.textContent).toContain('Actualización en pausa')
    unmount()
  })

  it('coming back to the app asks for fresh numbers at once', async () => {
    vi.useFakeTimers()
    const { positions, unmount } = await mount()
    expect(positions).toHaveBeenCalledTimes(1)
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(positions).toHaveBeenCalledTimes(2)
    unmount()
  })
})
