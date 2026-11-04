// T2 (S3, S7, odd/tasks/market-page.md): the Mercado board, one shared copy in Redis for every user.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { MARKET_DATA_UNAVAILABLE } from '@/lib/api/errors'

const mockRequireUser = vi.fn()
vi.mock('@/lib/api-auth', () => ({
  requireUser: () => mockRequireUser(),
  isAuthFailure: (r: object) => 'error' in r,
}))

const mockRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}))

// Redis as an in-memory store that records each write's TTL.
const store = new Map<string, string>()
const ttls = new Map<string, number>()
const mockConnected = vi.fn()
vi.mock('@/lib/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redis')>()),
  ensureRedisConnected: () => mockConnected(),
  getCachedRoute: async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : null),
  cacheRoute: async (key: string, data: unknown, ttl: number) => { store.set(key, JSON.stringify(data)); ttls.set(key, ttl) },
}))

const mockFrom = vi.fn()
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => ({ from: mockFrom }), createServerClientInstance: vi.fn() }))

const mockDollar = vi.fn()
vi.mock('@/lib/currency', () => ({ getDollarInfo: (kind: string) => mockDollar(kind) }))

const { GET } = await import('./route')

const STOCKS = 'https://data912.com/live/arg_stocks'
const CEDEARS = 'https://data912.com/live/arg_cedears'
const OPEN = new Date('2026-10-28T17:00:00Z') // a Wednesday, 14:00 in Buenos Aires
const CLOSED = new Date('2026-10-31T17:00:00Z') // a Saturday
const row = (symbol: string, c: number, pct_change: number) => ({ symbol, c, pct_change, px_bid: c, px_ask: c, v: 1 })

let feeds: Record<string, unknown>
const mockFetch = vi.fn(async (url: string, _init?: RequestInit) => {
  const body = feeds[url]
  if (body instanceof Error) throw body
  return { ok: true, status: 200, json: async () => body } as Response
})
const upstreamCalls = (url: string) => mockFetch.mock.calls.filter(c => c[0] === url).length
const req = (query = '') => new NextRequest(`http://localhost/api/market${query}`)

