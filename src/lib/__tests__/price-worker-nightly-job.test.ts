import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCapture = vi.fn()
const mockTelegram = vi.fn()

vi.mock('bullmq', () => ({ Worker: class { on() {} } }))
vi.mock('../queue', () => ({
  PRICE_QUEUE_NAME: 'q', PRICE_REPEAT_JOB_NAME: 'r', NIGHTLY_JOB_NAME: 's', TICKER_AUDIT_JOB_NAME: 't',
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
vi.mock('../utils', () => ({ isMarketOpen: () => false, argentinaDate: () => '2026-10-16' }))
vi.mock('../import-worker', () => ({ startImportWorker: vi.fn() }))
vi.mock('../signals-worker', () => ({ startSignalsWorker: vi.fn() }))
vi.mock('../job-health', () => ({ beat: vi.fn(), alertJobFailure: vi.fn(), recordRefresh: vi.fn() }))
vi.mock('../notifications', async () => ({
  ...(await vi.importActual<typeof import('../notifications')>('../notifications')),
  checkNotificationConfig: vi.fn(), sendTelegram: (...a: unknown[]) => mockTelegram(...a),
}))
vi.mock('../worker-startup', () => ({
  ensureRedisAndScheduleJobs: vi.fn(async () => ({})),
  resolveStartupOutcome: () => ({ exit: false }),
}))
vi.mock('../ticker-audit', () => ({ auditTickerIdentities: vi.fn() }))
vi.mock('../on-price-history', () => ({ captureOnPriceHistory: (...a: unknown[]) => mockCapture(...a) }))

const { runNightlyJob } = await import('../price-worker')

beforeEach(() => {
  mockCapture.mockReset().mockResolvedValue(250)
  mockTelegram.mockReset().mockResolvedValue({ ok: true })
})

describe('runNightlyJob', () => {
  it('captures the ON closes on the Argentine date and writes nothing else', async () => {
    await runNightlyJob()
    expect(mockCapture).toHaveBeenCalledTimes(1)
    expect(mockCapture.mock.calls[0][1]).toBe('2026-10-16')
  })

  it('a capture failure alerts via Telegram and does not throw', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCapture.mockRejectedValue(new Error('data912 down'))
    await expect(runNightlyJob()).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    expect(mockTelegram).toHaveBeenCalledWith(expect.stringContaining('data912 down'))
    err.mockRestore()
  })

  it('escapes HTML in the alert, or Telegram (parse_mode HTML) rejects it and the alert is lost', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCapture.mockRejectedValue(new Error('Unexpected token < in <html> & co'))
    await runNightlyJob()
    const msg = mockTelegram.mock.calls.at(-1)![0] as string
    expect(msg).not.toMatch(/[<>]/)
    expect(msg).toContain('&lt;html&gt; &amp; co')
    err.mockRestore()
  })

  it('a Telegram failure does not throw either', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCapture.mockRejectedValue(new Error('x'))
    mockTelegram.mockRejectedValue(new Error('tg down'))
    await expect(runNightlyJob()).resolves.toBeUndefined()
    err.mockRestore()
  })
})
