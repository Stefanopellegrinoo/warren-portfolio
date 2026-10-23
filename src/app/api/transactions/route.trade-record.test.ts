import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockProcessTransaction = vi.fn()
vi.mock('@/lib/portfolio-engine', () => ({ processTransaction: (...a: unknown[]) => mockProcessTransaction(...a) }))
vi.mock('@/lib/redis', () => ({ invalidateUserCache: vi.fn(async () => undefined) }))
vi.mock('@/lib/ticker-identity', () => ({ resolveTickerIdentity: vi.fn() }))
vi.mock('@/lib/ticker-catalog', () => ({ getCataloguedTicker: vi.fn(async () => ({ ticker: 'AAPL' })), upsertTickerIdentity: vi.fn() }))
// cedears and fx_rates are market tables (S12): the route reads them with the service client.
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: vi.fn(() => marketClient) }))

const fx: Record<string, { date: string; buy: number; sell: number }> = {
  mep: { date: '2026-10-20', buy: 1440, sell: 1460 },
  ccl: { date: '2026-10-20', buy: 1490, sell: 1510 },
}
// The session has no SELECT on market tables: any read through it fails the test.
const userClient = {
  from(table: string) {
    throw new Error(`market table read with the user session: ${table}`)
  },
}
const marketClient = {
  from(table: string) {
    const filters: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (c: string, v: unknown) => { filters[c] = v; return chain }
    chain.lte = () => chain
    chain.order = () => chain
    chain.limit = () => chain
    chain.maybeSingle = async () => {
      if (table === 'cedears') return { data: filters.ticker === 'AAPL' ? { ratio: 20 } : null, error: null }
      if (table === 'fx_rates') return { data: fx[filters.kind as string], error: null }
      throw new Error(`unexpected table ${table}`)
    }
    return chain
  },
}
vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 'user-1' }, supabase: userClient })),
  isAuthFailure: () => false,
}))

const post = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

const ticket = {
  date: '2026-10-20', ticker: 'AAPL', operation: 'COMPRA', assetType: 'CEDEAR',
  tradeCurrency: 'ARS', tradeQuantity: 40, tradePrice: 15000, tradeCommission: 3000,
}

beforeEach(() => {
  mockProcessTransaction.mockReset()
  mockProcessTransaction.mockResolvedValue({ transaction: { id: 'tx-1' } })
})

describe('POST /api/transactions — CEDEAR broker ticket', () => {
  it('derives the engine values on the server and stores the raw ticket next to them', async () => {
    const { POST } = await import('./route')
    const res = await POST(post(ticket))
    expect(res.status).toBe(201)
    const [, userId, input] = mockProcessTransaction.mock.calls[0]
    expect(userId).toBe('user-1')
    expect(input).toMatchObject({ date: '2026-10-20', ticker: 'AAPL', operation: 'COMPRA', assetType: 'CEDEAR', moneda: 'ARS', quantity: 2 })
    expect(input.price).toBeCloseTo(200, 10)
    expect(input.commission).toBeCloseTo(2, 10)
    expect(input.tradeRecord).toEqual({
      tradeCurrency: 'ARS', tradeQuantity: 40, tradePrice: 15000, tradeCommission: 3000,
      cedearRatio: 20, fxMep: 1450, fxCcl: 1500, fxDate: '2026-10-20', fxSource: 'reference',
    })
  })

  it('rejects a ticket with a bad currency with 400 and writes nothing', async () => {
    const { POST } = await import('./route')
    const res = await POST(post({ ...ticket, tradeCurrency: 'USD' }))
    expect(res.status).toBe(400)
    expect(mockProcessTransaction).not.toHaveBeenCalled()
  })

  it('rejects a ticker that is not a CEDEAR with 400 and writes nothing', async () => {
    const { POST } = await import('./route')
    const res = await POST(post({ ...ticket, ticker: 'ZZZZ' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'ZZZZ no figura en la lista de CEDEARs.' })
    expect(mockProcessTransaction).not.toHaveBeenCalled()
  })

  it('keeps the old engine-value payload working unchanged (import and other callers)', async () => {
    const { POST } = await import('./route')
    const old = { date: '2026-10-20', ticker: 'AAPL', operation: 'COMPRA', quantity: 2, price: 200, commission: 1, assetType: 'CEDEAR', moneda: 'ARS' }
    const res = await POST(post(old))
    expect(res.status).toBe(201)
    const [, , input] = mockProcessTransaction.mock.calls[0]
    expect(input).toEqual({ ...old })
    expect(input.tradeRecord).toBeUndefined()
  })
})
