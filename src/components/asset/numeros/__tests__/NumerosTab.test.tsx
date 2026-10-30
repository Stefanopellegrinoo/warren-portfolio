import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { METRICS, SECTIONS, type MetricId } from '@/lib/fundamentals/catalog'
import type { AssetPage, PeerToday } from '@/lib/fundamentals/service'
import type { MetricValue, Metrics } from '@/lib/fundamentals/metrics'
import type { Series } from '@/lib/fundamentals/types'
import { NumerosTab } from '../NumerosTab'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Public company names only; every number is invented.
const TODAY = '2026-10-30'
const QUARTER_ENDS = Array.from({ length: 32 }, (_, i) => {
  const y = 2018 + Math.floor((i + 2) / 4)
  const m = ((i + 2) % 4) * 3 + 3
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}).filter((end) => end <= '2026-06-30')
const withToday = (points: Series, today: number): Series => [...points, { end: TODAY, value: today }]
const quarters = (f: (i: number) => number) => QUARTER_ENDS.map((end, i) => ({ end, value: f(i) }))

const TODAYS: Partial<Record<MetricId, number | null>> = {
  pe: 45.23, netMargin: 5.3, employees: 123_700, sharesOutstanding: 50.7e6, beta: null, roe: null,
}

function metric(id: MetricId, snapshot: boolean): MetricValue {
  const today = id in TODAYS ? TODAYS[id]! : 10
  const empty = { quarterly: [], ttm: [], annual: [] }
  if (snapshot || today === null) return { id, today, history: empty, since: null, asOf: null, source: snapshot ? 'snapshot' : 'yahoo' }
  return {
    id,
    today,
    history: { quarterly: withToday(quarters((i) => i - 3), today), ttm: withToday(quarters((i) => i - 6).slice(3), today), annual: [] },
    since: '2018',
    asOf: '2026-06-30',
    source: 'tradingview',
  }
}

const peer = (tvSymbol: string, name: string, values: Partial<Record<MetricId, number>>): PeerToday => ({
  tvSymbol,
  name,
  today: Object.fromEntries(METRICS.map((d) => [d.id, values[d.id] ?? null])) as PeerToday['today'],
})

function page(): AssetPage {
  return {
    ticker: 'MELI', name: 'MercadoLibre, Inc.', exchange: 'NASDAQ', price: 1660, currency: 'USD', supported: true,
    listing: { ticker: 'MELI', market: 'america', tvSymbol: 'NASDAQ:MELI', yahooSymbol: 'MELI' },
    bymaListing: false,
    metrics: Object.fromEntries(METRICS.map((d) => [d.id, metric(d.id, d.group === 'snapshot')])) as Metrics,
    peers: [
      peer('NASDAQ:AMZN', 'Amazon.com, Inc.', { pe: 19.6, netMargin: 17.4 }),
      peer('NYSE:SE', 'Sea Limited', { pe: 29, netMargin: 5.9 }),
      peer('NASDAQ:EBAY', 'eBay Inc.', {}),
    ],
    sources: { tradingview: 'ok', yahoo: 'ok' },
  }
}

let root: Root
let el: HTMLDivElement
beforeEach(async () => {
  window.history.replaceState(null, '', '/activo/MELI')
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root.render(<NumerosTab page={page()} />))
})
afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
})

