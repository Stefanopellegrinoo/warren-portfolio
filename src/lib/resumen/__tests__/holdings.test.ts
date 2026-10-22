import { describe, it, expect } from 'vitest'
import { buildHoldings, reviewItems, distribution, type HoldingRow } from '../holdings'
import type { Position, ONPosition, PortfolioSummary } from '@/types'

const base = { id: 'x', user_id: 'u', avg_cost: 0, total_invested: 0, first_bought: null, last_updated: '', version: 1 }
const pos = (ticker: string, quantity: number, market_value: number | undefined, pnl: number, pnl_pct: number, day_change_pct: number): Position =>
  ({ ...base, ticker, quantity, market_value, pnl, pnl_pct, day_change_pct, current_price: market_value === undefined ? undefined : market_value / quantity })

const positions: Position[] = [
  pos('DUK', 40, 4827, 1027, 0.27, -0.005),
  pos('T', 33, 2191, 441, 0.252, -0.064),
  pos('AAL', 25, 612, -360, -0.371, 0.01),
  pos('SLB', 3, 511, -489, -0.489, 0.022),
]
const onPositions: ONPosition[] = [{ ...base, ticker: 'YMCJO', quantity: 15, market_value: 1450, pnl: -50, pnl_pct: -0.033, day_change_pct: 0.002, current_price: 96.67 }]
const input = { positions, onPositions, cedearTickers: ['T', 'AAL', 'SLB'], names: { DUK: 'Duke Energy', T: 'AT&T' }, total: 39951.8 }

describe('buildHoldings', () => {
  it('labels stocks, CEDEARs and ONs and links each to the right page', () => {
    const rows = buildHoldings(input)
    const byTicker = Object.fromEntries(rows.map(r => [r.ticker, r]))
    expect(byTicker.DUK).toMatchObject({ kind: 'stock', name: 'Duke Energy', quantityLabel: '40 acciones', href: '/trading?symbol=DUK' })
    expect(byTicker.T).toMatchObject({ kind: 'cedear', quantityLabel: '33 CEDEARs' })
    expect(byTicker.YMCJO).toMatchObject({ kind: 'on', quantityLabel: 'VN 1.500', href: '/ons/mi-cartera', name: null })
  })

  it('uses the singular for one unit', () => {
    expect(buildHoldings({ ...input, positions: [pos('DUK', 1, 120, 0, 0, 0)], onPositions: [] })[0].quantityLabel).toBe('1 acción')
  })

  it('computes the weight in the whole portfolio', () => {
    expect(buildHoldings(input).find(r => r.ticker === 'DUK')!.weightPct).toBeCloseTo(12.08, 2)
  })

  it('sorts by value and leaves unpriced positions last, with nulls instead of zeros', () => {
    const unpriced = pos('NEW', 5, undefined, 0, 0, 0)
    delete unpriced.day_change_pct
    delete unpriced.pnl
    delete unpriced.pnl_pct
    const rows = buildHoldings({ ...input, positions: [unpriced, ...positions] })
    expect(rows.map(r => r.ticker)).toEqual(['DUK', 'T', 'YMCJO', 'AAL', 'SLB', 'NEW'])
    expect(rows.at(-1)).toMatchObject({ value: null, dayChangePct: null, pnl: null, pnlPct: null, weightPct: 0 })
  })

  it('returns nothing for an empty portfolio', () => {
    expect(buildHoldings({ positions: [], onPositions: [], cedearTickers: [], names: {}, total: 0 })).toEqual([])
  })
})

describe('reviewItems', () => {
  const rows = buildHoldings(input)

  it('lists heavy accumulated losses, worst first, then the biggest drop of the day', () => {
    expect(reviewItems(rows)).toEqual([
      { ticker: 'SLB', name: null, tone: 'danger', chip: '−48,9 %', why: 'Pierde 489 desde la compra' },
      { ticker: 'AAL', name: null, tone: 'danger', chip: '−37,1 %', why: 'Pierde 360 desde la compra' },
      { ticker: 'T', name: 'AT&T', tone: 'warn', chip: '−6,4 % hoy', why: 'La mayor caída del día en tu cartera' },
    ])
  })

  it('ignores a daily drop smaller than 3 %', () => {
    const calm = rows.map((r): HoldingRow => (r.ticker === 'T' ? { ...r, dayChangePct: -0.02 } : r))
    expect(reviewItems(calm).map(i => i.ticker)).toEqual(['SLB', 'AAL'])
  })

  it('does not repeat a position already listed for its loss', () => {
    const worstDay = rows.map((r): HoldingRow => (r.ticker === 'SLB' ? { ...r, dayChangePct: -0.1 } : r))
    expect(reviewItems(worstDay).map(i => i.ticker)).toEqual(['SLB', 'AAL'])
  })

  it('is empty when nothing stands out', () => {
    expect(reviewItems([])).toEqual([])
  })
})

describe('distribution', () => {
  const summary = {
    total_market_value: 39951.8,
    stocks: { market_value: 20900.85 },
    ons: { market_value: 0 },
    cash: { balance: 19050.95 },
  } as unknown as PortfolioSummary

  it('splits the portfolio into the three asset classes', () => {
    const d = distribution(summary)
    expect(d.map(x => x.label)).toEqual(['Acciones y CEDEARs', 'Caja', 'Obligaciones negociables'])
    expect(d[0].pct).toBeCloseTo(52.315, 3)
    expect(d[1].pct).toBeCloseTo(47.685, 3)
    expect(d[2]).toEqual({ label: 'Obligaciones negociables', pct: 0, value: 0 })
  })

  it('never returns NaN for an empty portfolio', () => {
    const empty = { total_market_value: 0, stocks: { market_value: 0 }, ons: { market_value: 0 }, cash: { balance: 0 } } as unknown as PortfolioSummary
    expect(distribution(empty).map(x => x.pct)).toEqual([0, 0, 0])
  })
})
