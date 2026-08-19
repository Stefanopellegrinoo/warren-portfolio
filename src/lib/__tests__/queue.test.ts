import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addRefreshSummaryJob, addPriceUpdateJob, addImportJob, QueueUnavailableError } from '../queue'

process.env.REDIS_URL = 'redis://localhost:6379'

const mockAdd = vi.fn().mockResolvedValue({ id: 'job-id' })
const mockGetRepeatableJobs = vi.fn().mockResolvedValue([])
const mockRemoveRepeatableByKey = vi.fn().mockResolvedValue(undefined)
const mockEnsureRedisConnected = vi.fn()

vi.mock('bullmq', () => {
  class MockQueue {
    add = mockAdd
    getRepeatableJobs = mockGetRepeatableJobs
    removeRepeatableByKey = mockRemoveRepeatableByKey
  }
  return { Queue: MockQueue, Worker: vi.fn() }
})

vi.mock('ioredis', () => {
  class MockRedis {
    constructor() {}
  }
  return { default: MockRedis }
})

vi.mock('../redis', () => ({
  ensureRedisConnected: () => mockEnsureRedisConnected(),
}))

describe('addRefreshSummaryJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureRedisConnected.mockResolvedValue(true)
  })

  it('enqueues refresh-summary with dedup jobId', async () => {
    await addRefreshSummaryJob('u1')

    expect(mockAdd).toHaveBeenCalledWith(
      'refresh-summary',
      { userId: 'u1' },
      expect.objectContaining({
        jobId: 'refresh-summary-u1',
        removeOnComplete: true,
      })
    )
  })

  it('builds a jobId BullMQ will accept', async () => {
    // BullMQ rejects a custom job id containing ':' — it is its internal Redis
    // key separator — and throws "Custom Id cannot contain :". The mocked queue
    // above does not enforce that, so this asserts the constraint directly.
    // Without it, addRefreshSummaryJob silently failed on every single call.
    await addRefreshSummaryJob('user-with-uuid-1234-5678')

    const options = mockAdd.mock.calls.at(-1)?.[2]
    expect(options.jobId).not.toContain(':')
    expect(options.jobId).toBe('refresh-summary-user-with-uuid-1234-5678')
  })
})

// BullMQ's queue.add() HANGS on ioredis's offline queue when Redis is down
// (maxRetriesPerRequest: null) — it does not fail fast, and try/catch cannot
// save a promise that never settles. Every enqueue path must probe first.
describe('enqueue guards when Redis is unreachable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureRedisConnected.mockResolvedValue(false)
  })

  it('addRefreshSummaryJob skips (best-effort) instead of hanging', async () => {
    await addRefreshSummaryJob('u1')
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('addPriceUpdateJob skips (best-effort) instead of hanging', async () => {
    await addPriceUpdateJob(['AAPL'])
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('addImportJob rejects with QueueUnavailableError — imports NEED the queue', async () => {
    await expect(addImportJob('u1', [], false)).rejects.toBeInstanceOf(QueueUnavailableError)
    expect(mockAdd).not.toHaveBeenCalled()
  })
})
