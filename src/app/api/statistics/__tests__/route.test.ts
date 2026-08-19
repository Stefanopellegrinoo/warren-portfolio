import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: () => mockRequireUser(),
  isAuthFailure: (r: any) => 'error' in r,
}))

const mockGetCachedRoute = vi.fn()
const mockCacheRoute = vi.fn()
vi.mock('@/lib/redis', () => ({
  getCachedRoute: (...args: unknown[]) => mockGetCachedRoute(...args),
  cacheRoute: (...args: unknown[]) => mockCacheRoute(...args),
}))

const mockFetchSnapshotSeries = vi.fn()
vi.mock('@/lib/snapshot-series', () => ({
  fetchSnapshotSeries: (...args: unknown[]) => mockFetchSnapshotSeries(...args),
}))

vi.mock('@/lib/yahoo-finance', () => ({
  fetchQuotes: () => Promise.resolve(new Map()),
}))

const mockFetchFlowTransactions = vi.fn()
vi.mock('@/lib/flow-transactions', () => ({
  fetchFlowTransactions: (...args: unknown[]) => mockFetchFlowTransactions(...args),
}))

const mockFetchExternalFlows = vi.fn()
const mockFetchIncomeMovements = vi.fn()
vi.mock('@/lib/cash-flows', () => ({
  fetchExternalFlows: (...args: unknown[]) => mockFetchExternalFlows(...args),
  fetchIncomeMovements: (...args: unknown[]) => mockFetchIncomeMovements(...args),
}))

const { GET } = await import('../route')

function snap(date: string, source?: 'live' | 'estimated') {
  return {
    id: `id-${date}`,
    user_id: 'u1',
    snapshot_date: date,
    total_value: 1000,
    total_invested: 900,
    pnl: 100,
    pnl_pct: 0.111,
    ...(source ? { source } : {}),
  }
}

/** The route reads several tables; each returns an empty set unless overridden. */
function fakeSupabase() {
  const empty = { data: [], error: null }
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({ in: vi.fn(() => empty) })),
          order: vi.fn(() => empty),
          ...empty,
        })),
      })),
    })),
  }
}

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
  mockFetchSnapshotSeries.mockResolvedValue([])
  mockFetchFlowTransactions.mockResolvedValue([])
  mockFetchExternalFlows.mockResolvedValue([])
  mockFetchIncomeMovements.mockResolvedValue([])
})

describe('GET /api/statistics — which universes need the transaction list', () => {
  // This pins the WIRING half of the ON-boundary fix. The pure module can be
  // perfectly correct and the screen still wrong if the route hands it an
  // empty transaction list — which is exactly what shipped, and what no unit
  // test could see. Narrowing this condition back to `stocks || ons` returns
  // the General tab to a fabricated -10% day.
  it('fetches transactions for measurable — ON trades cross ITS boundary', async () => {
    await GET(makeRequest('/api/statistics?universe=measurable'))
    expect(mockFetchFlowTransactions).toHaveBeenCalledTimes(1)
  })

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
    // the measurable universe must move the metrics. Without the flow the
    // 25,125 purchase reads as a loss; with it, the interval is flat.
    const breakdown = (date: string, stocks: number, cash: number) => ({
      snapshot_date: date, total_value: stocks + cash, total_invested: stocks,
      stocks_value: stocks, stocks_invested: stocks,
      ons_value: 0, ons_invested: 0, cash_value: cash, source: 'live' as const,
    })
    // Three points, because maxDrawdown needs MIN_INTERVALS_DRAWDOWN = 2.
    mockFetchSnapshotSeries.mockResolvedValue([
      breakdown('2026-07-01', 100000, 30000),
      breakdown('2026-07-02', 100000, 5000),
      breakdown('2026-07-03', 100000, 5000),
    ])
    mockFetchFlowTransactions.mockResolvedValue([
      { date: '2026-07-02', operation: 'COMPRA', quantity: 250, price: 100, commission: 0, asset_type: 'ON' },
    ])

    const body = await (await GET(makeRequest('/api/statistics?universe=measurable'))).json()
    // 130,000 -> 105,000 with a -25,000 declared outflow is a flat interval.
    expect(body.maxDrawdown).toBe(0)
  })

  it('passes the fetched external flows through to `total` — its ONLY flow input', async () => {
    // `total` has no transactions or income fetch (every trade and payment is
    // internal to it) — externalFlows (deposits/withdrawals) is the SOLE flow
    // source for this universe (asset-universe.ts:247, `universeFlows`
    // returns externalFlows unmodified for `total`). mockFetchExternalFlows
    // is defaulted to [] and never otherwise asserted in this file, so a
    // route that fetched it and threw the result away — e.g. reverted to
    // `const externalFlows: ExternalFlow[] = []` — would leave every other
    // test here green.
    mockFetchSnapshotSeries.mockResolvedValue([
      { snapshot_date: '2026-07-01', total_value: 100000, total_invested: 100000 },
      { snapshot_date: '2026-07-02', total_value: 75000, total_invested: 100000 },
      { snapshot_date: '2026-07-03', total_value: 75000, total_invested: 100000 },
    ])
    mockFetchExternalFlows.mockResolvedValue([{ date: '2026-07-02', amount: -25000 }])

    const body = await (await GET(makeRequest('/api/statistics?universe=total'))).json()
    // 100,000 -> 75,000 with a declared -25,000 withdrawal is a flat interval.
    // Undeclared, that same day reads as a real -25% drawdown.
    expect(body.maxDrawdown).toBe(0)
  })
})