const text = (node: Element | null | undefined) => (node?.textContent ?? '').replace(/[  ]/g, ' ')
const button = (label: RegExp) => [...el.querySelectorAll('button')].find((b) => label.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))
const panel = () => el.querySelector('[data-slot="history-panel"]')
const click = (node: Element | undefined) => act(() => { node!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

describe('NumerosTab list', () => {
  it('groups the catalog rows by section, keeps the forward sub-heading and formats the values', () => {
    const headings = [...el.querySelectorAll('h3')].map((h) => h.textContent)
    for (const s of SECTIONS) expect(headings).toContain(s)
    expect(text(el)).toContain('Esperados por analistas, próximo año')
    const row = (label: string) => [...el.querySelectorAll('li')].find((li) => li.textContent?.startsWith(label))
    expect(text(row('P/E (precio / ganancias)'))).toContain('45,2')
    expect(text(row('Empleados'))).toContain('123.700')
    expect(text(row('Acciones en circulación'))).toContain('50,7 M')
    expect(text(row('Margen neto'))).toContain('5,3 %')
    expect(text(row('Beta'))).toContain('—')
  })

  it('"?" opens the plain explanation with the company and its peers, and closes on Escape and outside clicks', () => {
    const q = button(/^Qué es P\/E/)!
    expect(q.getAttribute('aria-expanded')).toBe('false')
    click(q)
    expect(q.getAttribute('aria-expanded')).toBe('true')
    const pop = document.getElementById(q.getAttribute('aria-controls')!)
    expect(text(pop)).toContain('Cuántos años de ganancias estás pagando.')
    expect(text(pop)).toContain('si MercadoLibre ganara')
    expect(text(pop)).toContain('Sus parecidas: Amazon.com 19,6 · Sea 29,0')

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(q.getAttribute('aria-expanded')).toBe('false')

    click(q)
    act(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(q.getAttribute('aria-expanded')).toBe('false')
  })

  it('says why a row has no value', () => {
    const q = button(/^Qué es Beta/)!
    click(q)
    expect(text(document.getElementById(q.getAttribute('aria-controls')!))).toContain('Sin datos')
  })

  it('keeps the "?" on the line of the label\'s last word', () => {
    const q = button(/^Qué es P\/E/)!
    expect(q.parentElement!.className).toContain('whitespace-nowrap')
    expect(q.parentElement!.textContent).toBe('ganancias)?')
  })

  it('leaves the BYMA note to the header', async () => {
    await act(async () => root.render(<NumerosTab page={{ ...page(), bymaListing: true }} />))
    expect(text(el)).not.toContain('Datos de MercadoLibre en BYMA')
  })

  it('shows an ADR\'s price target as its BYMA listing\'s, in pesos', async () => {
    const p = { ...page(), ticker: 'GGAL', name: 'Grupo Financiero Galicia S.A.', currency: 'USD', bymaListing: true }
    p.metrics!.priceTarget = { ...p.metrics!.priceTarget, today: 9581.1 }
    await act(async () => root.render(<NumerosTab page={p} />))
    const row = [...el.querySelectorAll('li')].find((li) => li.textContent?.startsWith('Precio objetivo'))
    expect(text(row)).toContain('Precio objetivo promedio (en BYMA)')
    // "(en BYMA)" and its "?" never split across lines.
    expect(text(button(/^Qué es Precio objetivo/)!.parentElement)).toBe('(en BYMA)?')
    expect(text(row)).toContain('$ 9.581')
    expect(text(row)).not.toContain('US$')
  })

  it('formats the price target in the listing currency the page names', async () => {
    const p = { ...page(), listingCurrency: 'EUR' } as AssetPage
    p.metrics!.priceTarget = { ...p.metrics!.priceTarget, today: 12.5 }
    await act(async () => root.render(<NumerosTab page={p} />))
    const row = [...el.querySelectorAll('li')].find((li) => li.textContent?.startsWith('Precio objetivo'))
    expect(text(row)).toContain('Precio objetivo promedio')
    expect(text(row)).not.toContain('en BYMA')
    expect(text(row)).toContain('EUR 12,50')
  })
})

describe('NumerosTab history', () => {
  it('opens Margen neto by default, as in the mockup', () => {
    expect(text(panel()?.querySelector('h2'))).toBe('Margen neto')
  })

  it('falls back to the first row with history when Margen neto has none', async () => {
    const p = page()
    p.metrics!.netMargin = { ...p.metrics!.netMargin, history: { quarterly: [], ttm: [], annual: [] } }
    await act(async () => root.render(<NumerosTab page={p} />))
    expect(text(panel()?.querySelector('h2'))).toBe('P/E (precio / ganancias)')
  })

  it('says a 12-month flow covers the last 12 months, and a balance its close', () => {
    expect(text(panel()?.querySelector('h2 + p'))).toBe('Últimos 12 meses a abr–jun 2026')
    click(button(/^Deuda \/ activos:/))
    expect(text(panel()?.querySelector('h2 + p'))).toBe('Al cierre de abr–jun 2026')
  })

  it('opens the history of a clicked row and keeps it in the URL; a snapshot row has none', async () => {
    click(button(/^Margen neto: 5,3 %/))
    expect(text(panel()?.querySelector('h2'))).toBe('Margen neto')
    expect(window.location.search).toBe('?dato=netMargin')
    expect(button(/^Empleados:/)).toBeUndefined()

    // Back undoes the entry the row pushed; the browser reports it asynchronously.
    await act(async () => {
      button(/Números/)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(window.location.search).toBe('')
  })

  it('hides a period mode with no data, and the range picks the chart points', () => {
    click(button(/^Margen neto: 5,3 %/))
    const modes = [...panel()!.querySelectorAll('label')].map((l) => l.textContent)
    expect(modes).toEqual(expect.arrayContaining(['Trimestral', 'Últimos 12 meses']))
    expect(modes).not.toContain('Anual')

    const points = () => Number(panel()!.querySelector('[data-points]')!.getAttribute('data-points'))
    // Últimos 12 meses and 8 años by default: the 29 TTM ends from 2019-06-30, plus today.
    expect(points()).toBe(30)
    const twoYears = [...panel()!.querySelectorAll('input[type="radio"]')].find((i) => i.parentElement?.textContent === '2 años')!
    click(twoYears)
    // 2024-10-30 onward: four quarters of 2024-12 … 2025-09, plus 2025-12, 2026-03, 2026-06, plus today.
    expect(points()).toBe(8)
  })

  it('opens on the mode with history when the last 12 months have a single period', async () => {
    const p = page()
    p.metrics!.roe = {
      id: 'roe', today: 27.5, since: '2022', asOf: '2026-06-30', source: 'yahoo',
      history: {
        quarterly: withToday(quarters((i) => i).slice(-5), 27.5),
        ttm: withToday([{ end: '2026-06-30', value: 27.5 }], 27.5),
        annual: withToday(['2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31'].map((end, i) => ({ end, value: 20 + i })), 27.5),
      },
    }
    await act(async () => root.render(<NumerosTab page={p} />))
    click(button(/^Rentabilidad sobre patrimonio \(ROE\): 27,5 %/))
    const checked = panel()!.querySelector('input[type="radio"]:checked')
    expect(checked?.parentElement?.textContent).toBe('Trimestral')
  })

  it('states the change in a year against the same 12 months a year before the latest statements', async () => {
    const p = page()
    p.metrics!.netMargin = {
      id: 'netMargin', today: 5.3, since: '2025', asOf: '2026-06-30', source: 'tradingview',
      history: { quarterly: [], ttm: withToday([['2025-06-30', 8.5], ['2025-09-30', 7.9], ['2025-12-31', 6.6], ['2026-03-31', 5.9], ['2026-06-30', 5.3]].map(([end, value]) => ({ end: end as string, value: value as number })), 5.3), annual: [] },
    }
    await act(async () => root.render(<NumerosTab page={p} />))
    click(button(/^Margen neto: 5,3 %/))
    expect(text(panel())).toContain('▼ bajó 3,2 puntos en un año')
  })

  it('charts every quarter of a per-share flow, which has no hoy point in quarterly mode', async () => {
    const p = page()
    p.metrics!.revenuePerShare = { ...p.metrics!.revenuePerShare, history: { ...p.metrics!.revenuePerShare.history, quarterly: quarters((i) => 10 + i) } }
    await act(async () => root.render(<NumerosTab page={p} />))
    click(button(/^Ventas:/))
    click([...panel()!.querySelectorAll('input[type="radio"]')].find((i) => i.parentElement?.textContent === 'Trimestral'))
    // 8 años from the last quarter, 2026-06-30: the quarters from 2018-09-30, the last one included.
    expect(Number(panel()!.querySelector('[data-points]')!.getAttribute('data-points'))).toBe(QUARTER_ENDS.length)
    expect(text(panel())).toContain('a 41,0 en abr–jun 2026')
  })

  it('wraps long peer names by their short name instead of cutting them', async () => {
    const p = page()
    p.peers = [...p.peers, peer('BCBA:GGAL', 'Grupo Financiero Galicia S.A.', { netMargin: 20 })]
    await act(async () => root.render(<NumerosTab page={p} />))
    click(button(/^Margen neto: 5,3 %/))
    const name = panel()!.querySelector('[data-slot="peer-bar"] span')!
    expect(name.textContent).toBe('Grupo Financiero Galicia')
    expect(name.className).not.toContain('truncate')
    expect(name.className).toContain('break-words')
  })

  it('ranks the company among its peers by value, highlights it and leaves out peers with no value', () => {
    click(button(/^Margen neto: 5,3 %/))
    const bars = [...panel()!.querySelectorAll('[data-slot="peer-bar"]')]
    expect(bars.map((b) => b.querySelector('span')?.textContent)).toEqual(['Amazon.com', 'Sea', 'MercadoLibre'])
    expect(bars.map((b) => b.hasAttribute('data-self'))).toEqual([false, false, true])
  })
})
