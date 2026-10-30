import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { METRICS, type MetricId } from '@/lib/fundamentals/catalog'
import type { AssetPage, PeerToday } from '@/lib/fundamentals/service'
import type { Metrics } from '@/lib/fundamentals/metrics'

// odd/tasks/asset-page.md T7, S9: the company and its peers side by side; edits live in ?vs=.
const replace = vi.fn()
let params = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }), useSearchParams: () => params }))
// The one client-safe rule (L29), watched: Comparar must not keep a copy of its own.
vi.mock('@/lib/fundamentals/ticker', async (real) => {
  const { parseTicker } = await real<typeof import('@/lib/fundamentals/ticker')>()
  return { parseTicker: vi.fn(parseTicker) }
})
import { parseTicker } from '@/lib/fundamentals/ticker'

import { ComparaTab } from '../ComparaTab'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Public company names only; every number is invented.
const values = (v: Partial<Record<MetricId, number | null>>) =>
  Object.fromEntries(METRICS.map((d) => [d.id, v[d.id] ?? null])) as PeerToday['today']
const peer = (tvSymbol: string, name: string, v: Partial<Record<MetricId, number | null>>): PeerToday => ({ tvSymbol, name, today: values(v) })

const AMZN = peer('NASDAQ:AMZN', 'Amazon.com, Inc.', { pe: 19.6, peForward: 30, revenueGrowth: 11, netMargin: 17.4, roe: 24, debtToEquity: 0.5, marketCap: 2_300_000e6 })
const SE = peer('NYSE:SE', 'Sea Limited', { pe: 29, peForward: 20, revenueGrowth: 30, netMargin: 5.9, roe: 12, debtToEquity: 0.9, marketCap: 60_000e6 })
const EBAY = peer('NASDAQ:EBAY', 'eBay Inc.', { pe: null, netMargin: -2, marketCap: 40_000e6 })

function page(peers: PeerToday[] = [AMZN, SE, EBAY]): AssetPage {
  const today = values({ pe: 45.23, peForward: 35, revenueGrowth: 46, netMargin: 5.3, roe: 30, debtToEquity: 1.68, marketCap: 84_163e6 })
  const metrics = Object.fromEntries(
    METRICS.map((d) => [d.id, { id: d.id, today: today[d.id], history: { quarterly: [], ttm: [], annual: [] }, since: null, asOf: null, source: 'tradingview' }]),
  ) as unknown as Metrics
  return {
    ticker: 'MELI', name: 'MercadoLibre, Inc.', exchange: 'NASDAQ', price: 1660, currency: 'USD', supported: true,
    listing: { ticker: 'MELI', market: 'america', tvSymbol: 'NASDAQ:MELI', yahooSymbol: 'MELI' },
    bymaListing: false, metrics, peers, sources: { tradingview: 'ok', yahoo: 'ok' },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  replace.mockReset()
  params = new URLSearchParams()
  document.body.innerHTML = ''
})

async function mount(p = page(), search = '') {
  params = new URLSearchParams(search)
  window.history.replaceState(null, '', `/activo/MELI${search ? `?${search}` : ''}`)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => root.render(<ComparaTab page={p} />))
  return el
}

