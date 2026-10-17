import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture every BullMQ Worker so tests can invoke its event handlers and processor.
const h = vi.hoisted(() => ({
  workers: [] as Array<{ name: string; processor: unknown; handlers: Record<string, (...a: any[]) => unknown> }>,
  beat: vi.fn(),
  alertJobFailure: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Worker: class {
    handlers: Record<string, (...a: any[]) => unknown> = {}
    constructor(name: string, processor: unknown) {
      h.workers.push({ name, processor, handlers: this.handlers })
    }
    on(event: string, fn: (...a: any[]) => unknown) {
      this.handlers[event] = fn
    }
  },
}))
vi.mock('../job-health', () => ({ beat: h.beat, alertJobFailure: h.alertJobFailure, recordRefresh: vi.fn() }))
vi.mock('../queue', () => ({
  PRICE_QUEUE_NAME: 'price-q', PRICE_REPEAT_JOB_NAME: 'r', SNAPSHOT_JOB_NAME: 's', TICKER_AUDIT_JOB_NAME: 't',
  IMPORT_QUEUE_NAME: 'import-q',
}))
vi.mock('../signals-queue', () => ({ SIGNALS_QUEUE_NAME: 'signals-q' }))
vi.mock('../redis', () => ({
  getRedis: () => null, getRedisConnectionOpts: () => ({}), invalidateUserCache: vi.fn(),
}))
vi.mock('../yahoo-finance', () => ({
  fetchQuotesFromYahoo: vi.fn(), cachePrice: vi.fn(), fetchQuotes: vi.fn(async () => new Map()),
  fetchQuotesWithFallback: vi.fn(),
}))
vi.mock('../data912-client', () => ({ fetchData912Prices: vi.fn() }))
vi.mock('../supabase-server', () => ({ createServiceClient: () => ({}) }))
vi.mock('../summary-cache', () => ({ cacheUserSummaries: vi.fn() }))
vi.mock('../portfolio-snapshots', () => ({
  snapshotAllUsers: vi.fn(),
  splitQuotesByAssetClass: () => ({ stockQuotes: new Map(), onQuotes: new Map() }),
}))
vi.mock('../portfolio-engine', () => ({ processTransactionBatch: vi.fn() }))
vi.mock('../import-worker', () => ({ startImportWorker: vi.fn() }))
vi.mock('../signals-worker', async (orig) => orig())
vi.mock('../notifications', async () => ({
  ...(await vi.importActual<typeof import('../notifications')>('../notifications')),
  checkNotificationConfig: vi.fn(), sendTelegram: vi.fn(),
}))
vi.mock('../worker-startup', () => ({
  ensureRedisAndScheduleJobs: vi.fn(async () => ({})),
  resolveStartupOutcome: () => ({ exit: false }),
}))
vi.mock('../ticker-audit', () => ({ auditTickerIdentities: vi.fn() }))
vi.mock('../on-price-history', () => ({ captureOnPriceHistory: vi.fn() }))

const find = (name: string) => h.workers.find((w) => w.name === name)!

beforeEach(() => {
  h.beat.mockReset()
  h.alertJobFailure.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('price worker event wiring', () => {
  it('beats on completed and alerts (price, job name, error) on failed', async () => {
    await import('../price-worker')
    const w = find('price-q')
    w.handlers.completed({ name: 'refresh', id: '1' })
    expect(h.beat).toHaveBeenCalledTimes(1)
    expect(h.alertJobFailure).not.toHaveBeenCalled()

    const err = new Error('boom')
    w.handlers.failed({ name: 'refresh', id: '1' }, err)
    expect(h.alertJobFailure).toHaveBeenCalledWith('price', 'refresh', err)
  })

  it('falls back to "unknown" when failed fires without a job', async () => {
    await import('../price-worker')
    const err = new Error('x')
    find('price-q').handlers.failed(undefined, err)
    expect(h.alertJobFailure).toHaveBeenCalledWith('price', 'unknown', err)
  })
})

describe('signals worker event wiring', () => {
  it('alerts (signals, job name, error) on failed', async () => {
    const { startSignalsWorker } = await import('../signals-worker')
    startSignalsWorker()
    const err = new Error('bad')
    find('signals-q').handlers.failed({ name: 'eval', id: '2' }, err)
    expect(h.alertJobFailure).toHaveBeenCalledWith('signals', 'eval', err)
  })
})

describe('import worker', () => {
  it('alerts from the processor catch block, since it returns instead of throwing', async () => {
    const { processTransactionBatch } = await import('../portfolio-engine')
    vi.mocked(processTransactionBatch).mockRejectedValueOnce(new Error('db down'))
    vi.doUnmock('../import-worker')
    vi.resetModules()
    await import('../import-worker')
    const processor = find('import-q').processor as (job: unknown) => Promise<{ success: boolean }>
    const res = await processor({
      id: 'j1', name: 'import', updateProgress: vi.fn(),
      data: { userId: '00000000-0000-4000-8000-000000000001', transactions: [{ ticker: 'AAA' }], replace: false },
    })
    expect(res.success).toBe(false)
    expect(h.alertJobFailure).toHaveBeenCalledWith('import', 'import', expect.any(Error))
  })
})