describe('GET /api/statistics — provenance', () => {
  // Provenance is now computed over the requested universe's metric rows.
  // `total` needs only total_value/total_invested — the same shape `snap()`
  // has always produced — so these tests request it explicitly rather than
  // relying on the `measurable` default, which needs the per-asset-class
  // breakdown fields these fixtures don't set.
  it('reports how much of the series was reconstructed', async () => {
    mockFetchSnapshotSeries.mockResolvedValue([
      snap('2026-04-10', 'estimated'),
      snap('2026-04-11', 'estimated'),
      snap('2026-07-27', 'live'),
    ])

    const res = await GET(makeRequest('/api/statistics?universe=total'))
    const body = await res.json()

    expect(body.provenance).toEqual({
      totalDays: 3,
      liveDays: 1,
      estimatedDays: 2,
      hasEstimated: true,
      firstDate: '2026-04-10',
      lastDate: '2026-07-27',
    })
  })

  it('reports an all-measured series without raising a flag', async () => {
    mockFetchSnapshotSeries.mockResolvedValue([snap('2026-07-27', 'live'), snap('2026-07-28')])

    const res = await GET(makeRequest('/api/statistics?universe=total'))
    const body = await res.json()

    expect(body.provenance.hasEstimated).toBe(false)
    expect(body.provenance.liveDays).toBe(2)
  })

  it('bumps the cache key so a stale v3 payload cannot serve without income declared', async () => {
    // v4: the payload gained income-adjusted risk metrics (this branch). Without
    // the bump, a cached v3 entry (no income folded into the flows) would serve
    // for 300s and read a coupon as a fabricated gain or loss.
    await GET(request())

    expect(mockGetCachedRoute).toHaveBeenCalledWith('statistics:v4:u1:measurable')
    expect(mockCacheRoute).toHaveBeenCalledWith('statistics:v4:u1:measurable', expect.anything(), 300)
  })
})

describe('GET /api/statistics — universe parameter', () => {
  it('defaults to measurable and carries v4 + universe in the cache key', async () => {
    const res = await GET(makeRequest('/api/statistics'))
    expect(res.status).toBe(200)
    expect(mockGetCachedRoute).toHaveBeenCalledWith('statistics:v4:u1:measurable')
    const body = await res.json()
    expect(body.universe).toBe('measurable')
  })

  it('accepts each valid universe in the key', async () => {
    for (const u of ['total', 'measurable', 'stocks', 'ons']) {
      vi.clearAllMocks()
      mockRequireUser.mockResolvedValue({ supabase: fakeSupabase(), user: { id: 'u1' } })
      mockGetCachedRoute.mockResolvedValue(null)
      mockFetchSnapshotSeries.mockResolvedValue([])
      mockFetchExternalFlows.mockResolvedValue([])
      mockFetchIncomeMovements.mockResolvedValue([])
      const res = await GET(makeRequest(`/api/statistics?universe=${u}`))
      expect(res.status).toBe(200)
      expect(mockGetCachedRoute).toHaveBeenCalledWith(`statistics:v4:u1:${u}`)
    }
  })

  it('rejects an unknown universe with 400 instead of silently defaulting', async () => {
    const res = await GET(makeRequest('/api/statistics?universe=banana'))
    expect(res.status).toBe(400)
    expect(mockCacheRoute).not.toHaveBeenCalled()
  })

  it('below-threshold data returns null metrics, never 0', async () => {
    mockFetchSnapshotSeries.mockResolvedValue([
      { snapshot_date: '2026-07-01', total_value: 1000, total_invested: 800,
        stocks_value: 600, stocks_invested: 500, ons_value: 300, ons_invested: 300,
        cash_value: 100, source: 'live' },
      { snapshot_date: '2026-07-02', total_value: 1010, total_invested: 800,
        stocks_value: 610, stocks_invested: 500, ons_value: 300, ons_invested: 300,
        cash_value: 100, source: 'live' },
    ])
    const res = await GET(makeRequest('/api/statistics'))
    const body = await res.json()
    expect(body.maxDrawdown).toBeNull() // 1 interval < 2
    expect(body.sharpeRatio).toBeNull()
    expect(body.annualizedVol).toBeNull()
  })
})

