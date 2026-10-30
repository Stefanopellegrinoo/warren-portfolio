// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { METRICS, SECTIONS, type MetricId } from '../catalog'
import {
  computeMetrics,
  changeVsYearAgo,
  bestPoint,
  peersMedian,
  PERIOD_MODES,
  type MetricsInput,
} from '../metrics'
import { fetchTvHistory, fetchTvSnapshot, type TvHistory, type TvHistoryLine } from '../tradingview'
import type { YahooLines, YahooStatements } from '../yahoo'
import type { Series } from '../types'
import historyRows from './fixtures/tradingview-history.json'
import meliSnapshotRow from './fixtures/tradingview-snapshot-meli.json'

const TODAY = '2026-10-30'

/** A fake scanner that answers any request with this one row, laid out in the requested columns. */
const answering = (row: Record<string, unknown>) =>
  (async (_url: unknown, init?: RequestInit) => {
    const { columns } = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ data: [{ s: row.s, d: columns.map((c: string) => row[c] ?? null) }] }))
  }) as typeof fetch

/** A company's input from the TradingView fixtures, read through the real parsers (live data, 2026-10-30). */
async function tvInput(symbol: string, priceOn: MetricsInput['priceOn'] = () => 1000): Promise<MetricsInput> {
  const row = historyRows.find((r) => r.s === symbol)!
  const tv = (await fetchTvHistory([symbol], 'america', answering(row))).get(symbol)!
  const snapshot = await fetchTvSnapshot('NASDAQ:MELI', 'america', answering(meliSnapshotRow))
  return { today: TODAY, snapshot, tv, yahoo: null, rates: new Map(), priceOn }
}

/** Oldest-first series from quarter ends and values in the same order. */
const series = (ends: string[], values: (number | null)[]): Series =>
  ends.flatMap((end, i) => (values[i] === null ? [] : [{ end, value: values[i] as number }]))

const lines = (ends: string[], values: Record<string, (number | null)[] | undefined>) =>
  Object.fromEntries(Object.entries(values).map(([line, v]) => [line, series(ends, v ?? [])]))

/** Quarterly TradingView history with only the given lines; the rest and the annual history empty. */
function tvHistory(currency: string, ends: string[], values: Partial<Record<TvHistoryLine, (number | null)[]>>): TvHistory {
  const none = Object.fromEntries(TV_LINES.map((l) => [l, []])) as unknown as TvHistory['quarterly']
  return { currency, quarterly: { ...none, ...lines(ends, values) }, annual: none }
}
const TV_LINES = ['revenue', 'netIncome', 'grossProfit', 'ebitda', 'totalAssets', 'totalDebt', 'freeCashFlow', 'epsDiluted'] as const

const Q5 = ['2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30']
const Y4 = ['2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31']

/** Invented round statements with every Yahoo line, 5 quarters and 4 years. */
function yahooStatements(currency: string): YahooStatements {
  const q = (v: number) => Q5.map((_, i) => v * (1 + i / 10))
  const y = (v: number) => Y4.map((_, i) => v * (1 + i / 10))
  const all = (f: (v: number) => number[]) => ({
    revenue: f(1000), costOfRevenue: f(600), grossProfit: f(400), operatingIncome: f(100), ebit: f(110),
    ebitda: f(150), netIncome: f(50), dilutedEps: f(1), dilutedAverageShares: f(50),
    totalAssets: f(5000), totalLiabilities: f(3000), stockholdersEquity: f(2000), cashAndCashEquivalents: f(300),
    cashAndShortTermInvestments: f(500), currentAssets: f(1500), currentLiabilities: f(1000), inventory: f(200),
    totalDebt: f(800), longTermDebt: f(400), investedCapital: f(2800), tangibleBookValue: f(1800),
    workingCapital: f(500), ordinarySharesNumber: f(50), operatingCashFlow: f(120), capitalExpenditure: f(-30),
    freeCashFlow: f(90),
  })
  return { currency, quarterly: lines(Q5, all(q)) as YahooLines, annual: lines(Y4, all(y)) as YahooLines }
}

const ids = (group: string) => METRICS.filter((m) => m.group === group).map((m) => m.id)
/** Per-share flows: a quarter holds a quarter's worth, about a fourth of the 12 months. */
const QUARTER_FLOWS: MetricId[] = ['revenuePerShare', 'ocfPerShare', 'fcfPerShare', 'ebitPerShare', 'ebitdaPerShare', 'capexPerShare', 'eps']
const relative = (a: number | null, b: number) => Math.abs((a as number) / b - 1)

