import { describe, it, expect } from 'vitest'
import { businessAnswer, priceAnswer, sectorName, countryName, type Answer } from '../summary'
import { METRICS, type MetricId } from '../catalog'
import type { Metrics } from '../metrics'
import type { AssetPage, PeerToday } from '../service'
import type { Series } from '../types'

// odd/tasks/asset-page.md T9, S11: the two first-ten-seconds answers, facts only. Every number is invented.
const TODAY = '2026-10-30'
const AS_OF = '2026-06-30'

/** 20 quarters of TTM values, oldest first, ending at AS_OF, then the "hoy" point. */
function quarters(values: number[], hoy: number): Series {
  const ends = values.map((_, i) => {
    const d = new Date(Date.UTC(2026, 6 - 3 * (values.length - 1 - i), 0))
    return d.toISOString().slice(0, 10)
  })
  return [...values.map((value, i) => ({ end: ends[i], value })), { end: TODAY, value: hoy }]
}

interface Spec {
  revenueGrowth?: number | null
  netMargin?: number | null
  /** Net margin a year before AS_OF; the change is netMargin − this. */
  netMarginYearAgo?: number
  pe?: number | null
  peHistory?: number[]
  ps?: number | null
  eps?: number | null
}

function page(spec: Spec, peers: Partial<Record<MetricId, number | null>>[] = []): AssetPage {
  const metric = (id: MetricId, today: number | null, ttm: Series = []) =>
    ({ id, today, history: { quarterly: [], ttm, annual: [] }, since: null, asOf: AS_OF, source: 'tradingview' })
  const metrics = Object.fromEntries(METRICS.map((d) => [d.id, metric(d.id, null)])) as unknown as Metrics
  const nm = spec.netMargin ?? null
  Object.assign(metrics, {
    revenueGrowth: metric('revenueGrowth', spec.revenueGrowth ?? null),
    netMargin: metric('netMargin', nm, spec.netMarginYearAgo === undefined || nm === null
      ? []
      : [{ end: '2025-06-30', value: spec.netMarginYearAgo }, { end: AS_OF, value: nm }, { end: TODAY, value: nm }]),
    pe: metric('pe', spec.pe ?? null, spec.peHistory ? quarters(spec.peHistory, spec.pe ?? 0) : []),
    ps: metric('ps', spec.ps ?? null),
    eps: metric('eps', spec.eps ?? null),
  })
  const peer = (v: Partial<Record<MetricId, number | null>>, i: number): PeerToday => ({
    tvSymbol: `NYSE:P${i}`, name: `Peer ${i}`,
    today: Object.fromEntries(METRICS.map((d) => [d.id, v[d.id] ?? null])) as PeerToday['today'],
  })
  return {
    ticker: 'MELI', name: 'MercadoLibre, Inc.', exchange: 'NASDAQ', price: 1660, currency: 'USD', supported: true,
    listing: { ticker: 'MELI', market: 'america', tvSymbol: 'NASDAQ:MELI', yahooSymbol: 'MELI' },
    bymaListing: false, metrics, peers: peers.map(peer), sources: { tradingview: 'ok', yahoo: 'ok' },
  }
}

const PEERS_PE = [{ pe: 19.6 }, { pe: 24 }, { pe: 29 }, { pe: null }]
// Median 35 over the last 5 years.
const OWN_PE = [30, 31, 32, 33, 34, 34, 35, 35, 35, 35, 35, 35, 36, 36, 37, 38, 39, 40, 41, 42]

const said: Answer[] = []
const answer = (a: Answer) => (said.push(a), a)

describe('businessAnswer: ¿Le va bien como empresa?', () => {
  it('sales up strongly, makes money, margin down: yes, with the "aunque"', () => {
    const a = answer(businessAnswer(page({ revenueGrowth: 46.04, netMargin: 5.3, netMarginYearAgo: 8.5 })))
    expect(a).toEqual({
      tone: 'ok', label: 'Crece fuerte', facts: ['revenueGrowth', 'netMargin'],
      text: 'Sí: vende 46 % más que hace un año y gana plata, aunque su margen bajó 3,2 puntos.',
    })
  })

  it('sales up, makes money, margin up', () => {
    const a = answer(businessAnswer(page({ revenueGrowth: 4.5, netMargin: 10, netMarginYearAgo: 8.8 })))
    expect(a).toMatchObject({ tone: 'ok', label: 'Crece', text: 'Sí: vende 4,5 % más que hace un año y gana plata, y su margen subió 1,2 puntos.' })
  })

  it('sales flat, makes money, margin about the same', () => {
    const a = answer(businessAnswer(page({ revenueGrowth: -1, netMargin: 10, netMarginYearAgo: 9.8 })))
    expect(a).toMatchObject({ tone: 'neutral', label: 'Ventas estables', text: 'Más o menos: vende 1,0 % menos que hace un año y gana plata, con el margen estable.' })
  })

  it('sales down, makes money', () => {
    const a = answer(businessAnswer(page({ revenueGrowth: -8, netMargin: 10 })))
    expect(a).toMatchObject({ tone: 'warn', label: 'Vende menos', text: 'Más o menos: vende 8,0 % menos que hace un año, pero gana plata.' })
  })

  it('a loss while sales grow, its margin improving', () => {
    const a = answer(businessAnswer(page({ revenueGrowth: 20, netMargin: -4, netMarginYearAgo: -9 })))
    expect(a).toMatchObject({ tone: 'warn', label: 'Pierde plata', text: 'Más o menos: vende 20 % más que hace un año, pero pierde plata, aunque su margen subió 5,0 puntos.' })
  })

  it('a loss while sales fall', () => {
    const a = answer(businessAnswer(page({ revenueGrowth: -8, netMargin: -4, netMarginYearAgo: -2 })))
    expect(a).toMatchObject({ tone: 'bad', label: 'Pierde plata', text: 'No: vende 8,0 % menos que hace un año y pierde plata, y su margen bajó 2,0 puntos.' })
  })

  it('missing data: says what it knows and what it lacks, no verdict', () => {
    expect(answer(businessAnswer(page({ netMargin: 5 })))).toEqual({
      tone: null, label: null, facts: ['netMargin'], text: 'Gana plata en los últimos 12 meses; no tenemos cuánto cambiaron sus ventas.',
    })
    expect(answer(businessAnswer(page({ revenueGrowth: 12 })))).toMatchObject({
      tone: null, label: null, facts: ['revenueGrowth'], text: 'Vende 12 % más que hace un año; no tenemos su ganancia de los últimos 12 meses.',
    })
    expect(answer(businessAnswer(page({})))).toMatchObject({ tone: null, facts: [], text: 'Todavía no tenemos sus ventas ni sus ganancias de los últimos 12 meses.' })
    expect(answer(businessAnswer({ ...page({}), metrics: null }))).toMatchObject({ tone: null, text: 'Todavía no tenemos sus balances.' })
  })
})

