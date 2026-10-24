/**
 * /api/positions on a summary miss (odd/tasks/rendimiento.md S8): independent reads run together,
 * the ledger is read once for the portfolio and its currency views, and the computed summary is
 * left in Redis in the worker's format, guarded by the version read before the ledger.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

/** Redis as a map; eval runs the summary compare-and-set the Lua script does. */
const store = new Map<string, string>()
const fakeRedis = {
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  mget: vi.fn(async (...keys: string[]) => keys.flat().map(k => store.get(k) ?? null)),
  eval: vi.fn(async (_lua: string, _n: number, key: string, versionKey: string, version: string, _ttl: number, payload: string) => {
    if ((store.get(versionKey) ?? '') !== version) return 0
    store.set(key, payload)
    return 1
  }),
}
vi.mock('@/lib/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redis')>()),
  getRedis: () => fakeRedis,
  ensureRedisConnected: async () => true,
}))

const h = vi.hoisted(() => ({ supabase: null as any, quotes: undefined as Map<string, unknown> | undefined }))
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => h.supabase }))
vi.mock('@/lib/api-auth', () => ({
  requireUser: async () => ({ supabase: h.supabase, user: { id: 'u1' } }),
  isAuthFailure: () => false,
}))
vi.mock('@/lib/yahoo-finance', () => ({
  fetchQuotesWithFallback: async () => h.quotes ?? new Map([['AAPL', { ticker: 'AAPL', price: 150, change: 1, changePercent: 0.01, previousClose: 149 }]]),
  fetchQuotes: async () => new Map(),
}))
vi.mock('@/lib/data912-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data912-client')>()),
  fetchONQuotesWithFallback: async () => new Map(),
}))
const mockDollar = vi.fn()
vi.mock('@/lib/currency', () => ({ getDollarInfo: (kind: string) => mockDollar(kind) }))

const { GET } = await import('../route')
const { SUMMARY_SETEX_LUA } = await import('@/lib/summary-cache')
const { ledgerSupabase, trade, movement } = await import('@/lib/__tests__/fixtures/ledger-supabase')

const req = new Request('http://test.local/api/positions') as unknown as NextRequest
const withFx = (over: Record<string, unknown> = {}) => trade({
  asset_type: 'CEDEAR', created_at: '2026-01-05T12:00:00Z', trade_currency: 'USD', trade_quantity: null, trade_price: null,
  trade_commission: null, fx_mep: 1000, fx_ccl: 1100, ...over,
})
const tables = () => ({
  transactions: [withFx({ quantity: 3 }), withFx({ operation: 'VENTA', quantity: 1, price: 105, date: '2026-01-06', created_at: '2026-01-06T12:00:00Z' })],
  cash_movements: [movement({ amount: 50 })],
  on_payment_overrides: [],
  cedears: [{ ticker: 'AAPL', ratio: 20 }],
})

/** The fixture, logging every table read; `onRead(table)` runs as a read is issued. */
function ledger(log: string[] = [], onRead?: (table: string) => void) {
  const sb = ledgerSupabase(tables(), log)
  const from = sb.from
  sb.from = (name: string) => { onRead?.(name); return from(name) }
  return sb
}

/** What the worker writes for the same summary (src/lib/summary-cache.ts cacheUserSummaries). */
const workerPayload = (b: any) => JSON.stringify({
  positions: b.positions, onPositions: b.onPositions, summary: b.summary,
  unpricedCount: b.unpricedCount, unpricedTickers: b.unpricedTickers, ...(b.currencies && { currencies: b.currencies }),
})

beforeEach(() => {
  vi.clearAllMocks()
  store.clear()
  h.quotes = undefined
  mockDollar.mockImplementation(async (kind: string) => ({ rate: kind === 'mep' ? 1500 : 1600, asOf: '2026-10-21T20:00:00.000Z', source: 'cache' }))
})