describe('catalog', () => {
  it("lists every row of the design's catalog, by section, in the mockup's order", () => {
    const bySection = Object.fromEntries(SECTIONS.map((s) => [s, METRICS.filter((m) => m.section === s).map((m) => m.label)]))

    expect(bySection).toEqual({
      'Valoración': [
        'P/E (precio / ganancias)', 'Precio / ventas', 'Precio / flujo de caja', 'Precio / valor libro',
        'Valor de empresa', 'Valor de empresa / EBITDA', 'Valor de empresa / ventas', 'Valor de empresa / EBIT',
        'P/E esperado', 'Precio / ventas esperado', 'Valor de empresa / EBITDA esperado', 'Precio / valor libro esperado',
      ],
      'Estadísticas clave': ['Capitalización', 'Acciones en circulación', 'Capital flotante', 'Empleados'],
      'Rentabilidad': [
        'Rentabilidad sobre activos (ROA)', 'Rentabilidad sobre patrimonio (ROE)',
        'Rentabilidad sobre capital invertido (ROIC)', 'Margen bruto', 'Margen operativo', 'Margen EBITDA', 'Margen neto',
        'Crecimiento de ventas (12 meses)',
      ],
      'Liquidez': ['Liquidez inmediata', 'Liquidez corriente', 'Rotación de inventario', 'Rotación de activos'],
      'Solvencia': ['Deuda / activos', 'Deuda / patrimonio', 'Deuda largo plazo / activos', 'Deuda largo plazo / patrimonio'],
      'Por acción (US$)': [
        'Ventas', 'Flujo de caja operativo', 'Flujo de caja libre', 'EBIT', 'EBITDA', 'Valor libro',
        'Valor libro tangible', 'Caja', 'Deuda', 'Capital de trabajo', 'Inversión (CapEx)', 'Ganancia (EPS)',
      ],
      'Analistas y riesgo': ['Precio objetivo promedio', 'Beta (cuánto se mueve contra el mercado)'],
    })
    expect(METRICS.filter((m) => 'subsection' in m).map((m) => m.id)).toEqual(['peForward', 'psForward', 'evEbitdaForward', 'pbForward'])
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(METRICS.length)
  })

  it('takes each metric from one group: TradingView history (T), Yahoo statements (Y) or the snapshot', () => {
    // Group T: only revenue, net income, gross profit, EBITDA, total assets and EPS. Debt and free cash
    // flow are Yahoo's, so every debt and FCF figure on the page shares one definition (L21 b).
    expect(ids('T')).toEqual([
      'pe', 'ps', 'roa', 'grossMargin', 'ebitdaMargin', 'netMargin', 'revenueGrowth', 'assetTurnover', 'revenuePerShare',
      'ebitdaPerShare', 'eps',
    ])
    expect(ids('snapshot')).toEqual([
      'peForward', 'psForward', 'evEbitdaForward', 'pbForward', 'sharesOutstanding', 'floatShares', 'employees', 'beta',
    ])
    // Today's quote × listed units, in USD: the market cap every price ratio divides.
    expect(ids('quote')).toEqual(['marketCap'])
    // The analysts' target is Resumen's: the asked listing's Yahoo profile (T10, S5).
    expect(ids('profile')).toEqual(['priceTarget'])
    expect(ids('Y')).toHaveLength(METRICS.length - 11 - 8 - 1 - 1)
    expect(ids('Y')).toEqual(expect.arrayContaining(['debtToAssets', 'debtToEquity', 'debtPerShare', 'fcfPerShare', 'ev']))
  })
})

