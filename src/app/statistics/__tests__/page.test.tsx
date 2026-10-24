import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { NO_CONNECTION } from '@/lib/request-errors'
import type { StatData } from '../DetailedStats'
import StatisticsPage from '../page'

// The evolution chart measures itself; its heading belongs to the page, which is what these tests read.
vi.mock('@/components/charts/PortfolioChart', () => ({ default: () => null }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

const stats: StatData = {
  maxDrawdown: -0.123, winRate: null, totalPortfolioValue: 10000,
  allocation: [], realizedPnl: 100, openPnl: -300, biggestWinner: null, biggestLoser: null,
  allPnLs: [], monthlyReturns: [], cumulativePnl: [],
  avgHoldingDays: 30, maxHoldingDays: 60, minHoldingDays: 2, avgWin: 200, avgLoss: -100,
  profitFactor: 2, sharpeRatio: 0.5, annualizedVol: 0.2, monthlyStdDev: null,
  winnersCount: 0, losersCount: 0, totalTrades: 0, arsExposure: 2500, usdExposure: 7500,
}
const part = { value: 5000, openPnl: 10, realizedPnl: 0, totalPnl: 10, positionCount: 2, closedTradesCount: 1 }
const combined = { totalValue: 12345, composition: [{ name: 'Acciones', value: 5000, pct: 1 }], stocks: part, ons: part }

const STATS_URLS = ['/api/statistics?universe=stocks', '/api/statistics/ons', '/api/statistics/combined', '/api/statistics?universe=total']
const ok = (body: unknown) => () => new Response(JSON.stringify(body))
const failed = () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })

function stubFetch(overrides: Record<string, () => Response> = {}, offline = { value: false }) {
  const calls: string[] = []
  const routes: Record<string, () => Response> = {
    [STATS_URLS[0]]: ok(stats), [STATS_URLS[1]]: ok(stats), [STATS_URLS[2]]: ok(combined), [STATS_URLS[3]]: ok(stats),
    ...overrides,
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    if (url.startsWith('/api/portfolio-history')) return new Response(JSON.stringify({ data: [] }))
    if (url.includes('&benchmark=')) return new Response('{}')
    if (offline.value) throw new TypeError('Failed to fetch')
    if (routes[url]) return routes[url]()
    throw new Error(`unexpected fetch ${url}`)
  }))
  return calls
}

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const buttons = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].filter(b => b.textContent === text)

async function render() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<StatisticsPage />) })
  await flush()
  await flush()
  return { el, unmount: () => act(() => root.unmount()) }
}
async function openTab(el: HTMLElement, name: string) {
  act(() => [...el.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(b => b.textContent === name)!.click())
  await flush()
}

describe('StatisticsPage — headline first (S6)', () => {
  it('shows the total value and the KPIs before the evolution chart, then the benchmark, then risk and composition', async () => {
    stubFetch()
    const { el, unmount } = await render()
    const text = el.textContent!
    const at = (s: string) => { const i = text.indexOf(s); expect(i, s).toBeGreaterThanOrEqual(0); return i }
    expect(at('Valor total de la cartera')).toBeLessThan(at('Resultado de acciones'))
    expect(at('Resultado de ONs')).toBeLessThan(at('Evolución de la cartera'))
    expect(at('Evolución de la cartera')).toBeLessThan(at('Comparar con un índice'))
    expect(at('Comparar con un índice')).toBeLessThan(at('Ratio de Sharpe'))
    expect(at('Ratio de Sharpe')).toBeLessThan(at('Composición'))
    expect(el.querySelector('[role="alert"]')).toBeNull()
    unmount()
  })
})

describe('StatisticsPage — failed loads say so, with Reintentar (S1, S6)', () => {
  it('a request that never reached the server shows NO_CONNECTION, and Reintentar loads again', async () => {
    const offline = { value: true }
    const calls = stubFetch({}, offline)
    const { el, unmount } = await render()
    const statCalls = () => calls.filter(u => STATS_URLS.includes(u)).length
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(NO_CONNECTION)
    expect(el.textContent).not.toContain('Failed to fetch')
    expect(statCalls()).toBe(4)

    offline.value = false
    act(() => buttons(el, 'Reintentar')[0].click())
    await flush()
    await flush()
    expect(statCalls()).toBe(8)
    expect(el.querySelector('[role="alert"]')).toBeNull()
    expect(el.textContent).toContain('Valor total de la cartera')
    unmount()
  })

  it('a server failure says the statistics could not be loaded, with Reintentar', async () => {
    stubFetch({ [STATS_URLS[2]]: failed })
    const { el, unmount } = await render()
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar las estadísticas.')
    expect(buttons(el, 'Reintentar')).toHaveLength(1)
    unmount()
  })

  it('a failed stocks load says so on its tab instead of showing only part of it', async () => {
    stubFetch({ [STATS_URLS[0]]: failed })
    const { el, unmount } = await render()
    await openTab(el, 'Acciones')
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar las estadísticas de acciones.')
    expect(buttons(el, 'Reintentar')).toHaveLength(1)
    expect(el.textContent).not.toContain('Comparar con un índice')
    unmount()
  })

  it('a failed ONs load says so on its tab', async () => {
    stubFetch({ [STATS_URLS[1]]: failed })
    const { el, unmount } = await render()
    await openTab(el, 'ONs')
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar las estadísticas de ONs.')
    expect(buttons(el, 'Reintentar')).toHaveLength(1)
    unmount()
  })

  it('failed risk metrics say so instead of vanishing, and the rest of the tab still shows', async () => {
    stubFetch({ [STATS_URLS[3]]: failed })
    const { el, unmount } = await render()
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron calcular las métricas de riesgo.')
    expect(buttons(el, 'Reintentar')).toHaveLength(1)
    expect(el.textContent).toContain('Valor total de la cartera')
    expect(el.textContent).toContain('Composición')
    unmount()
  })

  it('the chosen benchmark survives switching from the whole portfolio to Acciones', async () => {
    stubFetch()
    const { el, unmount } = await render()
    const select = () => el.querySelector<HTMLSelectElement>('select[aria-label="Índice de comparación"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select(), 'SPY')
      select().dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    await openTab(el, 'Acciones')
    expect(select().value).toBe('SPY')
    unmount()
  })

  it('a tab whose data loaded still shows its detailed stats', async () => {
    stubFetch()
    const { el, unmount } = await render()
    await openTab(el, 'Acciones')
    expect(el.textContent).toContain('Resultado total')
    expect(el.textContent).toContain('Evolución de Acciones')
    expect(el.querySelector('[role="alert"]')).toBeNull()
    unmount()
  })
})
