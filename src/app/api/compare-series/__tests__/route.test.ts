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

const mockLoadStocksTwr = vi.fn()
vi.mock('@/lib/stocks-twr', () => ({
  loadStocksTwr: (...args: unknown[]) => mockLoadStocksTwr(...args),
}))

const mockGetBars = vi.fn()
vi.mock('@/lib/bars-cache', () => ({
  getBars: (...args: unknown[]) => mockGetBars(...args),
}))

const mockGetHistoricalCCL = vi.fn()
vi.mock('@/lib/currency', () => ({
  getHistoricalCCL: (...args: unknown[]) => mockGetHistoricalCCL(...args),
}))

const { GET } = await import('../route')

const get = (query: string) => GET(new NextRequest(new URL(`/api/compare-series${query}`, 'http://test.local')))

const barsOf = (bars: { date: string; close: number }[]) => ({ bars, splits: [], splitsKnown: true, degraded: false, missing: false })
const empty = { bars: [], splits: [], splitsKnown: false, degraded: true, missing: true }

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireUser.mockResolvedValue({ supabase: {}, user: { id: 'u1' } })
  mockGetCachedRoute.mockResolvedValue(null)
  mockCacheRoute.mockResolvedValue(undefined)
  mockLoadStocksTwr.mockResolvedValue([])
  mockGetHistoricalCCL.mockResolvedValue(new Map([['2026-01-02', 1000]]))
  mockGetBars.mockImplementation(async (symbols: string[]) =>
    new Map(symbols.map((s) => [s, s === 'ZZZZ' ? empty : barsOf([{ date: '2026-01-02', close: 2000 }])])),
  )
})

describe('GET /api/compare-series', () => {
  it('asks for between one and five assets', async () => {
    for (const query of ['', '?symbols=', '?symbols=A,B,C,D,E,F']) {
      const res = await get(query)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Elegí entre 1 y 5 activos para comparar' })
    }
  })

  it('a ticker without data is marked on its own; the rest still answer', async () => {
    const res = await get('?symbols=SPY,ZZZZ')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.series.SPY).toEqual({ points: [{ time: '2026-01-02', value: 2000 }] })
    expect(body.series.ZZZZ).toEqual({ error: 'no_data' })
  })

  it('something that is not a ticker is one asset without data, never a failed request', async () => {
    const res = await get('?symbols=SPY,SP;Y')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.series['SP;Y']).toEqual({ error: 'no_data' })
    expect(body.series.SPY.points).toHaveLength(1)
    expect(mockGetBars.mock.calls[0][0]).toEqual(['SPY'])
  })

  it('a held peso share is its Buenos Aires listing, in dollars', async () => {
    const body = await (await get('?symbols=BCBA:GGAL')).json()
    expect(mockGetBars.mock.calls[0][0]).toEqual(['GGAL.BA'])
    expect(body.series['BCBA:GGAL']).toEqual({ points: [{ time: '2026-01-02', value: 2 }] })
  })

  it('a peso-quoted ticker is divided by the CCL; a dollar one never asks for it', async () => {
    const ars = await (await get('?symbols=GGAL.BA')).json()
    expect(ars.series['GGAL.BA']).toEqual({ points: [{ time: '2026-01-02', value: 2 }] })
    expect(mockGetHistoricalCCL).toHaveBeenCalledTimes(1)

    mockGetHistoricalCCL.mockClear()
    await get('?symbols=SPY')
    expect(mockGetHistoricalCCL).not.toHaveBeenCalled()
  })

  it('ccl=1 sends the CCL itself, for a peso chart being compared', async () => {
    const body = await (await get('?symbols=SPY&ccl=1')).json()
    expect(body.ccl).toEqual([{ time: '2026-01-02', value: 1000 }])
  })

  it('a crypto pair is fetched under its Yahoo name and answered under its own', async () => {
    const body = await (await get('?symbols=BTCUSDT')).json()
    expect(mockGetBars.mock.calls[0][0]).toEqual(['BTC-USD'])
    expect(body.series.BTCUSDT).toEqual({ points: [{ time: '2026-01-02', value: 2000 }] })
  })

  it('the portfolio is its stock TWR as an index from 100, loaded only when asked for', async () => {
    await get('?symbols=SPY')
    expect(mockLoadStocksTwr).not.toHaveBeenCalled()

    mockLoadStocksTwr.mockResolvedValue([
      { date: '2026-01-02', twrIndex: 1, twrPct: 0 },
      { date: '2026-01-05', twrIndex: 1.05, twrPct: 5 },
    ])
    const body = await (await get('?symbols=__portfolio__')).json()
    expect(body.series.__portfolio__.points).toEqual([
      { time: '2026-01-02', value: 100 },
      { time: '2026-01-05', value: 105 },
    ])
  })

  it('a portfolio without history is marked like a ticker without data', async () => {
    const body = await (await get('?symbols=__portfolio__')).json()
    expect(body.series.__portfolio__).toEqual({ error: 'no_data' })
  })

  it('answers from the cache, under a key the user cache invalidation clears', async () => {
    mockGetCachedRoute.mockResolvedValue({ series: { SPY: { error: 'no_data' } } })
    const body = await (await get('?symbols=SPY,DIA')).json()
    expect(body).toEqual({ series: { SPY: { error: 'no_data' } } })
    expect(mockGetCachedRoute).toHaveBeenCalledWith('statistics:v4:u1:compare:DIA,SPY')
    expect(mockGetBars).not.toHaveBeenCalled()
  })
})
