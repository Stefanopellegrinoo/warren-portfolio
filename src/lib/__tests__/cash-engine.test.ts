import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processCashMovement } from '../cash-engine'
import { writeSupabase } from './fixtures/ledger-write-supabase'

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
    const sb = writeSupabase()

    await processCashMovement(sb as any, 'u1', {
      date: '2024-01-01',
      type: 'DEPOSITO',
      amount: 100,
      description: 'Test deposit',
    })

    expect(mockedAddRefreshSummaryJob).toHaveBeenCalledWith('u1')
  })

  it('keeps the response shape: the movement and the balance', async () => {
    const sb = writeSupabase()

    const result = await processCashMovement(sb as any, 'u1', { date: '2024-01-01', type: 'RETIRO', amount: 40 })

    expect(result).toEqual({
      movement: expect.objectContaining({ type: 'RETIRO', amount: 40, transaction_id: null }),
      balance: { user_id: 'u1', balance: -40 },
    })
  })
})
