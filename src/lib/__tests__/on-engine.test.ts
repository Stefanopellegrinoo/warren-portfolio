import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processONTransaction } from '../on-engine'

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

function makeMockSupabase(overrides: {
  rpcError?: { code: string; message: string } | null
  rpcData?: any
  position?: any
  closedTrade?: any
} = {}) {
  const { rpcError = null, rpcData = null, position = null, closedTrade = null } = overrides

  return {
    rpc: vi.fn().mockResolvedValue({ data: rpcData, error: rpcError }),
    from: vi.fn((table: string) => {
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: table === 'on_positions' ? position : closedTrade,
          error: null,
        }),
      }
      return builder
    }),
  } as any
}

describe('processONTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFns.fetchONQuotesWithFallback.mockResolvedValue(undefined)
    mockFns.addPriceUpdateJob.mockResolvedValue(undefined)
  })

  it('propagates a meaningful Error when the RPC returns a PostgrestError-like object', async () => {
    const supabase = makeMockSupabase({
      rpcError: {
        code: 'P0001',
        message: 'Insufficient position for ON sale',
      },
    })

    await expect(
      processONTransaction(supabase, 'user-1', {
        date: '2024-01-01',
        ticker: 'AL30D',
        operation: 'VENTA',
        quantity: 100,
        price: 80,
      })
    ).rejects.toThrow('Insufficient position for ON sale')
  })

  it('returns position: null when a full VENTA closes the position', async () => {
    const supabase = makeMockSupabase({
      rpcData: { transaction_id: 'tx-1' },
      position: null,
      closedTrade: {
        id: 'ct-1',
        user_id: 'user-1',
        ticker: 'AL30D',
        quantity: 100,
        close_price: 80,
      },
    })

    const result = await processONTransaction(supabase, 'user-1', {
      date: '2024-01-01',
      ticker: 'AL30D',
      operation: 'VENTA',
      quantity: 100,
      price: 80,
    })

    expect(result.position).toBeNull()
    expect(result.closedTrade).toEqual({
      id: 'ct-1',
      user_id: 'user-1',
      ticker: 'AL30D',
      quantity: 100,
      close_price: 80,
    })
  })
})
