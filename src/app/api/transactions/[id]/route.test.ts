import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockRebuild = vi.fn(async () => undefined)
vi.mock('@/lib/portfolio-engine', () => ({ rebuildPosition: (...a: unknown[]) => mockRebuild(...(a as [])) }))
vi.mock('@/lib/cash-engine', () => ({ rebuildCashBalance: vi.fn(async () => undefined) }))
vi.mock('@/lib/redis', () => ({ invalidateUserCache: vi.fn(async () => undefined) }))

const ID = '11111111-1111-4111-8111-111111111111'
let original: Record<string, unknown>
let updates: Record<string, unknown>[]

const db = {
  from(table: string) {
    const filters: Record<string, unknown> = {}
    let pendingUpdate: Record<string, unknown> | null = null
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (c: string, v: unknown) => { filters[c] = v; return chain }
    chain.lte = () => chain
    chain.order = () => chain
    chain.limit = () => chain
    chain.update = (obj: Record<string, unknown>) => { pendingUpdate = obj; updates.push(obj); return chain }
    chain.delete = () => chain
    chain.insert = async () => ({ error: null })
    chain.single = async () => {
      if (pendingUpdate) return { data: { ...original, ...pendingUpdate, ticker: original.ticker }, error: null }
      return { data: original, error: null }
    }
    chain.maybeSingle = async () => {
      if (table === 'cedears') return { data: filters.ticker === 'AAPL' ? { ratio: 20 } : null, error: null }
      if (table === 'fx_rates') return { data: filters.kind === 'mep' ? { date: '2026-03-02', buy: 1400, sell: 1400 } : { date: '2026-03-02', buy: 1500, sell: 1500 }, error: null }
      throw new Error(`unexpected table ${table}`)
    }
    return chain
  },
}
vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 'user-1' }, supabase: db })),
  isAuthFailure: () => false,
}))

const patch = (body: Record<string, unknown>) =>
  new NextRequest(`http://localhost/api/transactions/${ID}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  updates = []
  mockRebuild.mockClear()
  original = { ticker: 'AAPL', asset_type: 'CEDEAR', needs_review: true }
})

describe('PATCH /api/transactions/[id]', () => {
  it('corrects a CEDEAR from its broker ticket: re-derives on the server, stores the ticket and clears the review flag', async () => {
    const { PATCH } = await import('./route')
    const res = await PATCH(patch({
      date: '2026-03-02', ticker: 'AAPL', operation: 'COMPRA', assetType: 'CEDEAR',
      tradeCurrency: 'ARS', tradeQuantity: 40, tradePrice: 15000, tradeCommission: 0,
    }), { params: { id: ID } })
    expect(res.status).toBe(200)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      date: '2026-03-02', operation: 'COMPRA', quantity: 2, price: 200, commission: 0,
      trade_currency: 'ARS', trade_quantity: 40, trade_price: 15000, trade_commission: 0, cedear_ratio: 20,
      fx_mep: 1400, fx_ccl: 1500, fx_date: '2026-03-02', fx_source: 'reference', needs_review: false, review_note: null,
    })
    expect(mockRebuild).toHaveBeenCalledWith(db, 'user-1', 'AAPL')
  })

  it('refuses a ticket for a ticker that is not a CEDEAR and writes nothing', async () => {
    original = { ticker: 'DIS', asset_type: 'ACCION', needs_review: true }
    const { PATCH } = await import('./route')
    const res = await PATCH(patch({
      date: '2026-03-02', ticker: 'DIS', operation: 'COMPRA', assetType: 'CEDEAR',
      tradeCurrency: 'CCL', tradeQuantity: 2, tradePrice: 90,
    }), { params: { id: ID } })
    expect(res.status).toBe(400)
    expect(updates).toEqual([])
  })

  it('keeps the engine-value payload updating exactly the old columns', async () => {
    const { PATCH } = await import('./route')
    const res = await PATCH(patch({ date: '2026-03-02', ticker: 'AAPL', operation: 'VENTA', quantity: 2, price: 200, commission: 1, assetType: 'CEDEAR' }), { params: { id: ID } })
    expect(res.status).toBe(200)
    expect(updates).toEqual([{ date: '2026-03-02', operation: 'VENTA', quantity: -2, price: 200, commission: 1, notes: null }])
  })
})
