// odd/tasks/ux-paginas.md S1: a refresh that fails while older numbers are on screen says they may be outdated.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// The page's sections are not under test: only what it shows when a refresh fails.
for (const m of ['SummaryHeader', 'ValueSection', 'HoldingsList', 'HoldingsTable', 'DistributionList', 'MovementsList', 'AdjustCashDialog', 'ValueChart']) {
  vi.doMock(`@/components/resumen/${m}`, () => ({ default: () => null }))
}
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), isMarketOpen: () => true }))
vi.mock('@/lib/resumen/currency', async (orig) => ({ ...(await orig<object>()), headline: () => ({ prefix: 'USD ' }), viewsOf: () => null }))
vi.mock('@/lib/resumen/holdings', async (orig) => ({ ...(await orig<object>()), buildHoldings: () => [], distribution: () => [] }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = '' })

const STALE = 'No se pudieron actualizar los precios. Lo que ves puede estar desactualizado.'

async function mount(answers: (() => Response)[]) {
  const positions = vi.fn(() => (answers.shift() ?? (() => new Response('{}', { status: 500 })))())
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/positions' ? positions() : new Response('[]'))))
  const { default: DashboardPage } = await import('../page')
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<DashboardPage />) })
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  return { el, positions, unmount: () => act(() => root.unmount()) }
}

const ok = () => new Response(JSON.stringify({ summary: { total_market_value: 100, cash: { balance: 5 } } }))
const down = () => new Response('{}', { status: 503 })

describe('Resumen refresh', () => {
  it('a failed auto-refresh keeps the numbers and says they may be outdated; Reintentar clears it', async () => {
    vi.useFakeTimers()
    const { el, positions, unmount } = await mount([ok, down, ok])
    expect(el.textContent).not.toContain(STALE)

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(positions).toHaveBeenCalledTimes(2)
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(STALE)
    expect(el.textContent).not.toContain('No se pudo cargar tu cartera.')

    await act(async () => { [...el.querySelectorAll('button')].find(b => b.textContent === 'Reintentar')!.click() })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(positions).toHaveBeenCalledTimes(3)
    expect(el.textContent).not.toContain(STALE)
    unmount()
  })

  it('a failed first load still says the portfolio could not be loaded', async () => {
    vi.useFakeTimers()
    const { el, unmount } = await mount([down])
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar tu cartera.')
    expect(el.textContent).not.toContain(STALE)
    unmount()
  })
})
