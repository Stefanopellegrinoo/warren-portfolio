import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: string[] = []
const mockCapture = vi.fn()
const mockSnapshot = vi.fn()
const mockTelegram = vi.fn()

vi.mock('bullmq', () => ({ Worker: class { on() {} } }))
vi.mock('../queue', () => ({
  PRICE_QUEUE_NAME: 'q', PRICE_REPEAT_JOB_NAME: 'r', SNAPSHOT_JOB_NAME: 's', TICKER_AUDIT_JOB_NAME: 't',
}))
vi.mock('../yahoo-finance', () => ({
  fetchQuotesFromYahoo: vi.fn(), cachePrice: vi.fn(), fetchQuotes: vi.fn(async () => new Map()),
}))
vi.mock('../data912-client', () => ({ fetchData912Prices: vi.fn() }))
vi.mock('../supabase-server', () => ({
  createServiceClient: () => ({ from: () => ({ select: async () => ({ data: [], error: null }) }) }),
}))
vi.mock('../redis', () => ({ getRedis: () => null }))
vi.mock('../summary-cache', () => ({ cacheUserSummaries: vi.fn() }))
vi.mock('../portfolio-snapshots', () => ({
  snapshotAllUsers: (...a: unknown[]) => mockSnapshot(...a),
  splitQuotesByAssetClass: () => ({ stockQuotes: new Map(), onQuotes: new Map() }),
}))
vi.mock('../utils', () => ({ isMarketOpen: () => false, argentinaDate: () => '2026-10-16' }))
vi.mock('../import-worker', () => ({ startImportWorker: vi.fn() }))
vi.mock('../signals-worker', () => ({ startSignalsWorker: vi.fn() }))
vi.mock('../notifications', () => ({
  checkNotificationConfig: vi.fn(), sendTelegram: (...a: unknown[]) => mockTelegram(...a),
}))
vi.mock('../worker-startup', () => ({
  ensureRedisAndScheduleJobs: vi.fn(async () => ({})),
  resolveStartupOutcome: () => ({ exit: false }),
}))
vi.mock('../ticker-audit', () => ({ auditTickerIdentities: vi.fn() }))
vi.mock('../on-price-history', () => ({ captureOnPriceHistory: (...a: unknown[]) => mockCapture(...a) }))

const { runSnapshotJob } = await import('../price-worker')

beforeEach(() => {
  calls.length = 0
  mockCapture.mockReset().mockImplementation(async () => { calls.push('capture'); return 250 })
  mockSnapshot.mockReset().mockImplementation(async () => { calls.push('snapshot') })
  mockTelegram.mockReset().mockResolvedValue({ ok: true })
})

describe('runSnapshotJob', () => {
  it('captures BEFORE snapshotting, both on the Argentine date', async () => {
    await runSnapshotJob()
    expect(calls).toEqual(['capture', 'snapshot'])
    expect(mockCapture.mock.calls[0][1]).toBe('2026-10-16')
    expect(mockSnapshot.mock.calls[0][2]).toBe('2026-10-16')
  })

  it('a capture failure alerts via Telegram and still runs the snapshots', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCapture.mockRejectedValue(new Error('data912 down'))
    await runSnapshotJob()
    expect(err).toHaveBeenCalled()
    expect(mockTelegram).toHaveBeenCalledWith(expect.stringContaining('data912 down'))
    expect(mockSnapshot).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })

  it('escapes HTML in the alert, or Telegram (parse_mode HTML) rejects it and the alert is lost', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCapture.mockRejectedValue(new Error('Unexpected token < in <html> & co'))
    await runSnapshotJob()
    const msg = mockTelegram.mock.calls.at(-1)![0] as string
    expect(msg).not.toMatch(/[<>]/)
    expect(msg).toContain('&lt;html&gt; &amp; co')
    err.mockRestore()
  })

  it('a Telegram failure does not block the snapshots either', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCapture.mockRejectedValue(new Error('x'))
    mockTelegram.mockRejectedValue(new Error('tg down'))
    await runSnapshotJob()
    expect(mockSnapshot).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })
})
