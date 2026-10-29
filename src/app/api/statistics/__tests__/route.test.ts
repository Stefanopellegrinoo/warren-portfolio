import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireUser = vi.fn()
// Ledger reads load the stock splits (odd/tasks/split-aware-ledger.md T3): none in these tests.
vi.mock('@/lib/stock-splits', () => ({ loadSplits: async () => new Map() }))
// An ON in the ledger reads its schedule, a market table, with the service role: it serves the same fixture.
const h = vi.hoisted(() => ({ market: null as any }))
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => h.market }))
vi.mock('@/lib/api-auth', () => ({
  requireUser: async () => { const r = await mockRequireUser(); h.market = r?.supabase; return r },
  isAuthFailure: (r: any) => 'error' in r,
}))

const mockGetCachedRoute = vi.fn()
const mockCacheRoute = vi.fn()
vi.mock('@/lib/redis', () => ({
  getCachedRoute: (...args: unknown[]) => mockGetCachedRoute(...args),
  cacheRoute: (...args: unknown[]) => mockCacheRoute(...args),
}))

const mockGetDerivedSeries = vi.fn()
vi.mock('@/lib/derived-series', () => ({
  getDerivedSeries: (...args: unknown[]) => mockGetDerivedSeries(...args),
}))
/** The derived series the route reads: rows, the core's automatic ON payments and the deposits and withdrawals the rows were built from. */
const mockSeries = (rows: unknown[], income: unknown[] = [], degraded = false, externalFlows: unknown[] = [], fundedDeposits: unknown = null) =>
  mockGetDerivedSeries.mockResolvedValue({ rows, income, degraded, flags: {}, externalFlows, fundedDeposits })

// Tripwire: statistics no longer read portfolio_snapshots.
const mockFetchSnapshotSeries = vi.fn()
vi.mock('@/lib/snapshot-series', () => ({
  fetchSnapshotSeries: (...args: unknown[]) => mockFetchSnapshotSeries(...args),
}))

// fetchQuotes reads the cache only; fetchQuotesWithFallback also asks Yahoo for what is missing (S2).
const mockFetchQuotes = vi.fn(async (_tickers: string[]) => new Map())
const mockFetchQuotesWithFallback = vi.fn(async (_tickers: string[]) => new Map())
vi.mock('@/lib/yahoo-finance', () => ({
  fetchQuotes: (...a: unknown[]) => mockFetchQuotes(...(a as [string[]])),
  fetchQuotesWithFallback: (...a: unknown[]) => mockFetchQuotesWithFallback(...(a as [string[]])),
}))
const quote = (ticker: string, price: number) => ({ ticker, price, change: 0, changePercent: 0, previousClose: price })

const mockFetchFlowTransactions = vi.fn()
vi.mock('@/lib/flow-transactions', () => ({
  fetchFlowTransactions: (...args: unknown[]) => mockFetchFlowTransactions(...args),
}))

const mockFetchIncomeMovements = vi.fn()
vi.mock('@/lib/cash-flows', () => ({
  fetchIncomeMovements: (...args: unknown[]) => mockFetchIncomeMovements(...args),
}))

const mockFetchBenchmarkComparison = vi.fn()
vi.mock('@/lib/benchmark', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/benchmark')>()),
  fetchBenchmarkComparison: (...args: unknown[]) => mockFetchBenchmarkComparison(...args),
}))

const { GET } = await import('../route')

const { ledgerSupabase, trade } = await import('@/lib/__tests__/fixtures/ledger-supabase')
/** An empty ledger; the fake throws on any stored derived table (T4.2b). */
const fakeSupabase = (tables = {}) => ledgerSupabase(tables)

// The route reads `req.nextUrl.searchParams` (universe param), which only
// exists on a real NextRequest — a plain Request cast to the type has no
// `nextUrl` and would throw at runtime. Matches the NextRequest construction
// used elsewhere in the codebase for query-param routes (e.g. watchlist).
function makeRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, 'http://test.local'))
}

