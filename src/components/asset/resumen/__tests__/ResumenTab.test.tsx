import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { METRICS, type MetricId } from '@/lib/fundamentals/catalog'
import type { AssetPage, AssetProfile } from '@/lib/fundamentals/service'
import type { Metrics } from '@/lib/fundamentals/metrics'
import { ResumenTab } from '../ResumenTab'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// odd/tasks/asset-page.md T9, S11. Public company names only; every number is invented.
const PROFILE: AssetProfile = {
  sector: 'Consumer Cyclical', industry: 'Internet Retail', country: 'Uruguay', fullTimeEmployees: 90_000, currency: 'USD',
  fiftyTwoWeekLow: 1500, fiftyTwoWeekHigh: 2500, targetMeanPrice: 2400, numberOfAnalystOpinions: 30, nextEarningsDate: '2099-11-05',
  earnings: [
    { quarterEnd: '2025-09-30', epsEstimate: 9.5, epsActual: 8.3 },
    { quarterEnd: '2025-12-31', epsEstimate: 11, epsActual: 12.4 },
    { quarterEnd: '2026-03-31', epsEstimate: 8, epsActual: 8 },
    { quarterEnd: '2026-06-30', epsEstimate: 10, epsActual: null },
  ],
}

function page(over: Partial<AssetPage> = {}, today: Partial<Record<MetricId, number>> = {}): AssetPage {
  const values: Partial<Record<MetricId, number>> = { revenueGrowth: 46, netMargin: 5.3, pe: 44.1, employees: 84_000, ...today }
  const metrics = Object.fromEntries(METRICS.map((d) => [
    d.id, { id: d.id, today: values[d.id] ?? null, history: { quarterly: [], ttm: [], annual: [] }, since: null, asOf: '2026-06-30', source: 'tradingview' },
  ])) as unknown as Metrics
  const peer = (i: number, pe: number) => ({
    tvSymbol: `NYSE:P${i}`, name: `Peer ${i}`,
    today: Object.fromEntries(METRICS.map((d) => [d.id, d.id === 'pe' ? pe : null])) as Record<MetricId, number | null>,
  })
  return {
    ticker: 'MELI', name: 'MercadoLibre, Inc.', exchange: 'NASDAQ', price: 2000, currency: 'USD', supported: true,
    listing: { ticker: 'MELI', market: 'america', tvSymbol: 'NASDAQ:MELI', yahooSymbol: 'MELI' },
    bymaListing: false, metrics, peers: [peer(1, 20), peer(2, 24), peer(3, 30)], sources: { tradingview: 'ok', yahoo: 'ok' },
    profile: PROFILE, ...over,
  }
}

afterEach(() => { document.body.innerHTML = '' })

async function mount(p: AssetPage, onOpen = vi.fn()) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => root.render(<ResumenTab page={p} onOpen={onOpen} />))
  return { el, onOpen }
}

