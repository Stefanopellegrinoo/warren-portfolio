import { describe, it, expect } from 'vitest'
import { LINES, freeCashFlow, tableOf, toStatements, trend, type AssetStatements } from '../statements'
import type { TvHistory, TvHistoryLine } from '../tradingview'
import type { YahooStatements } from '../yahoo'
import type { Series } from '../types'

// Public company names only; every number is invented.
const TV_LINES: TvHistoryLine[] = ['revenue', 'netIncome', 'grossProfit', 'ebitda', 'totalAssets', 'totalDebt', 'freeCashFlow', 'epsDiluted']
const at = (ends: string[], values: number[]): Series => ends.map((end, i) => ({ end, value: values[i] }))
const QUARTERS = Array.from({ length: 32 }, (_, i) => new Date(Date.UTC(2018, 9 + i * 3, 0)).toISOString().slice(0, 10)) // 2018-09-30 … 2026-06-30
const YEARS = Array.from({ length: 20 }, (_, i) => `${2006 + i}-12-31`) // 2006 … 2025

function tvHistory(currency: string, quarterly: Partial<Record<TvHistoryLine, Series>>, annual: Partial<Record<TvHistoryLine, Series>> = {}): TvHistory {
  const all = (lines: Partial<Record<TvHistoryLine, Series>>) => Object.fromEntries(TV_LINES.map((l) => [l, lines[l] ?? []])) as Record<TvHistoryLine, Series>
  return { currency, quarterly: all(quarterly), annual: all(annual) }
}

const lastQuarters = QUARTERS.slice(-5)
const yahooUsd: YahooStatements = {
  currency: 'USD',
  quarterly: {
    revenue: at(lastQuarters, [50e8, 55e8, 60e8, 70e8, 80e8]),
    netIncome: at(lastQuarters, [5e8, 4e8, 6e8, 7e8, 3e8]),
    totalLiabilities: at(lastQuarters, [1e10, 1.1e10, 1.2e10, 1.3e10, 1.4e10]),
    operatingCashFlow: at(lastQuarters, [9e8, 8e8, 7e8, 6e8, 5e8]),
    capitalExpenditure: at(lastQuarters.slice(1), [-1e8, -2e8, -3e8, -4e8]),
    freeCashFlow: at(lastQuarters, [9e8, 8e8, 7e8, 6e8, 5e8]),
    dilutedEps: at(lastQuarters, [1.01, 0.81, 1.21, 1.41, 0.61]),
    ordinarySharesNumber: at(lastQuarters, [5e8, 5e8, 4.9e8, 4.9e8, 4.8e8]),
  },
  annual: { revenue: at(['2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31'], [1e10, 1.4e10, 2e10, 2.8e10]) },
}
const tvUsd = tvHistory('USD', {
  revenue: at(QUARTERS, QUARTERS.map((_, i) => 1e9 + i * 1e8)),
  epsDiluted: at(QUARTERS, QUARTERS.map((_, i) => 0.5 + i / 100)),
}, { revenue: at(YEARS, YEARS.map((_, i) => 1e9 * (i + 1))) })