describe('computeMetrics', () => {
  it("reproduces TradingView's own MELI values today, percents as percent numbers (USD reporter)", async () => {
    const { snapshot } = await tvInput('NASDAQ:MELI')
    const m = computeMetrics(await tvInput('NASDAQ:MELI'))

    // TTM to 2026-06-30: net income 466+417+559+421 = 1863 M over revenue 10169+8845+8759+7409 = 35182 M.
    expect(m.netMargin.today).toBeCloseTo(5.295, 3)
    expect(m.pe.today).toBeCloseTo(84163279217 / 1863e6, 6) // 45,18
    const anchors: [MetricId, keyof typeof snapshot.fields][] = [
      ['netMargin', 'net_margin'], ['grossMargin', 'gross_margin'], ['ebitdaMargin', 'ebitda_margin_ttm'],
      ['pe', 'price_earnings_ttm'], ['ps', 'price_revenue_ttm'], ['roa', 'return_on_assets'],
      ['assetTurnover', 'asset_turnover_current'],
      ['revenuePerShare', 'revenue_per_share_ttm'], ['ebitdaPerShare', 'ebitda_per_share_ttm'],
    ]
    for (const [id, field] of anchors) expect(relative(m[id].today, snapshot.fields[field]!), id).toBeLessThan(1e-4)
    expect(m.eps.today).toBeCloseTo(1863e6 / (84163279217 / 1660.13), 6)
  })

  it('ends every history at the "hoy" point, equal to the list value; earlier points use the price of that day', async () => {
    const m = computeMetrics(await tvInput('NASDAQ:MELI', (d) => (d === '2026-06-30' ? 2000 : 1000)))
    const unitsNow = meliSnapshotRow.total_shares_outstanding

    // Sales growth needs eight quarters and the fixture keeps six: covered with eight below.
    for (const id of ids('T').filter((t) => t !== 'revenueGrowth')) {
      for (const mode of PERIOD_MODES) {
        expect(m[id].today, id).not.toBeNull()
        // A quarter of a per-share flow is not on hoy's 12-month scale: next test.
        if (mode === 'quarterly' && QUARTER_FLOWS.includes(id)) continue
        expect(m[id].history[mode].at(-1), `${id} ${mode}`).toEqual({ end: TODAY, value: m[id].today })
      }
    }
    const [lastPeriod] = m.pe.history.ttm.slice(-2)
    expect(lastPeriod.end).toBe('2026-06-30')
    expect(lastPeriod.value).toBeCloseTo((2000 * unitsNow) / 1863e6, 6)
  })

  it("ends a quarterly per-share flow at its last quarter: a quarter's flow is not on hoy's 12-month scale", async () => {
    const m = computeMetrics({ ...(await tvInput('NASDAQ:MELI')), yahoo: yahooStatements('USD') })

    for (const id of QUARTER_FLOWS) {
      expect(m[id].history.quarterly.at(-1)?.end, id).toBe('2026-06-30')
      expect(m[id].history.ttm.at(-1), id).toEqual({ end: TODAY, value: m[id].today })
      expect(m[id].history.annual.at(-1), id).toEqual({ end: TODAY, value: m[id].today })
    }
    // Annualized ratios, balances per share and margins are on hoy's scale: they keep it.
    for (const id of ['pe', 'pcf', 'debtPerShare', 'bookPerShare', 'netMargin', 'operatingMargin'] as const) {
      expect(m[id].history.quarterly.at(-1), id).toEqual({ end: TODAY, value: m[id].today })
    }
  })

  it('compares the list value with the same period a year before the statements it is built on (MELI)', async () => {
    // The fixture keeps six quarters; MercadoLibre's reported Q4 and Q3 2024 complete the TTM to 2025-06-30.
    const row = historyRows.find((r) => r.s === 'NASDAQ:MELI')!
    const longer = { ...row, total_revenue_fq_h: [...row.total_revenue_fq_h, 6059e6, 5312e6], net_income_fq_h: [...row.net_income_fq_h, 639e6, 397e6] }
    const tv = (await fetchTvHistory(['NASDAQ:MELI'], 'america', answering(longer))).get('NASDAQ:MELI')!
    const m = computeMetrics({ ...(await tvInput('NASDAQ:MELI', (d) => (d === '2025-06-30' ? 2000 : 1000))), tv })
    const at = (s: Series, end: string) => s.find((p) => p.end === end)!.value

    // Hoy is the TTM to 2026-06-30 (5,3 %); a year before it is the TTM to 2025-06-30 (8,5 %), not 2025-09-30.
    expect(m.netMargin.asOf).toBe('2026-06-30')
    expect(at(m.netMargin.history.ttm, '2025-06-30')).toBeCloseTo(8.5, 1)
    expect(changeVsYearAgo(m.netMargin.history.ttm, 'percent', m.netMargin.asOf)).toBeCloseTo(-3.2, 1)
    expect(changeVsYearAgo(m.netMargin.history.ttm, 'percent', m.netMargin.asOf)).toBeCloseTo(m.netMargin.today! - at(m.netMargin.history.ttm, '2025-06-30'), 9)
    // A price metric: hoy at today's price against that period at its own day's price.
    expect(changeVsYearAgo(m.pe.history.ttm, 'ratio', m.pe.asOf)).toBeCloseTo((m.pe.today! / at(m.pe.history.ttm, '2025-06-30') - 1) * 100, 9)
    expect(m.peForward.asOf).toBeNull()
  })

  it('builds TTM only where 4 consecutive quarters exist', () => {
    const ends = ['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30']
    const tv = tvHistory('USD', ends, { revenue: [100, null, 100, 100, 100, 100], netIncome: [10, null, 10, 10, 10, 20] })
    const m = computeMetrics({ ...emptyInput(), tv })

    expect(m.netMargin.history.ttm).toEqual([{ end: '2025-06-30', value: 12.5 }, { end: TODAY, value: 12.5 }])
    expect(m.netMargin.history.quarterly.map((p) => p.end)).toEqual([...ends.filter((e) => e !== '2024-06-30'), TODAY])
    expect(m.netMargin.history.quarterly.at(-2)).toEqual({ end: '2025-06-30', value: 20 })
  })

  it('annualizes a quarter against balances and prices in quarterly mode; margins use the quarter as is', async () => {
    const m = computeMetrics(await tvInput('NASDAQ:MELI', () => 2000))
    const unitsNow = meliSnapshotRow.total_shares_outstanding
    const at = (s: Series) => s.find((p) => p.end === '2026-06-30')!.value

    expect(at(m.pe.history.quarterly)).toBeCloseTo((2000 * unitsNow) / (466e6 * 4), 6)
    expect(at(m.netMargin.history.quarterly)).toBeCloseTo((466 / 10169) * 100, 6)
    expect(at(m.revenuePerShare.history.quarterly)).toBeCloseTo(10169e6 / unitsNow, 6)
  })

  it('never mixes sources: group T reads only TradingView, group Y only Yahoo', async () => {
    const base = await tvInput('NASDAQ:MELI')
    const both = computeMetrics({ ...base, yahoo: yahooStatements('USD') })
    const tvOnly = computeMetrics({ ...base, yahoo: null })
    const yahooOnly = computeMetrics({ ...base, tv: null, yahoo: yahooStatements('USD') })

    for (const def of METRICS) {
      if (def.group === 'T') {
        expect(both[def.id], def.id).toEqual(tvOnly[def.id])
        expect(both[def.id].source).toBe('tradingview')
        expect(yahooOnly[def.id].today, def.id).toBeNull()
      }
      if (def.group === 'Y') {
        expect(both[def.id], def.id).toEqual(yahooOnly[def.id])
        expect(both[def.id].source).toBe('yahoo')
        expect(both[def.id].today, def.id).not.toBeNull()
        expect(tvOnly[def.id].today, def.id).toBeNull()
      }
    }
  })

  it('converts to USD at each date before any ratio, with statement and price currencies apart (YPF-like)', () => {
    // BCBA listing: ARS price; TradingView statements in ARS, Yahoo statements in USD.
    const ccl = new Map([['2025-09-30', 1000], ['2025-12-31', 1200], ['2026-03-31', 1300], ['2026-06-30', 1400], ['2026-10-29', 1500]])
    const qEnds = Q5.slice(1)
    const ni = [100e9, 200e9, 300e9, 400e9]
    const rev = [1000e9, 1000e9, 1000e9, 1000e9]
    const shares = 400e6
    const tv = tvHistory('ARS', qEnds, { revenue: rev, netIncome: ni, epsDiluted: ni.map((x) => x / shares) })
    const yahoo: YahooStatements = {
      currency: 'USD',
      quarterly: lines(qEnds, { netIncome: [70e6, 140e6, 210e6, 280e6], stockholdersEquity: [9e9, 9e9, 9e9, 10e9], ordinarySharesNumber: [shares, shares, shares, shares] }),
      annual: {},
    }
    const marketCap = 16e12 // ARS: 400 M shares at 40.000
    const m = computeMetrics({
      today: TODAY,
      snapshot: { close: 40000, marketCap, currency: 'ARS', fields: emptyInput().snapshot.fields },
      tv, yahoo, rates: new Map([['ARS', ccl]]),
      priceOn: (d) => (d === '2026-06-30' ? 35000 : null),
    })
    const niTtmUsd = 100e9 / 1000 + 200e9 / 1200 + 300e9 / 1300 + 400e9 / 1400

    expect(m.pe.today).toBeCloseTo(marketCap / 1500 / niTtmUsd, 9)
    expect(m.pe.history.ttm.at(-2)).toEqual({ end: '2026-06-30', value: expect.closeTo(((35000 / 1400) * shares) / niTtmUsd, 9) })
    expect(m.pb.today).toBeCloseTo(marketCap / 1500 / 10e9, 9)
    expect(m.pb.history.quarterly.at(-2)).toEqual({ end: '2026-06-30', value: expect.closeTo(((35000 / 1400) * shares) / 10e9, 9) })
    expect(m.revenuePerShare.history.quarterly.find((p) => p.end === '2025-12-31')!.value).toBeCloseTo(1000e9 / 1200 / shares, 9)
  })

  it('counts listed units through the listing ratio for an ADR (1 unit = 5 ordinary shares, TWD statements)', () => {
    const yahoo: YahooStatements = {
      currency: 'TWD',
      quarterly: lines(Q5, {
        netIncome: [100e9, 100e9, 100e9, 100e9, 100e9],
        stockholdersEquity: [3000e9, 3000e9, 3000e9, 3000e9, 3300e9],
        ordinarySharesNumber: [26e9, 26e9, 26e9, 26e9, 25e9],
      }),
      annual: {},
    }
    const rates = new Map([['TWD', new Map([['2025-06-30', 30], ['2026-06-30', 33], ['2026-10-30', 32]])]])
    const m = computeMetrics({
      today: TODAY,
      // 5e9 units at US$100; the company has 25e9 ordinary shares now.
      snapshot: { close: 100, marketCap: 500e9, currency: 'USD', fields: emptyInput().snapshot.fields },
      tv: null, yahoo, rates,
      priceOn: (d) => (d === '2025-06-30' ? 80 : 90),
    })

    // 2025-06-30: 26e9 ordinary shares = 5.2e9 units at US$80; equity 3000e9 TWD at 30.
    expect(m.pb.history.quarterly[0]).toEqual({ end: '2025-06-30', value: expect.closeTo((80 * 5.2e9) / 100e9, 9) })
    expect(m.bookPerShare.history.quarterly[0].value).toBeCloseTo(100e9 / 5.2e9, 9)
    expect(m.pb.today).toBeCloseTo(500e9 / (3300e9 / 33), 9)
    expect(m.bookPerShare.today).toBeCloseTo(3300e9 / 33 / 5e9, 9)
  })

  it("values an ADR at its own price: units from TradingView's share count, not its home-market cap", () => {
    // NYSE:TSM (live 2026-10-30): market_cap_basic / close = 4.454e9, total_shares_outstanding = 5.186e9,
    // because the market cap follows the Taiwan price and the ADR trades about 16 % above it.
    const yahoo: YahooStatements = {
      currency: 'USD',
      quarterly: lines(Q5, {
        netIncome: [10e9, 10e9, 10e9, 10e9, 10e9],
        stockholdersEquity: [100e9, 100e9, 100e9, 100e9, 100e9],
        ordinarySharesNumber: [25e9, 25e9, 25e9, 25e9, 25e9],
      }),
      annual: {},
    }
    const fields = { ...emptyInput().snapshot.fields, total_shares_outstanding: 5e9 }
    const m = computeMetrics({
      today: TODAY,
      snapshot: { close: 100, marketCap: 430e9, currency: 'USD', fields },
      tv: null, yahoo, rates: new Map(),
      priceOn: () => 100,
    })

    expect(m.pb.today).toBeCloseTo(500e9 / 100e9, 9)
    expect(m.bookPerShare.today).toBeCloseTo(100e9 / 5e9, 9)
  })

  it('reads one Yahoo share line per company, never a per-period fallback to another', () => {
    const yahoo: YahooStatements = {
      currency: 'USD',
      quarterly: lines(Q5, {
        netIncome: [1e9, 1e9, 1e9, 1e9, 1e9],
        stockholdersEquity: [10e9, 10e9, 10e9, 10e9, 10e9],
        ordinarySharesNumber: [null, null, null, null, 50e6],
        dilutedAverageShares: [50e6, 50e6, 50e6, 50e6, 50e6],
      }),
      annual: {},
    }
    const m = computeMetrics({ ...emptyInput(), yahoo })

    expect(m.pb.history.quarterly.map((p) => p.end)).toEqual(['2026-06-30', TODAY])
  })

  it('drops Yahoo annual for ARS reporters (IAS 29 restated years) but keeps TradingView annual', async () => {
    const ccl = new Map([['2022-01-01', 100]])
    const { tv } = await tvInput('NASDAQ:MELI')
    const ars = computeMetrics({ ...emptyInput(), tv: { ...tv!, currency: 'ARS' }, yahoo: yahooStatements('ARS'), rates: new Map([['ARS', ccl]]) })
    const usd = computeMetrics({ ...emptyInput(), tv: { ...tv!, currency: 'ARS' }, yahoo: yahooStatements('USD'), rates: new Map([['ARS', ccl]]) })

    expect(ars.roe.history.annual).toEqual([])
    expect(ars.roe.history.quarterly.length).toBeGreaterThan(0)
    expect(ars.netMargin.history.annual.length).toBeGreaterThan(0)
    expect(usd.roe.history.annual.length).toBeGreaterThan(0)
  })

  it('reads debt and free cash flow from Yahoo only: totalDebt, and operating cash flow minus CapEx', async () => {
    const base = await tvInput('NASDAQ:MELI')
    const y = yahooStatements('USD')
    const m = computeMetrics({ ...base, yahoo: y })
    const tvOnly = computeMetrics(base)
    const last = (line: keyof YahooLines) => y.quarterly[line]!.at(-1)!.value
    const ttm = (line: keyof YahooLines) => y.quarterly[line]!.slice(-4).reduce((a, p) => a + p.value, 0)
    const units = meliSnapshotRow.total_shares_outstanding

    for (const id of ['debtToAssets', 'debtPerShare', 'fcfPerShare'] as const) {
      expect(m[id].source, id).toBe('yahoo')
      expect(tvOnly[id].today, id).toBeNull()
    }
    expect(m.debtToAssets.today).toBeCloseTo(last('totalDebt') / last('totalAssets'), 9)
    expect(m.debtPerShare.today).toBeCloseTo(last('totalDebt') / units, 9)
    // CapEx is booked negative: FCF = OCF − |CapEx|, so the page's FCF equals its OCF row minus its CapEx row.
    expect(m.fcfPerShare.today).toBeCloseTo((ttm('operatingCashFlow') + ttm('capitalExpenditure')) / units, 9)
    expect(m.fcfPerShare.today).toBeCloseTo(m.ocfPerShare.today! - m.capexPerShare.today!, 9)
  })

  it("MELI: debt per share ÷ book value per share equals debt / equity, today and at every period", async () => {
    // MercadoLibre's reported balances (Yahoo, USD): total debt and stockholders' equity, 2026-03-31 and 2026-06-30.
    const ends = ['2026-03-31', '2026-06-30']
    const yahoo: YahooStatements = {
      currency: 'USD',
      quarterly: lines(ends, { totalDebt: [12345e6, 13176e6], stockholdersEquity: [7281e6, 7834e6], ordinarySharesNumber: [50697182, 50696802], netIncome: [494e6, 523e6] }) as YahooLines,
      annual: {},
    }
    const m = computeMetrics({ ...(await tvInput('NASDAQ:MELI')), yahoo })

    expect(m.debtPerShare.today! / m.bookPerShare.today!).toBeCloseTo(m.debtToEquity.today!, 12)
    expect(m.debtToEquity.today).toBeCloseTo(13176 / 7834, 9) // 1,68
    for (const mode of PERIOD_MODES) {
      m.debtToEquity.history[mode].forEach((p, i) => {
        expect(m.debtPerShare.history[mode][i].value / m.bookPerShare.history[mode][i].value, `${mode} ${p.end}`).toBeCloseTo(p.value, 12)
      })
    }
  })

  it('keeps a period already in USD inside an ARS-labeled series (BCBA:YPFD, 2026-09-30) instead of shrinking it ~1.400×', () => {
    // BCBA:YPFD's TradingView history (live 2026-10-30) is labeled ARS, but its newest quarter is in USD:
    // revenue 6.557e9 after 9.284e12 ARS. Yahoo's USD statements say 6.574e9 and 6.557e9. Rates invented.
    const ends = ['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30']
    const tv = tvHistory('ARS', ends, {
      revenue: [6.215e12, 6.6e12, 6.951e12, 9.284e12, 6.557e9],
      netIncome: [-2.576e11, -8.743e11, 6.063e11, 1.696e12, 1.181e9],
      totalAssets: [4.067e13, 4.27e13, 4.182e13, 4.786e13, 3.418e10],
      totalDebt: [1.545e13, 1.618e13, 1.482e13, 1.602e13, 1.102e10],
      epsDiluted: [-66.53, -226, 154.6, 438.9, 0.3],
    })
    const ccl = new Map([['2025-09-30', 1380], ['2025-12-31', 1450], ['2026-03-31', 1400], ['2026-06-30', 1410], ['2026-09-30', 1460], ['2026-10-29', 1500]])
    const units = 3.9326e9
    const fields = { ...emptyInput().snapshot.fields, total_shares_outstanding: units }
    const m = computeMetrics({
      ...emptyInput(), tv, rates: new Map([['ARS', ccl]]),
      snapshot: { close: 7800, marketCap: 7800 * units, currency: 'ARS', fields },
    })
    const mcapUsd = (7800 * units) / 1500
    const niTtm = -8.743e11 / 1450 + 6.063e11 / 1400 + 1.696e12 / 1410 + 1.181e9
    const revTtm = 6.6e12 / 1450 + 6.951e12 / 1400 + 9.284e12 / 1410 + 6.557e9

    expect(m.pe.today).toBeCloseTo(mcapUsd / niTtm, 9) // 9,2, not 19,6
    expect(m.ps.today).toBeCloseTo(mcapUsd / revTtm, 9) // 0,90
    expect(m.assetTurnover.today).toBeCloseTo(revTtm / ((3.418e10 + 4.067e13 / 1380) / 2), 9) // 0,71
    expect(m.eps.today).toBeCloseTo(niTtm / units, 9)
    // Every line of that period stays as is; the ARS quarters before it are converted.
    expect(m.revenuePerShare.history.quarterly.at(-1)).toEqual({ end: '2026-09-30', value: expect.closeTo(6.557e9 / units, 9) })
    // Units then: net income ÷ EPS (both ARS, never converted) over the listing ratio, set by the USD quarter's.
    const unitsThen = 1.696e12 / 438.9 / (1.181e9 / 0.3 / units)
    expect(m.revenuePerShare.history.quarterly.at(-2)).toEqual({ end: '2026-06-30', value: expect.closeTo(9.284e12 / 1410 / unitsThen, 9) })
  })

  it('reads a genuine high-inflation ARS series as ARS: a ×3 yearly jump, or one line near zero, is not a switch to USD', () => {
    const years = ['2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31']
    const ni = [1e11, 3e11, 9e11, 2.7e12]
    const tv: TvHistory = {
      ...tvHistory('ARS', [], {}),
      annual: { ...tvHistory('ARS', [], {}).annual, ...lines(years, { revenue: [1e12, 3e12, 9e12, 27e12], netIncome: ni, epsDiluted: ni.map((x) => x / 1e9) }) },
    }
    // A quarter whose net income (and EPS) fell to about its previous USD value, while revenue, assets and debt did not.
    const quarters = ['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30']
    const qNi = [1e12, 1e12, 1e12, 1e9]
    tv.quarterly = { ...tv.quarterly, ...lines(quarters, {
      revenue: [5e12, 5e12, 5e12, 5.1e12], netIncome: qNi, epsDiluted: qNi.map((x) => x / 1e9),
      totalAssets: [4e13, 4e13, 4e13, 4.1e13], totalDebt: [1e13, 1e13, 1e13, 1.1e13],
    }) } as TvHistory['quarterly']
    const rates = new Map([['ARS', new Map([
      ['2022-12-30', 180], ['2023-12-29', 800], ['2024-12-31', 1030], ['2025-09-30', 1400], ['2025-12-31', 1450],
      ['2026-03-31', 1400], ['2026-06-30', 1400], ['2026-10-29', 1500],
    ])]])
    const fields = { ...emptyInput().snapshot.fields, total_shares_outstanding: 1e9 }
    const m = computeMetrics({ ...emptyInput(), tv, rates, snapshot: { close: 1000, marketCap: 1e12, currency: 'ARS', fields } })

    expect(m.revenuePerShare.history.annual.slice(0, 4).map((p) => p.value)).toEqual(
      [1e12 / 180, 3e12 / 800, 9e12 / 1030, 27e12 / 1450].map((v) => expect.closeTo(v / 1e9, 9)),
    )
    expect(m.revenuePerShare.history.quarterly.at(-1)).toEqual({ end: '2026-06-30', value: expect.closeTo(5.1e12 / 1400 / 1e9, 9) })

    // A currency near the dollar is always converted: no point of it shrinks >100× when converted.
    const brl = computeMetrics({
      ...emptyInput(), rates: new Map([['BRL', new Map([['2025-01-01', 4]])]]),
      tv: tvHistory('BRL', quarters, { revenue: [5e9, 5e9, 5e9, 5e9], netIncome: [1e9, 1e9, 1e9, 1e9], epsDiluted: [1, 1, 1, 1] }),
      snapshot: { close: 10, marketCap: 1e10, currency: 'USD', fields },
    })
    expect(brl.revenuePerShare.today).toBeCloseTo(20e9 / 4 / 1e9, 9)
  })

  it('shows "—" in the list only when the latest period lacks the input; asOf names that period either way', () => {
    // Net income for the last three quarters only (no 12 months of it); CapEx missing in the latest quarter.
    const yahoo: YahooStatements = {
      currency: 'USD',
      quarterly: lines(Q5, {
        netIncome: [null, null, 50, 50, 50],
        currentAssets: [150, 150, 150, 150, 180], currentLiabilities: [100, 100, 100, 100, 100],
        operatingCashFlow: [12, 12, 12, 12, 12], capitalExpenditure: [-3, -3, -3, -3, null],
        ordinarySharesNumber: [50, 50, 50, 50, 50],
      }) as YahooLines,
      annual: {},
    }
    const m = computeMetrics({ ...emptyInput(), yahoo })

    expect(m.currentRatio).toMatchObject({ today: 1.8, asOf: '2026-06-30' })
    expect(m.ocfPerShare.today).not.toBeNull()
    expect(m.capexPerShare).toMatchObject({ today: null, asOf: '2026-06-30' })
    expect(m.capexPerShare.history.ttm.at(-1)!.end).toBe('2026-03-31')
    expect(m.roe).toMatchObject({ today: null, asOf: '2026-06-30' })
  })

  it('gives null when an input is missing, and never invents a rate', async () => {
    const meli = await tvInput('NASDAQ:MELI')
    const noPrice = computeMetrics({ ...meli, snapshot: { ...meli.snapshot, close: null, marketCap: null }, priceOn: () => null })
    const noRates = computeMetrics({ ...meli, tv: { ...meli.tv!, currency: 'BRL' } })

    expect(noPrice.pe.today).toBeNull()
    expect(noPrice.pe.history).toEqual({ quarterly: [], ttm: [], annual: [] })
    // Per-share values need units, not a price: TradingView's share count gives them.
    expect(noPrice.revenuePerShare.today).toBeCloseTo(694, 0)
    expect(noPrice.netMargin.today).toBeCloseTo(5.295, 3)
    expect(noRates.netMargin).toMatchObject({ today: null, history: { quarterly: [], ttm: [], annual: [] }, since: null })
    expect(computeMetrics(meli).roe).toEqual({ id: 'roe', today: null, history: { quarterly: [], ttm: [], annual: [] }, since: null, asOf: null, source: 'yahoo' })
  })

  it('gives null over a denominator ≤ 0 (P/E of a loss), but keeps a negative margin', () => {
    const tv = tvHistory('USD', Q5.slice(1), { revenue: [100, 100, 100, 100], netIncome: [-10, -10, -10, -10], epsDiluted: [-1, -1, -1, -1] })
    const m = computeMetrics({ ...emptyInput(), tv })

    expect(m.pe.today).toBeNull()
    expect(m.netMargin.today).toBe(-10)
  })

  it("takes forward metrics, shares, float, employees and beta from TradingView's snapshot, with no history", async () => {
    const m = computeMetrics(await tvInput('NASDAQ:MELI'))

    expect(m.peForward).toEqual({ id: 'peForward', today: meliSnapshotRow.price_earnings_fwd, history: { quarterly: [], ttm: [], annual: [] }, since: null, asOf: null, source: 'snapshot' })
    expect(m.sharesOutstanding.today).toBe(meliSnapshotRow.total_shares_outstanding)
    expect(m.beta.today).toBe(meliSnapshotRow.beta_1_year)
  })

  it("takes the price target as given, Resumen's (the asked listing's Yahoo profile), never TradingView's (T10, S5)", async () => {
    const input = await tvInput('NASDAQ:MELI')
    expect(meliSnapshotRow.price_target_average).not.toBeNull()

    expect(computeMetrics({ ...input, target: 2400 }).priceTarget).toEqual({
      id: 'priceTarget', today: 2400, history: { quarterly: [], ttm: [], annual: [] }, since: null, asOf: null, source: 'profile',
    })
    // A peer has no profile: no target, even when TradingView has one.
    expect(computeMetrics(input).priceTarget.today).toBeNull()
  })

  it('says since when the history starts', async () => {
    const m = computeMetrics({ ...(await tvInput('NASDAQ:MELI')), yahoo: yahooStatements('USD') })

    expect(m.netMargin.since).toBe('2023') // TradingView annual from 2023-12-31 in the fixture
    expect(m.roe.since).toBe('2023') // Yahoo annual 2022 has no year-earlier equity to average
  })

  it('computes a peer with the same function and its own inputs', async () => {
    const peer = computeMetrics(await tvInput('NASDAQ:MSFT'))
    const msftNi = 36629 + 35766 + 31778 + 38458
    const msftRev = 92279 + 90007 + 82886 + 81273

    expect(peer.netMargin.today).toBeCloseTo((msftNi / msftRev) * 100, 9)
    expect(peer.netMargin.source).toBe('tradingview')
  })
})

