import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireUser = vi.fn()
// Market tables are read with the service role (odd/tasks/security-hardening.md S12): the service
// client serves the same fixture the session does.
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
const mockSeries = (rows: unknown[], income: unknown[] = [], degraded = false) =>
  mockGetDerivedSeries.mockResolvedValue({ rows, income, degraded, flags: {} })

// Tripwire: statistics no longer read portfolio_snapshots.
const mockFetchSnapshotSeries = vi.fn()
vi.mock('@/lib/snapshot-series', () => ({
  fetchSnapshotSeries: (...args: unknown[]) => mockFetchSnapshotSeries(...args),
}))

vi.mock('@/lib/data912-client', () => ({
  fetchONQuotes: () => Promise.resolve(new Map()),
}))

const mockFetchFlowTransactions = vi.fn()
vi.mock('@/lib/flow-transactions', () => ({
  fetchFlowTransactions: (...args: unknown[]) => mockFetchFlowTransactions(...args),
}))

const mockFetchIncomeMovements = vi.fn()
vi.mock('@/lib/cash-flows', () => ({
  fetchIncomeMovements: (...args: unknown[]) => mockFetchIncomeMovements(...args),
}))

const { GET } = await import('../route')

const ONS_ROWS = [
  { snapshot_date: '2026-07-24', total_value: 1020, total_invested: 800,
    stocks_value: 600, stocks_invested: 500, ons_value: 320, ons_invested: 300, cash_value: 100 },
  { snapshot_date: '2026-07-25', total_value: 1021, total_invested: 800,
    stocks_value: 600, stocks_invested: 500, ons_value: 321, ons_invested: 300, cash_value: 100 },
  { snapshot_date: '2026-07-28', total_value: 1019, total_invested: 800,
    stocks_value: 600, stocks_invested: 500, ons_value: 319, ons_invested: 300, cash_value: 100 },
]

const { ledgerSupabase, trade } = await import('@/lib/__tests__/fixtures/ledger-supabase')
/** An empty ledger; the fake throws on any stored derived table (T4.2b). */
const fakeSupabase = (tables = {}) => ledgerSupabase(tables)

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireUser.mockResolvedValue({ supabase: fakeSupabase(), user: { id: 'u1' } })
  mockGetCachedRoute.mockResolvedValue(null)
  mockCacheRoute.mockResolvedValue(undefined)
  mockSeries([])
  mockFetchFlowTransactions.mockResolvedValue([])
  mockFetchIncomeMovements.mockResolvedValue([])
})

describe('GET /api/statistics/ons — positions and trades from the ledger core', () => {
  it('values an unquoted ON at its last close and counts its realized sale', async () => {
    const on = (over: Record<string, unknown>) => trade({ ticker: 'ONA', asset_type: 'ON', quantity: 10, price: 95, ...over })
    mockRequireUser.mockResolvedValue({
      supabase: fakeSupabase({
        transactions: [on({}), on({ operation: 'VENTA', quantity: 4, price: 100, date: '2026-01-10' })],
        on_price_history: [{ ticker: 'ONA', price_date: '2026-01-20', close: 98 }],
      }),
      user: { id: 'u1' },
    })

    const body = await (await GET()).json()

    expect(body.totalPortfolioValue).toBeCloseTo(6 * 98)
    expect(body.openPnl).toBeCloseTo(6 * 3)
    expect(body.realizedPnl).toBeCloseTo(20)
    expect(body.allPnLs.map((p: any) => p.status)).toEqual(['CLOSED', 'OPEN'])
    expect(body.avgHoldingDays).toBe(5)
  })
})