describe('toStatements', () => {
  it("converts each source's amounts to USD at its period end with the metrics' own conversion, and keeps a USD period inside an ARS series", () => {
    // BCBA:YPFD's TradingView history is labeled ARS, but its newest quarter is in USD (L21 a). Rates invented.
    const ends = ['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30']
    const tv = tvHistory('ARS', {
      revenue: at(ends, [6.215e12, 6.6e12, 6.951e12, 9.284e12, 6.557e9]),
      netIncome: at(ends, [-2.576e11, -8.743e11, 6.063e11, 1.696e12, 1.181e9]),
      totalAssets: at(ends, [4.067e13, 4.27e13, 4.182e13, 4.786e13, 3.418e10]),
      totalDebt: at(ends, [1.545e13, 1.618e13, 1.482e13, 1.602e13, 1.102e10]),
      epsDiluted: at(ends, [-66.53, -226, 154.6, 438.9, 0.3]),
    })
    const ccl = new Map([['2025-09-30', 1380], ['2025-12-31', 1450], ['2026-03-31', 1400], ['2026-06-30', 1410], ['2026-09-30', 1460]])

    const { tradingview } = toStatements(tv, null, new Map([['ARS', ccl]]))

    expect(tradingview!.currency).toBe('ARS')
    expect(tradingview!.quarterly.revenue).toEqual(at(ends, [6.215e12 / 1380, 6.6e12 / 1450, 6.951e12 / 1400, 9.284e12 / 1410, 6.557e9].map(Math.round)))
    expect(tradingview!.quarterly.netIncome!.at(-1)).toEqual({ end: '2026-09-30', value: 1.181e9 })
    // EPS (and share counts) are never converted.
    expect(tradingview!.quarterly.dilutedEps).toEqual(at(ends, [-66.53, -226, 154.6, 438.9, 0.3]))
  })

  it('a period with no rate is left out, never converted at an invented one', () => {
    const y: YahooStatements = { currency: 'TWD', quarterly: { revenue: at(['2026-03-31', '2026-06-30'], [3.2e11, 3.3e11]) }, annual: {} }

    const { yahoo } = toStatements(null, y, new Map([['TWD', new Map([['2026-06-30', 32]])]]))

    expect(yahoo!.quarterly.revenue).toEqual([{ end: '2026-06-30', value: 3.3e11 / 32 }])
  })

  it("an Argentine reporter (ARS statements) has no Yahoo annual: it mixes as-reported years with IAS 29 restated ones (L11)", () => {
    const y: YahooStatements = {
      currency: 'ARS',
      quarterly: { revenue: at(['2026-06-30'], [1.41e12]) },
      annual: { revenue: at(['2024-12-31', '2025-12-31'], [4e12, 5e12]) },
    }
    const ccl = new Map([['2024-12-31', 1200], ['2025-12-31', 1450], ['2026-06-30', 1410]])

    const { yahoo } = toStatements(null, y, new Map([['ARS', ccl]]))

    expect(yahoo!.quarterly.revenue).toEqual([{ end: '2026-06-30', value: 1e9 }])
    expect(yahoo!.annual).toEqual({})
  })

  it("Flujo de caja libre is operating cash flow − |CapEx| (L22), not Yahoo's own line; a period without CapEx has none", () => {
    const { yahoo } = toStatements(null, yahooUsd, new Map())

    expect(yahoo!.quarterly.freeCashFlow).toEqual(at(lastQuarters.slice(1), [8e8 - 1e8, 7e8 - 2e8, 6e8 - 3e8, 5e8 - 4e8]))
    expect(freeCashFlow(at(['2026-06-30'], [5]), undefined)).toEqual([])
  })

  it('keeps the shown lines only, eight years at most, small enough to send', () => {
    const { yahoo, tradingview } = toStatements(tvUsd, { ...yahooUsd, quarterly: { ...yahooUsd.quarterly, investedCapital: at(lastQuarters, [1, 2, 3, 4, 5]) } }, new Map())

    expect(Object.keys(yahoo!.quarterly)).not.toContain('investedCapital')
    expect(tradingview!.quarterly.revenue).toHaveLength(32)
    expect(tradingview!.annual.revenue!.map((p) => p.end.slice(0, 4))).toEqual(['2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'])
    // TradingView's history keys are the page's line names: epsDiluted is Yahoo's dilutedEps.
    expect(tradingview!.quarterly.dilutedEps).toHaveLength(32)
    expect(JSON.stringify({ yahoo, tradingview }).length).toBeLessThan(40_000)
  })
})

const statements = (): AssetStatements => ({ ...toStatements(tvUsd, yahooUsd, new Map()), sources: { tradingview: 'ok', yahoo: 'ok', fx: 'ok' } })