describe('the two metrics Comparar adds (T7, S9)', () => {
  it('sales growth: the 12 months against the 12 months a year earlier, in USD; the same quarter or year before in the other modes', async () => {
    // MELI's six quarters plus its reported Q4 and Q3 2024 (as in the asOf test above).
    const row = historyRows.find((r) => r.s === 'NASDAQ:MELI')!
    const longer = { ...row, total_revenue_fq_h: [...row.total_revenue_fq_h, 6059e6, 5312e6], net_income_fq_h: [...row.net_income_fq_h, 639e6, 397e6] }
    const tv = (await fetchTvHistory(['NASDAQ:MELI'], 'america', answering(longer))).get('NASDAQ:MELI')!
    const m = computeMetrics({ ...(await tvInput('NASDAQ:MELI')), tv })
    const at = (s: Series, end: string) => s.find((p) => p.end === end)?.value

    // TTM to 2026-06-30: 35.182 M; TTM to 2025-06-30: 6.790 + 5.935 + 6.059 + 5.312 = 24.096 M.
    expect(m.revenueGrowth.today).toBeCloseTo((35182 / 24096 - 1) * 100, 1)
    expect(m.revenueGrowth.source).toBe('tradingview')
    expect(m.revenueGrowth.history.ttm).toEqual([{ end: '2026-06-30', value: m.revenueGrowth.today }, { end: TODAY, value: m.revenueGrowth.today }])
    expect(at(m.revenueGrowth.history.quarterly, '2026-06-30')).toBeCloseTo((10169 / 6790 - 1) * 100, 6)
    expect(at(m.revenueGrowth.history.quarterly, '2025-06-30')).toBeUndefined() // no quarter a year before it
  })

  it('sales growth of a peer comes from the same function, and an ARS reporter grows in dollars, not in pesos', () => {
    const ends = ['2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30']
    const usd = computeMetrics({ ...emptyInput(), tv: tvHistory('USD', ends, { revenue: [100, 100, 100, 100, 110, 120, 130, 140] }) })
    expect(usd.revenueGrowth.today).toBeCloseTo(25, 9) // 500 against 400

    // The same pesos every quarter while the CCL doubles: half the dollars, −50 %.
    const ccl = new Map(ends.map((e, i) => [e, i < 4 ? 1000 : 2000]))
    const ars = computeMetrics({ ...emptyInput(), rates: new Map([['ARS', ccl]]), tv: tvHistory('ARS', ends, { revenue: ends.map(() => 1e6) }) })
    expect(ars.revenueGrowth.today).toBeCloseTo(-50, 9)
    expect(ars.revenueGrowth.history.annual).toEqual([])
  })

  it('market cap: today\'s quote × listed units in USD, the one P/E divides; no history', async () => {
    const m = computeMetrics(await tvInput('NASDAQ:MELI'))

    expect(m.marketCap.today).toBeCloseTo(1660.13 * meliSnapshotRow.total_shares_outstanding, 0)
    expect(m.marketCap.today! / 1863e6).toBeCloseTo(m.pe.today!, 9)
    expect(m.marketCap).toMatchObject({ history: { quarterly: [], ttm: [], annual: [] }, since: null, asOf: null, source: 'snapshot' })

    // A BYMA listing: pesos at today's CCL; without a rate there is no dollar figure.
    const fields = { ...emptyInput().snapshot.fields, total_shares_outstanding: 400e6 }
    const byma = { ...emptyInput(), snapshot: { close: 40000, marketCap: 16e12, currency: 'ARS', fields } }
    expect(computeMetrics({ ...byma, rates: new Map([['ARS', new Map([['2026-10-29', 1500]])]]) }).marketCap.today).toBeCloseTo(16e12 / 1500, 0)
    expect(computeMetrics(byma).marketCap.today).toBeNull()
  })
})

