// odd/tasks/rendimiento.md S7: Resumen shares the portfolio request, starts its chart and movements with the page,
// shows a portfolio seen before at once, and only the countdown re-renders every second.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { forgetCached, setCachedValue } from '@/lib/client-cache'
import { getPortfolio, POSITIONS_KEY } from '@/lib/warren/positions'

const renders = { distribution: 0 }
for (const m of ['HoldingsList', 'HoldingsTable', 'AdjustCashDialog']) {
  vi.doMock(`@/components/resumen/${m}`, () => ({ default: () => null }))
}
vi.doMock('@/components/resumen/ValueSection', () => ({ default: () => <p>valor de la cartera</p> }))
vi.doMock('@/components/resumen/DistributionList', () => ({ default: () => { renders.distribution++; return null } }))
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), isMarketOpen: () => true }))
vi.mock('@/lib/resumen/currency', async (orig) => ({ ...(await orig<object>()), headline: () => ({ prefix: 'USD ' }), viewsOf: () => null }))
vi.mock('@/lib/resumen/holdings', async (orig) => ({ ...(await orig<object>()), buildHoldings: () => [], distribution: () => [] }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); forgetCached(); document.body.innerHTML = '' })

const HISTORY = '/api/portfolio-history?days=all&universe=total'
const MOVEMENTS = '/api/cash/movements?limit=5&offset=0'
const PORTFOLIO = { summary: { total_market_value: 100, cash: { balance: 5 } } }
const json = (body: unknown) => new Response(JSON.stringify(body))

/** A /api/positions answer the test releases when it wants. */
function held() {
  let release!: (body: unknown) => void
  const answer = new Promise<Response>(r => { release = body => r(json(body)) })
  return { answer, release }
}

async function mount(positions: () => Promise<Response>) {
  const urls: string[] = []
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    if (url === '/api/positions') return positions()
    if (url === HISTORY) return json({ data: [] })
    if (url === MOVEMENTS) return json({ data: [], pagination: { total: 0 } })
    return json([])
  }))
  const { default: DashboardPage } = await import('../page')
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<DashboardPage />) })
  await act(async () => {})
  const count = (url: string) => urls.filter(u => u === url).length
  return { el, urls, count, unmount: () => act(() => root.unmount()) }
}
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

describe('Resumen loads fast', () => {
  it('asks for the portfolio once when another part of the tab is already asking for it', async () => {
    const positions = held()
    vi.stubGlobal('fetch', vi.fn(async () => positions.answer))
    const asking = getPortfolio()
    const { count, unmount } = await mount(() => positions.answer)
    expect(count('/api/positions')).toBe(0) // the page joined the request already in flight
    positions.release(PORTFOLIO)
    await asking
    await flush()
    unmount()
  })

  it('starts the value chart and the movements with the page, before the portfolio answers, and asks each once', async () => {
    const positions = held()
    const { el, count, unmount } = await mount(() => positions.answer)
    expect(count(HISTORY)).toBe(1)
    expect(count(MOVEMENTS)).toBe(1)
    positions.release(PORTFOLIO)
    await flush()
    expect(el.textContent).toContain('valor de la cartera')
    expect(el.textContent).toContain('Evolución')
    expect(el.textContent).toContain('Últimos movimientos')
    expect(count(HISTORY)).toBe(1)
    expect(count(MOVEMENTS)).toBe(1)
    unmount()
  })

  it('an empty portfolio still shows only the empty state', async () => {
    const { el, unmount } = await mount(async () => json({ summary: { total_market_value: 0, cash: { balance: 0 } } }))
    await flush()
    expect(el.textContent).toContain('Todavía no cargaste operaciones.')
    expect(el.textContent).not.toContain('Evolución')
    expect(el.textContent).not.toContain('Últimos movimientos')
    expect(el.querySelector('[aria-label="Cargando tu cartera"]')).toBeNull()
    unmount()
  })

  it('a portfolio seen before in the tab shows at once and refreshes behind', async () => {
    setCachedValue(POSITIONS_KEY, PORTFOLIO)
    const positions = held()
    const { el, count, unmount } = await mount(() => positions.answer)
    expect(el.textContent).toContain('valor de la cartera')
    expect(el.querySelector('[aria-label="Cargando tu cartera"]')).toBeNull()
    expect(count('/api/positions')).toBe(1)
    positions.release(PORTFOLIO)
    await flush()
    unmount()
  })

  it('the countdown ticks without rendering the rest of the page again', async () => {
    vi.useFakeTimers()
    const { el, unmount } = await mount(async () => json(PORTFOLIO))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(el.textContent).toContain('Se actualiza en 0:30.')
    const before = renders.distribution
    for (let s = 0; s < 3; s++) await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(el.textContent).toContain('Se actualiza en 0:27.')
    expect(renders.distribution).toBe(before)
    unmount()
  })
})
