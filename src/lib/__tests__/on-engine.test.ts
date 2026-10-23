import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processONTransaction } from '../on-engine'
import { writeSupabase } from './fixtures/ledger-write-supabase'

// ── Mock Redis helpers ───────────────────────────────────────────────────────
const mockFns = {
  invalidateUserCache: vi.fn(),
  fetchONQuotesWithFallback: vi.fn(),
  addPriceUpdateJob: vi.fn(),
}

vi.mock('@/lib/redis', () => ({
  isRedisReady: () => false,
  getRedis: () => null,
  invalidateUserCache: (...args: any[]) => mockFns.invalidateUserCache(...args),
}))

vi.mock('@/lib/data912-client', () => ({
  fetchONQuotesWithFallback: (...args: any[]) => mockFns.fetchONQuotesWithFallback(...args),
}))

vi.mock('@/lib/queue', () => ({
  addPriceUpdateJob: (...args: any[]) => mockFns.addPriceUpdateJob(...args),
}))

vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => ({ from: () => ({ upsert: async () => ({ error: null }) }) }) }))

const held = { id: 'b1', user_id: 'user-1', ticker: 'AL30D', operation: 'COMPRA', quantity: 100, price: 70, commission: 0, date: '2023-12-01', asset_type: 'ON', created_at: '2023-12-01T10:00:00Z' }

describe('processONTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFns.fetchONQuotesWithFallback.mockResolvedValue(undefined)
    mockFns.addPriceUpdateJob.mockResolvedValue(undefined)
  })

  it('propagates a meaningful Error when the RPC returns a PostgrestError-like object', async () => {
    const supabase = writeSupabase({ transactions: [held] })
    supabase.rpc = vi.fn(async () => ({ data: null, error: { code: 'P0001', message: 'Invalid Price: Must be greater than 0' } as any }))

    await expect(
      processONTransaction(supabase as any, 'user-1', {
        date: '2024-01-01',
        ticker: 'AL30D',
        operation: 'VENTA',
        quantity: 100,
        price: 80,
      })
    ).rejects.toThrow('Invalid Price: Must be greater than 0')
  })

  it('returns position: null when a full VENTA closes the position', async () => {
    const supabase = writeSupabase({ transactions: [held] })

    const result = await processONTransaction(supabase as any, 'user-1', {
      date: '2024-01-01',
      ticker: 'AL30D',
      operation: 'VENTA',
      quantity: 100,
      price: 80,
    })

    expect(result.position).toBeNull()
    expect(result.closedTrade).toMatchObject({
      user_id: 'user-1',
      ticker: 'AL30D',
      quantity: 100,
      close_price: 80,
    })
  })
})
