import { describe, it, expect } from 'vitest'
import { METRICS, type MetricId } from '../catalog'
import type { Metrics } from '../metrics'
import { explain, formatMetric, howItGoes, nullReason, peersLine, periodLabel, shortName } from '../explain'

const plain = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ')
const BROKEN = /\{|\}|undefined|NaN|null|Infinity/

describe('formatMetric', () => {
  it('formats each unit the Spanish way, and null as a dash', () => {
    expect(formatMetric(45.23, 'ratio')).toBe('45,2')
    expect(formatMetric(2.391, 'ratio')).toBe('2,39')
    expect(formatMetric(5.26, 'percent')).toBe('5,3 %')
    expect(formatMetric(-3.2, 'percent')).toBe('−3,2 %')
    expect(plain(formatMetric(83_680e6, 'usd'))).toBe('US$ 83.680 M')
    expect(formatMetric(694, 'usdPerShare')).toBe('694,0')
    expect(formatMetric(1.234, 'usdPerShare')).toBe('1,23')
    expect(plain(formatMetric(50.7e6, 'count'))).toBe('50,7 M')
    expect(formatMetric(123_700, 'count')).toBe('123.700')
    expect(plain(formatMetric(2254.4, 'price', 'USD'))).toBe('US$ 2.254')
    expect(plain(formatMetric(8450, 'price', 'ARS'))).toBe('$ 8.450')
    expect(plain(formatMetric(12.5, 'price', 'EUR'))).toBe('EUR 12,50')
    for (const unit of ['ratio', 'percent', 'usd', 'usdPerShare', 'count', 'price'] as const) {
      expect(formatMetric(null, unit)).toBe('—')
      expect(formatMetric(Number.NaN, unit)).toBe('—')
    }
  })
})

describe('shortName', () => {
  it('drops the legal suffixes a reader does not say', () => {
    expect(shortName('MercadoLibre, Inc.')).toBe('MercadoLibre')
    expect(shortName('Alibaba Group Holding Limited')).toBe('Alibaba')
    expect(shortName('Grupo Financiero Galicia S.A.')).toBe('Grupo Financiero Galicia')
    expect(shortName('Sea Limited')).toBe('Sea')
    expect(shortName('JD.com, Inc.')).toBe('JD.com')
    expect(shortName('Sea Limited Sponsored ADR Class A')).toBe('Sea')
    expect(shortName('Alibaba Group Holding Limited Sponsored ADR')).toBe('Alibaba')
    expect(shortName('Taiwan Semiconductor Manufacturing Company Ltd.')).toBe('Taiwan Semiconductor Manufacturing')
  })
})

describe('explain', () => {
  it('has plain copy for every catalog metric, with the company and its value filled in', () => {
    for (const def of METRICS) {
      for (const value of [12.3456, -0.8, 0.42]) {
        const e = explain(def.id, 'Acme', value, 'USD')
        expect(e.what.length, def.id).toBeGreaterThan(20)
        expect(e.read.length, def.id).toBeGreaterThan(10)
        expect(e.example, def.id).toContain('Acme')
        for (const text of [e.what, e.example, e.read]) expect(plain(text), def.id).not.toMatch(BROKEN)
      }
      expect(explain(def.id, 'Acme', null).example, def.id).toBeNull()
    }
  })

  it('reads the P/E as the design example does', () => {
    const e = explain('pe', 'MercadoLibre', 45.2)
    expect(e.what).toBe('Cuántos años de ganancias estás pagando.')
    expect(e.example).toBe('Con 45,2, si MercadoLibre ganara siempre lo mismo que en los últimos 12 meses, tardaría 45 años en devolverte lo que pagás por la acción.')
    expect(e.read).toContain('Más alto = más cara')
  })

  it('says a negative margin is a loss, never "le quedan" a negative amount', () => {
    expect(plain(explain('netMargin', 'Acme', -3.2).example)).toBe('Con −3,2 %, Acme perdió US$ 3,2 por cada US$ 100 que vendió.')
    expect(plain(explain('netMargin', 'Acme', 5.3).example)).toBe('Con 5,3 %, a Acme le quedaron US$ 5,3 de ganancia por cada US$ 100 que vendió.')
  })
})

describe('peersLine', () => {
  it('lists the peers that have a value, in the given order', () => {
    expect(peersLine('pe', [{ name: 'Amazon', value: 19.6 }, { name: 'Nadie', value: null }, { name: 'Sea', value: 29 }]))
      .toBe('Sus parecidas: Amazon 19,6 · Sea 29,0')
    expect(peersLine('pe', [{ name: 'Nadie', value: null }])).toBeNull()
  })
})