const text = (node: Element | null | undefined) => (node?.textContent ?? '').replace(/[\u00a0\u202f]/g, ' ')
const buttons = (el: Element) => [...el.querySelectorAll('button')]
const button = (el: Element, label: RegExp) => buttons(el).find((b) => label.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))
const click = (node: Element | undefined) => act(() => { node!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const rows = (el: Element) => [...el.querySelectorAll('tbody tr')]
const names = (el: Element) => rows(el).map((r) => text(r.querySelector('th')).split(/[A-Z]{2,}/)[0].trim())
/** The cell of `row` under the column headed `label`. */
function cell(el: Element, row: number, label: string) {
  const col = [...el.querySelectorAll('thead th')].findIndex((th) => text(th).startsWith(label))
  return rows(el)[row].children[col]
}
/** The vs list of the URL last written. */
const written = () => new URL(replace.mock.calls.at(-1)![0], 'http://x').searchParams.get('vs')

describe('ComparaTab', () => {
  it('shows the company and its peers on the seven columns, the company row first and highlighted', async () => {
    const el = await mount()

    const heads = [...el.querySelectorAll('thead th')].map((th) => text(th).replace(/\?|[↑↓]/g, '').trim())
    expect(heads).toEqual(['Empresa', 'P/E', 'P/E esperado', 'Crecimiento de ventas', 'Margen neto', 'ROE', 'Deuda / patrimonio', 'Capitalización'])
    expect(names(el)).toEqual(['MercadoLibre', 'Amazon.com', 'Sea', 'eBay'])
    const own = rows(el)[0]
    expect(own.getAttribute('aria-current')).toBe('true')
    expect(own.className).toContain('bg-accent-soft')
    expect(text(cell(el, 0, 'P/E'))).toContain('45,2')
    expect(text(cell(el, 0, 'Crecimiento'))).toContain('46,0 %')
    expect(text(cell(el, 0, 'Capitalización'))).toContain('US$ 84.163 M')
  })

  it('sorts by a column when its header is clicked, best side first, and reverses on a second click; missing values stay last', async () => {
    const el = await mount()
    const sortBy = (label: string) => click(button(el, new RegExp(`^Ordenar por ${label}$`)))
    const th = (label: string) => [...el.querySelectorAll('thead th')].find((h) => text(h).startsWith(label))!

    sortBy('P/E')
    expect(names(el)).toEqual(['Amazon.com', 'Sea', 'MercadoLibre', 'eBay'])
    expect(th('P/E').getAttribute('aria-sort')).toBe('ascending')
    sortBy('P/E')
    expect(names(el)).toEqual(['MercadoLibre', 'Sea', 'Amazon.com', 'eBay'])
    expect(th('P/E').getAttribute('aria-sort')).toBe('descending')

    sortBy('Margen neto')
    expect(names(el)).toEqual(['Amazon.com', 'Sea', 'MercadoLibre', 'eBay'])
    expect(th('P/E').getAttribute('aria-sort')).toBe('none')
  })

  it("marks each column's best value by the catalog's better side, and the company's position in it", async () => {
    const el = await mount()

    // P/E: lower is better. MercadoLibre is third of the three with a value.
    expect(text(cell(el, 1, 'P/E'))).toContain('mejor')
    expect(text(cell(el, 0, 'P/E'))).toContain('3.º de 3')
    // P/E esperado: lower too, from the snapshot row's own better side.
    expect(text(cell(el, 2, 'P/E esperado'))).toContain('mejor')
    // Higher is better: the company's own best.
    expect(text(cell(el, 0, 'Crecimiento'))).toContain('mejor')
    expect(text(cell(el, 0, 'Crecimiento'))).not.toContain('de 3')
    // A size has no better side: no "mejor", only where the company stands.
    const caps = rows(el).map((_, i) => text(cell(el, i, 'Capitalización')))
    expect(caps.join(' ')).not.toContain('mejor')
    expect(caps[0]).toContain('2.ª más grande')
  })

  it('shows "—" for a missing value, with its reason on hover and on tap', async () => {
    const el = await mount()
    const dash = cell(el, 3, 'P/E').querySelector('button')!
    const why = 'No aplica: la empresa perdió plata en los últimos 12 meses'

    expect(text(dash)).toBe('—')
    expect(dash.getAttribute('title')).toBe(why)
    click(dash)
    expect(text(cell(el, 3, 'P/E'))).toContain(why)
  })

  it('opens each header\'s "?" with what the metric is and this company\'s value', async () => {
    const el = await mount()
    const q = button(el, /^Qué es P\/E$/)!

    click(q)
    expect(q.getAttribute('aria-expanded')).toBe('true')
    const tip = document.getElementById(q.getAttribute('aria-controls')!)
    expect(text(tip)).toContain('Cuántos años de ganancias estás pagando.')
    expect(text(tip)).toContain('Con 45,2, si MercadoLibre ganara')
    click(q)
    expect(document.getElementById(q.getAttribute('aria-controls')!)).toBeNull()
  })

  it('removes a peer: ?vs= keeps the others, as tickers, and the rest of the URL', async () => {
    const el = await mount(page(), 'dato=pe')

    click(button(el, /^Quitar Amazon/))
    expect(written()).toBe('SE,EBAY')
    expect(replace.mock.calls[0][0]).toBe('/activo/MELI?dato=pe&vs=SE,EBAY')
    expect(replace.mock.calls[0][1]).toEqual({ scroll: false })
  })

  it('adds a company found by the search; a BYMA share goes as BCBA:, and only companies are offered', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ results: [
      { symbol: 'GGAL.BA', shortname: 'Grupo Financiero Galicia', exchange: 'BUE', quoteType: 'EQUITY' },
      { symbol: 'BTC-USD', shortname: 'Bitcoin USD', exchange: 'CCC', quoteType: 'CRYPTOCURRENCY' },
      { symbol: 'AMZN', shortname: 'Amazon.com, Inc.', exchange: 'NMS', quoteType: 'EQUITY' },
    ] })))
    const el = await mount()

    click(button(el, /Agregar empresa/))
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Buscar una empresa para comparar"]')!
    expect(document.activeElement).toBe(input)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => { setter.call(input, 'gal'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 350)) })

    const offered = [...el.querySelectorAll('ul[aria-label="Empresas encontradas"] button')]
    expect(offered).toHaveLength(1) // no crypto, and Amazon is already in the table
    expect(text(offered[0])).toContain('GGAL.BA')
    click(offered[0])
    expect(written()).toBe('AMZN,SE,EBAY,BCBA:GGAL')
    expect(parseTicker).toHaveBeenCalledWith('GGAL.BA')
  })

  it("says a peer's value is missing because its source did not answer", async () => {
    const failed = { ...SE, today: values({ netMargin: 5.9 }), sources: { tradingview: 'ok' as const, yahoo: 'error' as const, fx: 'ok' as const } }
    const el = await mount(page([AMZN, failed]))

    // ROE is Yahoo's (group Y); P/E is TradingView's, which answered.
    expect(cell(el, 2, 'ROE').querySelector('button')!.getAttribute('title')).toBe('Sin datos: la fuente no respondió')
    expect(cell(el, 2, 'P/E').querySelector('button')!.getAttribute('title')).toBe('Sin datos')
  })

  it('goes back to the suggested peers by dropping ?vs=, offered only once they were edited', async () => {
    let el = await mount()
    expect(button(el, /Volver a las parecidas sugeridas/)).toBeUndefined()
    document.body.innerHTML = ''

    el = await mount(page([SE]), 'vs=SE&dato=pe')
    click(button(el, /Volver a las parecidas sugeridas/))
    expect(replace.mock.calls[0][0]).toBe('/activo/MELI?dato=pe')
  })

  it('compares at most 5 companies besides this one', async () => {
    const five = ['A', 'B', 'C', 'D', 'E'].map((t) => peer(`NYSE:${t}`, `${t} Corp`, {}))
    const el = await mount(page(five))

    expect(button(el, /Agregar empresa/)!.disabled).toBe(true)
    expect(text(el)).toContain('Hasta 5 empresas')
  })

  it('on a phone the table scrolls inside its own box, with the company column pinned', async () => {
    const el = await mount()
    const table = el.querySelector('table')!

    expect(table.parentElement!.className).toMatch(/\boverflow-x-auto\b/)
    for (const row of [...el.querySelectorAll('tr')]) expect(row.children[0].className).toMatch(/\bsticky\b.*\bleft-0\b/)
  })
})