describe('GET /api/statistics — provenance is universe-scoped', () => {
  it('measurable (default): drops a row missing the breakdown from provenance, not just from the risk metrics', async () => {
    // Regression guard: reverting the route's provenance expression back to
    // `summarizeProvenance(validSnapshots)` would count both rows here and
    // still pass under `?universe=total` (identity projection — nothing
    // dropped) — that's what the two provenance tests above hit. This test
    // pins the DEFAULT `measurable` universe, where the second row (no
    // breakdown fields) must be dropped from the "N días" note the same way
    // it is dropped from the risk metrics rendered beside it.
    mockFetchSnapshotSeries.mockResolvedValue([
      { snapshot_date: '2026-07-01', total_value: 1000, total_invested: 900,
        stocks_value: 600, stocks_invested: 500, ons_value: 300, ons_invested: 300,
        cash_value: 100, source: 'live' },
      { snapshot_date: '2026-07-02', total_value: 1010, total_invested: 910 },
    ])

    const res = await GET(makeRequest('/api/statistics'))
    const body = await res.json()

    expect(body.provenance.totalDays).toBe(1)
  })

  it('ons: excludes estimated rows from provenance, matching the measured-only metrics rule', async () => {
    // metricsRows() drops estimated rows for the ons universe BEFORE
    // projection — provenance must be computed over that same filtered set,
    // or the "M reconstruidos" note would claim a reconstructed day the
    // Sharpe/vol/drawdown figures beside it never used.
    mockFetchSnapshotSeries.mockResolvedValue([
      { snapshot_date: '2026-07-01', total_value: 1000, total_invested: 900,
        ons_value: 300, ons_invested: 300, source: 'estimated' },
      { snapshot_date: '2026-07-02', total_value: 1010, total_invested: 900,
        ons_value: 310, ons_invested: 300, source: 'live' },
    ])

    const res = await GET(makeRequest('/api/statistics?universe=ons'))
    const body = await res.json()

    expect(body.provenance.totalDays).toBe(1)
    expect(body.provenance.estimatedDays).toBe(0)
  })
})