describe('tableOf', () => {
  it('in the 5-year range every row comes from Yahoo, its columns newest first', () => {
    const t = tableOf(statements(), 'income', 'quarterly', 5)

    expect(t.rows.map((r) => [r.def.id, r.source])).toEqual([['revenue', 'yahoo'], ['netIncome', 'yahoo'], ['dilutedEps', 'yahoo']])
    expect(t.columns).toEqual([...lastQuarters].reverse())
    expect(t.rows[0].series.map((p) => p.value)).toEqual([50e8, 55e8, 60e8, 70e8, 80e8])
  })

  it("in the 8-year range TradingView's lines come from TradingView for all their columns; the rest keep Yahoo's span and say so", () => {
    const t = tableOf(statements(), 'income', 'quarterly', 8)

    const row = (id: string) => t.rows.find((r) => r.def.id === id)!
    expect(row('revenue')).toMatchObject({ source: 'tradingview', since: null })
    expect(row('revenue').series).toEqual(tvUsd.quarterly.revenue)
    expect(row('dilutedEps').source).toBe('tradingview')
    // TradingView has no net income history here: that row stays Yahoo's, whole.
    expect(row('netIncome')).toMatchObject({ source: 'yahoo', since: '2025' })
    expect(row('netIncome').series).toEqual(yahooUsd.quarterly.netIncome)
    expect(t.columns).toHaveLength(32)
    expect(t.columns[0]).toBe('2026-06-30')
  })

  it('says "desde" only when a row starts in a later year than the table, not a quarter later in the same year', () => {
    const s = statements()
    s.yahoo!.quarterly.netIncome = at(['2025-03-31', ...lastQuarters], [1, 5e8, 4e8, 6e8, 7e8, 3e8])

    const t = tableOf(s, 'income', 'quarterly', 5)

    expect(t.columns.at(-1)).toBe('2025-03-31')
    expect(t.rows.map((r) => r.since)).toEqual([null, null, null])
  })

  it('lines a row has no data for are left out; the balance and cash flow tables hold their own lines', () => {
    expect(tableOf(statements(), 'balance', 'quarterly', 5).rows.map((r) => r.def.id)).toEqual(['totalLiabilities', 'ordinarySharesNumber'])
    expect(tableOf(statements(), 'cashflow', 'quarterly', 5).rows.map((r) => r.def.id)).toEqual(['operatingCashFlow', 'capitalExpenditure', 'freeCashFlow'])
    expect(tableOf(statements(), 'income', 'annual', 5).rows.map((r) => r.def.id)).toEqual(['revenue'])
  })

  it('aligns two sources whose period ends differ by days in one column', () => {
    const s = statements()
    s.yahoo!.quarterly.netIncome = at(['2026-06-28'], [1])

    const t = tableOf(s, 'income', 'quarterly', 8)

    expect(t.columns.filter((c) => c.startsWith('2026-06'))).toHaveLength(1)
  })
})

describe('trend', () => {
  it('▲▼ against the same period a year earlier, not the period before', () => {
    const s = at(['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'], [10, 20, 30, 40, 15, 18])

    expect(trend(s, '2026-03-31')).toBe(1) // 15 vs 10, though below the 40 before it
    expect(trend(s, '2026-06-30')).toBe(-1) // 18 vs 20, though above the 15 before it
    expect(trend(s, '2025-12-31')).toBe(0) // no year earlier
    expect(trend(at(['2024-12-31', '2025-12-31'], [-5, -2]), '2025-12-31')).toBe(1)
  })
})

describe('LINES', () => {
  it('has a Spanish label and a "?" for every line, and TradingView only for its eight lines', () => {
    for (const d of LINES) {
      expect(d.label.length, d.id).toBeGreaterThan(2)
      expect(d.help.length, d.id).toBeGreaterThan(30)
    }
    expect(LINES.flatMap((d) => (d.tv ? [d.tv] : [])).sort()).toEqual([...TV_LINES].sort())
  })
})