describe('GET /api/positions on a summary miss', () => {
  it('leaves the summary in Redis exactly as the worker writes it, under the version CAS, and the next request is a hit', async () => {
    store.set('summary:version:u1', '7')
    store.set('system:last-refresh', '2026-10-24T15:00:00.000Z')
    h.supabase = ledger()

    const body = await (await GET(req)).json()

    expect(body.summary).toMatchObject({ total_market_value: 350, total_invested: 200, open_pnl: 100, realized_pnl: 5 })
    expect(body.currencies).toBeDefined()
    expect(body.lastRefresh).toBe('2026-10-24T15:00:00.000Z')
    expect(fakeRedis.eval).toHaveBeenCalledTimes(1)
    expect(fakeRedis.eval.mock.calls[0].slice(0, 6)).toEqual([SUMMARY_SETEX_LUA, 2, 'summary:u1', 'summary:version:u1', '7', 600])
    expect(store.get('summary:u1')).toBe(workerPayload(body))

    const log: string[] = []
    h.supabase = ledger(log)
    const again = await (await GET(req)).json()
    expect(again).toEqual(body)
    expect(log).toEqual([])
  })

  it('a mutation while the summary is computed (version bumped) leaves nothing behind', async () => {
    store.set('summary:version:u1', '7')
    // invalidateUserCache: bump the version, drop the summary.
    h.supabase = ledger([], table => { if (table === 'transactions') { store.set('summary:version:u1', '8'); store.delete('summary:u1') } })

    const res = await GET(req)

    expect(res.status).toBe(200)
    expect((await res.json()).summary.total_market_value).toBe(350)
    expect(store.has('summary:u1')).toBe(false)
  })

  it('during an import the summary is answered but not left in Redis, as the worker skips it', async () => {
    store.set('importing:u1', '1')
    h.supabase = ledger()

    expect((await GET(req)).status).toBe(200)
    expect(store.has('summary:u1')).toBe(false)
  })

  it('a holding with no quote source at all still leaves the summary, as the worker does', async () => {
    h.quotes = new Map()
    store.set('summary:version:u1', '7')
    h.supabase = ledger()

    const body = await (await GET(req)).json()

    expect(body.unpricedCount).toBeGreaterThan(0)
    expect(fakeRedis.eval).toHaveBeenCalledTimes(1)
    expect(store.get('summary:u1')).toBe(workerPayload(body))
  })

  it('with a dollar answered from its last known value the summary is answered but not left in Redis', async () => {
    mockDollar.mockImplementation(async (kind: string) => ({ rate: kind === 'mep' ? 1300 : 1400, asOf: '2026-10-20T20:00:00.000Z', source: 'lkp' }))
    store.set('summary:version:u1', '7')
    h.supabase = ledger()

    const res = await GET(req)

    expect(res.status).toBe(200)
    expect((await res.json()).currencies).toBeDefined()
    expect(fakeRedis.eval).not.toHaveBeenCalled() // the refresh behind it brings today's rate; the next miss caches that
  })

  it('without the currency views (no dollar today) the summary is answered but not left in Redis', async () => {
    mockDollar.mockResolvedValue(null)
    h.supabase = ledger()

    const body = await (await GET(req)).json()

    expect('currencies' in body).toBe(false)
    expect(store.has('summary:u1')).toBe(false)
  })

  it('reads the ledger once for the portfolio and its currency views', async () => {
    const log: string[] = []
    h.supabase = ledger(log)

    await GET(req)

    expect(log.filter(t => t === 'transactions')).toHaveLength(1)
    expect(log.filter(t => t === 'on_payment_overrides')).toHaveLength(1)
  })

  it('asks the dollar rates while the ledger is still being read', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const sb = ledger()
    const from = sb.from
    sb.from = (name: string) => {
      const b = from(name)
      if (name === 'transactions') { const then = b.then; b.then = (res: any, rej: any) => gate.then(() => then(res, rej)) }
      return b
    }
    h.supabase = sb

    const pending = GET(req)
    await vi.waitFor(() => expect(mockDollar).toHaveBeenCalledTimes(2))
    release()

    expect((await pending).status).toBe(200)
  })
})
