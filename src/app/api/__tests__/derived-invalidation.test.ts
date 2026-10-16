// REQ-6 matrix: every path that writes the ledger must drop the derived history
// (invalidateUserCache deletes derived:v1:{uid} — see redis.test.ts) AFTER the write.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  events: [] as string[],
  processor: null as null | ((job: any) => Promise<any>),
  batch: { success: true, imported: 3, failed: 0, errors: [] as unknown[] },
}))

const txRow = { ticker: 'AAA', asset_type: 'ACCION', date: '2026-04-15', operation: 'COMPRA', quantity: 1, price: 10 }
const WRITES = new Set(['insert', 'update', 'delete', 'upsert', 'rpc'])
/** Chainable PostgREST stand-in: every chain resolves to `{ data: txRow, error: null }`. */
function chain(): any {
  return new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') return (res: any) => Promise.resolve({ data: txRow, error: null }).then(res)
      return () => { if (WRITES.has(prop)) h.events.push('write'); return chain() }
    },
  })
}

vi.mock('@/lib/api-auth', () => ({
  requireUser: async () => ({ supabase: chain(), user: { id: 'u1' } }),
  isAuthFailure: (r: any) => 'error' in r,
}))
vi.mock('@/lib/redis', () => ({
  invalidateUserCache: async (id: string) => { h.events.push(`invalidate:${id}`) },
  getRedis: () => null,
  isRedisReady: () => false,
  getRedisConnectionOpts: () => ({}),
  SUMMARY_VERSION_TTL: 1200,
}))
vi.mock('@/lib/cache', () => ({ invalidateCacheKey: vi.fn() }))
vi.mock('@/lib/queue', () => ({ addRefreshSummaryJob: vi.fn(), IMPORT_QUEUE_NAME: 'import' }))
vi.mock('@/lib/ticker-catalog', () => ({ getCataloguedTicker: async () => ({ ticker: 'AAA' }), upsertTickerIdentity: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => chain(), createServerClientInstance: () => chain() }))
vi.mock('@/lib/yahoo-finance', () => ({ fetchQuotesWithFallback: vi.fn() }))
vi.mock('bullmq', () => ({
  Worker: class { constructor(_q: string, processor: (job: any) => Promise<any>) { h.processor = processor } on() {} },
}))
vi.mock('@/lib/portfolio-engine', () => ({
  processTransaction: async () => { h.events.push('write'); return { ok: true } },
  rebuildPosition: async () => { h.events.push('write') },
  processTransactionBatch: async () => h.batch,
}))
vi.mock('@/lib/on-engine', () => ({
  processONTransaction: async () => { h.events.push('write'); return { ok: true } },
  rebuildONPosition: async () => { h.events.push('write') },
}))
vi.mock('@/lib/cash-engine', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/cash-engine')>()
  return {
    ...real,
    rebuildCashBalance: async () => { h.events.push('write') },
    adjustCashBalance: async () => { h.events.push('write'); return { movement: null, delta: 0, balance: null } },
    deleteCashMovement: async () => { h.events.push('write') },
  }
})

const ID = '3f2b8c1e-5a4d-4e6f-8b7a-1c2d3e4f5a6b'
const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/x', {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
const stock = { date: '2026-04-15', ticker: 'AAA', operation: 'COMPRA', quantity: 1, price: 10, assetType: 'ACCION' }

/** The write happened, THEN the user's cache was dropped. */
function expectInvalidatedAfterWrite() {
  const write = h.events.indexOf('write')
  const inval = h.events.indexOf('invalidate:u1')
  expect(write).toBeGreaterThan(-1)
  expect(inval).toBeGreaterThan(write)
}

beforeEach(() => {
  h.events.length = 0
  h.batch = { success: true, imported: 3, failed: 0, errors: [] }
})

describe('REQ-6 write paths invalidate the derived history', () => {
  it('POST /api/transactions', async () => {
    const { POST } = await import('../transactions/route')
    expect((await POST(req('POST', stock))).status).toBe(201)
    expectInvalidatedAfterWrite()
  })

  it('PATCH /api/transactions/[id]', async () => {
    const { PATCH } = await import('../transactions/[id]/route')
    expect((await PATCH(req('PATCH', stock), { params: { id: ID } })).status).toBe(200)
    expectInvalidatedAfterWrite()
  })

  it('DELETE /api/transactions/[id]', async () => {
    const { DELETE } = await import('../transactions/[id]/route')
    expect((await DELETE(req('DELETE'), { params: { id: ID } })).status).toBe(200)
    expectInvalidatedAfterWrite()
  })

  it('POST /api/on-positions', async () => {
    const { POST } = await import('../on-positions/route')
    const res = await POST(req('POST', { date: '2026-04-15', ticker: 'AERBD', operation: 'COMPRA', quantity: 10, price: 100 }))
    expect(res.status).toBe(201)
    expectInvalidatedAfterWrite()
  })

  it('POST /api/cash (invalidated inside processCashMovement)', async () => {
    const { POST } = await import('../cash/route')
    const res = await POST(req('POST', { date: '2026-04-15', type: 'DEPOSITO', amount: 100 }) as unknown as Request)
    expect(res.status).toBe(200)
    expectInvalidatedAfterWrite()
  })

  it('POST /api/cash/adjust', async () => {
    const { POST } = await import('../cash/adjust/route')
    expect((await POST(req('POST', { balance: 100, date: '2026-04-15' }))).status).toBe(200)
    expectInvalidatedAfterWrite()
  })

  it('DELETE /api/cash/movements/[id] (a CUPON movement leaves the ledger)', async () => {
    const { DELETE } = await import('../cash/movements/[id]/route')
    expect((await DELETE(req('DELETE'), { params: { id: ID } })).status).toBe(200)
    expectInvalidatedAfterWrite()
  })

  it('import worker: imported > 0 invalidates, imported = 0 is a no-op', async () => {
    await import('@/lib/import-worker')
    const job = { id: 'j1', data: { userId: 'u1', transactions: [{ ticker: '' }], replace: false }, updateProgress: async () => {} }

    await h.processor!(job)
    expect(h.events).toContain('invalidate:u1')

    h.events.length = 0
    h.batch = { success: false, imported: 0, failed: 1, errors: [] }
    await h.processor!(job)
    expect(h.events).not.toContain('invalidate:u1')
  })
})
