import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Position, ONPosition, PortfolioSummary } from '@/types'
import type { Amounts, CurrencyViews, PositionView } from '@/lib/multicurrency'
import { CURRENCIES, headline, readCurrency, saveCurrency, viewsOf } from '../currency'
import { buildHoldings, distribution } from '../holdings'

const a = (ARS: number, MEP: number, CCL: number): Amounts => ({ ARS, MEP, CCL })

const view = (over: Partial<PositionView>): PositionView => ({
  value: a(300_000, 200, 187.5), cost: a(150_000, 150, 120), avgCost: a(75_000, 75, 60), pnl: a(150_000, 50, 67.5),
  pnlPct: a(1, 1 / 3, 0.5625), price: a(150_000, 100, 93.75), dayChange: a(3000, 2, 1.875), dayChangePct: 0.01,
  source: 'local', estimated: false, costEstimated: false, ...over,
})

const views: CurrencyViews = {
  version: 1,
  fx: { mep: 1500, ccl: 1600, mepDate: '2026-10-21', cclDate: '2026-10-21' },
  positions: {
    AAPL: view({}),
    DIS: view({ value: a(480_000, 320, 300), pnl: a(-20_000, -30, -20), pnlPct: a(-0.04, -0.0857, -0.0625), price: a(240_000, 160, 150), avgCost: a(250_000, 175, 160), cost: a(500_000, 350, 320), dayChangePct: -0.02, source: 'estimated', estimated: true }),
    YM34D: view({ value: a(1_500_000, 1000, 937.5) }),
  },
  totals: {
    value: a(2_440_000, 2440_000 / 1500, 1525), stocks: a(780_000, 520, 487.5), ons: a(1_500_000, 1000, 937.5), cash: a(160_000, 106.67, 100),
    invested: a(800_000, 650, 560), openPnl: a(1_480_000, 870, 865), openPnlPct: a(1.85, 1.338, 1.545), realized: a(12_500, 12.5, 10),
    dayChange: a(30_000, 20, 18.75), dayChangePct: a(0.0375, 0.0308, 0.0335),
  },
  estimated: true,
}

const summary = {
  total_market_value: 1600, total_invested: 1000, open_pnl: 500, open_pnl_pct: 0.5, day_pnl: 12, day_pnl_pct: 0.012,
  realized_pnl: 7, stocks: { market_value: 600 }, ons: { market_value: 900 }, cash: { balance: 100 },
} as unknown as PortfolioSummary

// Node's own localStorage global shadows jsdom's, as in useResizable.test.ts.
const storage = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(window, 'localStorage', { value: storage, writable: true })

afterEach(() => { vi.restoreAllMocks(); storage.clear() })

