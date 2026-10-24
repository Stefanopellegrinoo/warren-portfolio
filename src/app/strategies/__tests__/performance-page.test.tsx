import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import PerformancePage from '../[id]/performance/page'
import { forgetCached } from '@/lib/client-cache'

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 's1' }) }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// A request left hanging would stay in flight for the next test (the cache shares in-flight loads): end it.
const hanging: (() => void)[] = []
afterEach(async () => {
  hanging.splice(0).forEach(end => end())
  await new Promise(r => setTimeout(r, 0))
  vi.unstubAllGlobals(); forgetCached(); document.body.innerHTML = ''
})

const strategy = { id: 's1', name: 'Momentum', tickers: ['AAPL'], timeframes: ['1d'], active: true, indicator_setups: [{ id: 'u1', name: 'Cruce EMA', active: true }] }
const performance = {
  // What the page shows of the strategy comes with its performance (odd/tasks/rendimiento.md S9).
  strategy: { id: 's1', name: 'Momentum', tickers: ['AAPL'], setups: [{ id: 'u1', name: 'Cruce EMA', active: true }] },
  setups: [{ setup_id: 'u1', setup_name: 'Cruce EMA', active: true, total_trades: 12, profitable_trades: 7, hit_rate: 0.583, avg_return_pct: 2.4, avg_duration_days: 5, open_trades: 2, tickers: ['AAPL'] }],
  best_setup_id: 'u1',
}
const trade = { setup_id: 'u1', setup_name: 'Cruce EMA' }
const openTrade = { ...trade, id: 't1', ticker: 'AAPL', status: 'OPEN', open_price: 180.5, close_price: null, open_at: '2026-10-01T15:00:00Z', close_at: null, close_reason: null, pnl_pct: null }
const closedTrade = { ...trade, id: 't2', ticker: 'MSFT', status: 'CLOSED', open_price: 400, close_price: 388, open_at: '2026-09-10T15:00:00Z', close_at: '2026-09-15T15:00:00Z', close_reason: 'STOP_LOSS', pnl_pct: -3 }

type Responder = () => Response | Promise<Response>
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status })
const offline: Responder = () => { throw new TypeError('Failed to fetch') }
const hang: Responder = () => new Promise<Response>(end => { hanging.push(() => end(new Response('{}', { status: 500 }))) })
const defaults: Record<string, Responder> = {
  '/api/strategies/s1/performance': json(performance),
  '/api/strategies/s1/signals': json({ signals: [] }),
  '/api/strategies/s1/paper-trades?status=OPEN': json({ trades: [openTrade] }),
  '/api/strategies/s1/paper-trades?status=CLOSED': json({ trades: [closedTrade] }),
  '/api/strategies/s1': json({ strategy }),
}

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(b => b.textContent === label)!

async function mount(overrides: Record<string, Responder> = {}) {
  const routes = { ...defaults, ...overrides }
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    // Longest prefix first: '/api/strategies/s1' is a prefix of every route.
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find(k => url.startsWith(k))
    if (!key) throw new Error(`unexpected fetch ${url}`)
    return routes[key]()
  }))
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(<PerformancePage />) })
  await flush()
  return { el, routes, calls, unmount: () => act(() => root.unmount()) }
}

// The wrapper that hides the wide table below 1080 px.
const tableWrapper = (el: HTMLElement, caption: string) =>
  [...el.querySelectorAll('table')].find(t => t.querySelector('caption')?.textContent === caption)!.parentElement!

