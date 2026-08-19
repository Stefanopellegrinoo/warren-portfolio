import { describe, it, expect, vi, beforeEach } from 'vitest'

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

const ONS_SNAPS = [
  // 3 estimated rows frozen at cost — must be invisible to the metrics
  ...['2026-05-01', '2026-05-02', '2026-05-03'].map((d) => ({
    snapshot_date: d, total_value: 1000, total_invested: 800,
    stocks_value: 600, stocks_invested: 500,
    ons_value: 300, ons_invested: 300, cash_value: 100, source: 'estimated',
  })),
  // 3 live rows with real ON marks
  { snapshot_date: '2026-07-24', total_value: 1020, total_invested: 800,
    stocks_value: 600, stocks_invested: 500, ons_value: 320, ons_invested: 300,
    cash_value: 100, source: 'live' },
  { snapshot_date: '2026-07-25', total_value: 1021, total_invested: 800,
    stocks_value: 600, stocks_invested: 500, ons_value: 321, ons_invested: 300,
    cash_value: 100, source: 'live' },
  { snapshot_date: '2026-07-28', total_value: 1019, total_invested: 800,
    stocks_value: 600, stocks_invested: 500, ons_value: 319, ons_invested: 300,
    cash_value: 100, source: 'live' },
]

/** The route reads on_positions and on_closed_trades; each returns an empty
 *  set unless overridden. Transactions come from fetchFlowTransactions, which
 *  is mocked above — the fake cannot model its paginated call chain. */
function fakeSupabase() {
  const empty = { data: [], error: null }
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => empty),
          ...empty,
        })),
      })),
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireUser.mockResolvedValue({ supabase: fakeSupabase(), user: { id: 'u1' } })
  mockGetCachedRoute.mockResolvedValue(null)
  mockCacheRoute.mockResolvedValue(undefined)
  mockFetchSnapshotSeries.mockResolvedValue([])
  mockFetchFlowTransactions.mockResolvedValue([])
  mockFetchIncomeMovements.mockResolvedValue([])
})

describe('GET /api/statistics/ons — computed risk metrics', () => {
  it('uses the v3 cache key', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(mockGetCachedRoute).toHaveBeenCalledWith('statistics:ons:v3:u1')
  })

  it('maxDrawdown is a real number over the measured rows — the hardcoded 0 is dead', async () => {
    mockFetchSnapshotSeries.mockResolvedValue(ONS_SNAPS)
    const body = await (await GET()).json()
    // 321 → 319 is a real, small drawdown; 0 would claim "never fell"
    expect(body.maxDrawdown).toBeLessThan(0)
    expect(body.drawdownIntervals).toBe(2)
  })

  it('vol and Sharpe are null below the 20-interval threshold, not numbers', async () => {
    mockFetchSnapshotSeries.mockResolvedValue(ONS_SNAPS)
    const body = await (await GET()).json()
    expect(body.annualizedVol).toBeNull()
    expect(body.sharpeRatio).toBeNull()
    expect(body.returnIntervals).toBe(2)
  })

  it('with no measured rows every metric is null — never 0', async () => {
    mockFetchSnapshotSeries.mockResolvedValue(ONS_SNAPS.filter((s) => s.source === 'estimated'))
    const body = await (await GET()).json()
    expect(body.maxDrawdown).toBeNull()
    expect(body.annualizedVol).toBeNull()
    expect(body.sharpeRatio).toBeNull()
  })

  it('provenance describes the metric rows (measured only), so the note matches the figures', async () => {
    mockFetchSnapshotSeries.mockResolvedValue(ONS_SNAPS)
    const body = await (await GET()).json()
    expect(body.provenance.totalDays).toBe(3)
    expect(body.provenance.estimatedDays).toBe(0)
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
      stocks_invested: 500, ons_value, ons_invested: 300, cash_value, source: 'live' as const,
    })
    mockFetchSnapshotSeries.mockResolvedValue([
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