function request(): NextRequest {
  return makeRequest('/api/statistics')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireUser.mockResolvedValue({ supabase: fakeSupabase(), user: { id: 'u1' } })
  mockGetCachedRoute.mockResolvedValue(null)
  mockCacheRoute.mockResolvedValue(undefined)
  mockSeries([])
  mockFetchFlowTransactions.mockResolvedValue([])
  mockFetchIncomeMovements.mockResolvedValue([])
  mockFetchQuotesWithFallback.mockResolvedValue(new Map())
})

describe('GET /api/statistics — allocation and trade stats from the ledger core', () => {
  it('values allocation at cost without a quote and realizes a sale the stored table missed (L8)', async () => {
    mockRequireUser.mockResolvedValue({
      supabase: fakeSupabase({ transactions: [
        trade(),
        trade({ ticker: 'VIST', quantity: 100, price: 43.64, date: '2026-03-02' }),
        trade({ ticker: 'VIST', operation: 'VENTA', quantity: 57.333333, price: 64.8508, date: '2026-04-09' }),
      ] }),
      user: { id: 'u1' },
    })

    const body = await (await GET(request())).json()

    expect(body.realizedPnl).toBeCloseTo(1216.09, 2)
    expect(body.totalTrades).toBe(1)
    expect(body.avgHoldingDays).toBe(38)
    expect(body.cumulativePnl).toMatchObject([{ date: '2026-04-09', ticker: 'VIST' }])
    expect(body.allocation.map((a: any) => a.name)).toEqual(['VIST', 'AAPL'])
    expect(body.totalPortfolioValue).toBeCloseTo(1000 + 42.666667 * 43.64, 2)
    expect(body.unpricedPositions).toBe(2)
    expect(body.unpricedTickers).toEqual(['VIST', 'AAPL'])
  })

  it('values a stock missing from the quote cache with the quote the dashboard fetches (S2)', async () => {
    mockRequireUser.mockResolvedValue({ supabase: fakeSupabase({ transactions: [trade()] }), user: { id: 'u1' } })
    mockFetchQuotesWithFallback.mockResolvedValue(new Map([['AAPL', quote('AAPL', 120)]]))

    const body = await (await GET(makeRequest('/api/statistics?universe=stocks'))).json()

    expect(mockFetchQuotesWithFallback).toHaveBeenCalledWith(['AAPL'])
    expect(mockFetchQuotes).not.toHaveBeenCalled()
    expect(body.totalPortfolioValue).toBe(1200)
    expect(body.openPnl).toBe(200)
    expect(body.unpricedPositions).toBe(0)
    expect(body.unpricedTickers).toEqual([])
  })

  it('counts the stocks\' dividends in the realized result and in each asset\'s bar, never an ON coupon (S7)', async () => {
    mockRequireUser.mockResolvedValue({
      supabase: fakeSupabase({ transactions: [
        trade(),
        trade({ operation: 'DIVIDENDO', quantity: 1, price: 4, date: '2026-02-10' }),
        trade({ ticker: 'VIST', quantity: 100, price: 43.64, date: '2026-03-02' }),
        trade({ ticker: 'VIST', operation: 'VENTA', quantity: 57.333333, price: 64.8508, date: '2026-04-09' }),
        trade({ ticker: 'ONA', asset_type: 'ON', quantity: 10, price: 95 }),
        trade({ ticker: 'ONA', operation: 'CUPON', quantity: 1, price: 7, asset_type: null }),
      ] }),
      user: { id: 'u1' },
    })

    const body = await (await GET(makeRequest('/api/statistics?universe=stocks'))).json()

    expect(body.incomeReceived).toBe(4)
    expect(body.realizedPnl).toBeCloseTo(1216.09 + 4, 2)
    // One bar per asset, open + sales + income: VIST's sale, AAPL's dividend (both unpriced: open 0).
    expect(body.allPnLs).toHaveLength(2)
    expect(body.allPnLs[0]).toMatchObject({ ticker: 'VIST' })
    expect(body.allPnLs[0].pnl).toBeCloseTo(1216.09, 2)
    expect(body.allPnLs[1]).toEqual({ ticker: 'AAPL', pnl: 4 })
  })

  it('has no worst operation when nothing lost, and no averages or holding days without sales — null, never 0 (S7)', async () => {
    mockRequireUser.mockResolvedValue({ supabase: fakeSupabase({ transactions: [trade()] }), user: { id: 'u1' } })
    mockFetchQuotesWithFallback.mockResolvedValue(new Map([['AAPL', quote('AAPL', 120)]]))

    const body = await (await GET(makeRequest('/api/statistics?universe=stocks'))).json()

    expect(body.biggestWinner).toMatchObject({ ticker: 'AAPL', pnl: 200, status: 'OPEN' })
    expect(body.biggestLoser).toBeNull()
    expect(body).toMatchObject({
      avgWin: null, avgLoss: null, avgHoldingDays: null, minHoldingDays: null, maxHoldingDays: null,
      monthlyReturns: [], totalTrades: 0,
    })
  })
})

