/**
 * S12 (odd/tasks/security-hardening.md): the market/reference tables lose their
 * anon/authenticated SELECT grant, so every server read of them goes through the
 * service role. The fake USER client below behaves like a session after that revoke:
 * any market table answers 42501, user tables are served normally.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ service: null as any }))
vi.mock('@/lib/supabase-server', () => ({ createServiceClient: vi.fn(() => h.service) }))
vi.mock('@/lib/redis', () => ({ ensureRedisConnected: vi.fn(async () => false), getRedis: vi.fn(() => null) }))
vi.mock('@/lib/currency', async (orig) => ({
  ...(await orig<typeof import('@/lib/currency')>()),
  getDollarInfo: vi.fn(async (kind: string) => ({ rate: kind === 'mep' ? 1400 : 1500, asOf: '2026-10-23T15:00:00Z' })),
}))
vi.mock('@/lib/yahoo-finance', async (orig) => ({
  ...(await orig<typeof import('@/lib/yahoo-finance')>()),
  fetchQuotes: vi.fn(async () => new Map()),
}))

import { loadOnAnalyses, loadPriceHistory, resetOnCaches } from '@/lib/on-catalog'
import { loadSchedules } from '@/lib/on-schedules'
import { loadPayments } from '@/lib/on-payments'
import { currencyViewsFor, loadCurrencyContext } from '@/lib/currency-views'
import { loadLastCloses } from '@/lib/ledger-now'
import { getDerivedSeries } from '@/lib/derived-series'
import { getCataloguedTicker, listCatalogued } from '@/lib/ticker-catalog'

const MARKET = [
  'on_terms', 'on_terms_overrides', 'on_flow_history', 'on_price_history', 'on_cashflows', 'on_corporate_events',
  'on_sov_curve', 'on_yield_checks', 'ons', 'activos', 'cedears', 'ticker_identity', 'fx_rates',
]
const TODAY = '2026-10-23'
const ISIN = 'AR0000000001'

type Tables = Record<string, Record<string, unknown>[]>

function fakeClient(tables: Tables, denied: (table: string) => boolean) {
  const reads: string[] = []
  const writes: { table: string; rows: unknown }[] = []
  return {
    reads,
    writes,
    from(table: string) {
      reads.push(table)
      const eqs: [string, unknown][] = []
      let from = 0
      let to = Infinity
      const result = () => {
        if (denied(table)) return { data: null, error: { code: '42501', message: `permission denied for table ${table}` } }
        const rows = (tables[table] ?? []).filter((r) => eqs.every(([c, v]) => !(c in r) || r[c] === v))
        return { data: rows.slice(from, to + 1), error: null }
      }
      const b: any = {
        select: () => b, order: () => b, gte: () => b, lte: () => b, in: () => b, or: () => b, limit: () => b,
        eq: (c: string, v: unknown) => { eqs.push([c, v]); return b },
        range: (f: number, t: number) => { from = f; to = t; return b },
        maybeSingle: () => {
          const r = result()
          return Promise.resolve(r.error ? r : { data: r.data?.[0] ?? null, error: null })
        },
        upsert: (rows: unknown) => {
          writes.push({ table, rows })
          return Promise.resolve(denied(table) ? result() : { data: null, error: null })
        },
        then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
      }
      return b
    },
  }
}

const termsRow = {
  isin: ISIN, ticker_o: 'T001O', ticker_d: 'T001D', ticker_c: null, issuer: 'Emisor', description: 'ON Clase A',
  law: 'NY', currency: 'USD', payment_plaza: 'MEP', est: 'Tasa Fija', frequency: 'Semestral',
  issue_date: '2025-12-01', maturity_date: '2029-12-01', coupon_rate: '0.06', residual_pct: '100',
  accrual_start: '2025-12-01', issued_amount_byma: null, adtv_o: null, adtv_d: '500', adtv_c: null, as_of: '2026-10-22',
}
const MARKET_ROWS: Tables = {
  on_terms: [termsRow],
  on_cashflows: [
    { isin: ISIN, flow_date: '2026-06-01', ren: '3', amo: '0' },
    { isin: ISIN, flow_date: '2029-12-01', ren: '3', amo: '100' },
  ],
  on_flow_history: [],
  on_terms_overrides: [],
  on_corporate_events: [],
  on_yield_checks: [],
  on_sov_curve: [],
  on_price_history: [{ ticker: 'T001D', price_date: '2026-10-22', close: 98.5 }],
  cedears: [{ ticker: 'AAPL', ratio: 20 }],
  fx_rates: [
    { date: '2026-09-30', kind: 'mep', buy: 1400, sell: 1420 },
    { date: '2026-09-30', kind: 'ccl', buy: 1500, sell: 1520 },
  ],
  ticker_identity: [{ ticker: 'AAPL', yahoo_symbol: 'AAPL', confirmed_name: 'Apple Inc.', exchange: 'NMS', last_checked_at: null }],
}

const onTrade = { user_id: 'u1', ticker: 'T001D', operation: 'COMPRA', quantity: 1000, price: 100, commission: 0, date: '2026-01-05', asset_type: 'ON', created_at: null }
const stockTrade = {
  user_id: 'u1', ticker: 'AAPL', operation: 'COMPRA', quantity: 1, price: 200, commission: 0, date: '2026-09-30', asset_type: 'CEDEAR', created_at: null,
  trade_currency: null, trade_quantity: null, trade_price: null, trade_commission: null, fx_mep: null, fx_ccl: null,
}

let user: ReturnType<typeof fakeClient>
let service: ReturnType<typeof fakeClient>

function setup(userTables: Tables = {}, serviceTables: Tables = MARKET_ROWS) {
  user = fakeClient({ on_payment_overrides: [], cash_movements: [], ...userTables }, (t) => MARKET.includes(t))
  service = fakeClient(serviceTables, () => false)
  h.service = service
}

const userMarketReads = () => user.reads.filter((t) => MARKET.includes(t))

beforeEach(() => {
  resetOnCaches()
  setup()
})

describe('market tables are read with the service role, never with the user session', () => {
  it('1a. on-catalog loadOnAnalyses reads the whole catalog from the service client', async () => {
    const r = await loadOnAnalyses(user as never, { now: new Date('2026-10-23T15:00:00Z'), getPrices: async () => null, getCcl: async () => null })
    expect(r.analyses.map((a) => a.row.isin)).toEqual([ISIN])
    expect(r.asOf).toBe('2026-10-22')
    expect(service.reads).toEqual(expect.arrayContaining(['on_terms', 'on_cashflows', 'on_terms_overrides', 'on_corporate_events', 'on_yield_checks', 'on_sov_curve']))
    expect(userMarketReads()).toEqual([])
  })

  it('1b. on-catalog loadPriceHistory reads on_price_history from the service client', async () => {
    await expect(loadPriceHistory(user as never, 'T001D')).resolves.toEqual([{ date: '2026-10-22', close: 98.5 }])
    expect(service.reads).toContain('on_price_history')
    expect(userMarketReads()).toEqual([])
  })

  it('2. on-schedules loadSchedules resolves the ISIN and its flows on the service client', async () => {
    const out = await loadSchedules(user as never, ['T001D'], TODAY)
    expect(out.get('T001D')?.map((f) => f.date)).toContain('2026-06-01')
    expect(service.reads).toEqual(expect.arrayContaining(['on_terms', 'on_flow_history', 'on_cashflows']))
    expect(userMarketReads()).toEqual([])
  })

  it('3. on-payments loadPayments keeps the ledger on the user client and on_terms on the service client', async () => {
    setup({ transactions: [onTrade] })
    const r = await loadPayments(user as never, 'u1', TODAY)
    expect(r.payments.map((p) => p.date)).toContain('2026-06-01')
    expect(user.reads).toEqual(expect.arrayContaining(['transactions', 'on_payment_overrides']))
    expect(service.reads).not.toContain('transactions')
    expect(userMarketReads()).toEqual([])
  })

  it('4a. currency-views loadCurrencyContext reads the CEDEAR ratios from the service client', async () => {
    const ctx = await loadCurrencyContext(user as never)
    expect(ctx?.ratios.get('AAPL')).toBe(20)
    expect(service.reads).toContain('cedears')
    expect(userMarketReads()).toEqual([])
  })

  it('4b. currency-views currencyViewsFor reads fx_rates on the service client and the ledger on the user client', async () => {
    setup({ transactions: [stockTrade] })
    const ctx = { fx: { mep: { rate: 1400, date: TODAY }, ccl: { rate: 1500, date: TODAY } }, ratios: new Map([['AAPL', 20]]) }
    await currencyViewsFor(user as never, 'u1', ctx, { positions: [], onPositions: [], cashBalance: 0 })
    expect(service.reads).toContain('fx_rates')
    expect(service.reads).not.toContain('transactions')
    expect(user.reads).toContain('transactions')
    expect(userMarketReads()).toEqual([])
  })

  it('5. ledger-now loadLastCloses reads the last ON close from the service client', async () => {
    const closes = await loadLastCloses(user as never, [{ ticker: 'T001D', first_bought: '2026-01-05' }], new Map())
    expect(closes.get('T001D')).toBe(98.5)
    expect(userMarketReads()).toEqual([])
  })

  it('6. derived-series reads market data and backfills through the service client; the ledger stays on the user client', async () => {
    setup({ transactions: [onTrade], cash_movements: [{ user_id: 'u1', type: 'DEPOSITO', amount: 100000, date: '2026-01-02' }] },
      { ...MARKET_ROWS, on_price_history: [] })
    const derive = vi.fn(() => ({ rows: [], flags: { negativeCash: null, costMarkedStocks: [], todayUnpriced: [], failure: null }, income: [] }))
    const backfillOnPriceHistory = vi.fn(async (sb: any, ticker: string) => {
      const { error } = await sb.from('on_price_history').upsert([{ ticker, price_date: '2026-01-05', close: 99 }])
      if (error) throw new Error(error.message)
      return 1
    })
    const backfillPastFlows = vi.fn(async (sb: any, isin: string) => {
      const { error } = await sb.from('on_flow_history').upsert([{ isin, flow_date: '2025-12-01', ren: 3, amo: 0 }])
      if (error) throw new Error(error.message)
      return 1
    })
    await getDerivedSeries(user as never, 'u1', {}, {
      today: TODAY, getBars: vi.fn(async () => new Map()), fetchQuotes: vi.fn(async () => new Map()),
      derive: derive as never, backfillOnPriceHistory: backfillOnPriceHistory as never, backfillPastFlows: backfillPastFlows as never,
    })
    expect(backfillOnPriceHistory).toHaveBeenCalledWith(service, 'T001D', '2026-01-05', TODAY)
    expect(backfillPastFlows).toHaveBeenCalledWith(service, ISIN, 'T001O', TODAY)
    expect(service.writes.map((w) => w.table)).toEqual(['on_price_history', 'on_flow_history'])
    expect(user.writes).toEqual([])
    expect(service.reads).toEqual(expect.arrayContaining(['on_price_history', 'on_terms', 'ticker_identity', 'on_flow_history', 'on_cashflows']))
    expect(user.reads).toEqual(expect.arrayContaining(['transactions', 'cash_movements', 'on_payment_overrides']))
    expect(service.reads.filter((t) => !MARKET.includes(t))).toEqual([])
    expect(userMarketReads()).toEqual([])
  })

  // 7-8. fx-rates getFxRate and trade-record recordCedearTrade read with the client they are
  // given: trade-record reaches the browser bundle (AddTransactionModal), so it cannot import
  // supabase-server. Their callers pass the service client; see the transactions route tests.

  it('9. ticker-catalog getCataloguedTicker and listCatalogued read ticker_identity from the service client', async () => {
    await expect(getCataloguedTicker(user, 'aapl')).resolves.toMatchObject({ ticker: 'AAPL', yahoo_symbol: 'AAPL' })
    await expect(listCatalogued(user)).resolves.toHaveLength(1)
    expect(userMarketReads()).toEqual([])
  })

  it('9b. ticker-catalog still throws on a failed read, so a broken read never looks like "not catalogued"', async () => {
    setup({}, { ticker_identity: [] })
    h.service = fakeClient({}, () => true)
    await expect(getCataloguedTicker(user, 'AAPL')).rejects.toThrow(/permission denied/)
  })
})
