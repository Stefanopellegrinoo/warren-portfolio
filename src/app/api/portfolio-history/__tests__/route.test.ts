import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { argentinaDate } from '@/lib/utils'

// ── Mocks ────────────────────────────────────────────────────────────────────

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

const mockComputeLiveSnapshotRow = vi.fn()
const mockSnapshotUser = vi.fn()
vi.mock('@/lib/portfolio-snapshots', () => ({
  computeLiveSnapshotRow: (...args: unknown[]) => mockComputeLiveSnapshotRow(...args),
  snapshotUser: (...args: unknown[]) => mockSnapshotUser(...args),
}))

// H4 tripwires — the rebuilt route must never touch these
const mockFetchQuotes = vi.fn()
const mockFetchHistoricalQuotes = vi.fn()
vi.mock('@/lib/yahoo-finance', () => ({
  fetchQuotes: (...args: unknown[]) => mockFetchQuotes(...args),
  fetchHistoricalQuotes: (...args: unknown[]) => mockFetchHistoricalQuotes(...args),
}))

const { GET, POST } = await import('../route')

// ── Helpers ──────────────────────────────────────────────────────────────────

const TODAY = argentinaDate()

function daysAgo(n: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().split('T')[0]
}

function snapRow(date: string, value: number, invested: number) {
  return {
    id: `id-${date}`,
    user_id: 'u1',
    snapshot_date: date,
    total_value: value,
    total_invested: invested,
    pnl: value - invested,
    pnl_pct: invested > 0 ? (value - invested) / invested : 0,
  }
}

function request(query = 'days=90'): NextRequest {
  return new Request(`http://test.local/api/portfolio-history?${query}`) as unknown as NextRequest
}

function makeRequest(pathAndQuery: string): NextRequest {
  return new Request(`http://test.local${pathAndQuery}`) as unknown as NextRequest
}

