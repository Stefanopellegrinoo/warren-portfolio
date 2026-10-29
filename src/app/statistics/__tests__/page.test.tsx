import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { NO_CONNECTION } from '@/lib/request-errors'
import { forgetCached } from '@/lib/client-cache'
import { argentinaDate, formatDate } from '@/lib/utils'
import type { StatData } from '../DetailedStats'
import StatisticsPage from '../page'

// The evolution chart measures itself; this stand-in prints the days it was given and offers one period.
vi.mock('@/components/charts/PortfolioChart', () => ({
  default: ({ data, loading, onPeriodChange, line }: {
    data: { snapshot_date: string; invested: number }[]; loading: boolean; onPeriodChange: (p: string) => void; line: { label: string; delta: string }
  }) => (
    <div data-chart="">
      <output>{loading ? 'cargando' : data.map(p => p.snapshot_date).join(',')}</output>
      <span data-line="">{line.label} · {line.delta} · {data.map(p => p.invested).join(',')}</span>
      <button type="button" onClick={() => onPeriodChange('30')}>Período 1M</button>
      <button type="button" onClick={() => onPeriodChange('all')}>Período Todo</button>
    </div>
  ),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A request left hanging would stay in flight for the next test (the cache shares in-flight loads): end it.
const hanging: ((r: Response) => void)[] = []
afterEach(async () => {
  hanging.splice(0).forEach(end => end(new Response('{}', { status: 500 })))
  await new Promise(r => setTimeout(r, 0))
  vi.unstubAllGlobals(); forgetCached(); document.body.innerHTML = ''
})

const stats: StatData = {
  maxDrawdown: -0.123, winRate: null, totalPortfolioValue: 10000,
  allocation: [], realizedPnl: 100, openPnl: -300, biggestWinner: null, biggestLoser: null,
  allPnLs: [], monthlyReturns: [], cumulativePnl: [],
  avgHoldingDays: 30, maxHoldingDays: 60, minHoldingDays: 2, avgWin: 200, avgLoss: -100,
  profitFactor: 2, sharpeRatio: 0.5, annualizedVol: 0.2, monthlyStdDev: null,
  winnersCount: 0, losersCount: 0, totalTrades: 0, arsExposure: 2500, usdExposure: 7500,
}
const part = { positionCount: 2, closedTradesCount: 1 }
const combined = { stocks: part, ons: part }

// The dashboard's own answer (GET /api/positions): its Pesos / MEP / Cable views.
const amounts = (ARS: number, MEP: number, CCL: number) => ({ ARS, MEP, CCL })
const NONE = amounts(0, 0, 0)
const BY_CLASS = {
  stocks: { openPnl: amounts(180_000, 120, 110), realized: amounts(45_000, 30, 28) },
  ons: { openPnl: amounts(15_000, 10, 9), realized: amounts(7_500, 5, 4) },
}
const portfolioWith = (byClass: typeof BY_CLASS | undefined) => ({
  positions: [], onPositions: [], lastRefresh: null,
  summary: { total_market_value: 1850, cash: { balance: 200 }, stocks: { market_value: 900 }, ons: { market_value: 750 } },
  currencies: {
    version: 1, fx: { mep: 1500, ccl: 1580, mepDate: '2026-10-28', cclDate: '2026-10-28' }, positions: {}, estimated: false,
    totals: {
      value: amounts(3_000_000, 2000, 1900), stocks: amounts(1_500_000, 1000, 950), ons: amounts(1_200_000, 800, 760),
      cash: amounts(300_000, 200, 190), invested: NONE, openPnl: NONE, openPnlPct: NONE, realized: NONE, dayChange: NONE, dayChangePct: NONE,
      ...(byClass && { byClass }),
    },
  },
})
const POSITIONS_URL = '/api/positions'

const STATS_URLS = ['/api/statistics?universe=stocks', '/api/statistics/ons', '/api/statistics/combined', '/api/statistics?universe=total']
const ok = (body: unknown) => () => new Response(JSON.stringify(body))
const failed = () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })

type Route = () => Response | Promise<Response>
function stubFetch(overrides: Record<string, Route> = {}, offline = { value: false }) {
  const calls: string[] = []
  const routes: Record<string, Route> = {
    [STATS_URLS[0]]: ok(stats), [STATS_URLS[1]]: ok(stats), [STATS_URLS[2]]: ok(combined), [STATS_URLS[3]]: ok(stats),
    [POSITIONS_URL]: ok(portfolioWith(BY_CLASS)),
    ...overrides,
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    if (url.startsWith('/api/portfolio-history') && !routes[url]) return new Response(JSON.stringify({ data: [] }))
    if (url.includes('&benchmark=') && !routes[url]) return new Response('{}')
    if (offline.value) throw new TypeError('Failed to fetch')
    if (routes[url]) return routes[url]()
    throw new Error(`unexpected fetch ${url}`)
  }))
  return calls
}
const never = () => new Promise<Response>(end => { hanging.push(end) })

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