describe('helpers', () => {
  const s = (pairs: [string, number][]): Series => pairs.map(([end, value]) => ({ end, value }))

  it('changeVsYearAgo: the last point against the same period a year before the one it is built on; points for percent, % for the rest', () => {
    const ttm = s([['2025-06-30', 8.5], ['2025-09-30', 7.9], ['2026-06-30', 5.3], [TODAY, 5.3]])

    expect(changeVsYearAgo(ttm, 'percent', '2026-06-30')).toBeCloseTo(-3.2, 9) // hoy is built on 2026-06-30: vs 2025-06-30
    expect(changeVsYearAgo(ttm.slice(0, 3), 'percent')).toBeCloseTo(-3.2, 9) // a period point is its own anchor
    expect(changeVsYearAgo(s([['2025-06-30', 40], [TODAY, 45]]), 'ratio', '2026-06-30')).toBeCloseTo(12.5, 9)
    expect(changeVsYearAgo(s([['2025-09-30', 40], [TODAY, 45]]), 'ratio', '2026-06-30')).toBeNull() // not the same period
    expect(changeVsYearAgo(s([['2024-06-30', 40], [TODAY, 45]]), 'ratio', '2026-06-30')).toBeNull() // two years is not one
    expect(changeVsYearAgo(s([['2025-06-30', -5], [TODAY, 45]]), 'ratio', '2026-06-30')).toBeNull()
    expect(changeVsYearAgo(s([['2024-12-28', 3], ['2025-12-31', 4]]), 'ratio')).toBeCloseTo(100 / 3, 9) // 52/53-week years drift
  })

  it("bestPoint: the highest or lowest point, by the metric's direction", () => {
    const history = s([['2024-12-31', 30], ['2025-12-31', 20], [TODAY, 25]])

    expect(bestPoint(history, 'lower')).toEqual({ end: '2025-12-31', value: 20 })
    expect(bestPoint(history, 'higher')).toEqual({ end: '2024-12-31', value: 30 })
    expect(bestPoint([], 'higher')).toBeNull()
  })

  it("peersMedian: the median of the peers' values, skipping the missing ones", () => {
    expect(peersMedian([19.6, null, 29, 26.5])).toBe(26.5)
    expect(peersMedian([19.6, 29, 26.5, 17])).toBeCloseTo(23.05, 9)
    expect(peersMedian([null])).toBeNull()
  })
})

function emptyInput(): MetricsInput {
  return {
    today: TODAY,
    snapshot: {
      close: 1660.13,
      marketCap: 84163279217,
      currency: 'USD',
      fields: Object.fromEntries(Object.keys(meliSnapshotRow).map((k) => [k, null])) as MetricsInput['snapshot']['fields'],
    },
    tv: null,
    yahoo: null,
    rates: new Map(),
    priceOn: () => 1000,
  }
}
