/**
 * Worker-level: during a CCL outage the on-demand price job keeps the BCBA
 * last-good price, never evaluates alerts on a missing price, and still builds summaries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let processor: (job: unknown) => Promise<void> = async () => {}
const mockFetchFresh = vi.fn()
const mockFetchLkp = vi.fn()
const mockCacheSummaries = vi.fn()
const alertIn = vi.fn()
mockFetchLkp.mockResolvedValue(new Map())
mockFetchFresh.mockResolvedValue(new Map())

vi.mock('bullmq', () => ({ Worker: class { constructor(_q: string, fn: typeof processor) { processor = fn } on() {} } }))
vi.mock('../queue', () => ({ PRICE_QUEUE_NAME: 'q', PRICE_REPEAT_JOB_NAME: 'r', NIGHTLY_JOB_NAME: 's', TICKER_AUDIT_JOB_NAME: 't', ON_TERMS_JOB_NAME: 'o', FX_RATES_JOB_NAME: 'fx' }))
vi.mock('../yahoo-finance', () => ({
  fetchQuotesFromYahoo: (...a: unknown[]) => mockFetchFresh(...a),
  cachePrice: vi.fn(async () => {}),
  fetchQuotes: (...a: unknown[]) => mockFetchLkp(...a),
}))
vi.mock('../data912-client', () => ({ fetchData912Prices: vi.fn() }))
vi.mock('../supabase-server', () => ({
  createServiceClient: () => ({
    from: (table: string) => table === 'price_alerts'
      ? { select: () => ({ eq: () => ({ eq: () => ({ in: async (_c: string, v: string[]) => { alertIn(v); return { data: [], error: null } } }) }) }) }
      : { select: async () => ({ data: [], error: null }) },
  }),
}))
vi.mock('../redis', () => ({ getRedis: () => null }))
vi.mock('../summary-cache', () => ({ cacheUserSummaries: (...a: unknown[]) => mockCacheSummaries(...a) }))
vi.mock('../portfolio-valuation', () => ({
  splitQuotesByAssetClass: (m: Map<string, unknown>) => ({ stockQuotes: m, onQuotes: new Map() }),
}))
vi.mock('../utils', () => ({ isMarketOpen: () => true, argentinaDate: () => '2026-10-16' }))
vi.mock('../import-worker', () => ({ startImportWorker: vi.fn() }))
vi.mock('../signals-worker', () => ({ startSignalsWorker: vi.fn() }))
vi.mock('../job-health', () => ({ beat: vi.fn(), alertJobFailure: vi.fn(), recordRefresh: vi.fn() }))
vi.mock('../notifications', async () => ({
  ...(await vi.importActual<typeof import('../notifications')>('../notifications')),
  checkNotificationConfig: vi.fn(), sendTelegram: vi.fn(async () => ({ ok: true })),
}))
vi.mock('../worker-startup', () => ({ ensureRedisAndScheduleJobs: vi.fn(async () => ({})), resolveStartupOutcome: () => ({ exit: false }) }))
vi.mock('../ticker-audit', () => ({ auditTickerIdentities: vi.fn() }))
vi.mock('../on-price-history', () => ({ captureOnPriceHistory: vi.fn() }))

await import('../price-worker')

const q = (ticker: string, price: number, updatedAt = '2026-10-16T12:00:00Z') => ({ ticker, price, change: 0, changePercent: 0, previousClose: price, updatedAt })

beforeEach(() => { vi.clearAllMocks() })

describe('price job without a CCL rate', () => {
  it('keeps the BCBA last-good price, never prices the unpriced ticker, still builds summaries', async () => {
    mockFetchLkp.mockResolvedValue(new Map([['BCBA:GGAL', q('BCBA:GGAL', 5, '2026-10-10T15:00:00Z')]]))
    mockFetchFresh.mockResolvedValue(new Map([['AAPL', q('AAPL', 200)]])) // BCBA dropped by fetchQuotesFromYahoo

    await processor({ name: 'on-demand', data: { tickers: ['AAPL', 'BCBA:GGAL', 'BCBA:NOLKP'] } })

    const summaryStocks = mockCacheSummaries.mock.calls[0][0] as Map<string, { price: number }>
    expect(summaryStocks.get('BCBA:GGAL')!.price).toBe(5)   // LKP kept
    expect(summaryStocks.get('AAPL')!.price).toBe(200)
    expect(summaryStocks.has('BCBA:NOLKP')).toBe(false)      // never invented
    expect(alertIn).toHaveBeenCalledTimes(1)
    // Every ticker of the cycle is read: a price alert on the unpriced one still never fires (no price),
    // and a condition alert on it is checked on its candles, so it cannot look armed forever.
    expect(alertIn.mock.calls[0][0].sort()).toEqual(['AAPL', 'BCBA:GGAL', 'BCBA:NOLKP'])
  })
})