describe('Performance page on phones: cards below 1080 px, the full table from 1080 px', () => {
  it('comparison: one card per setup with return, hit rate and trades first', async () => {
    const { el, unmount } = await mount()
    expect(tableWrapper(el, 'Comparación de setups').className).toContain('max-[1279px]:hidden')

    const list = el.querySelector('ul[aria-label="Comparación de setups"]')!
    expect(list.className).toContain('min-[1280px]:hidden')
    const cards = list.querySelectorAll('li')
    expect(cards).toHaveLength(1)
    const text = cards[0].textContent!
    for (const value of ['Cruce EMA', 'Mejor', 'Activo', '+2,4 %', 'Retorno prom.', 'Acierto 58,3 %', 'Operaciones 12', 'Ganadoras 7', 'Duración prom. 5 días', 'Abiertas 2']) {
      expect(text).toContain(value)
    }
    expect(list.innerHTML).not.toMatch(/min-w-\[/)
    unmount()
  })

  it('paper trades: one card per trade with ticker, result and prices first', async () => {
    const { el, unmount } = await mount()
    act(() => tab('Paper trades').click())
    await flush()
    expect(tableWrapper(el, 'Paper trades').className).toContain('max-[1279px]:hidden')

    const list = el.querySelector('ul[aria-label="Paper trades"]')!
    expect(list.className).toContain('min-[1280px]:hidden')
    const [open, closed] = [...list.querySelectorAll('li')].map(li => li.textContent!)
    for (const value of ['AAPL', 'Abierto', 'Cruce EMA', 'Entrada US$\u00a0180,50', 'Apertura 01/10/2026']) expect(open).toContain(value)
    expect(open).not.toContain('Salida')
    expect(open).not.toContain('Cierre')
    for (const value of ['MSFT', 'Cerrado', '\u22123,00 %', 'Entrada US$\u00a0400,00', 'Salida US$\u00a0388,00', 'Apertura 10/09/2026', 'Cierre 15/09/2026', 'Stop loss']) expect(closed).toContain(value)
    expect(list.innerHTML).not.toMatch(/min-w-\[/)
    unmount()
  })

  it('the paper trade filters still apply to the table and the cards', async () => {
    const { el, unmount } = await mount()
    act(() => tab('Paper trades').click())
    await flush()
    const status = el.querySelector<HTMLInputElement>('input[name="trades-status"][value="OPEN"]')!
    act(() => status.click())

    const rows = [...tableWrapper(el, 'Paper trades').querySelectorAll('tbody tr')].map(r => r.textContent!)
    const cards = [...el.querySelectorAll('ul[aria-label="Paper trades"] li')].map(li => li.textContent!)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('AAPL')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toContain('AAPL')
    unmount()
  })
})

describe('Performance page: a failed load says so, with Reintentar', () => {
  it.each([['the server fails', json({}, 500)], ['there is no connection', offline]])('signals, when %s', async (_, failure) => {
    const { el, routes, unmount } = await mount({ '/api/strategies/s1/signals': failure })
    act(() => tab('Señales').click())
    const alert = el.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('No se pudieron cargar las señales.')
    expect(el.textContent).not.toContain('No hay señales para los filtros elegidos.')

    // Retrying after the server recovers shows the real (empty) result.
    routes['/api/strategies/s1/signals'] = json({ signals: [] })
    await act(async () => { [...alert.querySelectorAll('button')].find(b => b.textContent === 'Reintentar')!.click() })
    await flush()
    expect(el.querySelector('[role="alert"]')).toBeNull()
    expect(el.textContent).toContain('No hay señales para los filtros elegidos.')
    unmount()
  })

  it('the comparison, when there is no connection', async () => {
    const { el, unmount } = await mount({ '/api/strategies/s1/performance': offline })
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('No se pudo cargar la comparación.')
    unmount()
  })
})

describe('Performance page: fewer round trips (odd/tasks/rendimiento.md S9)', () => {
  it('the strategy\'s name, tickers and setups come with the performance: the strategy is not asked for', async () => {
    const { el, calls, unmount } = await mount()
    expect(el.querySelector('a[href="/strategies/s1"]')!.textContent).toBe('Momentum')
    act(() => tab('Señales').click())
    expect([...el.querySelectorAll('#signals-ticker option')].map(o => o.textContent)).toEqual(['Todos', 'AAPL'])
    act(() => tab('Paper trades').click())
    await flush()
    expect([...el.querySelectorAll('#trades-setup option')].map(o => o.textContent)).toEqual(['Todos', 'Cruce EMA'])
    expect(calls).not.toContain('/api/strategies/s1')
    unmount()
  })

  it('paper trades ask both states together, once: opening the tab again asks nothing', async () => {
    const { el, calls, unmount } = await mount({ '/api/strategies/s1/paper-trades?status=OPEN': hang })
    act(() => tab('Paper trades').click())
    await flush()
    const trades = () => calls.filter(u => u.includes('/paper-trades'))
    expect(trades()).toEqual(['/api/strategies/s1/paper-trades?status=OPEN', '/api/strategies/s1/paper-trades?status=CLOSED'])
    act(() => tab('Comparación').click())
    act(() => tab('Paper trades').click())
    await flush()
    expect(trades()).toHaveLength(2)
    unmount()
  })

  it('a page seen before shows its comparison at once while it refreshes', async () => {
    const first = await mount()
    first.unmount()
    const { el, unmount } = await mount({ '/api/strategies/s1/performance': hang, '/api/strategies/s1/signals': hang })
    expect(el.querySelector('ul[aria-label="Comparación de setups"]')).not.toBeNull()
    expect(el.querySelector('a[href="/strategies/s1"]')!.textContent).toBe('Momentum')
    unmount()
  })
})
