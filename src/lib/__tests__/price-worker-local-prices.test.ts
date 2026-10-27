/**
 * Worker-level: the periodic cycle refreshes the peso-line prices, and a data912
 * failure there never fails the cycle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let processor: (job: unknown) => Promise<void> = async () => {}
const mockRefreshLocal = vi.fn()
const mockCacheSummaries = vi.fn()
const mockRecordRefresh = vi.fn()

// Ledger reads load the stock splits (odd/tasks/split-aware-ledger.md T3): none in these tests.
vi.mock('@/lib/stock-splits', () => ({ loadSplits: async () => new Map() }))
vi.mock('bullmq', () => ({ Worker: class { constructor(_q: string, fn: typeof processor) { processor = fn } on() {} } }))
vi.mock('../queue', () => ({ ON_PRICES_PERSIST_JOB_NAME: 'on-prices-persist', PRICE_QUEUE_NAME: 'q', PRICE_REPEAT_JOB_NAME: 'r', NIGHTLY_JOB_NAME: 's', TICKER_AUDIT_JOB_NAME: 't', ON_TERMS_JOB_NAME: 'o', FX_RATES_JOB_NAME: 'fx', SPLITS_INGEST_JOB_NAME: 'splits' }))
vi.mock('../yahoo-finance', () => ({
  fetchQuotesFromYahoo: vi.fn(async () => new Map([['AAPL', { ticker: 'AAPL', price: 200, change: 0, changePercent: 0, previousClose: 200 }]])),
  cachePrice: vi.fn(async () => {}),
  fetchQuotes: vi.fn(async () => new Map()),
}))
vi.mock('../data912-client', () => ({
  fetchData912Prices: vi.fn(async () => new Map()),
  refreshLocalPrices: (...a: unknown[]) => mockRefreshLocal(...a),
}))
// The held stocks come from the ledger core (T4.2b); the fake throws on the stored tables.
vi.mock('../supabase-server', async () => {
  const { ledgerSupabase, trade } = await import('./fixtures/ledger-supabase')
  return { createServiceClient: () => ledgerSupabase({ transactions: [trade({ ticker: 'AAPL' }), trade({ ticker: 'BCBA:GGAL' })] }) }
})
vi.mock('../redis', () => ({ getRedis: () => null }))
vi.mock('../summary-cache', () => ({
  cacheUserSummaries: (...a: unknown[]) => mockCacheSummaries(...a),
  loadCycleInputs: async () => ({ ledgers: await (await import('../ledger-now')).loadAllLedgers((await import('../supabase-server')).createServiceClient()) }),
}))
vi.mock('../portfolio-valuation', () => ({
  splitQuotesByAssetClass: (m: Map<string, unknown>) => ({ stockQuotes: m, onQuotes: new Map() }),
}))
vi.mock('../utils', () => ({ isMarketOpen: () => true, argentinaDate: () => '2026-10-22' }))
vi.mock('../import-worker', () => ({ startImportWorker: vi.fn() }))
vi.mock('../signals-worker', () => ({ startSignalsWorker: vi.fn() }))
vi.mock('../job-health', () => ({ beat: vi.fn(), alertJobFailure: vi.fn(), recordRefresh: (...a: unknown[]) => mockRecordRefresh(...a) }))
vi.mock('../notifications', async () => ({
  ...(await vi.importActual<typeof import('../notifications')>('../notifications')),
  checkNotificationConfig: vi.fn(), sendTelegram: vi.fn(async () => ({ ok: true })),
}))
vi.mock('../worker-startup', () => ({ ensureRedisAndScheduleJobs: vi.fn(async () => ({})), resolveStartupOutcome: () => ({ exit: false }) }))
vi.mock('../ticker-audit', () => ({ auditTickerIdentities: vi.fn() }))
vi.mock('../on-price-history', () => ({ captureOnPriceHistory: vi.fn() }))

mockRefreshLocal.mockResolvedValue(0)
await import('../price-worker')
await new Promise(r => setTimeout(r, 0)) // let main()'s startup fetch settle

beforeEach(() => { vi.clearAllMocks() })

describe('periodic price cycle and peso-line prices', () => {
  it('refreshes the peso-line prices of the held stocks before building the summaries', async () => {
    mockRefreshLocal.mockResolvedValue(2)

    await processor({ name: 'r', data: {} })

    expect(mockRefreshLocal).toHaveBeenCalledTimes(1)
    expect((mockRefreshLocal.mock.calls[0][0] as string[]).sort()).toEqual(['AAPL', 'BCBA:GGAL'])
    expect(mockRefreshLocal.mock.invocationCallOrder[0]).toBeLessThan(mockCacheSummaries.mock.invocationCallOrder[0])
    expect(mockCacheSummaries).toHaveBeenCalledTimes(1)
    expect((mockCacheSummaries.mock.calls[0][0] as Map<string, { price: number }>).get('AAPL')!.price).toBe(200)
  })

  it('a data912 failure is logged and the cycle still records the refresh and builds the summaries', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRefreshLocal.mockRejectedValue(new Error('data912 down'))

    await expect(processor({ name: 'r', data: {} })).resolves.toBeUndefined()

    expect(mockRecordRefresh).toHaveBeenCalledTimes(1)
    expect(mockCacheSummaries).toHaveBeenCalledTimes(1)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('peso'), expect.any(Error))
    errSpy.mockRestore()
  })
})