describe('GET /api/statistics/ons — computed risk metrics', () => {
  it('uses the v3 cache key', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(mockGetCachedRoute).toHaveBeenCalledWith('statistics:ons:v3:u1')
  })

  it('reads the derived series, never portfolio_snapshots', async () => {
    await GET()
    expect(mockGetDerivedSeries).toHaveBeenCalledWith(expect.anything(), 'u1')
    expect(mockFetchSnapshotSeries).not.toHaveBeenCalled()
  })

  it('keeps the response shape, minus the retired provenance block', async () => {
    const body = await (await GET()).json()
    expect(Object.keys(body).sort()).toEqual([
      'allPnLs', 'allocation', 'annualizedVol', 'arsExposure', 'avgHoldingDays', 'avgLoss', 'avgWin',
      'biggestLoser', 'biggestWinner', 'couponsReceived', 'cumulativePnl', 'drawdownIntervals', 'drawdownIntervalsSkipped',
      'losersCount', 'maxDrawdown', 'maxHoldingDays', 'minHoldingDays', 'monthlyReturns', 'monthlyStdDev', 'openPnl',
      'profitFactor', 'realizedPnl', 'returnIntervals', 'sharpeRatio', 'totalPortfolioValue', 'totalTrades',
      'unpricedPositions', 'usdExposure', 'winRate', 'winnersCount',
    ])
  })

  it('serves a degraded series without caching it', async () => {
    mockSeries([], [], true)
    expect((await GET()).status).toBe(200)
    expect(mockCacheRoute).not.toHaveBeenCalled()
  })

  it('maxDrawdown is a real number over the series — the hardcoded 0 is dead', async () => {
    mockSeries(ONS_ROWS)
    const body = await (await GET()).json()
    // 321 → 319 is a real, small drawdown; 0 would claim "never fell"
    expect(body.maxDrawdown).toBeLessThan(0)
    expect(body.drawdownIntervals).toBe(2)
  })

  it('vol and Sharpe are null below the 20-interval threshold, not numbers', async () => {
    mockSeries(ONS_ROWS)
    const body = await (await GET()).json()
    expect(body.annualizedVol).toBeNull()
    expect(body.sharpeRatio).toBeNull()
    expect(body.returnIntervals).toBe(2)
  })

  it('with a single day every metric is null — never 0', async () => {
    mockSeries(ONS_ROWS.slice(0, 1))
    const body = await (await GET()).json()
    expect(body.maxDrawdown).toBeNull()
    expect(body.annualizedVol).toBeNull()
    expect(body.sharpeRatio).toBeNull()
  })
})

describe('GET /api/statistics/ons — coupons', () => {
  it('does not read a coupon day as a loss — the interval is skipped, not adjusted', async () => {
    // 24 -> 25 is the payment: ons_value falls 320 -> 288 while cash rises.
    // That interval is not measured at all (a flow there would be a bet on
    // whether the leg was priced), so the drawdown sees only the two flat
    // intervals that follow — enough to clear MIN_INTERVALS_DRAWDOWN.
    const row = (snapshot_date: string, ons_value: number, cash_value: number) => ({
      snapshot_date, total_value: 1020, total_invested: 800, stocks_value: 600,
      stocks_invested: 500, ons_value, ons_invested: 300, cash_value,
    })
    mockSeries([
      row('2026-07-24', 320, 100),
      row('2026-07-25', 288, 132),
      row('2026-07-28', 288, 132),
      row('2026-07-29', 288, 132),
    ])
    mockFetchIncomeMovements.mockResolvedValue([{ date: '2026-07-25', type: 'CUPON', amount: 32 }])

    const body = await (await GET()).json()
    expect(body.maxDrawdown).toBe(0)
    expect(body.drawdownIntervals).toBe(2)
    expect(body.drawdownIntervalsSkipped).toBe(1)
  })

  it('reports the lifetime coupon total', async () => {
    mockFetchIncomeMovements.mockResolvedValue([
      { date: '2026-07-25', type: 'CUPON', amount: 8300 },
      { date: '2026-01-25', type: 'CUPON', amount: 8100 },
      { date: '2026-07-25', type: 'DIVIDENDO', amount: 500 },
    ])
    const body = await (await GET()).json()
    expect(body.couponsReceived).toBe(16400)
  })

  it('skips the day of an automatic coupon from the core, and counts it in the lifetime total', async () => {
    const row = (snapshot_date: string, ons_value: number, cash_value: number) => ({
      snapshot_date, total_value: 1020, total_invested: 800, stocks_value: 600,
      stocks_invested: 500, ons_value, ons_invested: 300, cash_value,
    })
    mockSeries(
      [row('2026-07-24', 320, 100), row('2026-07-25', 288, 132), row('2026-07-28', 288, 132), row('2026-07-29', 288, 132)],
      [{ ticker: 'XD', date: '2026-07-25', kind: 'coupon', amount: 32, source: 'schedule' }]
    )
    mockFetchIncomeMovements.mockResolvedValue([{ date: '2026-01-25', type: 'CUPON', amount: 10 }])
    const body = await (await GET()).json()
    expect(body.maxDrawdown).toBe(0)
    expect(body.drawdownIntervalsSkipped).toBe(1)
    expect(body.couponsReceived).toBe(42)
  })

  it('reports 0 coupons received when there are none, never undefined', async () => {
    const body = await (await GET()).json()
    expect(body.couponsReceived).toBe(0)
  })

  it('uses the v3 cache key', async () => {
    await GET()
    expect(mockCacheRoute.mock.calls[0][0]).toBe('statistics:ons:v3:u1')
  })

  it('returns 500 when the income fetch fails', async () => {
    mockFetchIncomeMovements.mockRejectedValue(new Error('boom'))
    expect((await GET()).status).toBe(500)
  })
})
