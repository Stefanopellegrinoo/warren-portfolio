import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createServiceClient } from '@/lib/supabase-server'
import { cacheUserSummaries, setSummaryIfVersion } from '../summary-cache'

const mockedCreateServiceClient = vi.mocked(createServiceClient)

const mockRedis = {
  del: vi.fn().mockResolvedValue(1),
  scan: vi.fn().mockResolvedValue(['0', []]),
  connect: vi.fn().mockResolvedValue(undefined),
  setex: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  eval: vi.fn().mockResolvedValue(1),
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  on: vi.fn(),
}

vi.mock('ioredis', () => {
  class MockRedis {
    constructor() {
      Object.assign(this, mockRedis)
    }
  }
  return { default: MockRedis }
})

vi.mock('@/lib/supabase-server', () => ({
  createServiceClient: vi.fn(),
  createServerClientInstance: vi.fn(),
}))

function createMockSupabase(tables: Record<string, any>) {
  return {
    from: vi.fn((table: string) => {
      const rows = tables[table] ?? []
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        data: rows,
        error: null,
      }
    }),
    rpc: vi.fn(),
  }
}

describe('setSummaryIfVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes summary when version has not changed', async () => {
    mockRedis.get.mockResolvedValue('1')
    mockRedis.eval.mockResolvedValue(1)

    const result = await setSummaryIfVersion('u1', '{"positions":[]}', '1')

    expect(result).toBe(true)
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'summary:u1',
      'summary:version:u1',
      '1',
      600,
      '{"positions":[]}'
    )
  })

  it('does not write summary when version changed', async () => {
    mockRedis.get.mockResolvedValue('2')
    mockRedis.eval.mockResolvedValue(0)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await setSummaryIfVersion('u1', '{"positions":[]}', '1')

    expect(result).toBe(false)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Discarded'))
    logSpy.mockRestore()
  })
})

describe('cacheUserSummaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedis.get.mockResolvedValue(null)
    mockRedis.eval.mockResolvedValue(1)
  })

  it('caches summary for cash-only users with non-zero balance', async () => {
    mockedCreateServiceClient.mockReturnValue(
      createMockSupabase({
        cash_balance: [{ user_id: 'cash-only', balance: 100 }],
      }) as any
    )

    const stockQuotes = new Map([['AAPL', { price: 150, change: 0, changePercent: 0 }]])
    await cacheUserSummaries(stockQuotes, new Map())

    const calls = mockRedis.eval.mock.calls
    const summaryCall = calls.find((call) => call[2] === 'summary:cash-only')
    expect(summaryCall).toBeDefined()
  })

  it('skips cash-only users with zero balance', async () => {
    mockedCreateServiceClient.mockReturnValue(
      createMockSupabase({
        cash_balance: [{ user_id: 'zero-cash', balance: 0 }],
      }) as any
    )

    const stockQuotes = new Map([['AAPL', { price: 150, change: 0, changePercent: 0 }]])
    await cacheUserSummaries(stockQuotes, new Map())

    const calls = mockRedis.eval.mock.calls
    const summaryCall = calls.find((call) => call[2] === 'summary:zero-cash')
    expect(summaryCall).toBeUndefined()
  })

  it('logs discarded write when version changed during computation', async () => {
    mockedCreateServiceClient.mockReturnValue(
      createMockSupabase({
        positions: [{ user_id: 'u1', ticker: 'AAPL', quantity: 1, total_invested: 100 }],
      }) as any
    )

    mockRedis.get.mockImplementation(async (key: string) => {
      if (key === 'importing:u1') return null
      if (key === 'summary:version:u1') return '1'
      return null
    })
    mockRedis.eval.mockResolvedValue(0)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const stockQuotes = new Map([['AAPL', { price: 150, change: 0, changePercent: 0 }]])
    await cacheUserSummaries(stockQuotes, new Map())

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Discarded'))
    logSpy.mockRestore()
  })

  it('characterization: an unpriced position is dropped from the totals but kept in the payload', async () => {
    // Arrange — AAPL priced @150; MISS has no quote (drop semantics)
    mockedCreateServiceClient.mockReturnValue(
      createMockSupabase({
        positions: [
          { user_id: 'u1', ticker: 'AAPL', quantity: 10, avg_cost: 100, total_invested: 1000 },
          { user_id: 'u1', ticker: 'MISS', quantity: 5, avg_cost: 100, total_invested: 500 },
        ],
        cash_balance: [{ user_id: 'u1', balance: 200 }],
      }) as any
    )
    const stockQuotes = new Map([['AAPL', { price: 150, change: 0, changePercent: 0 }]])

    // Act
    await cacheUserSummaries(stockQuotes, new Map())

    // Assert — pins today's dashboard numbers so the valuation refactor
    // can prove it changed nothing. eval args: (script, 2, key, versionKey,
    // version, ttl, payload) → payload is index 6.
    const call = mockRedis.eval.mock.calls.find((c) => c[2] === 'summary:u1')
    expect(call).toBeDefined()
    const payload = JSON.parse(call![6])
    expect(payload.summary.total_market_value).toBe(1700) // 10×150 + 200 cash; MISS contributes nothing
    expect(payload.summary.total_invested).toBe(1000)     // MISS's 500 invested also dropped
    expect(payload.summary.open_pnl).toBe(500)
    expect(payload.positions).toHaveLength(2)             // MISS still listed…
    expect(payload.positions[1].market_value).toBeUndefined() // …just unpriced
  })
})