describe('priceAnswer: ¿Está cara?', () => {
  it("P/E above its peers' median and above its own 5-year median", () => {
    const a = answer(priceAnswer(page({ pe: 44.1, peHistory: OWN_PE, netMargin: 5 }, PEERS_PE)))
    expect(a).toEqual({
      tone: 'bad', label: 'Más cara que sus parecidas', facts: ['pe'],
      text: 'Más cara que sus parecidas: P/E 44 contra 24 de mediana. También más cara que su propia mediana de 5 años (35).',
    })
  })

  it('in line with its peers, below its own history', () => {
    const a = answer(priceAnswer(page({ pe: 25, peHistory: OWN_PE }, PEERS_PE)))
    expect(a).toMatchObject({
      tone: 'ok', label: 'En línea con sus parecidas',
      text: 'En línea con sus parecidas: P/E 25 contra 24 de mediana. Pero más barata que su propia mediana de 5 años (35).',
    })
  })

  it('below its peers, with fewer than 16 quarters of its own (the "hoy" point is not one)', () => {
    const a = answer(priceAnswer(page({ pe: 15, peHistory: OWN_PE.slice(-15) }, PEERS_PE)))
    expect(a).toMatchObject({
      tone: 'ok', label: 'Más barata que sus parecidas',
      text: 'Más barata que sus parecidas: P/E 15 contra 24 de mediana. No tenemos 5 años de su historia para comparar.',
    })
  })

  it('against its own 5 years only, when fewer than two peers have the number', () => {
    const a = answer(priceAnswer(page({ pe: 44.1, peHistory: OWN_PE }, [{ pe: 20 }, { pe: null }])))
    expect(a).toMatchObject({
      tone: 'warn', label: 'Más cara que su historia',
      text: 'Más cara que su propia mediana de 5 años: P/E 44 contra 35. No hay suficientes parecidas con el dato para comparar.',
    })
  })

  it('with a loss, P/E does not apply: the same comparison on price / sales', () => {
    const a = answer(priceAnswer(page({ pe: null, netMargin: -3, ps: 2, eps: -0.5 }, [{ ps: 3 }, { ps: 4 }])))
    expect(a).toEqual({
      tone: 'ok', label: 'Más barata que sus parecidas', facts: ['ps'],
      text: 'El P/E no aplica porque perdió plata en los últimos 12 meses; miramos precio/ventas. '
        + 'Más barata que sus parecidas: precio/ventas 2,0 contra 3,5 de mediana. No tenemos 5 años de su historia para comparar.',
    })
  })

  it('missing data: no guess', () => {
    expect(answer(priceAnswer(page({ pe: null, netMargin: 5 }, PEERS_PE)))).toEqual({ tone: null, label: null, facts: [], text: 'No tenemos su P/E de hoy.' })
    expect(answer(priceAnswer(page({ pe: 44.1 })))).toMatchObject({
      tone: null, label: null, facts: ['pe'], text: 'P/E 44. No tenemos con qué compararlo: ni parecidas con el dato ni 5 años de su historia.',
    })
    expect(answer(priceAnswer({ ...page({}), metrics: null }))).toMatchObject({ tone: null, text: 'Todavía no tenemos sus balances.' })
  })
})

describe('the answers state facts, never advice', () => {
  it('no answer says buy, sell or recommend', () => {
    expect(said.length).toBeGreaterThan(15)
    // "vende" (it sells) and "ventas" (sales) are facts; "comprá", "vendé", "vender", "venta" (a trade) and "recomend…" are advice.
    for (const a of said) expect(`${a.label ?? ''} ${a.text}`).not.toMatch(/compr|recomend|vendé|vender|\bventa\b|conviene|oportunidad/i)
  })
})

describe('sector and country names', () => {
  it("says Yahoo's sectors and countries in Spanish, and anything else as it came", () => {
    expect(sectorName('Consumer Cyclical')).toBe('Consumo discrecional')
    expect(sectorName('Financial Services')).toBe('Servicios financieros')
    expect(sectorName('Something New')).toBe('Something New')
    expect(countryName('United States')).toBe('Estados Unidos')
    expect(countryName('Taiwan')).toBe('Taiwán')
    expect(countryName('Uruguay')).toBe('Uruguay')
    expect(countryName('Narnia')).toBe('Narnia')
  })
})
