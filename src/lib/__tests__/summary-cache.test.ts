import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createServiceClient } from '@/lib/supabase-server'
import { cacheUserSummaries, setSummaryIfVersion } from '../summary-cache'
import { ledgerSupabase, trade, movement } from './fixtures/ledger-supabase'

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
      ledgerSupabase({ cash_movements: [movement({ user_id: 'cash-only', amount: 100 })] })
    )

    const stockQuotes = new Map([['AAPL', { price: 150, change: 0, changePercent: 0 }]])
    await cacheUserSummaries(stockQuotes, new Map())

    const calls = mockRedis.eval.mock.calls
    const summaryCall = calls.find((call) => call[2] === 'summary:cash-only')
    expect(summaryCall).toBeDefined()
  })

  it('skips cash-only users with zero balance', async () => {
    mockedCreateServiceClient.mockReturnValue(
      ledgerSupabase({ cash_movements: [
        movement({ user_id: 'zero-cash', amount: 100 }),
        movement({ user_id: 'zero-cash', type: 'RETIRO', amount: 100, date: '2026-01-03' }),
      ] })
    )

    const stockQuotes = new Map([['AAPL', { price: 150, change: 0, changePercent: 0 }]])
    await cacheUserSummaries(stockQuotes, new Map())

    const calls = mockRedis.eval.mock.calls
    const summaryCall = calls.find((call) => call[2] === 'summary:zero-cash')
    expect(summaryCall).toBeUndefined()
  })

  it('logs discarded write when version changed during computation', async () => {
    mockedCreateServiceClient.mockReturnValue(
      ledgerSupabase({ transactions: [trade({ quantity: 1 })] })
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

  it('reads the ledger core and marks an unpriced position at its cost (S3), never the stored tables', async () => {
    // Arrange — AAPL priced @150; MISS has no quote
    mockedCreateServiceClient.mockReturnValue(
      ledgerSupabase({
        transactions: [trade(), trade({ ticker: 'MISS', quantity: 5 })],
        cash_movements: [
          movement({ amount: 1700 }),
          movement({ type: 'COMPRA', amount: 1500, date: '2026-01-05' }),
        ],
      })
    )
    const stockQuotes = new Map([['AAPL', { price: 150, change: 0, changePercent: 0 }]])

    // Act
    await cacheUserSummaries(stockQuotes, new Map())

    // Assert — eval args: (script, 2, key, versionKey, version, ttl, payload) → payload is index 6.
    const call = mockRedis.eval.mock.calls.find((c) => c[2] === 'summary:u1')
    expect(call).toBeDefined()
    const payload = JSON.parse(call![6])
    expect(payload.summary.total_market_value).toBe(2200) // 10×150 + MISS at cost 500 + 200 cash
    expect(payload.summary.total_invested).toBe(1500)
    expect(payload.summary.open_pnl).toBe(500)
    expect(payload.positions.map((p: any) => p.ticker)).toEqual(['AAPL', 'MISS'])
    expect(payload.positions[1].market_value).toBe(500)
    expect(payload.unpricedCount).toBe(1)
    expect(payload.unpricedTickers).toEqual(['MISS'])
  })
})
