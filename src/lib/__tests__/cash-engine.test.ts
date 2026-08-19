import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processCashMovement, rebuildCashBalance } from '../cash-engine'

const mockAddRefreshSummaryJob = vi.fn().mockResolvedValue(undefined)
const mockInvalidateUserCache = vi.fn().mockResolvedValue(undefined)

vi.mock('../queue', () => ({
  addRefreshSummaryJob: vi.fn().mockResolvedValue(undefined),
  addPriceUpdateJob: vi.fn().mockResolvedValue(undefined),
  scheduleRepeatingPriceJob: vi.fn().mockResolvedValue(undefined),
  getPriceQueue: vi.fn(),
  getImportQueue: vi.fn(),
  PRICE_QUEUE_NAME: 'price-updates',
  IMPORT_QUEUE_NAME: 'import-transactions',
}))

vi.mock('../redis', () => ({
  getRedis: vi.fn(),
  isRedisReady: vi.fn().mockReturnValue(false),
  invalidateUserCache: vi.fn().mockResolvedValue(undefined),
  ensureRedisConnected: vi.fn().mockResolvedValue(false),
}))

import * as queueModule from '../queue'

const mockedAddRefreshSummaryJob = vi.mocked(queueModule.addRefreshSummaryJob)

describe('processCashMovement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedAddRefreshSummaryJob.mockResolvedValue(undefined)
  })

  it('enqueues a summary refresh after processing', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValue({ data: { transaction_id: 'tx-1' }, error: null }),
      from: vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: table === 'cash_movements'
            ? { id: 'cm-1', user_id: 'u1', amount: 100 }
            : { user_id: 'u1', balance: 100 },
          error: null,
        }),
      })),
    }

    await processCashMovement(mockSupabase as any, 'u1', {
      date: '2024-01-01',
      type: 'DEPOSITO',
      amount: 100,
      description: 'Test deposit',
    })

    expect(mockedAddRefreshSummaryJob).toHaveBeenCalledWith('u1')
  })
})

describe('rebuildCashBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedAddRefreshSummaryJob.mockResolvedValue(undefined)
  })

  it('enqueues a summary refresh after rebuild', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'cash_movements') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            data: [],
            error: null,
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { user_id: 'u1', balance: 0 }, error: null }),
            }),
          }),
          data: { user_id: 'u1', balance: 0 },
          error: null,
        }
      }),
    }

    await rebuildCashBalance(mockSupabase as any, 'u1')

    expect(mockedAddRefreshSummaryJob).toHaveBeenCalledWith('u1')
  })
})