describe('currency selector state', () => {
  it('offers Pesos, Dólar MEP and Dólar cable', () => {
    expect(CURRENCIES).toEqual([
      { id: 'ARS', label: 'Pesos', prefix: '$' },
      { id: 'MEP', label: 'Dólar MEP', prefix: 'US$' },
      { id: 'CCL', label: 'Dólar cable', prefix: 'US$' },
    ])
  })

  it('defaults to MEP and remembers the viewer choice', () => {
    expect(readCurrency()).toBe('MEP')
    saveCurrency('ARS')
    expect(window.localStorage.getItem('resumen:currency')).toBe('ARS')
    expect(readCurrency()).toBe('ARS')
    window.localStorage.setItem('resumen:currency', 'EUR')
    expect(readCurrency()).toBe('MEP')
  })

  it('works without storage (private window, blocked site data)', () => {
    vi.spyOn(storage, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(readCurrency()).toBe('MEP')
    expect(() => saveCurrency('CCL')).not.toThrow()
  })

  it('reads only a views payload whose version it knows', () => {
    expect(viewsOf({ currencies: views })).toBe(views)
    expect(viewsOf({})).toBeNull()
    expect(viewsOf({ currencies: { ...views, version: 2 } })).toBeNull()
    expect(viewsOf({ currencies: null })).toBeNull()
  })
})

describe('headline', () => {
  it('without views: the USD figures exactly as before', () => {
    expect(headline(summary, null, 'ARS')).toEqual({
      prefix: 'US$', total: 1600, dayPnl: 12, dayPnlPct: 0.012, dayLabel: 'hoy', openPnl: 500, openPnlPct: 0.5,
      realized: 7, realizedLabel: 'Resultado realizado', capital: 1100,
    })
  })

  it('with views: every figure in the chosen currency', () => {
    expect(headline(summary, views, 'ARS')).toEqual({
      prefix: '$', total: 2_440_000, dayPnl: 30_000, dayPnlPct: 0.0375, dayLabel: 'hoy, por precio', openPnl: 1_480_000, openPnlPct: 1.85,
      realized: 12_500, realizedLabel: 'Realizado, con dividendos y cupones', capital: 960_000,
    })
    expect(headline(summary, views, 'CCL')).toMatchObject({ prefix: 'US$', total: 1525, dayPnl: 18.75, openPnl: 865, realized: 10, capital: 660 })
  })

})

describe('holdings and distribution in a currency', () => {
  const base = { id: 'x', user_id: 'u', avg_cost: 1, total_invested: 1, first_bought: null, last_updated: '', version: 1 }
  const positions: Position[] = [
    { ...base, ticker: 'AAPL', quantity: 2, market_value: 130, pnl: 10, pnl_pct: 0.1, day_change_pct: 0.005, current_price: 65 },
    { ...base, ticker: 'DIS', quantity: 2, market_value: 300, pnl: -20, pnl_pct: -0.06, day_change_pct: -0.02, current_price: 150 },
  ]
  const onPositions: ONPosition[] = [{ ...base, ticker: 'YM34D', quantity: 10, market_value: 1000, pnl: 0, pnl_pct: 0, day_change_pct: 0, current_price: 100 }]
  const input = { positions, onPositions, cedearTickers: ['AAPL'], names: {}, total: 1600 }

  it('takes every holding figure from the views', () => {
    const rows = buildHoldings({ ...input, total: views.totals.value.MEP, views, currency: 'MEP' })
    expect(rows.map(r => r.ticker)).toEqual(['YM34D', 'DIS', 'AAPL'])
    const aapl = rows.find(r => r.ticker === 'AAPL')!
    expect(aapl).toMatchObject({
      value: 200, pnl: 50, pnlPct: 1 / 3, price: 100, avgCost: 75, invested: 150, dayChangePct: 0.01, estimated: false,
      quantity: 2, kind: 'cedear',
    })
    expect(aapl.weightPct).toBeCloseTo((200 / (2440_000 / 1500)) * 100, 9)
    expect(rows.find(r => r.ticker === 'DIS')).toMatchObject({ value: 320, pnl: -30, invested: 350, dayChangePct: -0.02, estimated: true })
  })

  it('without views the rows are the USD ones, not estimated', () => {
    const rows = buildHoldings(input)
    expect(rows.find(r => r.ticker === 'AAPL')).toMatchObject({ value: 130, pnl: 10, price: 65, invested: 1, estimated: false })
  })

  it('distribution follows the currency', () => {
    const rows = buildHoldings({ ...input, total: views.totals.value.ARS, views, currency: 'ARS' })
    const cedear = rows.find(r => r.ticker === 'AAPL')!.value!
    expect(distribution(summary, views, 'ARS', rows)).toEqual([
      { label: 'Acciones', value: 780_000 - cedear, pct: ((780_000 - cedear) / 2_440_000) * 100 },
      { label: 'CEDEARs', value: cedear, pct: (cedear / 2_440_000) * 100 },
      { label: 'Obligaciones negociables', value: 1_500_000, pct: (1_500_000 / 2_440_000) * 100 },
      { label: 'Caja', value: 160_000, pct: (160_000 / 2_440_000) * 100 },
    ])
    expect(distribution(summary).map(d => d.value)).toEqual([600, 0, 900, 100])
  })
})
