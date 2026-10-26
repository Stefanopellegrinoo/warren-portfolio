import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  processor: null as null | ((job: { name: string; data: unknown }) => Promise<void>),
  ingest: vi.fn(),
  fx: vi.fn(),
  splits: vi.fn(),
}))

vi.mock('bullmq', () => ({ Worker: class { constructor(_n: string, p: never) { h.processor = p } on() {} } }))
vi.mock('../queue', () => ({ ON_PRICES_PERSIST_JOB_NAME: 'on-prices-persist',
  PRICE_QUEUE_NAME: 'q', PRICE_REPEAT_JOB_NAME: 'r', NIGHTLY_JOB_NAME: 's', TICKER_AUDIT_JOB_NAME: 't', ON_TERMS_JOB_NAME: 'on-terms-ingest', FX_RATES_JOB_NAME: 'fx-rates-ingest', SPLITS_INGEST_JOB_NAME: 'splits-ingest',
}))
vi.mock('../yahoo-finance', () => ({ fetchQuotesFromYahoo: vi.fn(), cachePrice: vi.fn(), fetchQuotes: vi.fn(async () => new Map()) }))
vi.mock('../data912-client', () => ({ fetchData912Prices: vi.fn() }))
vi.mock('../supabase-server', () => ({ createServiceClient: () => ({ marker: 'svc' }) }))
vi.mock('../redis', () => ({ getRedis: () => null }))
vi.mock('../summary-cache', () => ({ cacheUserSummaries: vi.fn() }))
vi.mock('../portfolio-valuation', () => ({ splitQuotesByAssetClass: () => ({ stockQuotes: new Map(), onQuotes: new Map() }) }))
vi.mock('../import-worker', () => ({ startImportWorker: vi.fn() }))
vi.mock('../signals-worker', () => ({ startSignalsWorker: vi.fn() }))
vi.mock('../job-health', () => ({ beat: vi.fn(), alertJobFailure: vi.fn(), recordRefresh: vi.fn() }))
vi.mock('../notifications', async () => ({ ...(await vi.importActual<typeof import('../notifications')>('../notifications')), checkNotificationConfig: vi.fn(), sendTelegram: vi.fn() }))
vi.mock('../worker-startup', () => ({ ensureRedisAndScheduleJobs: vi.fn(async () => ({})), resolveStartupOutcome: () => ({ exit: false }) }))
vi.mock('../ticker-audit', () => ({ auditTickerIdentities: vi.fn() }))
vi.mock('../on-price-history', () => ({ captureOnPriceHistory: vi.fn() }))
vi.mock('../on-terms-ingest', () => ({ ingestOnTerms: (...a: unknown[]) => h.ingest(...a) }))
vi.mock('../fx-rates', () => ({ ingestFxRates: (...a: unknown[]) => h.fx(...a) }))
vi.mock('../splits-ingest', () => ({ ingestSplits: (...a: unknown[]) => h.splits(...a) }))

await import('../price-worker')

beforeEach(() => {
  h.ingest.mockReset().mockResolvedValue({ asOf: '2026-10-20', ons: 228, skipped: 0, sov: 15, checks: 200, flagged: 8, warnings: 0 })
  h.fx.mockReset().mockResolvedValue({ mep: 2916, ccl: 5042, written: 2 })
  h.splits.mockReset().mockResolvedValue({ tickers: 30, written: 1, unknown: [] })
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('fx-rates-ingest job', () => {
  it('upserts the MEP and CCL history with the service client', async () => {
    await h.processor!({ name: 'fx-rates-ingest', data: {} })
    expect(h.fx).toHaveBeenCalledTimes(1)
    expect(h.fx.mock.calls[0][0]).toEqual({ marker: 'svc' })
    expect(h.ingest).not.toHaveBeenCalled()
  })

  it('propagates failures so the worker failed handler alerts', async () => {
    h.fx.mockRejectedValue(new Error('argentinadatos down'))
    await expect(h.processor!({ name: 'fx-rates-ingest', data: {} })).rejects.toThrow('argentinadatos down')
  })
})

describe('splits-ingest job (odd/tasks/split-aware-ledger.md T2)', () => {
  it('brings stock_splits up to Yahoo with the service client', async () => {
    await h.processor!({ name: 'splits-ingest', data: {} })
    expect(h.splits).toHaveBeenCalledTimes(1)
    expect(h.splits.mock.calls[0][0]).toEqual({ marker: 'svc' })
    expect(h.fx).not.toHaveBeenCalled()
  })

  it('propagates failures so the worker failed handler alerts (last-good stays in the DB)', async () => {
    h.splits.mockRejectedValue(new Error('stock_splits upsert: disk'))
    await expect(h.processor!({ name: 'splits-ingest', data: {} })).rejects.toThrow('disk')
  })
})

describe('on-terms-ingest job', () => {
  it('runs the ingest with the service client', async () => {
    await h.processor!({ name: 'on-terms-ingest', data: {} })
    expect(h.ingest).toHaveBeenCalledTimes(1)
    expect(h.ingest.mock.calls[0][0]).toEqual({ marker: 'svc' })
  })

  it('propagates failures so the worker failed handler alerts (last-good stays in the DB)', async () => {
    h.ingest.mockRejectedValue(new Error('BYMA down'))
    await expect(h.processor!({ name: 'on-terms-ingest', data: {} })).rejects.toThrow('BYMA down')
  })
})