describe('nullReason', () => {
  const metrics = (today: Partial<Record<MetricId, number>>) =>
    Object.fromEntries(METRICS.map((d) => [d.id, { id: d.id, today: today[d.id] ?? null, history: { quarterly: [], ttm: [], annual: [] }, since: null, source: 'tradingview' }])) as unknown as Metrics

  it('says why a ratio over a loss is missing', () => {
    expect(nullReason('pe', { metrics: metrics({ netMargin: -2 }), sources: {} })).toBe('No aplica: la empresa perdió plata en los últimos 12 meses')
    expect(nullReason('pb', { metrics: metrics({ bookPerShare: -1 }), sources: {} })).toBe('No aplica: su patrimonio es negativo')
  })

  it('blames the source when it did not answer, and otherwise just says there is no data', () => {
    expect(nullReason('roe', { metrics: metrics({}), sources: { yahoo: 'error' } })).toBe('Sin datos: la fuente no respondió')
    expect(nullReason('beta', { metrics: metrics({}), sources: {} })).toBe('Sin datos')
  })
})

describe('periodLabel', () => {
  it('names quarters by their months, years by the year, and today as hoy', () => {
    expect(periodLabel('2026-06-30', 'ttm')).toBe('abr–jun 2026')
    expect(periodLabel('2025-01-31', 'quarterly')).toBe('nov–ene 2025')
    expect(periodLabel('2024-12-31', 'annual')).toBe('2024')
    expect(periodLabel('2026-10-30', 'ttm', '2026-10-30')).toBe('hoy')
  })
})

describe('howItGoes', () => {
  const CAUSES = /porque|debido|gracias|culpa|por eso|ya que|causa|motivo/i
  const s = (pairs: [string, number][]) => pairs.map(([end, value]) => ({ end, value }))

  it('states losses, when it turned, its best point and how it compares with a year before', () => {
    const series = s([['2019-12-31', -2], ['2020-06-30', -1], ['2021-03-31', 3], ['2022-03-31', 9.2], ['2025-09-30', 6], ['2026-10-30', 5.3]])
    const text = howItGoes('netMargin', series, 'ttm', '2026-10-30').join(' ')
    expect(text).toContain('Perdió plata en 2019–2020')
    expect(text).toContain('gana desde ene–mar 2021')
    expect(text).toContain('Su máximo fue 9,2 % en ene–mar 2022.')
    expect(text).toContain('bajó 0,7 puntos')
    expect(text).not.toMatch(CAUSES)
  })

  it('counts a streak of quarters at the end, and marks the lowest point where lower is better', () => {
    const series = s([['2025-03-31', 30], ['2025-06-30', 25], ['2025-09-30', 22], ['2025-12-31', 20], ['2026-03-31', 18], ['2026-10-30', 19]])
    const text = howItGoes('pe', series, 'quarterly', '2026-10-30').join(' ')
    expect(text).toContain('Bajó cuatro trimestres seguidos, hasta ene–mar 2026.')
    expect(text).toContain('Su mínimo fue 18,0 en ene–mar 2026.')
    expect(text).toContain('Pasó de 30,0 en ene–mar 2025 a 19,0 hoy.')
    expect(text).not.toMatch(CAUSES)
  })

  it('says when today is the best point, and counts years in annual mode', () => {
    const series = s([['2022-12-31', 1], ['2023-12-31', 2], ['2024-12-31', 3], ['2025-12-31', 4], ['2026-10-30', 5]])
    const text = howItGoes('revenuePerShare', series, 'annual', '2026-10-30').join(' ')
    expect(text).toContain('Subió tres años seguidos, hasta 2025.')
    expect(text).toContain('Hoy está en su máximo del período.')
    expect(text).not.toMatch(BROKEN)
  })

  it('has nothing to say about a single period, with or without today', () => {
    const none = ['Todavía no hay historia suficiente para ver cómo viene.']
    expect(howItGoes('pe', s([['2026-10-30', 20]]), 'ttm', '2026-10-30')).toEqual(none)
    expect(howItGoes('roe', s([['2026-06-30', 27.5], ['2026-10-30', 27.5]]), 'ttm', '2026-10-30')).toEqual(none)
  })

  it('compares a quarter with the same quarter a year before', () => {
    const series = s([['2025-03-31', 5], ['2025-06-30', 6], ['2025-09-30', 7], ['2025-12-31', 8], ['2026-03-31', 9], ['2026-06-30', 9]])
    expect(howItGoes('revenuePerShare', series, 'quarterly', null).join(' ')).toContain('Contra el mismo trimestre de un año antes, subió 50,0 %.')
  })
})