describe('GET /api/statistics — income reaches the risk computation', () => {
  /** 22 live days so the A3 annualized threshold (20 intervals) is cleared.
   *  Everything is flat except day 10, when the ONs pay a coupon: ons_value
   *  falls by 8,300 and cash rises by 8,300, permanently. So `measurable`
   *  (stocks + cash) is 120,000 for nine days and 128,300 after — one jump,
   *  and it is pure accounting.
   *
   *  Assert on annualizedVol, NOT maxDrawdown: a series that only ever rises
   *  has zero drawdown whether or not the jump is declared, so a drawdown
   *  assertion here would pass in BOTH worlds and prove nothing. */
  const COUPON_DAY = '2026-07-10'
  const series = () =>
    Array.from({ length: 22 }, (_, i) => {
      const paid = i >= 9
      return {
        snapshot_date: `2026-07-${String(i + 1).padStart(2, '0')}`,
        total_value: 228300,
        total_invested: 200000,
        stocks_value: 100000, stocks_invested: 100000,
        ons_value: paid ? 91700 : 100000, ons_invested: 100000,
        cash_value: paid ? 28300 : 20000,
        source: 'live' as const,
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
        source: 'live' as const,
      }
    })
  const DIVIDEND = [{ date: COUPON_DAY, type: 'DIVIDENDO' as const, amount: 8300 }]

  it('declares the coupon as an inflow to measurable — the jump is not volatility', async () => {
    mockFetchSnapshotSeries.mockResolvedValue(series())
    mockFetchIncomeMovements.mockResolvedValue(COUPON)

    const body = await (await GET(makeRequest('/api/statistics?universe=measurable'))).json()
    expect(body.returnIntervals).toBe(21)
    expect(body.annualizedVol).toBe(0)
  })

  it('WITHOUT the coupon declared the same series manufactures volatility', async () => {
    mockFetchSnapshotSeries.mockResolvedValue(series())
    mockFetchIncomeMovements.mockResolvedValue([])

    const body = await (await GET(makeRequest('/api/statistics?universe=measurable'))).json()
    // One undeclared +6.92% day across 21 intervals, annualized by sqrt(252).
    // THIS is the assertion that discriminates: if it ever agrees with the
    // test above, the wiring is dead and nothing else will say so.
    expect(body.annualizedVol).toBeGreaterThan(0.2)
  })

  it('declares the coupon as an outflow from ons — the price fall is not a loss', async () => {
    mockFetchSnapshotSeries.mockResolvedValue(series())
    mockFetchIncomeMovements.mockResolvedValue(COUPON)

    const body = await (await GET(makeRequest('/api/statistics?universe=ons'))).json()
    expect(body.maxDrawdown).toBe(0)
  })

  it('without the coupon declared, ons records the payment as a drawdown', async () => {
    mockFetchSnapshotSeries.mockResolvedValue(series())
    mockFetchIncomeMovements.mockResolvedValue([])

    const body = await (await GET(makeRequest('/api/statistics?universe=ons'))).json()
    // ons_value 100,000 -> 91,700 with nothing declared: -8.3%.
    expect(body.maxDrawdown).toBeLessThan(-0.08)
  })

  it('declares the dividend as an outflow from stocks — the price fall is not a loss', async () => {
    // Pins income wiring for `stocks` specifically. Narrowing route.ts's
    // universe guard to exclude `stocks` (income keeps fetching for
    // measurable/ons but stops for stocks) would leave every OTHER test in
    // this file green — this is the one that would catch it, because it
    // asserts the VALUE the fetched income produces, not just that the fetch
    // was called.
    mockFetchSnapshotSeries.mockResolvedValue(stockSeries())
    mockFetchIncomeMovements.mockResolvedValue(DIVIDEND)

    const body = await (await GET(makeRequest('/api/statistics?universe=stocks'))).json()
    expect(body.maxDrawdown).toBe(0)
  })

  it('without the dividend declared, stocks records the payment as a drawdown', async () => {
    mockFetchSnapshotSeries.mockResolvedValue(stockSeries())
    mockFetchIncomeMovements.mockResolvedValue([])

    const body = await (await GET(makeRequest('/api/statistics?universe=stocks'))).json()
    // stocks_value 100,000 -> 91,700 with nothing declared: -8.3%.
    expect(body.maxDrawdown).toBeLessThan(-0.08)
  })

  it('fetches income for every universe except total', async () => {
    await GET(makeRequest('/api/statistics?universe=total'))
    expect(mockFetchIncomeMovements).not.toHaveBeenCalled()
    await GET(makeRequest('/api/statistics?universe=measurable'))
    expect(mockFetchIncomeMovements).toHaveBeenCalledTimes(1)
    await GET(makeRequest('/api/statistics?universe=stocks'))
    expect(mockFetchIncomeMovements).toHaveBeenCalledTimes(2)
    await GET(makeRequest('/api/statistics?universe=ons'))
    expect(mockFetchIncomeMovements).toHaveBeenCalledTimes(3)
  })

  it('returns 500 when the income fetch fails — an empty list would fabricate a gain', async () => {
    mockFetchIncomeMovements.mockRejectedValue(new Error('boom'))
    const res = await GET(makeRequest('/api/statistics?universe=measurable'))
    expect(res.status).toBe(500)
  })

  it('uses the v4 cache key', async () => {
    await GET(makeRequest('/api/statistics?universe=measurable'))
    expect(mockCacheRoute.mock.calls[0][0]).toBe('statistics:v4:u1:measurable')
    expect(mockGetCachedRoute.mock.calls[0][0]).toBe('statistics:v4:u1:measurable')
  })
})
