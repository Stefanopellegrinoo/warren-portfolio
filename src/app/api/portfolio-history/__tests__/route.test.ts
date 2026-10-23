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

const mockGetDerivedSeries = vi.fn()
vi.mock('@/lib/derived-series', () => ({
  getDerivedSeries: (...args: unknown[]) => mockGetDerivedSeries(...args),
}))

const route = await import('../route')
const { GET } = route

// ── Helpers ──────────────────────────────────────────────────────────────────

const TODAY = argentinaDate()

function daysAgo(n: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().split('T')[0]
}

function row(date: string, over: Record<string, number> = {}) {
  return {
    user_id: 'u1', snapshot_date: date, total_value: 1000, total_invested: 800, pnl: 100, pnl_pct: 0.125,
    stocks_value: 600, stocks_invested: 500, ons_value: 300, ons_invested: 300, cash_value: 100, ...over,
  }
}
const series = (rows: unknown[], degraded = false) => ({ rows, degraded, flags: {}, income: [] })

function request(query = 'days=90'): NextRequest {
  return new Request(`http://test.local/api/portfolio-history?${query}`) as unknown as NextRequest
}

// The route only forwards supabase to mocked helpers; from() is a tripwire.
const fakeSupabase = { from: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireUser.mockResolvedValue({ supabase: fakeSupabase, user: { id: 'u1' } })
  mockGetCachedRoute.mockResolvedValue(null)
  mockCacheRoute.mockResolvedValue(undefined)
  mockGetDerivedSeries.mockResolvedValue(series([]))
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/portfolio-history — derived from the ledger core', () => {
  it('keeps the response shape: { data: [{ snapshot_date, value, invested }] }, today last, no source', async () => {
    mockGetDerivedSeries.mockResolvedValue(series([row(daysAgo(1), { total_value: 1350, pnl: 550 }), row(TODAY, { total_value: 1400, pnl: 600 })]))

    const res = await GET(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      data: [
        { snapshot_date: daysAgo(1), value: 1350, invested: 800 },
        { snapshot_date: TODAY, value: 1400, invested: 800 },
      ],
    })
  })

  it('never queries a table directly: every row comes from the derived series', async () => {
    mockGetDerivedSeries.mockResolvedValue(series([row(daysAgo(1))]))
    await GET(request())
    expect(fakeSupabase.from).not.toHaveBeenCalled()
    expect(mockGetDerivedSeries).toHaveBeenCalledWith(fakeSupabase, 'u1', { fromDate: daysAgo(90) })
  })

  it('filters the range by days and caps at 730; all = from the first ledger date', async () => {
    await GET(request('days=30'))
    await GET(request('days=all'))
    await GET(request('days=10000'))
    expect(mockGetDerivedSeries.mock.calls[0][2]).toEqual({ fromDate: daysAgo(30) })
    expect(mockGetDerivedSeries.mock.calls[1][2]).toEqual({ fromDate: undefined })
    expect(mockGetDerivedSeries.mock.calls[2][2]).toEqual({ fromDate: daysAgo(730) })
  })

  it('clamps a negative days value to a 1-day window instead of a future fromDate', async () => {
    await GET(request('days=-5'))
    expect(mockGetDerivedSeries.mock.calls[0][2]).toEqual({ fromDate: daysAgo(1) })
  })

  it('returns 500 when the ledger read fails', async () => {
    mockGetDerivedSeries.mockRejectedValue(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(request())
    expect(res.status).toBe(500)
    errSpy.mockRestore()
  })

  it('serves from cache and writes the cache with the v3 key + TTL 300', async () => {
    mockGetCachedRoute.mockResolvedValueOnce({ data: [{ snapshot_date: TODAY }] })
    const body = await (await GET(request())).json()
    expect(body.data[0].snapshot_date).toBe(TODAY)
    expect(mockGetDerivedSeries).not.toHaveBeenCalled()

    await GET(request())
    expect(mockCacheRoute).toHaveBeenCalledWith('history:v3:u1:90:total', { data: [] }, 300)
  })

  it('serves a degraded series without caching it', async () => {
    mockGetDerivedSeries.mockResolvedValue(series([row(TODAY)], true))
    const res = await GET(request())
    expect((await res.json()).data).toHaveLength(1)
    expect(mockCacheRoute).not.toHaveBeenCalled()
  })
})

describe('GET /api/portfolio-history — universe parameter', () => {
  it('projects the ons and stocks universes, today included', async () => {
    mockGetDerivedSeries.mockResolvedValue(series([row(daysAgo(1)), row(TODAY, { stocks_value: 615 })]))
    const ons = await (await GET(request('days=90&universe=ons'))).json()
    expect(ons.data[0]).toEqual({ snapshot_date: daysAgo(1), value: 300, invested: 300 })
    const stocks = await (await GET(request('days=90&universe=stocks'))).json()
    expect(stocks.data.at(-1)).toEqual({ snapshot_date: TODAY, value: 615, invested: 500 })
  })

  it('treats the retired measurable universe as the whole portfolio (old clients and cached URLs)', async () => {
    mockGetDerivedSeries.mockResolvedValue(series([row(daysAgo(1))]))
    const res = await GET(request('days=90&universe=measurable'))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual([{ snapshot_date: daysAgo(1), value: 1000, invested: 900 }])
    expect(mockGetCachedRoute).toHaveBeenCalledWith('history:v3:u1:90:total')
  })

  it('rejects an unknown universe with 400', async () => {
    const res = await GET(request('universe=everything'))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/portfolio-history', () => {
  it('no longer exists: there is no snapshot to take, Next answers 405', () => {
    expect((route as Record<string, unknown>).POST).toBeUndefined()
  })
})