describe('GET /api/statistics — which universes need the transaction list', () => {
  // This pins the WIRING half of the ON-boundary fix. The pure module can be
  // perfectly correct and the screen still wrong if the route hands it an
  // empty transaction list — which is exactly what shipped, and what no unit
  // test could see. Narrowing this condition back to `stocks || ons` returns
  // the General tab to a fabricated -10% day.
  it('fetches transactions for stocks and for ons', async () => {
    await GET(makeRequest('/api/statistics?universe=stocks'))
    expect(mockFetchFlowTransactions).toHaveBeenCalledTimes(1)
    await GET(makeRequest('/api/statistics?universe=ons'))
    expect(mockFetchFlowTransactions).toHaveBeenCalledTimes(2)
  })

  it('does NOT fetch transactions for total — every trade is internal to it', async () => {
    await GET(makeRequest('/api/statistics?universe=total'))
    expect(mockFetchFlowTransactions).not.toHaveBeenCalled()
  })

  it('passes the fetched transactions through to the risk computation', async () => {
    // Discriminates "fetched" from "fetched and used": an ON purchase inside
    // the ons universe must move the metrics. Without the flow the 25,000
    // purchase reads as a gain then nothing; with it, the interval is flat.
    const breakdown = (date: string, ons: number) => ({
      snapshot_date: date, total_value: 130000, total_invested: 100000,
      stocks_value: 100000, stocks_invested: 100000,
      ons_value: ons, ons_invested: ons, cash_value: 30000 - ons,
    })
    // Three points, because maxDrawdown needs MIN_INTERVALS_DRAWDOWN = 2.
    mockSeries([
      breakdown('2026-07-01', 30000),
      breakdown('2026-07-02', 5000),
      breakdown('2026-07-03', 5000),
    ])
    mockFetchFlowTransactions.mockResolvedValue([
      { date: '2026-07-02', operation: 'VENTA', quantity: -250, price: 100, commission: 0, asset_type: 'ON' },
    ])

    const body = await (await GET(makeRequest('/api/statistics?universe=ons'))).json()
    // 30,000 -> 5,000 with a -25,000 declared outflow (the sale) is a flat interval.
    expect(body.maxDrawdown).toBe(0)
  })

  it('passes the derived series\' external flows through to `total` — its ONLY flow input (S10)', async () => {
    // `total` has no transactions or income fetch (every trade and payment is
    // internal to it) — externalFlows (deposits/withdrawals) is the SOLE flow
    // source for this universe (asset-universe.ts:247, `universeFlows`
    // returns externalFlows unmodified for `total`). The series' flows default
    // to [] everywhere else in this file, so a route that dropped them — e.g.
    // `const externalFlows: ExternalFlow[] = []` — would leave every other test
    // green. They come with the rows they were built from: one read, one set of
    // movements (S10).
    mockSeries([
      { snapshot_date: '2026-07-01', total_value: 100000, total_invested: 100000 },
      { snapshot_date: '2026-07-02', total_value: 75000, total_invested: 100000 },
      { snapshot_date: '2026-07-03', total_value: 75000, total_invested: 100000 },
    ], [], false, [{ date: '2026-07-02', amount: -25000 }])

    const body = await (await GET(makeRequest('/api/statistics?universe=total'))).json()
    // 100,000 -> 75,000 with a declared -25,000 withdrawal is a flat interval.
    // Undeclared, that same day reads as a real -25% drawdown.
    expect(body.maxDrawdown).toBe(0)
  })
})

