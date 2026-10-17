import { describe, it, expect, vi, beforeEach } from 'vitest'

// The import worker runs with the service role (RLS bypass). The only thing
// scoping its writes is job.data.userId, so pin that every user-scoped effect
// uses exactly that id.
const h = vi.hoisted(() => ({
  processor: null as null | ((job: unknown) => Promise<any>),
  batch: vi.fn(),
  invalidate: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(_n: string, processor: (job: unknown) => Promise<any>) { h.processor = processor }
    on() {}
  },
}))
vi.mock('../queue', () => ({ IMPORT_QUEUE_NAME: 'import-q' }))
vi.mock('../redis', () => ({
  getRedis: () => ({ setex: h.setex, del: h.del }),
  getRedisConnectionOpts: () => ({}),
  invalidateUserCache: (...a: unknown[]) => h.invalidate(...a),
}))
vi.mock('../supabase-server', () => ({ createServiceClient: () => ({ tag: 'service' }) }))
vi.mock('../portfolio-engine', () => ({ processTransactionBatch: (...a: unknown[]) => h.batch(...a) }))
vi.mock('../yahoo-finance', () => ({ fetchQuotesWithFallback: vi.fn() }))
vi.mock('../job-health', () => ({ alertJobFailure: vi.fn() }))

await import('../import-worker')

const USER_A = '00000000-0000-4000-8000-0000000000aa'
const job = (userId: string) => ({
  id: 'j1', name: 'import', updateProgress: vi.fn(),
  data: { userId, transactions: [{ ticker: 'AAA' }], replace: true },
})

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  h.batch.mockReset().mockResolvedValue({ success: true, imported: 1, failed: 0, errors: [] })
  h.invalidate.mockReset()
  h.setex.mockReset()
  h.del.mockReset()
})

describe('import worker user scoping', () => {
  it('passes job.data.userId to the batch, the lock and the cache invalidation', async () => {
    await h.processor!(job(USER_A))
    expect(h.batch.mock.calls[0][1]).toBe(USER_A)
    expect(h.batch.mock.calls[0][3]).toBe(true)
    expect(h.setex).toHaveBeenCalledWith(`importing:${USER_A}`, 3600, '1')
    expect(h.invalidate).toHaveBeenCalledWith(USER_A)
    expect(h.del).toHaveBeenCalledWith(`importing:${USER_A}`)
  })

  it('releases the lock of the same user even when the batch throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.batch.mockRejectedValue(new Error('db down'))
    const res = await h.processor!(job(USER_A))
    expect(res.success).toBe(false)
    expect(h.del).toHaveBeenCalledWith(`importing:${USER_A}`)
    expect(h.invalidate).not.toHaveBeenCalled()
  })
})
