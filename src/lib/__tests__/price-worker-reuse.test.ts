/**
 * odd/tasks/supabase-efficiency.md S2-S4 on the real worker job: every Supabase request of each per-minute
 * cycle is counted with a counting fake database, a controllable ledger/alerts version and a fake clock.
 * From the feature's independent verification (the baseline made 34 requests a cycle with the market open).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { fakeDb, reads, resetReads, failing, TWO_USER_TABLES, quote, type Row } from './fixtures/counting-supabase'

const tables: Record<string, Row[]> = structuredClone(TWO_USER_TABLES)
let ledgerV: () => Promise<string | null> = async () => '1'
let alertsV = 1
let alertsVReadable = true
const evals: string[][] = []
const fakeRedis = { get: vi.fn(async () => null), eval: vi.fn(async (...a: unknown[]) => { evals.push(a.map(String)); return 1 }) }
vi.mock('@/lib/redis', async (orig) => ({
  ...(await orig<object>()),
  getRedis: () => fakeRedis,
  readLedgerVersion: () => ledgerV(),
  readAlertsVersion: async () => (alertsVReadable ? String(alertsV) : null),
  bumpAlertsVersion: async () => { alertsV++ },
}))
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: () => fakeDb(tables), createServerClientInstance: vi.fn() }))
vi.mock('@/lib/currency', () => ({
  getDollarInfo: async (kind: string) => ({ rate: kind === 'mep' ? 1500 : 1600, asOf: '2026-10-27T15:00:00.000Z', source: 'live' }),
}))
let processor: (job: unknown) => Promise<void> = async () => {}
vi.mock('bullmq', () => ({ Worker: class { constructor(_q: string, fn: typeof processor) { processor = fn } on() {} } }))
vi.mock('@/lib/queue', () => ({ ON_PRICES_PERSIST_JOB_NAME: 'p', PRICE_QUEUE_NAME: 'q', PRICE_REPEAT_JOB_NAME: 'repeat', NIGHTLY_JOB_NAME: 's', TICKER_AUDIT_JOB_NAME: 't', ON_TERMS_JOB_NAME: 'o', FX_RATES_JOB_NAME: 'fx', SPLITS_INGEST_JOB_NAME: 'sp' }))
const lkp: Record<string, number> = { KO: 67, AAPL: 329, YMCID: 100, ZZZZD: 96, BTCUSDT: 60_000 }
vi.mock('@/lib/yahoo-finance', () => ({
  fetchQuotesFromYahoo: vi.fn(async (t: string[]) => new Map(t.map(x => [x, quote(x, x === 'KO' ? 70 : 330)]))),
  cachePrice: vi.fn(async () => {}),
  fetchQuotes: vi.fn(async (keys: string[]) => new Map(keys.map(k => [k, quote(k, k.startsWith('local:') ? 9000 : lkp[k] ?? 1)]))),
}))
vi.mock('@/lib/data912-client', () => ({
  fetchData912Prices: vi.fn(async (t: string[]) => new Map(t.map(x => [x, quote(x, 101)]))),
  refreshLocalPrices: vi.fn(async () => 0),
  localPriceKey: (s: string) => `local:${s}`,
}))
let marketOpen = true
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), isMarketOpen: () => marketOpen }))
vi.mock('@/lib/binance/rest', () => ({ fetchCryptoQuotes: vi.fn(async (t: string[]) => new Map(t.map(x => [x, quote(x, 61_000)]))), fetchServerKlines: vi.fn(async () => []) }))
vi.mock('@/lib/market-data', async () => ({ getMarketDataProvider: () => ({ getCandles: async () => [] }), MarketDataError: (await import('@/lib/market-data/types')).MarketDataError }))
vi.mock('@/lib/import-worker', () => ({ startImportWorker: vi.fn() }))
vi.mock('@/lib/signals-worker', () => ({ startSignalsWorker: vi.fn() }))
vi.mock('@/lib/job-health', () => ({ beat: vi.fn(), alertJobFailure: vi.fn(), recordRefresh: vi.fn() }))
vi.mock('@/lib/worker-startup', () => ({ ensureRedisAndScheduleJobs: vi.fn(async () => ({})), resolveStartupOutcome: () => ({ exit: false }) }))
vi.mock('@/lib/ticker-audit', () => ({ auditTickerIdentities: vi.fn() }))
vi.mock('@/lib/on-price-history', () => ({ captureOnPriceHistory: vi.fn() }))
vi.mock('@/lib/notifications', async (orig) => ({ ...(await orig<object>()), sendTelegram: vi.fn(async () => ({ ok: true })), checkNotificationConfig: vi.fn() }))
vi.mock('@/lib/push', async (orig) => ({ ...(await orig<object>()), sendPushToUser: vi.fn(async () => ({ ok: true, sent: 1 })), pushKeys: () => null }))

const LEDGER_TABLES = ['transactions', 'cash_movements', 'on_payment_overrides', 'on_terms', 'on_flow_history', 'on_cashflows', 'fx_rates', 'cedears', 'ons', 'stock_splits']
const cycle = async () => { evals.length = 0; await processor({ name: 'repeat', id: 'x', data: {} }) }
const ledgerReads = () => Object.fromEntries(LEDGER_TABLES.map(t => [t, reads[t] ?? 0]))
// fx_rates: one per user with an FX-less trade (2 users); stock_splits: readTable pages until empty (2 requests).
const once = { ...Object.fromEntries(LEDGER_TABLES.map(t => [t, 1])), fx_rates: 2, stock_splits: 2 }
const none = Object.fromEntries(LEDGER_TABLES.map(t => [t, 0]))
const alertSelects = () => reads['price_alerts'] ?? 0
const now = (iso: string) => vi.setSystemTime(new Date(iso))

describe('worker per-minute cycle (head)', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    now('2026-10-27T15:00:00Z')
    tables.price_alerts = [
      { id: 'a-btc', user_id: 'u1', ticker: 'BTCUSDT', type: 'price', status: 'active', operator: 'crosses', value: 70_000, source: 'price', target: 'value' },
      { id: 'a-ko-far', user_id: 'u1', ticker: 'KO', type: 'price', status: 'active', operator: 'crosses', value: 90, source: 'price', target: 'value' },
    ]
    await import('@/lib/price-worker')
    await new Promise(r => setTimeout(r, 50))
  })
  beforeEach(() => { resetReads(); failing.clear() })

  it('S2/S3: same version and day -> each ledger/market table read once; summaries written every cycle, identical', async () => {
    ledgerV = async () => '2'
    await cycle()
    expect(ledgerReads()).toEqual(once)
    const first = JSON.stringify(evals)
    expect(evals.length).toBe(2)
    resetReads()
    for (let i = 0; i < 4; i++) {
      now(`2026-10-27T15:0${i + 1}:00Z`)
      await cycle()
      expect(evals.length).toBe(2)
      expect(JSON.stringify(evals)).toBe(first)
    }
    expect(ledgerReads()).toEqual(none)
  })

  it('a version change, a new Argentine day and max age each cause one re-read', async () => {
    ledgerV = async () => '3'
    await cycle(); await cycle()
    expect(ledgerReads()).toEqual(once)
    resetReads()
    now('2026-10-28T03:01:00Z') // 00:01 ART next day
    await cycle(); await cycle()
    expect(ledgerReads()).toEqual(once)
    resetReads()
    now('2026-10-28T04:02:00Z') // +61 min, same day
    await cycle(); await cycle()
    expect(ledgerReads()).toEqual(once)
  })

  it('a failed load is retried on the next cycle', async () => {
    ledgerV = async () => '4'
    failing.add('transactions')
    await cycle().catch(e => e)
    failing.clear(); resetReads(); evals.length = 0
    await cycle()
    expect(reads.transactions).toBe(1)
    expect(evals.length).toBe(2)
    resetReads()
    await cycle()
    expect(reads.transactions ?? 0).toBe(0)
  })

  for (const [name, v] of [['null', async () => null], ['throwing', async () => { throw new Error('redis down') }]] as const) {
    it(`an unreadable version (${name}) reads every cycle, as at baseline`, async () => {
      ledgerV = v
      await cycle(); await cycle(); await cycle()
      expect(reads.transactions).toBeGreaterThanOrEqual(3)
      expect(reads.on_terms).toBeGreaterThanOrEqual(3)
      expect(evals.length).toBe(2)
    })
  }

  it('S4: alerts read once per alerts version; a POST (bump) is evaluated next cycle; a fire bumps and the next cycle re-reads', async () => {
    ledgerV = async () => '5'
    alertsV = 10
    await cycle()
    const perVersion = alertSelects()
    expect(perVersion).toBeGreaterThan(0)
    resetReads()
    await cycle(); await cycle()
    expect(alertSelects()).toBe(0)
    // POST /api/price-alerts: a row is inserted, then the route bumps.
    tables.price_alerts.push({ id: 'a-ko-new', user_id: 'u2', ticker: 'KO', type: 'price', status: 'active', operator: 'crosses', value: 68, source: 'price', target: 'value' })
    alertsV++
    const before = alertsV
    resetReads()
    await cycle()
    expect(tables.price_alerts.find(a => a.id === 'a-ko-new')!.status).toBe('triggered') // evaluated in the first cycle after POST
    expect(reads['price_alerts:update']).toBe(1)
    expect(alertsV).toBe(before + 1) // claimAlert moved it
    resetReads()
    await cycle()
    expect(alertSelects()).toBeGreaterThan(0) // re-read after the fire
    expect(reads['price_alerts:update'] ?? 0).toBe(0) // no second fire
    resetReads()
    await cycle()
    expect(alertSelects()).toBe(0)
  })

  it('S4: crypto alerts are still checked every cycle (prices fetched each minute) while rows are reused', async () => {
    const { fetchCryptoQuotes } = await import('@/lib/binance/rest')
    vi.mocked(fetchCryptoQuotes).mockClear()
    await cycle(); await cycle(); await cycle()
    expect(vi.mocked(fetchCryptoQuotes)).toHaveBeenCalledTimes(3)
  })

  it('S4: unreadable alerts version reads alerts every cycle', async () => {
    alertsVReadable = false
    await cycle(); await cycle()
    expect(alertSelects()).toBeGreaterThanOrEqual(4)
    alertsVReadable = true
  })

  it('steady state: no Supabase request at all while nothing changes, market open or closed', async () => {
    ledgerV = async () => '9'; alertsV = 99
    const total = () => Object.values(reads).reduce((a, b) => a + b, 0)
    for (const open of [true, false]) {
      marketOpen = open
      await cycle(); resetReads()
      for (let i = 0; i < 10; i++) await cycle()
      expect(total()).toBe(0)
      resetReads()
    }
    marketOpen = true
  })
})