const text = (node: Element | null | undefined) => (node?.textContent ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ')
/** Cells joined by a space: textContent alone runs them together. */
const cells = (row: Element) => [...row.children].map((c) => text(c)).join(' ')
const card = (el: Element, title: string) => [...el.querySelectorAll('section')].find((s) => text(s.querySelector('h3')).startsWith(title))

describe('ResumenTab', () => {
  it('answers the two questions with a factual pill and sentence', async () => {
    const { el } = await mount(page())

    const business = card(el, '¿Le va bien como empresa?')!
    expect(text(business)).toContain('Crece fuerte')
    expect(text(business)).toContain('Sí: vende 46 % más que hace un año y gana plata.')
    const price = card(el, '¿Está cara?')!
    expect(text(price)).toContain('Más cara que sus parecidas')
    expect(text(price)).toContain('P/E 44 contra 24 de mediana')
    expect(price.querySelector('[data-tone="warn"]')).not.toBeNull()
  })

  it("each answer's numbers open their row in Números", async () => {
    const { el, onOpen } = await mount(page())

    const links = [...card(el, '¿Le va bien')!.querySelectorAll('button')]
    expect(links.map((b) => text(b))).toEqual(['Crecimiento de ventas (12 meses) 46,0 %', 'Margen neto 5,3 %'])
    act(() => links[1].click())
    expect(onOpen).toHaveBeenLastCalledWith('netMargin')
    act(() => card(el, '¿Está cara?')!.querySelector('button')!.click())
    expect(onOpen).toHaveBeenLastCalledWith('pe')
  })

  it("marks today's price on the 52-week range and says where it stands", async () => {
    const { el } = await mount(page())

    const range = card(el, 'Últimas 52 semanas')!
    expect(text(range)).toContain('US$ 1.500')
    expect(text(range)).toContain('US$ 2.500')
    expect(text(range)).toContain('Hoy US$ 2.000: 33 % arriba del mínimo y 20 % abajo del máximo.')
    expect((range.querySelector('[data-mark]') as HTMLElement).style.left).toBe('50%')
  })

  it("gives the analysts' average target and count as information, not a recommendation", async () => {
    const { el } = await mount(page())

    const analysts = card(el, 'Analistas')!
    expect(text(analysts)).toContain('US$ 2.400')
    expect(text(analysts)).toContain('Precio objetivo promedio según 30 analistas: 20 % arriba del precio de hoy.')
    expect(text(analysts.querySelector('[data-footnote]'))).toBe('Es información, no una recomendación de compra o venta.')
  })

  it('shows the next earnings date and the last four quarters, estimate against actual', async () => {
    const { el } = await mount(page())

    const results = card(el, 'Resultados')!
    expect(text(results)).toContain('Próximos resultados: 5 de noviembre de 2099.')
    const rows = [...results.querySelectorAll('tbody tr')].map(cells)
    expect(rows).toEqual([
      'jul–sep 2025 9,50 8,30 No llegó',
      'oct–dic 2025 11,00 12,40 Superó',
      'ene–mar 2026 8,00 8,00 Igual',
      'abr–jun 2026 10,00 — ',
    ])
  })

  it('names sector, industry, country and employees, the employees as Números counts them', async () => {
    const { el } = await mount(page())

    const company = card(el, 'La empresa')!
    expect([...company.querySelectorAll('dl > div')].map(cells)).toEqual([
      'Sector Consumo discrecional', 'Industria Internet Retail', 'País Uruguay', 'Empleados 84.000',
    ])
  })

  it('says no buy, sell or recommend anywhere but its footnote', async () => {
    for (const p of [page(), page({}, { revenueGrowth: -8, netMargin: -4, pe: 0 }), page({ profile: null })]) {
      const { el } = await mount(p)
      el.querySelectorAll('[data-footnote]').forEach((n) => n.remove())
      expect(text(el)).not.toMatch(/compr|recomend|vendé|vender|\bventa\b|conviene|oportunidad/i)
      document.body.innerHTML = ''
    }
  })

  it("without Yahoo's profile, keeps the answers and says the rest did not come", async () => {
    const { el } = await mount(page({ profile: null }))

    expect(card(el, '¿Le va bien como empresa?')).toBeDefined()
    expect(text(el)).toContain('No pudimos traer el rango de 52 semanas, los analistas ni los resultados. Probá de nuevo en un rato.')
    expect(card(el, 'Analistas')).toBeUndefined()
    expect([...card(el, 'La empresa')!.querySelectorAll('dl > div')].map(cells)).toEqual(['Empleados 84.000'])
  })

  it("compares no price with today's when the profile quotes another currency", async () => {
    const { el } = await mount(page({ profile: { ...PROFILE, currency: 'ARS' } }))

    expect(card(el, 'Últimas 52 semanas')!.querySelector('[data-mark]')).toBeNull()
    expect(text(card(el, 'Analistas'))).not.toContain('precio de hoy')
    expect(text(card(el, 'Analistas'))).toContain('$ 2.400')
  })

  it('says what is missing instead of guessing', async () => {
    const thin = { ...PROFILE, fiftyTwoWeekLow: null, targetMeanPrice: null, nextEarningsDate: null, earnings: [] }
    const { el } = await mount(page({ profile: thin }))

    expect(text(card(el, 'Últimas 52 semanas'))).toContain('Sin datos del rango de 52 semanas.')
    expect(text(card(el, 'Analistas'))).toContain('No tenemos precios objetivo de analistas para esta acción.')
    expect(text(card(el, 'Resultados'))).toContain('Todavía no hay fecha para sus próximos resultados.')
    expect(text(card(el, 'Resultados'))).toContain('Sin resultados trimestrales con estimaciones.')
  })

  it('never announces a date already past, as a last good copy might', async () => {
    const { el } = await mount(page({ profile: { ...PROFILE, nextEarningsDate: '2020-01-30' } }))

    expect(text(card(el, 'Resultados'))).toContain('Todavía no hay fecha para sus próximos resultados.')
  })
})
