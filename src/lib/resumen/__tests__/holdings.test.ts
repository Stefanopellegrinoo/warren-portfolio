import { describe, it, expect } from 'vitest'
import { buildHoldings, distribution, groupRows, nextSort, sortRows, DEFAULT_SORT, type HoldingRow } from '../holdings'
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

  it('shows the CEDEAR count the broker shows (underlying shares × ratio), rounding float noise', () => {
    const vst = { ...positions[0], ticker: 'VST', quantity: 42.307692 }
    const [row] = buildHoldings({ ...input, positions: [vst], onPositions: [], cedearTickers: ['VST'], cedearRatios: { VST: 26 } })
    expect(row.quantityLabel).toBe('1.100 CEDEARs')
    // Per CEDEAR, like the broker, so quantity × price is still the value.
    expect(row.quantity).toBe(1100)
    expect(row.price).toBeCloseTo(vst.current_price! / 26, 6)
    expect(row.avgCost).toBeCloseTo(vst.avg_cost / 26, 6)
  })

  it('keeps quantity, price, average cost and invested for the table view', () => {
    const duk = buildHoldings({ ...input, positions: [{ ...pos('DUK', 40, 4827, 1027, 0.27, -0.005), avg_cost: 95, total_invested: 3800 }] })[0]
    expect(duk).toMatchObject({ quantity: 40, price: 120.675, avgCost: 95, invested: 3800 })
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

describe('distribution', () => {
  const summary = {
    total_market_value: 39951.8,
    stocks: { market_value: 20900.85 },
    ons: { market_value: 0 },
    cash: { balance: 19050.95 },
  } as unknown as PortfolioSummary

  it('splits the portfolio into stocks, CEDEARs, ONs and cash', () => {
    const d = distribution(summary, null, undefined, [{ kind: 'cedear', value: 900.85 }, { kind: 'stock', value: 20000 }] as HoldingRow[])
    expect(d.map(x => x.label)).toEqual(['Acciones', 'CEDEARs', 'Obligaciones negociables', 'Caja'])
    expect(d[0].value).toBeCloseTo(20000, 6)
    expect(d[1].value).toBeCloseTo(900.85, 6)
    expect(d[0].pct + d[1].pct).toBeCloseTo(52.315, 3)
    expect(d[2]).toEqual({ label: 'Obligaciones negociables', pct: 0, value: 0 })
    expect(d[3].pct).toBeCloseTo(47.685, 3)
  })

  it('counts a CEDEAR without a price as zero, leaving the rest in stocks', () => {
    const d = distribution(summary, null, undefined, [{ kind: 'cedear', value: null }] as HoldingRow[])
    expect(d[0].value).toBe(20900.85)
    expect(d[1].value).toBe(0)
  })

  it('never returns NaN for an empty portfolio', () => {
    const empty = { total_market_value: 0, stocks: { market_value: 0 }, ons: { market_value: 0 }, cash: { balance: 0 } } as unknown as PortfolioSummary
    expect(distribution(empty).map(x => x.pct)).toEqual([0, 0, 0, 0])
  })
})

describe('sorting and grouping holdings', () => {
  const r = (ticker: string, kind: HoldingRow['kind'], value: number | null, pnlPct: number | null) =>
    ({ ticker, kind, value, pnlPct } as HoldingRow)
  const rows = [r('B', 'stock', 10, 0.2), r('A', 'cedear', 30, -0.1), r('C', 'stock', null, null), r('D', 'on', 20, 0.05), r('E', 'stock', 40, -0.3)]

  it('sorts by value, biggest first, by default', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'value', dir: 'desc' })
    expect(sortRows(rows, DEFAULT_SORT).map(x => x.ticker)).toEqual(['E', 'A', 'D', 'B', 'C'])
  })

  it('sorts either way and always leaves rows without a figure last', () => {
    expect(sortRows(rows, { key: 'pnlPct', dir: 'asc' }).map(x => x.ticker)).toEqual(['E', 'A', 'D', 'B', 'C'])
    expect(sortRows(rows, { key: 'pnlPct', dir: 'desc' }).map(x => x.ticker)).toEqual(['B', 'D', 'A', 'E', 'C'])
  })

  it('sorts names alphabetically', () => {
    expect(sortRows(rows, { key: 'ticker', dir: 'asc' }).map(x => x.ticker)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('flips the direction on the same column and starts a new one in its natural order', () => {
    expect(nextSort({ key: 'value', dir: 'desc' }, 'value')).toEqual({ key: 'value', dir: 'asc' })
    expect(nextSort({ key: 'value', dir: 'asc' }, 'pnl')).toEqual({ key: 'pnl', dir: 'desc' })
    expect(nextSort({ key: 'value', dir: 'desc' }, 'ticker')).toEqual({ key: 'ticker', dir: 'asc' })
  })

  it('groups by asset type in a fixed order, keeping the order inside each group', () => {
    const groups = groupRows(sortRows(rows, DEFAULT_SORT))
    expect(groups.map(g => [g.title, g.items.map(x => x.ticker)])).toEqual([
      ['Acciones', ['E', 'B', 'C']],
      ['CEDEARs', ['A']],
      ['Obligaciones negociables', ['D']],
    ])
  })
})