describe('GET /api/statistics — what a degraded series is missing (S11)', () => {
  it('passes the reasons through, so the screen can say which price was missing', async () => {
    mockGetDerivedSeries.mockResolvedValue({
      rows: [{ snapshot_date: '2026-07-01', total_value: 100, total_invested: 100 }], income: [], flags: {}, externalFlows: [], fundedDeposits: null,
      degraded: true, degradedReasons: [{ kind: 'today_unpriced', tickers: ['NVDA'] }],
    })
    const body = await (await GET(makeRequest('/api/statistics?universe=total'))).json()
    expect(body.degraded).toBe(true)
    expect(body.degradedReasons).toEqual([{ kind: 'today_unpriced', tickers: ['NVDA'] }])
  })
})

describe('GET /api/statistics — deposits moved to the purchases they paid (S10)', () => {
  it('says how much deposit money was moved and from when', async () => {
    mockSeries([{ snapshot_date: '2026-07-01', total_value: 100, total_invested: 100 }], [], false, [], { amount: 1234.56, from: '2023-05-02' })
    const body = await (await GET(makeRequest('/api/statistics?universe=total'))).json()
    expect(body.fundedDeposits).toEqual({ amount: 1234.56, from: '2023-05-02' })
  })
})

describe('GET /api/statistics — derived series', () => {
  it('reads the derived series, never portfolio_snapshots', async () => {
    await GET(request())
    expect(mockGetDerivedSeries).toHaveBeenCalledWith(expect.anything(), 'u1')
    expect(mockFetchSnapshotSeries).not.toHaveBeenCalled()
  })

  it('keeps the response shape, minus the retired provenance block', async () => {
    const body = await (await GET(request())).json()
    expect(Object.keys(body).sort()).toEqual([
      'allPnLs', 'allocation', 'annualizedVol', 'arsExposure', 'avgHoldingDays', 'avgLoss', 'avgWin', 'benchmark',
      'benchmarkError', 'biggestLoser', 'biggestWinner', 'cumulativePnl', 'degraded', 'degradedReasons', 'drawdownIntervals', 'drawdownIntervalsSkipped', 'fundedDeposits',
      'incomeReceived', 'losersCount', 'maxDrawdown', 'measuredDays', 'measuredFrom', 'negativeCashUntil', 'unavailableReason', 'maxHoldingDays', 'minHoldingDays', 'monthlyReturns', 'monthlyStdDev', 'openPnl',
      'profitFactor', 'realizedPnl', 'returnIntervals', 'sharpeRatio', 'totalPortfolioValue', 'totalTrades',
      'universe', 'unpricedPositions', 'unpricedTickers', 'usdExposure', 'winRate', 'winnersCount',
    ].sort())
  })

  it('serves a degraded series without caching it', async () => {
    mockSeries([], [], true)
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(mockCacheRoute).not.toHaveBeenCalled()
  })

  it('bumps the cache key so a stale v3 payload cannot serve without income declared', async () => {
    // v4: the payload gained income-adjusted risk metrics (this branch). Without
    // the bump, a cached v3 entry (no income folded into the flows) would serve
    // for 300s and read a coupon as a fabricated gain or loss.
    await GET(request())

    expect(mockGetCachedRoute).toHaveBeenCalledWith('statistics:v4:u1:total')
    expect(mockCacheRoute).toHaveBeenCalledWith('statistics:v4:u1:total', expect.anything(), 300)
  })
})

