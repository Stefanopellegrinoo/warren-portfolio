/**
 * Worker-level: ON prices live in Redis all day; the database (their last-resort fallback)
 * gets them once a day, after the close — never on every minute's cycle or on startup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let processor: (job: unknown) => Promise<void> = async () => {}
const mockCachePrice = vi.fn(async () => {})
const mockFetchQuotes = vi.fn(async (): Promise<Map<string, unknown>> => new Map())
const mockData912 = vi.fn(async (): Promise<Map<string, unknown>> => new Map())
const onsUpsert = vi.fn(async (): Promise<{ error: unknown }> => ({ error: null }))
const onsSelect = vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: [{ ticker: 'YMCXO' }], error: null }))

vi.mock('bullmq', () => ({ Worker: class { constructor(_q: string, fn: typeof processor) { processor = fn } on() {} } }))
vi.mock('../queue', () => ({
  PRICE_QUEUE_NAME: 'q', PRICE_REPEAT_JOB_NAME: 'r', NIGHTLY_JOB_NAME: 's', TICKER_AUDIT_JOB_NAME: 't', ON_TERMS_JOB_NAME: 'o', FX_RATES_JOB_NAME: 'fx',
  ON_PRICES_PERSIST_JOB_NAME: 'on-prices-persist', SPLITS_INGEST_JOB_NAME: 'splits',
}))
vi.mock('../yahoo-finance', () => ({
  fetchQuotesFromYahoo: vi.fn(async () => new Map()),
  cachePrice: (...a: unknown[]) => mockCachePrice(...(a as [])),
  fetchQuotes: (...a: unknown[]) => mockFetchQuotes(...(a as [])),
}))
vi.mock('../data912-client', () => ({
  fetchData912Prices: (...a: unknown[]) => mockData912(...(a as [])),
  refreshLocalPrices: vi.fn(async () => 0),
}))
// The ON catalog is one ticker; every other table comes from the ledger fake (no stocks held).
vi.mock('../supabase-server', async () => {
  const { ledgerSupabase } = await import('./fixtures/ledger-supabase')
  const ledger = ledgerSupabase({ transactions: [] })
  return {
    createServiceClient: () => ({
      from: (name: string) => name === 'ons'
        ? { select: () => onsSelect(), upsert: (...a: unknown[]) => onsUpsert(...(a as [])) }
        : ledger.from(name),
    }),
  }
})
vi.mock('../redis', () => ({ getRedis: () => null }))
vi.mock('../summary-cache', () => ({ cacheUserSummaries: vi.fn() }))
vi.mock('../portfolio-valuation', () => ({ splitQuotesByAssetClass: () => ({ stockQuotes: new Map(), onQuotes: new Map() }) }))
vi.mock('../utils', () => ({ isMarketOpen: () => true, argentinaDate: () => '2026-10-26' }))
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

const quote = (price: number) => ({ ticker: 'YMCXO', price, change: 0, changePercent: 0, previousClose: price })

mockData912.mockResolvedValue(new Map([['YMCXO', quote(1.05)]]))
await import('../price-worker')
await new Promise((r) => setTimeout(r, 0)) // let main()'s startup fetch settle
const upsertsAtStartup = onsUpsert.mock.calls.length
const cachedAtStartup = mockCachePrice.mock.calls.map((c) => (c as unknown[])[0])

beforeEach(() => {
  vi.clearAllMocks()
  onsUpsert.mockResolvedValue({ error: null })
  onsSelect.mockResolvedValue({ data: [{ ticker: 'YMCXO' }], error: null })
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('ON prices: Redis all day, the database once a day', () => {
  it('startup puts the ON price in Redis and writes nothing to the database', () => {
    expect(cachedAtStartup).toContain('YMCXO')
    expect(upsertsAtStartup).toBe(0)
  })

  it('the minute cycle puts the ON price in Redis and writes nothing to the database', async () => {
    mockData912.mockResolvedValue(new Map([['YMCXO', quote(1.06)]]))

    await processor({ name: 'r', data: {} })

    expect(mockCachePrice).toHaveBeenCalledWith('YMCXO', expect.objectContaining({ price: 1.06 }))
    expect(onsUpsert).not.toHaveBeenCalled()
  })

  it('the daily job writes each ON price Redis holds to the database, in one write', async () => {
    mockFetchQuotes.mockResolvedValue(new Map([['YMCXO', quote(1.07)]]))

    await processor({ name: 'on-prices-persist', data: {} })

    expect(mockFetchQuotes).toHaveBeenCalledWith(['YMCXO'])
    expect(mockData912).not.toHaveBeenCalled()
    expect(onsUpsert).toHaveBeenCalledTimes(1)
    expect(onsUpsert).toHaveBeenCalledWith([{ ticker: 'YMCXO', last_price: 1.07, last_updated: expect.any(String) }], { onConflict: 'ticker' })
  })

  it('the date written is when the price is from, not when the job ran', async () => {
    mockFetchQuotes.mockResolvedValue(new Map([['YMCXO', { ...quote(1.07), updatedAt: '2026-10-21T20:00:00.000Z' }]]))

    await processor({ name: 'on-prices-persist', data: {} })

    expect(onsUpsert).toHaveBeenCalledWith([{ ticker: 'YMCXO', last_price: 1.07, last_updated: '2026-10-21T20:00:00.000Z' }], { onConflict: 'ticker' })
  })

  it('an ON with a zero price keeps the one the database has', async () => {
    onsSelect.mockResolvedValue({ data: [{ ticker: 'YMCXO' }, { ticker: 'TLCMO' }], error: null })
    mockFetchQuotes.mockResolvedValue(new Map([['YMCXO', quote(0)], ['TLCMO', { ...quote(98.5), ticker: 'TLCMO' }]]))

    await processor({ name: 'on-prices-persist', data: {} })

    expect(onsUpsert).toHaveBeenCalledWith([{ ticker: 'TLCMO', last_price: 98.5, last_updated: expect.any(String) }], { onConflict: 'ticker' })
  })

  it('an ON missing from Redis keeps the one the database has; the others are written', async () => {
    onsSelect.mockResolvedValue({ data: [{ ticker: 'YMCXO' }, { ticker: 'TLCMO' }], error: null })
    mockFetchQuotes.mockResolvedValue(new Map([['TLCMO', { ...quote(98.5), ticker: 'TLCMO' }]]))

    await processor({ name: 'on-prices-persist', data: {} })

    expect(onsUpsert).toHaveBeenCalledWith([{ ticker: 'TLCMO', last_price: 98.5, last_updated: expect.any(String) }], { onConflict: 'ticker' })
  })

  it('a catalog that cannot be read fails the job instead of reporting 0 written', async () => {
    onsSelect.mockResolvedValue({ data: null, error: { message: 'connection timeout' } })

    await expect(processor({ name: 'on-prices-persist', data: {} })).rejects.toThrow(/connection timeout/)
    expect(onsUpsert).not.toHaveBeenCalled()
  })

  it('a Redis with none of the catalog\'s prices fails the job: the copy would go stale unseen', async () => {
    mockFetchQuotes.mockResolvedValue(new Map())

    await expect(processor({ name: 'on-prices-persist', data: {} })).rejects.toThrow(/Redis/)
    expect(onsUpsert).not.toHaveBeenCalled()
  })

  it('a failed write fails the job, so the worker reports it', async () => {
    mockFetchQuotes.mockResolvedValue(new Map([['YMCXO', quote(1.07)]]))
    onsUpsert.mockResolvedValue({ error: { message: 'timeout' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(processor({ name: 'on-prices-persist', data: {} })).rejects.toThrow(/timeout/)
  })
})