beforeEach(() => {
  vi.clearAllMocks()
  store.clear()
  ttls.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(OPEN)
  vi.stubGlobal('fetch', mockFetch)
  feeds = {
    [STOCKS]: [row('GGAL', 6500, 3.4), row('YPFD', 30000, -1), row('HARG', 1200, 0.5), row('GGALD', 4.5, 3)],
    [CEDEARS]: [row('AMD', 21000, 2), row('AMDD', 15, 2), row('AMDC', 15, 2), row('KO', 18000, -0.5)],
  }
  mockRequireUser.mockResolvedValue({ supabase: {}, user: { id: 'user-1' } })
  mockRateLimit.mockResolvedValue(true)
  mockConnected.mockResolvedValue(true)
  mockDollar.mockImplementation(async (kind: string) => ({ rate: kind === 'mep' ? 1000 : 1050, asOf: OPEN.toISOString(), source: 'cache' }))
  mockFrom.mockImplementation((table: string) => ({
    select: async () => ({
      data: table === 'activos'
        ? [{ ticker: 'GGAL', nombre: 'Grupo Galicia ADR' }, { ticker: 'BCBA:GGAL', nombre: 'Grupo Galicia' }, { ticker: 'YPFD.BA', nombre: 'YPF' }, { ticker: 'HARG', nombre: 'Holcim Argentina' }]
        : [{ ticker: 'KO', activos: { nombre: 'Coca-Cola' } }, { ticker: 'MELI', activos: null }],
      error: null,
    }),
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('GET /api/market', () => {
  it('returns 401 without a session and reads nothing', async () => {
    mockRequireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })

    const res = await GET(req())

    expect(res.status).toBe(401)
    expect(mockRateLimit).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 429 once the user is over 60 requests per 60 s, and reads nothing', async () => {
    mockRateLimit.mockResolvedValue(false)

    const res = await GET(req())

    expect(mockRateLimit).toHaveBeenCalledWith('rl:market:user-1', 60, 60)
    expect(res.status).toBe(429)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('builds the board from one GET per feed: Panel líder in order, every local, CEDEAR peso lines, the Resumen\'s rates', async () => {
    const res = await GET(req())

    expect(res.status).toBe(200)
    const board = await res.json()
    expect(upstreamCalls(STOCKS)).toBe(1)
    expect(upstreamCalls(CEDEARS)).toBe(1)
    expect(board.lider).toHaveLength(20)
    expect(board.lider[0]).toEqual({ symbol: 'ALUA', name: null, price: null, changePct: null })
    expect(board.lider.find((r: { symbol: string }) => r.symbol === 'GGAL')).toEqual({ symbol: 'GGAL', name: 'Grupo Galicia', price: 6500, changePct: 0.034 })
    expect(board.lider[19]).toEqual({ symbol: 'YPFD', name: 'YPF', price: 30000, changePct: -0.01 })
    expect(board.locals.map((r: { symbol: string }) => r.symbol)).toEqual(['GGAL', 'YPFD', 'HARG', 'GGALD'])
    // A plain ticker (maybe the US ADR) names the company when no BYMA spelling does; a BYMA spelling wins.
    expect(board.locals.find((r: { symbol: string }) => r.symbol === 'HARG').name).toBe('Holcim Argentina')
    expect(board.locals.find((r: { symbol: string }) => r.symbol === 'GGAL').name).toBe('Grupo Galicia')
    expect(board.cedears).toEqual([
      { symbol: 'AMD', name: null, price: 21000, changePct: 0.02 },
      { symbol: 'KO', name: 'Coca-Cola', price: 18000, changePct: -0.005 },
    ])
    expect(board.fx).toEqual({ mep: 1000, ccl: 1050 })
    expect(board.marketOpen).toBe(true)
    expect(board.updatedAt).toBe(OPEN.toISOString())
  })

  it('keeps the board a minute while BYMA is open, longer when closed, and the names for hours', async () => {
    await GET(req())
    expect(ttls.get('market:board')).toBe(60)
    expect(ttls.get('market:names')).toBe(6 * 3600)
    expect(ttls.get('market:board:last-good')).toBeGreaterThan(3 * 24 * 3600)

    store.clear()
    vi.setSystemTime(CLOSED)
    const res = await GET(req())

    expect((await res.json()).marketOpen).toBe(false)
    expect(ttls.get('market:board')).toBeGreaterThan(60)
  })

  it('serves a cached board to every user without reaching data912 or the database', async () => {
    await GET(req())
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ supabase: {}, user: { id: 'user-2' } })
    mockRateLimit.mockResolvedValue(true)
    mockConnected.mockResolvedValue(true)

    const res = await GET(req())

    expect(res.status).toBe(200)
    expect((await res.json()).cedears).toHaveLength(2)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('shares one refresh between users who arrive together', async () => {
    const [a, b] = await Promise.all([GET(req()), GET(req())])

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(upstreamCalls(STOCKS)).toBe(1)
    expect(upstreamCalls(CEDEARS)).toBe(1)
  })

  it('serves the last good board when a feed fails, and does not ask data912 again in that window', async () => {
    await GET(req())
    const good = JSON.parse(store.get('market:board:last-good')!)
    store.delete('market:board')
    feeds[STOCKS] = new Error('data912 down')

    const res = await GET(req())
    await GET(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ...good, marketOpen: true })
    expect(upstreamCalls(STOCKS)).toBe(2)
  })

  it('answers 503 rather than a half-empty board when a feed fails and there is no last good board', async () => {
    feeds[CEDEARS] = new Error('data912 down')

    const res = await GET(req())

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: MARKET_DATA_UNAVAILABLE })
  })

  it('takes an empty feed as a failed read', async () => {
    feeds[CEDEARS] = []

    const res = await GET(req())

    expect(res.status).toBe(503)
  })

  it('answers 503 without reaching data912 when Redis is unreachable, so no request goes upstream per user', async () => {
    mockConnected.mockResolvedValue(false)

    const res = await GET(req())

    expect(res.status).toBe(503)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('still serves the board with null rates when the dollar is unavailable', async () => {
    mockDollar.mockResolvedValue(null)

    const res = await GET(req())

    expect(res.status).toBe(200)
    expect((await res.json()).fx).toEqual({ mep: null, ccl: null })
  })
})

// T7 (S9, S10): one page of a list, sorted and searched on the server; the bare call stays the full board.
describe('GET /api/market, one page of a list', () => {
  // Thirty invented CEDEARs: AA00…AA14 and BB00…BB14, the day's change rising with the index; each
  // has its dollar line in the feed, which is how the board tells a peso line it does not know by name.
  const thirty = Array.from({ length: 30 }, (_, i) => `${i < 15 ? 'AA' : 'BB'}${String(i % 15).padStart(2, '0')}`)
    .flatMap((s, i) => [row(s, 1000 + i, i / 10), row(`${s}D`, 1, 0)])
  const tickers = (body: { rows: { ticker: string }[] }) => body.rows.map(r => r.ticker)

  beforeEach(() => { feeds[CEDEARS] = thirty })

  it('answers a market list\'s page with its total, its pages, both lists\' counts and the board\'s rates and state', async () => {
    const res = await GET(req('?list=cedears&page=2'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ total: 30, page: 2, size: 25, pages: 2, counts: { lider: 20, cedears: 30 }, fx: { mep: 1000, ccl: 1050 }, marketOpen: true, updatedAt: OPEN.toISOString() })
    expect(body.rows).toHaveLength(5)
    expect(body.rows[0]).toEqual({ key: 'AA04', ticker: 'AA04', stored: 'AA04', name: null, price: 1004, changePct: 0.004, note: null, line: { kind: 'cedear', line: 'AA04' } })
    expect(body).not.toHaveProperty('lider')
  })

  it('answers the rows of the stored symbols asked for, trimmed and without empties, priced by their BYMA line', async () => {
    feeds[CEDEARS] = [row('KO', 18000, -0.5)]

    const body = await (await GET(req(`?symbols=${encodeURIComponent('BCBA:GGAL, KO,,BTCUSDT ,')}`))).json()

    expect(body.rows.map((r: { stored: string; price: number | null }) => [r.stored, r.price])).toEqual([['BCBA:GGAL', 6500], ['KO', 18000], ['BTCUSDT', null]])
    expect(body).toMatchObject({ total: 3, page: 1, pages: 1, counts: { lider: 20, cedears: 1 } })
  })

  it('an empty list is one empty page', async () => {
    const body = await (await GET(req('?symbols='))).json()

    expect(body).toMatchObject({ rows: [], total: 0, page: 1, pages: 1 })
  })

  it('searches before cutting the page, so the total counts what matched', async () => {
    const body = await (await GET(req('?list=cedears&q=%20bb%20'))).json()

    expect(body).toMatchObject({ total: 15, pages: 1 })
    expect(tickers(body).every(t => t.startsWith('BB'))).toBe(true)
  })

  it('sorts the whole list before cutting the page, by the day\'s change by default', async () => {
    expect(tickers(await (await GET(req('?list=cedears'))).json())[0]).toBe('BB14')
    expect(tickers(await (await GET(req('?list=cedears&sort=ticker:desc&page=2'))).json())).toEqual(['AA04', 'AA03', 'AA02', 'AA01', 'AA00'])
    expect(tickers(await (await GET(req('?list=cedears&sort=abs:asc'))).json())[0]).toBe('AA00')
    expect(tickers(await (await GET(req('?list=cedears&sort=sideways'))).json())[0]).toBe('BB14')
  })

  it('serves 25 rows for a page size it does not offer, and 50 when asked', async () => {
    const odd = await (await GET(req('?list=cedears&size=7'))).json()
    const fifty = await (await GET(req('?list=cedears&size=50'))).json()

    expect(odd).toMatchObject({ size: 25, pages: 2 })
    expect(odd.rows).toHaveLength(25)
    expect(fifty).toMatchObject({ size: 50, pages: 1 })
    expect(fifty.rows).toHaveLength(30)
  })

  it('refuses a list and symbols together, an unknown list and more than 200 symbols, without reading the board', async () => {
    const many = Array.from({ length: 201 }, (_, i) => `S${i}`).join(',')
    for (const query of ['?list=lider&symbols=KO', '?list=merval', `?symbols=${many}`]) {
      const res = await GET(req(query))
      expect(res.status, query).toBe(400)
      expect(typeof (await res.json()).error).toBe('string')
    }
    expect(mockFetch).not.toHaveBeenCalled()
    expect((await GET(req(`?symbols=${many.split(',').slice(0, 200).join(',')}`))).status).toBe(200)
  })

  it('keeps 401, 429 and 503 with Retry-After for a page call', async () => {
    mockRequireUser.mockResolvedValueOnce({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })
    expect((await GET(req('?list=lider'))).status).toBe(401)

    mockRateLimit.mockResolvedValueOnce(false)
    expect((await GET(req('?symbols=KO'))).status).toBe(429)

    mockConnected.mockResolvedValue(false)
    const res = await GET(req('?list=lider'))
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(await res.json()).toEqual({ error: MARKET_DATA_UNAVAILABLE })
  })

  it('without a list or symbols answers exactly the full board, as before, for pages still running the old Mercado', async () => {
    const res = await GET(req('?page=2&size=50&sort=ticker:asc&q=bb'))

    const body = await res.json()
    expect(body).toEqual({ ...JSON.parse(store.get('market:board')!).board, marketOpen: true })
    expect(Object.keys(body).sort()).toEqual(['cedears', 'fx', 'lider', 'locals', 'marketOpen', 'updatedAt'])
    expect(body.cedears).toHaveLength(30)
  })
})