// The route only forwards supabase to mocked helpers; from() is a tripwire.
const fakeSupabase = { from: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireUser.mockResolvedValue({ supabase: fakeSupabase, user: { id: 'u1' } })
  mockGetCachedRoute.mockResolvedValue(null)
  mockCacheRoute.mockResolvedValue(undefined)
  mockFetchSnapshotSeries.mockResolvedValue([])
  mockComputeLiveSnapshotRow.mockResolvedValue(null)
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/portfolio-history — snapshots + live point (H4 dead)', () => {
  it('serves snapshot rows 1:1 — ONs and cash are IN because snapshot totals include them', async () => {
    // Arrange — snapshot values were written by buildSnapshotRow (stocks+ONs+cash)
    mockFetchSnapshotSeries.mockResolvedValue([
      snapRow(daysAgo(2), 1350, 1000), // includes ON value + cash by construction
      snapRow(daysAgo(1), 1400, 1000),
    ])

    // Act
    const res = await GET(request())
    const body = await res.json()

    // Assert — values pass through untouched; internal columns stripped
    expect(res.status).toBe(200)
    expect(body.data).toEqual([
      { snapshot_date: daysAgo(2), value: 1350, invested: 1000 },
      { snapshot_date: daysAgo(1), value: 1400, invested: 1000 },
    ])
    expect(body.data[0]).not.toHaveProperty('user_id')
    expect(body.data[0]).not.toHaveProperty('id')
    // Supplements the toEqual above: toEqual normalizes `source: undefined` as
    // absent on both sides, and JSON.stringify (which res.json() round-trips
    // through) drops undefined-valued keys entirely — so toEqual alone cannot
    // tell "route never emits source" apart from "route emits source: undefined".
    // This assertion is the one that actually distinguishes the two.
    expect(body.data[0]).not.toHaveProperty('source')
  })

  it('H4 reproducer: never replays transactions, never fetches historical quotes, no || 0 pricing', async () => {
    // Arrange
    mockFetchSnapshotSeries.mockResolvedValue([snapRow(daysAgo(1), 1000, 900)])

    // Act
    await GET(request())

    // Assert — the survivorship-biased replay pipeline is GONE:
    // no transactions read, no per-ticker history, no live-quote patching
    expect(fakeSupabase.from).not.toHaveBeenCalled()
    expect(mockFetchHistoricalQuotes).not.toHaveBeenCalled()
    expect(mockFetchQuotes).not.toHaveBeenCalled()
  })

  it("appends a live intraday point when today's snapshot is absent", async () => {
    // Arrange
    mockFetchSnapshotSeries.mockResolvedValue([snapRow(daysAgo(1), 1000, 900)])
    mockComputeLiveSnapshotRow.mockResolvedValue({
      user_id: 'u1', snapshot_date: TODAY,
      total_value: 1500, total_invested: 1000, pnl: 500, pnl_pct: 0.5,
    })

    // Act
    const res = await GET(request())
    const body = await res.json()

    // Assert
    expect(mockComputeLiveSnapshotRow).toHaveBeenCalledWith(fakeSupabase, 'u1', TODAY)
    expect(body.data).toHaveLength(2)
    expect(body.data[1]).toEqual({
      snapshot_date: TODAY, value: 1500, invested: 1000, source: 'live',
    })
  })

  it("does NOT duplicate today's point when the snapshot already exists", async () => {
    // Arrange
    mockFetchSnapshotSeries.mockResolvedValue([snapRow(daysAgo(1), 1000, 900), snapRow(TODAY, 1200, 900)])

    // Act
    const res = await GET(request())
    const body = await res.json()

    // Assert
    expect(mockComputeLiveSnapshotRow).not.toHaveBeenCalled()
    expect(body.data.filter((p: any) => p.snapshot_date === TODAY)).toHaveLength(1)
  })

  it('returns { data: [] } with no snapshots and no current holdings', async () => {
    // Act — both mocks already return empty/null
    const res = await GET(request())
    const body = await res.json()

    // Assert
    expect(res.status).toBe(200)
    expect(body).toEqual({ data: [] })
  })

  it('returns a single live point when there are no snapshots but holdings exist', async () => {
    // Arrange
    mockComputeLiveSnapshotRow.mockResolvedValue({
      user_id: 'u1', snapshot_date: TODAY,
      total_value: 800, total_invested: 700, pnl: 100, pnl_pct: 100 / 700,
    })

    // Act
    const res = await GET(request())
    const body = await res.json()

    // Assert
    expect(body.data).toHaveLength(1)
    expect(body.data[0].snapshot_date).toBe(TODAY)
  })

  it('filters the range by days and caps at 730', async () => {
    // Act
    await GET(request('days=30'))
    await GET(request('days=all'))
    await GET(request('days=10000'))

    // Assert
    expect(mockFetchSnapshotSeries.mock.calls[0][2]).toEqual({ fromDate: daysAgo(30) })
    expect(mockFetchSnapshotSeries.mock.calls[1][2]).toEqual({ fromDate: undefined })
    expect(mockFetchSnapshotSeries.mock.calls[2][2]).toEqual({ fromDate: daysAgo(730) })
  })

  it('clamps a negative days value to a 1-day window instead of a future fromDate', async () => {
    // Arrange — `-5 || 90` short-circuits to -5 (truthy), which today survives
    // into a fromDate 5 days in the FUTURE, producing an empty window.

    // Act
    await GET(request('days=-5'))

    // Assert
    expect(mockFetchSnapshotSeries.mock.calls[0][2]).toEqual({ fromDate: daysAgo(1) })
  })

  it('degrades gracefully when the live point fails — snapshots still served', async () => {
    // Arrange
    mockFetchSnapshotSeries.mockResolvedValue([snapRow(daysAgo(1), 1000, 900)])
    mockComputeLiveSnapshotRow.mockRejectedValue(new Error('yahoo down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Act
    const res = await GET(request())
    const body = await res.json()

    // Assert — a quote outage never blanks the chart
    expect(res.status).toBe(200)
    expect(body.data).toHaveLength(1)
    errSpy.mockRestore()
  })

  it('returns 500 when the snapshot read fails', async () => {
    // Arrange
    mockFetchSnapshotSeries.mockRejectedValue(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Act
    const res = await GET(request())

    // Assert
    expect(res.status).toBe(500)
    errSpy.mockRestore()
  })

  it('serves from cache and writes the cache with the v3 key + TTL 300', async () => {
    // Arrange — cache hit short-circuits everything
    mockGetCachedRoute.mockResolvedValueOnce({ data: [{ snapshot_date: TODAY }] })

    // Act
    const res = await GET(request())
    const body = await res.json()

    // Assert
    expect(body.data[0].snapshot_date).toBe(TODAY)
    expect(mockFetchSnapshotSeries).not.toHaveBeenCalled()

    // Arrange — cache miss writes back under history:v3:{userId}:{days}:{universe}, TTL 300
    mockGetCachedRoute.mockResolvedValueOnce(null)
    await GET(request())
    expect(mockCacheRoute).toHaveBeenCalledWith('history:v3:u1:90:total', { data: [] }, 300)
  })
})

describe('GET /api/portfolio-history — provenance', () => {
  it('carries source through on every point', async () => {
    mockFetchSnapshotSeries.mockResolvedValue([
      { ...snapRow(daysAgo(3), 1000, 900), source: 'estimated' },
      { ...snapRow(daysAgo(2), 1100, 900), source: 'live' },
    ])

    const res = await GET(request())
    const body = await res.json()

    expect(body.data[0].source).toBe('estimated')
    expect(body.data[1].source).toBe('live')
  })

  it('marks the live intraday point as live — it is a measurement, not a reconstruction', async () => {
    // computeLiveSnapshotRow values the portfolio from real current quotes.
    mockFetchSnapshotSeries.mockResolvedValue([
      { ...snapRow(daysAgo(1), 1000, 900), source: 'estimated' },
    ])
    mockComputeLiveSnapshotRow.mockResolvedValue({
      snapshot_date: TODAY,
      total_value: 1200,
      total_invested: 900,
      pnl: 300,
      pnl_pct: 0.333,
    })

    const res = await GET(request())
    const body = await res.json()

    const todayPoint = body.data[body.data.length - 1]
    expect(todayPoint.snapshot_date).toBe(TODAY)
    expect(todayPoint.source).toBe('live')
  })

  it('bumps the cache key so a stale v2 payload cannot serve without per-universe projection', async () => {
    await GET(request('days=90'))

    expect(mockGetCachedRoute).toHaveBeenCalledWith('history:v3:u1:90:total')
    expect(mockCacheRoute).toHaveBeenCalledWith('history:v3:u1:90:total', expect.anything(), 300)
  })
})

const SNAPS = [
  { snapshot_date: '2026-07-01', total_value: 1000, total_invested: 800,
    stocks_value: 600, stocks_invested: 500, ons_value: 300, ons_invested: 300,
    cash_value: 100, source: 'estimated' },
  { snapshot_date: '2026-07-02', total_value: 1010, total_invested: 800,
    stocks_value: 605, stocks_invested: 500, ons_value: 300, ons_invested: 300,
    cash_value: 105, source: 'live' },
]

describe('GET /api/portfolio-history — universe parameter', () => {
  it('defaults to total: value/invested mirror the stored totals', async () => {
    mockFetchSnapshotSeries.mockResolvedValue(SNAPS)
    const res = await GET(makeRequest('/api/portfolio-history?days=90'))
    const body = await res.json()
    expect(mockGetCachedRoute).toHaveBeenCalledWith('history:v3:u1:90:total')
    expect(body.data[0]).toEqual({
      snapshot_date: '2026-07-01', value: 1000, invested: 800, source: 'estimated',
    })
  })

  it('projects the ons universe and keeps the flat cost line visible', async () => {
    mockFetchSnapshotSeries.mockResolvedValue(SNAPS)
    const res = await GET(makeRequest('/api/portfolio-history?days=90&universe=ons'))
    const body = await res.json()
    expect(body.data).toHaveLength(2) // estimated rows stay — this is the CHART
    expect(body.data[0].value).toBe(300)
    expect(body.data[0].invested).toBe(300)
  })

  it('drops a row without breakdown from a non-total universe instead of coercing to 0', async () => {
    mockFetchSnapshotSeries.mockResolvedValue([
      ...SNAPS,
      { snapshot_date: '2026-07-03', total_value: 990, total_invested: 800, source: 'live' },
    ])
    const res = await GET(makeRequest('/api/portfolio-history?days=90&universe=stocks'))
    const body = await res.json()
    expect(body.data.map((p: { snapshot_date: string }) => p.snapshot_date))
      .toEqual(['2026-07-01', '2026-07-02'])
  })

  it('rejects an unknown universe with 400', async () => {
    const res = await GET(makeRequest('/api/portfolio-history?universe=everything'))
    expect(res.status).toBe(400)
  })

  it('projects the live intraday point through the same universe', async () => {
    mockFetchSnapshotSeries.mockResolvedValue(SNAPS)
    mockComputeLiveSnapshotRow.mockResolvedValue({
      user_id: 'u1', snapshot_date: TODAY, total_value: 1020, total_invested: 800,
      pnl: 220, pnl_pct: 27.5, stocks_value: 615, stocks_invested: 500,
      ons_value: 300, ons_invested: 300, cash_value: 105,
    })
    const res = await GET(makeRequest('/api/portfolio-history?days=90&universe=stocks'))
    const body = await res.json()
    const last = body.data[body.data.length - 1]
    expect(last).toEqual({
      snapshot_date: TODAY, value: 615, invested: 500, source: 'live',
    })
  })
})

describe('POST /api/portfolio-history', () => {
  function postRequest(): NextRequest {
    return new Request('http://test.local/api/portfolio-history', {
      method: 'POST',
    }) as unknown as NextRequest
  }

  it('returns a JSON 500 instead of an unhandled rejection when snapshotUser throws', async () => {
    // Arrange — computeLiveSnapshotRow (Fix 1) can now throw on a partial read
    // failure, and that propagates through snapshotUser unguarded today.
    mockSnapshotUser.mockRejectedValueOnce(new Error('boom'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Act
    const res = await POST(postRequest())
    const body = await res.json()

    // Assert
    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'Internal error' })
    errSpy.mockRestore()
  })
})