describe('GET /api/statistics — universe parameter', () => {
  it('defaults to the whole portfolio (S9) and carries v4 + universe in the cache key', async () => {
    const res = await GET(makeRequest('/api/statistics'))
    expect(res.status).toBe(200)
    expect(mockGetCachedRoute).toHaveBeenCalledWith('statistics:v4:u1:total')
    const body = await res.json()
    expect(body.universe).toBe('total')
  })

  it('treats the retired measurable universe as the whole portfolio (old clients and cached URLs)', async () => {
    const res = await GET(makeRequest('/api/statistics?universe=measurable'))
    expect(res.status).toBe(200)
    expect(mockGetCachedRoute).toHaveBeenCalledWith('statistics:v4:u1:total')
    expect((await res.json()).universe).toBe('total')
    expect(mockFetchFlowTransactions).not.toHaveBeenCalled()
  })

  it('accepts each valid universe in the key', async () => {
    for (const u of ['total', 'stocks', 'ons']) {
      vi.clearAllMocks()
      mockRequireUser.mockResolvedValue({ supabase: fakeSupabase(), user: { id: 'u1' } })
      mockGetCachedRoute.mockResolvedValue(null)
      mockSeries([])
      mockFetchIncomeMovements.mockResolvedValue([])
      const res = await GET(makeRequest(`/api/statistics?universe=${u}`))
      expect(res.status).toBe(200)
      expect(mockGetCachedRoute).toHaveBeenCalledWith(`statistics:v4:u1:${u}`)
    }
  })

  it('rejects an unknown universe with 400 instead of silently defaulting', async () => {
    const res = await GET(makeRequest('/api/statistics?universe=banana'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Elegí qué ver: toda la cartera, acciones u ONs')
    expect(mockCacheRoute).not.toHaveBeenCalled()
  })

  it('below-threshold data returns null metrics, never 0', async () => {
    mockSeries([
      { snapshot_date: '2026-07-01', total_value: 1000, total_invested: 800,
        stocks_value: 600, stocks_invested: 500, ons_value: 300, ons_invested: 300,
        cash_value: 100 },
      { snapshot_date: '2026-07-02', total_value: 1010, total_invested: 800,
        stocks_value: 610, stocks_invested: 500, ons_value: 300, ons_invested: 300,
        cash_value: 100 },
    ])
    const res = await GET(makeRequest('/api/statistics'))
    const body = await res.json()
    expect(body.maxDrawdown).toBeNull() // 1 interval < 2
    expect(body.sharpeRatio).toBeNull()
    expect(body.annualizedVol).toBeNull()
  })
})

describe('GET /api/statistics — income reaches the risk computation', () => {
  /** 22 live days so the A3 annualized threshold (20 intervals) is cleared.
   *  Everything is flat except day 10, when the ONs pay a coupon: ons_value
   *  falls by 8,300 and cash rises by 8,300, permanently. So `total` stays at
   *  228,300 and `ons` falls once — pure accounting either way.
   *
   *  Assert on annualizedVol, NOT maxDrawdown: a series that only ever rises
   *  has zero drawdown whether or not the jump is declared, so a drawdown
   *  assertion here would pass in BOTH worlds and prove nothing. */
  const COUPON_DAY = '2026-07-10'
  const day = (i: number) => new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10)
  const series = (days = 22) =>
    Array.from({ length: days }, (_, i) => {
      const paid = i >= 9
      return {
        snapshot_date: day(i),
        total_value: 228300,
        total_invested: 200000,
        stocks_value: 100000, stocks_invested: 100000,
        ons_value: paid ? 91700 : 100000, ons_invested: 100000,
        cash_value: paid ? 28300 : 20000,
      }
    })
  const COUPON = [{ date: COUPON_DAY, type: 'CUPON' as const, amount: 8300 }]

  /** Mirrors `series()` above but the leg that falls on the payment date is
   *  STOCKS instead of ONs — this is the fixture for the DIVIDENDO discriminating
   *  pair below, which pins income wiring for the `stocks` universe specifically
   *  (asset-universe.ts:270 nets DIVIDENDO against stocks, sign -1). */
  const stockSeries = () =>
    Array.from({ length: 22 }, (_, i) => {
      const paid = i >= 9
      return {
        snapshot_date: `2026-07-${String(i + 1).padStart(2, '0')}`,
        total_value: 228300,
        total_invested: 200000,
        stocks_value: paid ? 91700 : 100000, stocks_invested: 100000,
        ons_value: 100000, ons_invested: 100000,
        cash_value: paid ? 28300 : 20000,
      }
    })
  const DIVIDEND = [{ date: COUPON_DAY, type: 'DIVIDENDO' as const, amount: 8300 }]

  it('declares the coupon as an outflow from ons — the price fall is not a loss', async () => {
    mockSeries(series())
    mockFetchIncomeMovements.mockResolvedValue(COUPON)

    const body = await (await GET(makeRequest('/api/statistics?universe=ons'))).json()
    expect(body.maxDrawdown).toBe(0)
  })

  it('without the coupon declared, ons records the payment as a drawdown', async () => {
    mockSeries(series())
    mockFetchIncomeMovements.mockResolvedValue([])

    const body = await (await GET(makeRequest('/api/statistics?universe=ons'))).json()
    // ons_value 100,000 -> 91,700 with nothing declared: -8.3%.
    expect(body.maxDrawdown).toBeLessThan(-0.08)
  })

  it('declares the dividend as an outflow from stocks — the price fall is not a loss', async () => {
    // Pins income wiring for `stocks` specifically. Narrowing route.ts's
    // universe guard to exclude `stocks` (income keeps fetching for
    // ons but stops for stocks) would leave every OTHER test in
    // this file green — this is the one that would catch it, because it
    // asserts the VALUE the fetched income produces, not just that the fetch
    // was called.
    mockSeries(stockSeries())
    mockFetchIncomeMovements.mockResolvedValue(DIVIDEND)

    const body = await (await GET(makeRequest('/api/statistics?universe=stocks'))).json()
    expect(body.maxDrawdown).toBe(0)
  })

  it('without the dividend declared, stocks records the payment as a drawdown', async () => {
    mockSeries(stockSeries())
    mockFetchIncomeMovements.mockResolvedValue([])

    const body = await (await GET(makeRequest('/api/statistics?universe=stocks'))).json()
    // stocks_value 100,000 -> 91,700 with nothing declared: -8.3%.
    expect(body.maxDrawdown).toBeLessThan(-0.08)
  })

  const coreIncome = (kind: 'coupon' | 'amortization') =>
    [{ ticker: 'XD', date: COUPON_DAY, kind, amount: 8300, source: 'schedule' }]

  it('an automatic coupon or amortization is neither a gain nor a loss of the whole portfolio (S9)', async () => {
    // Inside `total` the ON leg and the cash leg move together; only deposits
    // and withdrawals cross its boundary, so nothing about the payment is declared.
    for (const kind of ['coupon', 'amortization'] as const) {
      // 61 days: volatility needs 60 returns before it shows a number (S5).
      mockSeries(series(61), coreIncome(kind))
      const body = await (await GET(makeRequest('/api/statistics?universe=total'))).json()
      expect(body.returnIntervals).toBe(60)
      expect(body.annualizedVol).toBe(0)
      expect(body.maxDrawdown).toBe(0)
    }
  })

  it('declares an automatic amortization from the core as capital leaving ons — not a loss', async () => {
    mockSeries(series(), coreIncome('amortization'))
    const body = await (await GET(makeRequest('/api/statistics?universe=ons'))).json()
    expect(body.maxDrawdown).toBe(0)
    expect(body.drawdownIntervalsSkipped).toBe(0)
  })

  it('fetches income for every universe except total', async () => {
    await GET(makeRequest('/api/statistics?universe=total'))
    expect(mockFetchIncomeMovements).not.toHaveBeenCalled()
    await GET(makeRequest('/api/statistics?universe=stocks'))
    expect(mockFetchIncomeMovements).toHaveBeenCalledTimes(1)
    await GET(makeRequest('/api/statistics?universe=ons'))
    expect(mockFetchIncomeMovements).toHaveBeenCalledTimes(2)
  })

  it('returns 500 when the income fetch fails — an empty list would fabricate a gain', async () => {
    mockFetchIncomeMovements.mockRejectedValue(new Error('boom'))
    const res = await GET(makeRequest('/api/statistics?universe=ons'))
    expect(res.status).toBe(500)
  })

  it('uses the v4 cache key', async () => {
    await GET(makeRequest('/api/statistics?universe=ons'))
    expect(mockCacheRoute.mock.calls[0][0]).toBe('statistics:v4:u1:ons')
    expect(mockGetCachedRoute.mock.calls[0][0]).toBe('statistics:v4:u1:ons')
  })
})

describe('GET /api/statistics — benchmark param', () => {
  it('compares the TWR of the derived series against the benchmark', async () => {
    mockFetchBenchmarkComparison.mockResolvedValue({ id: 'SPY' })
    mockSeries([
      { snapshot_date: '2026-07-01', total_value: 100, total_invested: 100 },
      { snapshot_date: '2026-07-02', total_value: 110, total_invested: 100 },
    ])
    const body = await (await GET(makeRequest('/api/statistics?universe=total&benchmark=SPY'))).json()
    expect(body.benchmarkError).toBe(false)
    expect(mockFetchBenchmarkComparison.mock.calls[0][1].map((p: { date: string }) => p.date)).toEqual(['2026-07-01', '2026-07-02'])
  })

  it('rejects a benchmark outside the whitelist with 400, before any fetch', async () => {
    const res = await GET(makeRequest('/api/statistics?universe=total&benchmark=%5EGSPC%3Bevil'))
    expect(res.status).toBe(400)
    expect(mockGetDerivedSeries).not.toHaveBeenCalled()
  })
})

describe('GET /api/statistics — independent reads run together', () => {
  it('asks the series, the flows and the portfolio together, then the benchmark and the quotes together', async () => {
    const log: string[] = []
    mockRequireUser.mockResolvedValue({ supabase: ledgerSupabase({ transactions: [trade()] }, log), user: { id: 'u1' } })
    let answerSeries!: (v: unknown) => void
    mockGetDerivedSeries.mockReturnValue(new Promise(r => { answerSeries = r }))
    let answerBenchmark!: (v: unknown) => void
    mockFetchBenchmarkComparison.mockReturnValue(new Promise(r => { answerBenchmark = r }))

    const pending = GET(makeRequest('/api/statistics?universe=stocks&benchmark=SPY'))
    // The series has not answered yet: the flows and the ledger read have started.
    await vi.waitFor(() => {
      expect(mockFetchFlowTransactions).toHaveBeenCalledTimes(1)
      expect(mockFetchIncomeMovements).toHaveBeenCalledTimes(1)
      expect(log).toContain('transactions')
    })
    answerSeries({ rows: [], income: [], degraded: false, flags: {}, externalFlows: [], fundedDeposits: null })
    // The benchmark has not answered yet: the quotes are already asked for.
    await vi.waitFor(() => expect(mockFetchQuotesWithFallback).toHaveBeenCalledWith(['AAPL']))
    answerBenchmark(null)

    const res = await pending
    expect(res.status).toBe(200)
    expect((await res.json()).benchmarkError).toBe(false)
  })
})
