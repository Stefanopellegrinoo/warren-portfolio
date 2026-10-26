import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Ledger reads load the stock splits (odd/tasks/split-aware-ledger.md T3): none unless a test sets them.
const h = vi.hoisted(() => ({ splits: new Map<string, unknown[]>(), bars: new Map<string, unknown>(), barReads: 0 }))
vi.mock('@/lib/stock-splits', () => ({ loadSplits: async () => h.splits }))
// The split-adjusted guard's market reads (S4).
vi.mock('@/lib/bars-cache', () => ({ getBars: async () => { h.barReads++; return h.bars } }))
vi.mock('@/lib/ticker-catalog', async orig => ({ ...(await orig<object>()), listCatalogued: async () => [{ ticker: 'GOOGL', yahoo_symbol: 'GOOGL' }] }))
vi.mock('@/lib/redis', () => ({ invalidateUserCache: vi.fn(async () => undefined) }))

const ID = '11111111-1111-4111-8111-111111111111'
let original: Record<string, unknown>
let updates: Record<string, unknown>[]
let deletes: string[]
/** The user's ledger, as the core's sale validation reads it (T5.1). */
let ledger: Record<string, unknown>[]

// After migration 049 the user client is denied the market tables (S12); only the
// service client reads cedears and fx_rates.
const MARKET = new Set(['cedears', 'fx_rates'])
const makeClient = (role: 'user' | 'service') => ({
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
    chain.delete = () => { deletes.push(table); return chain }
    chain.range = async () => ({ data: table === 'transactions' ? ledger : [], error: null })
    chain.insert = async () => ({ error: null })
    chain.single = async () => {
      if (pendingUpdate) return { data: { ...original, ...pendingUpdate, ticker: original.ticker }, error: null }
      return { data: original, error: null }
    }
    chain.maybeSingle = async () => {
      if (role === 'user' && MARKET.has(table)) return { data: null, error: { code: '42501', message: `permission denied for table ${table}` } }
      if (table === 'cedears') return { data: filters.ticker === 'AAPL' ? { ratio: 20 } : null, error: null }
      if (table === 'fx_rates') return { data: filters.kind === 'mep' ? { date: '2026-03-02', buy: 1400, sell: 1400 } : { date: '2026-03-02', buy: 1500, sell: 1500 }, error: null }
      throw new Error(`unexpected table ${table}`)
    }
    return chain
  },
})
const db = makeClient('user')
const market = makeClient('service')
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => market }))
vi.mock('@/lib/api-auth', () => ({
  requireUser: vi.fn(async () => ({ user: { id: 'user-1' }, supabase: db })),
  isAuthFailure: () => false,
}))

const patch = (body: Record<string, unknown>) =>
  new NextRequest(`http://localhost/api/transactions/${ID}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  updates = []
  deletes = []
  ledger = []
  original = { ticker: 'AAPL', asset_type: 'CEDEAR', needs_review: true }
  h.splits = new Map()
  h.bars = new Map()
  h.barReads = 0
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

describe('the core validates edits and deletes (T5.1)', () => {
  const sale = { id: 's1', ticker: 'AAPL', operation: 'VENTA', quantity: -2, price: 210, commission: 0, date: '2026-03-05', asset_type: 'CEDEAR', created_at: '2026-03-05T10:00:00Z' }
  const bought = { id: ID, ticker: 'AAPL', operation: 'COMPRA', quantity: 2, price: 200, commission: 0, date: '2026-03-02', asset_type: 'CEDEAR', created_at: '2026-03-02T10:00:00Z' }

  it('refuses an edit that leaves a later sale selling more than held, with 400, and writes nothing', async () => {
    ledger = [bought, sale]
    const { PATCH } = await import('./route')
    const res = await PATCH(patch({ date: '2026-03-02', ticker: 'AAPL', operation: 'COMPRA', quantity: 1, price: 200, assetType: 'CEDEAR' }), { params: { id: ID } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('No podés vender 2 AAPL el 2026-03-05: a esa fecha tenías 1.')
    expect(updates).toEqual([])
    expect(deletes).toEqual([])
  })

  it('refuses deleting the buy a later sale depends on, with 400, and deletes nothing', async () => {
    ledger = [bought, sale]
    const { DELETE } = await import('./route')
    const res = await DELETE(new NextRequest(`http://localhost/api/transactions/${ID}`, { method: 'DELETE' }), { params: { id: ID } })
    expect(res.status).toBe(400)
    expect(deletes).toEqual([])
  })

  it('a delete that breaks nothing keeps its previous response shape', async () => {
    ledger = [bought]
    const { DELETE } = await import('./route')
    const res = await DELETE(new NextRequest(`http://localhost/api/transactions/${ID}`, { method: 'DELETE' }), { params: { id: ID } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, invalidated: expect.any(Number), message: 'Transaction deleted. Portfolio and cash balance recalculated.' })
    expect(deletes).toEqual(['transactions'])
  })
})

describe('split-adjusted edits (odd/tasks/split-aware-ledger.md S4)', () => {
  const split = [{ date: '2022-07-18', numerator: 20, denominator: 1 }]
  const adjusted = { date: '2022-03-21', ticker: 'GOOGL', operation: 'COMPRA', quantity: 17.93, price: 136.98, assetType: 'ACCION' }

  beforeEach(() => {
    h.splits = new Map([['GOOGL', split]])
    h.bars = new Map([['GOOGL', { bars: [{ date: '2022-03-18', close: 140.123 }], splits: split, splitsKnown: true, degraded: false, missing: false }]])
  })

  it('refuses an edit that makes a pre-split row split-adjusted, with 400, and writes nothing', async () => {
    original = { ticker: 'GOOGL', asset_type: 'ACCION', date: '2022-03-21', quantity: 0.8965, price: 2739.6 }
    const { PATCH } = await import('./route')
    const res = await PATCH(patch(adjusted), { params: { id: ID } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('El precio de GOOGL el 2022-03-21 (136.98) parece ajustado por el split 20:1 del 2022-07-18: ese día cotizaba cerca de 2802.46. Cargala como figura en tu comprobante: 0.8965 a 2739.6.')
    expect(updates).toEqual([])
    expect(deletes).toEqual([])
  })

  it('an edit of the notes only on an old row is not checked', async () => {
    original = { ticker: 'GOOGL', asset_type: 'ACCION', date: '2022-03-21', quantity: 17.93, price: 136.98 }
    const { PATCH } = await import('./route')
    const res = await PATCH(patch({ ...adjusted, notes: 'from the broker' }), { params: { id: ID } })
    expect(res.status).toBe(200)
    expect(updates).toEqual([{ date: '2022-03-21', operation: 'COMPRA', quantity: 17.93, price: 136.98, commission: 0, notes: 'from the broker' }])
    expect(h.barReads).toBe(0)
  })
})