describe('StatisticsPage — the dashboard\'s total, in the dashboard\'s currency (odd/tasks/statistics-truth.md S1)', () => {
  const shown = (el: HTMLElement) => el.textContent!.replace(/\u00a0/g, ' ')
  // The dashboard keeps its choice in the browser's storage.
  const choose = (currency: string) => vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'resumen:currency' ? currency : null), setItem() {} })

  it('total, results and composition are the dashboard\'s views in its default currency, Dólar MEP', async () => {
    stubFetch()
    const { el, unmount } = await render()
    const text = shown(el)
    expect(text).toMatch(/Valor total de la cartera\s*US\$ 2\.000,00/)
    // Open result plus realized with dividends and coupons, per class.
    expect(text).toMatch(/Resultado de acciones\s*\+150,00/)
    expect(text).toMatch(/Resultado de ONs\s*\+15,00/)
    // The counts are sales, not round trips (statistics-truth S7).
    expect(text).toContain('2 posiciones · 1 venta')
    expect(text).toMatch(/Acciones\s*US\$ 1\.000,00/)
    expect(text).toMatch(/Obligaciones negociables\s*US\$ 800,00/)
    expect(text).toMatch(/Caja\s*US\$ 200,00/)
    unmount()
  })

  it('follows the currency chosen on the dashboard: Dólar cable, Pesos', async () => {
    choose('CCL')
    stubFetch()
    const cable = await render()
    expect(shown(cable.el)).toMatch(/Valor total de la cartera\s*US\$ 1\.900,00/)
    expect(shown(cable.el)).toMatch(/Resultado de acciones\s*\+138,00/)
    expect(shown(cable.el)).toMatch(/Acciones\s*US\$ 950,00/)
    cable.unmount()

    choose('ARS')
    const pesos = await render()
    expect(shown(pesos.el)).toMatch(/Valor total de la cartera\s*\$ 3\.000\.000,00/)
    expect(shown(pesos.el)).toMatch(/Resultado de ONs\s*\+22\.500,00/)
    pesos.unmount()
  })

  it('a summary cached before the per-class results shows none rather than one in another currency', async () => {
    stubFetch({ [POSITIONS_URL]: ok(portfolioWith(undefined)) })
    const { el, unmount } = await render()
    expect(shown(el)).toMatch(/Valor total de la cartera\s*US\$ 2\.000,00/)
    expect(shown(el)).toMatch(/Resultado de acciones\s*—/)
    unmount()
  })

  it('a failed portfolio load says so, and Reintentar asks again', async () => {
    let fail = true
    const calls = stubFetch({ [POSITIONS_URL]: () => (fail ? failed() : ok(portfolioWith(BY_CLASS))()) })
    const { el, unmount } = await render()
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar el valor de la cartera.')
    fail = false
    act(() => buttons(el, 'Reintentar')[0].click())
    await flush()
    await flush()
    expect(calls.filter(u => u === POSITIONS_URL)).toHaveLength(2)
    expect(shown(el)).toMatch(/Valor total de la cartera\s*US\$ 2\.000,00/)
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

describe('StatisticsPage — each block as its request answers (S9)', () => {
  it('shows the headline and composition while the risk metrics are still on their way', async () => {
    stubFetch({ [STATS_URLS[3]]: never })
    const { el, unmount } = await render()
    expect(el.textContent).toContain('Valor total de la cartera')
    expect(el.textContent).toContain('Composición')
    expect(el.textContent).toContain('Evolución de la cartera')
    expect(el.textContent).not.toContain('Ratio de Sharpe')
    expect(el.querySelector('[role="status"][aria-label="Cargando las métricas de riesgo"]')).not.toBeNull()
    unmount()
  })

  it('shows the evolution chart while the portfolio value is still on its way', async () => {
    stubFetch({ [POSITIONS_URL]: never })
    const { el, unmount } = await render()
    expect(el.textContent).toContain('Evolución de la cartera')
    expect(el.textContent).not.toContain('Valor total de la cartera')
    unmount()
  })
})

describe('StatisticsPage — history asked once per part, cut in the browser (S9)', () => {
  const daysAgo = (n: number) => {
    const d = new Date(`${argentinaDate()}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - n)
    return d.toISOString().slice(0, 10)
  }
  const point = (n: number) => ({ snapshot_date: daysAgo(n), value: 100, invested: 90, contributed: 95 })
  const series = { data: [point(100), point(60), point(20), point(0)] }

  it('the whole portfolio draws the money put in; a class, the cost of what it holds (statistics-truth S9)', async () => {
    const classSeries = { data: [{ snapshot_date: daysAgo(20), value: 100, invested: 90 }, { snapshot_date: daysAgo(0), value: 110, invested: 90 }] }
    stubFetch({
      '/api/portfolio-history?days=all&universe=total': ok({ data: [point(20), { ...point(0), contributed: 120 }], measuredFrom: daysAgo(20) }),
      '/api/portfolio-history?days=all&universe=stocks': ok(classSeries),
    })
    const { el, unmount } = await render()
    const line = () => el.querySelector('[data-chart] [data-line]')!.textContent
    expect(line()).toBe('Plata que pusiste · sobre lo que pusiste · 95,120')
    expect(el.textContent).toContain('Valor de mercado contra la plata que pusiste')

    await openTab(el, 'Acciones')
    expect(line()).toBe('Costo de lo que tenés · resultado abierto · 90,90')
    expect(el.textContent).toContain('Valor de mercado contra el costo de lo que tenés')
    unmount()
  })

  it('a period change cuts the series it already has; a part asks once', async () => {
    const calls = stubFetch({
      '/api/portfolio-history?days=all&universe=total': ok(series),
      '/api/portfolio-history?days=all&universe=stocks': ok(series),
    })
    const { el, unmount } = await render()
    const shown = () => el.querySelector('[data-chart] output')!.textContent
    const history = () => calls.filter(u => u.startsWith('/api/portfolio-history'))

    expect(shown()).toBe([daysAgo(60), daysAgo(20), daysAgo(0)].join(','))
    act(() => buttons(el, 'Período 1M')[0].click())
    expect(shown()).toBe([daysAgo(20), daysAgo(0)].join(','))
    act(() => buttons(el, 'Período Todo')[0].click())
    expect(shown()).toBe(series.data.map(p => p.snapshot_date).join(','))

    await openTab(el, 'Acciones')
    await openTab(el, 'Toda la cartera')
    expect(history()).toEqual(['/api/portfolio-history?days=all&universe=total', '/api/portfolio-history?days=all&universe=stocks'])
    unmount()
  })
})

describe('StatisticsPage — the whole portfolio is drawn from the day it is measured (odd/tasks/statistics-truth.md S4)', () => {
  const daysAgo = (n: number) => {
    const d = new Date(`${argentinaDate()}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - n)
    return d.toISOString().slice(0, 10)
  }
  // As the route serves it: the money put in from the measured base on, none before (S9).
  const point = (n: number) => ({ snapshot_date: daysAgo(n), value: 100, invested: 90, contributed: n > 20 ? null : 100 })
  const TOTAL = '/api/portfolio-history?days=all&universe=total'

  it('starts the chart the day after the last negative-cash day and says why', async () => {
    stubFetch({ [TOTAL]: ok({ data: [point(80), point(60), point(20), point(0)], measuredFrom: daysAgo(20), negativeCashUntil: daysAgo(60), unavailableReason: null }) })
    const { el, unmount } = await render()
    expect(el.querySelector('[data-chart] output')!.textContent).toBe([daysAgo(20), daysAgo(0)].join(','))
    expect(el.textContent).toContain(`Hasta el ${formatDate(daysAgo(60))} hay días con la caja negativa (faltan depósitos): quedan afuera.`)
    unmount()
  })

  it('says how much deposit money was moved to the purchases it paid (S10)', async () => {
    stubFetch({ [TOTAL]: ok({ data: [point(20), point(0)], measuredFrom: daysAgo(20), negativeCashUntil: null, unavailableReason: null, fundedDeposits: { amount: 1234.56, from: '2023-05-02' } }) })
    const { el, unmount } = await render()
    // One quiet line under the chart; the detail opens from its (i) (deposit-dates S5).
    expect(el.querySelector('[aria-labelledby="h-evolucion"]')!.textContent).toContain('Algunos depósitos se adelantaron a la fecha de tus compras')
    expect(el.textContent).not.toContain('se toman como depositados')
    await act(async () => { el.querySelector<HTMLButtonElement>('[aria-labelledby="h-evolucion"] button[aria-label="Qué depósitos se adelantaron"]')!.click() })
    expect(document.body.textContent).toContain('Algunos depósitos estaban cargados después de las compras que pagaron: para medir, US$ 1.234,56 se toman como depositados el día de esas compras, desde el 02/05/2023. El total depositado no cambia.')
    unmount()
  })

  it('the notice opens the review of the deposit dates (deposit-dates S1)', async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
    const calls = stubFetch({
      [TOTAL]: ok({ data: [point(20), point(0)], measuredFrom: daysAgo(20), negativeCashUntil: null, unavailableReason: null, fundedDeposits: { amount: 1234.56, from: '2023-05-02' } }),
      '/api/cash/deposit-dates': ok({ deposits: [{ id: '7d1c3f0e-5b8a-4c2e-9f6d-2a4b8e1c9d3f', date: '2026-05-20', amount: 120000, remaining: 118765.44, parts: [{ date: '2023-05-02', amount: 1234.56 }] }], total: 1234.56, from: '2023-05-02' }),
    })
    const { el, unmount } = await render()
    await act(async () => { el.querySelector<HTMLButtonElement>('[aria-labelledby="h-evolucion"] button[aria-label="Qué depósitos se adelantaron"]')!.click() })
    await act(async () => { [...document.body.querySelectorAll('button')].find(b => b.textContent === 'Revisar fechas de depósitos')!.click() })
    await flush()
    expect(calls).toContain('/api/cash/deposit-dates')
    expect(document.body.querySelector('dialog[open]')?.textContent).toContain('Tu depósito del 20/05/2026 pagó compras desde el 02/05/2023: ¿lo repartimos en esas fechas?')
    unmount()
  })

  it('with negative cash today draws nothing and says deposits are missing', async () => {
    stubFetch({ [TOTAL]: ok({ data: [point(1), point(0)], measuredFrom: null, negativeCashUntil: daysAgo(0), unavailableReason: 'negative_cash' }) })
    const { el, unmount } = await render()
    expect(el.querySelector('[data-chart] output')!.textContent).toBe('')
    expect(el.textContent).toContain('Faltan depósitos: la caja registrada hoy es negativa y toda la cartera no se puede medir.')
    unmount()
  })
})

describe('StatisticsPage — a page seen before shows its last data at once (S9)', () => {
  it('a second visit shows the remembered blocks while their refresh is still on its way', async () => {
    stubFetch()
    const first = await render()
    first.unmount()

    stubFetch({ [STATS_URLS[0]]: never, [STATS_URLS[1]]: never, [STATS_URLS[2]]: never, [STATS_URLS[3]]: never })
    const { el, unmount } = await render()
    expect(el.textContent).toContain('Valor total de la cartera')
    expect(el.textContent).toContain('Ratio de Sharpe')
    unmount()
  })
})

describe('StatisticsPage — a benchmark pick is not asked again per tab switch (S9)', () => {
  it('coming back to a part shows its comparison without a new request', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    const comparison = (label: string) => ok({ benchmark: { id: 'SPY', label, excessPp: 1.25, points: [{ date: '2026-10-01', portfolioPct: 0, benchmarkPct: 0 }, { date: '2026-10-20', portfolioPct: 3, benchmarkPct: 1.75 }] } })
    const calls = stubFetch({
      '/api/statistics?universe=total&benchmark=SPY': comparison('S&P 500 (SPY)'),
      '/api/statistics?universe=stocks&benchmark=SPY': comparison('S&P 500 (SPY)'),
    })
    const { el, unmount } = await render()
    const select = () => el.querySelector<HTMLSelectElement>('select[aria-label="Índice de comparación"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select(), 'SPY')
      select().dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    await openTab(el, 'Acciones')
    await openTab(el, 'Toda la cartera')
    expect(el.textContent).toContain('+1,3 pp')
    expect(calls.filter(u => u.includes('&benchmark='))).toEqual([
      '/api/statistics?universe=total&benchmark=SPY',
      '/api/statistics?universe=stocks&benchmark=SPY',
    ])
    unmount()
  })
})
