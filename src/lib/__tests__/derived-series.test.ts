import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map<string, string>()
const redisMock = {
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  set: vi.fn(),
  setex: vi.fn(),
  eval: vi.fn(async () => 1),
}
let redisUp = true
vi.mock('../redis', () => ({
  ensureRedisConnected: vi.fn(async () => redisUp),
  getRedis: vi.fn(() => (redisUp ? redisMock : null)),
}))

import { getDerivedSeries as getDerivedSeriesImpl, DERIVED_TTL } from '../derived-series'
import { SUMMARY_SETEX_LUA } from '../summary-cache'
import type { BarsResult } from '../bars-cache'
import type { DeriveInput } from '../derive-history'

const TODAY = '2026-03-10'
const FLAGS = { negativeCash: null, costMarkedStocks: [], todayUnpriced: [], failure: null }
const tx = (over: Record<string, unknown> = {}) => ({
  ticker: 'AAA', operation: 'COMPRA', quantity: 10, price: 50, commission: 0,
  date: '2026-03-02', asset_type: 'ACCION', created_at: null, ...over,
})
const MOVES = [
  { type: 'DEPOSITO', amount: 5000, date: '2026-03-01' },
  { type: 'COMPRA', amount: 500, date: '2026-03-02' },
]
const bar = (date: string, close: number) => ({ date, close })
const AAA_BARS = ['02', '03', '04', '05', '06', '09'].map((d, i) => bar(`2026-03-${d}`, 50 + i))
const ok = (bars = AAA_BARS, over: Partial<BarsResult> = {}): BarsResult =>
  ({ bars, splits: [], splitsKnown: true, degraded: false, missing: false, ...over })
const quote = (ticker: string, price: number) => ({ ticker, price, change: 0, changePercent: 0, previousClose: price })

type Tables = Record<string, { data?: any[]; error?: { message: string } }>
function fakeSupabase(tables: Tables, log: string[] = [], filters: string[] = []) {
  return {
    from(name: string) {
      log.push(name)
      const cfg = tables[name] ?? { data: [] }
      let offset = 0
      const b: any = {
        select: (cols: string) => { filters.push(`${name}.select(${cols})`); return b }, lte: () => b, order: () => b,
        eq: (c: string, v: unknown) => { filters.push(`${name}.eq(${c},${v})`); return b },
        gte: (c: string, v: unknown) => { filters.push(`${name}.gte(${c},${v})`); return b },
        in: (c: string, v: unknown[]) => { filters.push(`${name}.in(${c},${v.join('|')})`); return b },
        range: (o: number) => { offset = o; return b },
        then: (res: any, rej: any) =>
          Promise.resolve(cfg.error ? { data: null, error: cfg.error } : { data: (cfg.data ?? []).slice(offset, offset + 1000), error: null })
            .then(res, rej),
      }
      return b
    },
  } as any
}

// Market tables are read and backfilled with the service role (odd/tasks/security-hardening.md
// S12): the fixture each test passes is what the service client serves.
const hm = vi.hoisted(() => ({ market: null as any }))
vi.mock('../supabase-server', () => ({ createServiceClient: () => hm.market }))
const getDerivedSeries: typeof getDerivedSeriesImpl = (sb, userId, range, d) => { hm.market = sb; return getDerivedSeriesImpl(sb, userId, range, d) }

function deps(over: Record<string, any> = {}) {
  return {
    today: TODAY,
    getBars: vi.fn(async (symbols: string[]) => new Map(symbols.map(s => [s, ok()]))),
    getHistoricalCCL: vi.fn(async () => new Map<string, number>()),
    fetchQuotes: vi.fn(async (_tickers: string[]) => new Map([['AAA', quote('AAA', 70)]])),
    loadSchedules: vi.fn(async () => new Map()),
    backfillOnPriceHistory: vi.fn(async () => 0),
    backfillPastFlows: vi.fn(async () => 0),
    ...over,
  }
}
const tables = (over: Tables = {}): Tables => ({
  transactions: { data: [tx()] }, cash_movements: { data: MOVES }, ...over,
})

beforeEach(() => {
  store.clear()
  redisUp = true
  vi.clearAllMocks()
  redisMock.eval.mockResolvedValue(1)
  redisMock.get.mockImplementation(async (k: string) => store.get(k) ?? null)
})

describe('getDerivedSeries', () => {
  it('returns snapshot-shaped rows, today last, and caches them (with the income) under the version CAS', async () => {
    store.set('summary:version:u1', '7')
    const res = await getDerivedSeries(fakeSupabase(tables()), 'u1', {}, deps())

    expect(res.degraded).toBe(false)
    expect(res.rows.at(-1)).toMatchObject({ snapshot_date: TODAY, user_id: 'u1' })
    expect(res.rows.some(r => 'source' in r)).toBe(false)
    expect(res.rows.length).toBeGreaterThan(2)
    expect(redisMock.eval).toHaveBeenCalledTimes(1)
    const args = redisMock.eval.mock.calls[0] as unknown[]
    expect(args.slice(0, 6)).toEqual([SUMMARY_SETEX_LUA, 2, 'derived:v2:u1', 'summary:version:u1', '7', DERIVED_TTL])
    expect(DERIVED_TTL).toBe(900)
    // v2 carries the deposits and withdrawals the rows were built from (statistics-truth S10).
    expect(JSON.parse(args[6] as string)).toMatchObject({ asOf: TODAY, income: [], externalFlows: [{ date: '2026-03-01', amount: 5000 }], fundedDeposits: null })
    expect(redisMock.set).not.toHaveBeenCalled()
    expect(redisMock.setex).not.toHaveBeenCalled()
  })

  it('serves a same-day hit filtered by range without touching the database', async () => {
    const first = await getDerivedSeries(fakeSupabase(tables()), 'u1', {}, deps())
    store.set('derived:v2:u1', JSON.stringify({ asOf: TODAY, rows: first.rows, flags: first.flags, income: first.income, externalFlows: first.externalFlows, fundedDeposits: null }))

    const log: string[] = []
    const hit = await getDerivedSeries(fakeSupabase({}, log), 'u1', { fromDate: '2026-03-05' }, deps())

    expect(log).toEqual([])
    expect(hit.rows.every(r => r.snapshot_date >= '2026-03-05')).toBe(true)
    expect(hit.rows.length).toBeLessThan(first.rows.length)
    expect(hit.degraded).toBe(false)
    expect(hit.externalFlows).toEqual([{ date: '2026-03-01', amount: 5000 }])
  })

  it('ignores an entry cached before the core (no income field): it recomputes', async () => {
    store.set('derived:v2:u1', JSON.stringify({ asOf: TODAY, rows: [], flags: FLAGS }))
    const log: string[] = []
    const res = await getDerivedSeries(fakeSupabase(tables(), log), 'u1', {}, deps())
    expect(log).toContain('transactions')
    expect(res.rows.length).toBeGreaterThan(0)
  })

  it('ignores an entry without the flows its rows were built from: it recomputes (S10)', async () => {
    store.set('derived:v2:u1', JSON.stringify({ asOf: TODAY, rows: [], flags: FLAGS, income: [] }))
    const log: string[] = []
    const res = await getDerivedSeries(fakeSupabase(tables(), log), 'u1', {}, deps())
    expect(log).toContain('transactions')
    expect(res.externalFlows).toEqual([{ date: '2026-03-01', amount: 5000 }])
  })

  it('reads which movements a trade wrote, and funds purchases from a later deposit (S10)', async () => {
    const filters: string[] = []
    const res = await getDerivedSeries(fakeSupabase(tables({
      cash_movements: { data: [
        { type: 'RETIRO', amount: 500, date: '2026-03-02', transaction_id: 't1' },
        { type: 'DEPOSITO', amount: 5000, date: '2026-03-06', transaction_id: null },
      ] },
    }), [], filters), 'u1', {}, deps())
    expect(filters.find(f => f.startsWith('cash_movements.select'))).toContain('transaction_id')
    expect(res.externalFlows).toEqual([{ date: '2026-03-02', amount: 500 }, { date: '2026-03-06', amount: 4500 }])
    expect(res.fundedDeposits).toEqual({ amount: 500, from: '2026-03-02' })
    expect(res.flags.negativeCash).toBeNull()
  })

  it('ignores a hit from another day', async () => {
    store.set('derived:v2:u1', JSON.stringify({ asOf: '2026-03-09', rows: [], flags: null }))
    const log: string[] = []
    const res = await getDerivedSeries(fakeSupabase(tables(), log), 'u1', {}, deps())
    expect(log).toContain('transactions')
    expect(res.rows.length).toBeGreaterThan(0)
  })

  it('reads the version BEFORE it reads the database', async () => {
    const order: string[] = []
    redisMock.get.mockImplementation(async (k: string) => { order.push(`redis:${k}`); return null })
    const sb = fakeSupabase(tables())
    const from = sb.from
    sb.from = (n: string) => { order.push(`db:${n}`); return from(n) }
    await getDerivedSeries(sb, 'u1', {}, deps())
    expect(order.indexOf('redis:summary:version:u1')).toBeGreaterThan(-1)
    expect(order.indexOf('redis:summary:version:u1')).toBeLessThan(order.findIndex(s => s.startsWith('db:')))
  })

  it('S10.1: a version bump during the compute still returns the rows (the CAS refuses the write)', async () => {
    redisMock.eval.mockResolvedValue(0)
    const res = await getDerivedSeries(fakeSupabase(tables()), 'u1', {}, deps())
    expect(res.rows.length).toBeGreaterThan(0)
    expect(res.degraded).toBe(false)
  })

  it('S10.2: version read failure or Redis down -> 200 with rows, nothing cached', async () => {
    redisMock.get.mockImplementation(async (k: string) => { if (k.startsWith('summary:version')) throw new Error('down'); return null })
    const a = await getDerivedSeries(fakeSupabase(tables()), 'u1', {}, deps())
    expect(a.rows.length).toBeGreaterThan(0)

    redisUp = false
    const b = await getDerivedSeries(fakeSupabase(tables()), 'u1', {}, deps())
    expect(b.rows.length).toBeGreaterThan(0)
    expect(redisMock.eval).not.toHaveBeenCalled()
  })

  it('S8.3: degraded results are never cached, and the next healthy one is', async () => {
    const stale = deps({ getBars: vi.fn(async (s: string[]) => new Map(s.map(x => [x, ok(AAA_BARS, { degraded: true })]))) })
    const bad = await getDerivedSeries(fakeSupabase(tables()), 'u1', {}, stale)
    expect(bad.degraded).toBe(true)
    expect(redisMock.eval).not.toHaveBeenCalled()

    const good = await getDerivedSeries(fakeSupabase(tables()), 'u1', {}, deps())
    expect(good.degraded).toBe(false)
    expect(redisMock.eval).toHaveBeenCalledTimes(1)
  })

  it('treats a partial derivation (flags.failure) as degraded and uncacheable', async () => {
    const derive = vi.fn((i: DeriveInput) => ({
      rows: [], flags: { ...FLAGS, failure: 'boom' }, income: [],
    }))
    const res = await getDerivedSeries(fakeSupabase(tables()), 'u1', {}, deps({ derive }))
    expect(res.degraded).toBe(true)
    expect(redisMock.eval).not.toHaveBeenCalled()
  })

  it('a stock held today with no quote is degraded and never cached; an unpriced ON alone is not', async () => {
    const withUnpriced = (todayUnpriced: string[]) => deps({
      derive: vi.fn(() => ({ rows: [], flags: { ...FLAGS, todayUnpriced }, income: [], externalFlows: [], fundedDeposits: null })),
    })
    const onTx = tx({ ticker: 'ONX', asset_type: 'ON', quantity: 100, price: 1 })

    const stock = await getDerivedSeries(fakeSupabase(tables()), 'u1', {}, withUnpriced(['AAA']))
    expect(stock.degraded).toBe(true)
    expect(redisMock.eval).not.toHaveBeenCalled()

    const on = await getDerivedSeries(fakeSupabase(tables({ transactions: { data: [tx(), onTx] } })), 'u1', {}, withUnpriced(['ONX']))
    expect(on.degraded).toBe(false)
    expect(redisMock.eval).toHaveBeenCalledTimes(1)
  })

  it('a bars source with unknown splits is degraded; a clean chart() answering [] is not', async () => {
    const unknownSplits = deps({ getBars: vi.fn(async (s: string[]) => new Map(s.map(x => [x, ok(AAA_BARS, { splitsKnown: false })]))) })
    expect((await getDerivedSeries(fakeSupabase(tables()), 'u1', {}, unknownSplits)).degraded).toBe(true)

    const empty = deps({ getBars: vi.fn(async (s: string[]) => new Map(s.map(x => [x, ok([], { splitsKnown: true })]))) })
    const res = await getDerivedSeries(fakeSupabase(tables()), 'u1', {}, empty)
    expect(res.degraded).toBe(false)
  })

  it('a transactions, cash or payment-override read failure THROWS', async () => {
    for (const table of ['transactions', 'cash_movements', 'on_payment_overrides']) {
      await expect(getDerivedSeries(fakeSupabase(tables({ [table]: { error: { message: 'x' } } })), 'u1', {}, deps())).rejects.toThrow()
    }
  })

  it('on_price_history or schedules read failure -> still answers, degraded, not cached', async () => {
    const onTx = tx({ ticker: 'AERBD', asset_type: 'ON', quantity: 100, price: 100 })
    const prices = await getDerivedSeries(
      fakeSupabase(tables({ transactions: { data: [onTx] }, on_price_history: { error: { message: 'x' } } })), 'u1', {}, deps()
    )
    const schedules = await getDerivedSeries(
      fakeSupabase(tables({ transactions: { data: [onTx] } })), 'u1', {},
      deps({ loadSchedules: vi.fn(async () => { throw new Error('on_terms: x') }) })
    )
    for (const res of [prices, schedules]) {
      expect(res.degraded).toBe(true)
      expect(res.rows.length).toBeGreaterThan(0)
    }
    expect(redisMock.eval).not.toHaveBeenCalled()
  })

  it('catalog symbol wins; without the catalog it falls back to the exchange-normalized ticker; bars are keyed by portfolio ticker', async () => {
    const d = deps()
    let seen!: DeriveInput
    const derive = vi.fn((i: DeriveInput) => { seen = i; return { rows: [], flags: FLAGS, income: [], externalFlows: [], fundedDeposits: null } })
    await getDerivedSeries(
      fakeSupabase(tables({
        transactions: { data: [tx({ ticker: 'aaa ' }), tx({ ticker: 'BCBA:ZZZ' })] },
        ticker_identity: { data: [{ ticker: 'AAA', yahoo_symbol: 'AAA.X', confirmed_name: 'n', exchange: null, last_checked_at: null }] },
      })), 'u1', {}, { ...d, derive }
    )
    expect(d.getBars.mock.calls[0][0].sort()).toEqual(['AAA.X', 'ZZZ.BA'])
    expect([...seen.barsByTicker.keys()].sort()).toEqual(['AAA', 'BCBA:ZZZ'])

    const d2 = deps()
    await getDerivedSeries(
      fakeSupabase(tables({ transactions: { data: [tx({ ticker: 'BCBA:ZZZ' })] }, ticker_identity: { error: { message: 'rls' } } })),
      'u1', {}, { ...d2, derive }
    )
    expect(d2.getBars.mock.calls[0][0]).toEqual(['ZZZ.BA'])
  })

  it('S1: when Yahoo does not report the splits, the stored ones un-adjust the bars and reach the core', async () => {
    let seen!: DeriveInput
    const derive = vi.fn((i: DeriveInput) => { seen = i; return { rows: [], flags: FLAGS, income: [], externalFlows: [], fundedDeposits: null } })
    const stored = [{ date: '2026-03-04', numerator: 2, denominator: 1 }]
    const d = deps({
      getBars: vi.fn(async (s: string[]) => new Map(s.map(x => [x, ok([bar('2026-03-02', 25)], { splitsKnown: false })]))),
      loadSplits: vi.fn(async () => new Map([['AAA', stored]])),
    })
    await getDerivedSeries(fakeSupabase(tables()), 'u1', {}, { ...d, derive })
    expect(seen.barsByTicker.get('AAA')).toEqual([bar('2026-03-02', 50)])
    expect(seen.splits?.get('AAA')).toEqual(stored)
  })

  it('S13: passes bars un-split-adjusted; S12.1: .BA bars go through the CCL, only when one is held', async () => {
    let seen!: DeriveInput
    const derive = vi.fn((i: DeriveInput) => { seen = i; return { rows: [], flags: FLAGS, income: [], externalFlows: [], fundedDeposits: null } })
    const split = deps({
      getBars: vi.fn(async (s: string[]) => new Map(s.map(x => [x, ok([bar('2026-03-02', 25)], { splits: [{ date: '2026-03-04', numerator: 2, denominator: 1 }] })]))),
    })
    await getDerivedSeries(fakeSupabase(tables()), 'u1', {}, { ...split, derive })
    expect(seen.barsByTicker.get('AAA')).toEqual([bar('2026-03-02', 50)])
    // The core gets the same splits the bars were un-adjusted with (odd/tasks/split-aware-ledger.md S1).
    expect(seen.splits?.get('AAA')).toEqual([{ date: '2026-03-04', numerator: 2, denominator: 1 }])
    expect(split.getHistoricalCCL).not.toHaveBeenCalled()

    const ars = deps({
      getBars: vi.fn(async (s: string[]) => new Map(s.map(x => [x, ok([bar('2026-03-02', 12000)])]))),
      getHistoricalCCL: vi.fn(async () => new Map([['2026-03-02', 1200]])),
    })
    const res = await getDerivedSeries(
      fakeSupabase(tables({ transactions: { data: [tx({ ticker: 'BCBA:ZZZ' })] } })), 'u1', {}, { ...ars, derive }
    )
    expect(seen.barsByTicker.get('BCBA:ZZZ')).toEqual([bar('2026-03-02', 10)])
    expect(res.degraded).toBe(false)

    const noCcl = deps({ getBars: ars.getBars, getHistoricalCCL: vi.fn(async () => new Map()) })
    const bad = await getDerivedSeries(
      fakeSupabase(tables({ transactions: { data: [tx({ ticker: 'BCBA:ZZZ' })] } })), 'u1', {}, { ...noCcl, derive }
    )
    expect(bad.degraded).toBe(true)
  })

  it('feeds ON closes, schedules and payment overrides to the core, never portfolio_snapshots, and asks quotes for every traded ticker', async () => {
    let seen!: DeriveInput
    const derive = vi.fn((i: DeriveInput) => { seen = i; return { rows: [], flags: FLAGS, income: [], externalFlows: [], fundedDeposits: null } })
    const schedule = new Map([['AERBD', [{ date: '2026-03-05', ren: 2, amo: 0 }]]])
    const d = deps({ loadSchedules: vi.fn(async () => schedule) })
    const log: string[] = []
    const filters: string[] = []
    await getDerivedSeries(
      fakeSupabase(tables({
        transactions: { data: [tx(), tx({ ticker: 'AERBD', asset_type: 'ON', quantity: 100, price: 100 })] },
        on_price_history: { data: [
          { ticker: 'AERBD', price_date: '2026-03-03', close: '101.5' },
          { ticker: 'AERBD', price_date: '2026-03-04', close: '102' },
        ] },
        on_payment_overrides: { data: [{ ticker: 'aerbd', pay_date: '2026-03-05', kind: 'coupon', amount: null }] },
      }), log, filters), 'u1', {}, { ...d, derive }
    )
    expect(log).not.toContain('portfolio_snapshots')
    expect(filters).toEqual(expect.arrayContaining([
      'on_price_history.in(ticker,AERBD)', 'on_price_history.gte(price_date,2026-03-01)', 'on_payment_overrides.eq(user_id,u1)',
    ]))
    expect(seen.onPricesByTicker.get('AERBD')).toEqual([bar('2026-03-03', 101.5), bar('2026-03-04', 102)])
    expect([...seen.onPricesByTicker.keys()]).toEqual(['AERBD'])
    expect(d.loadSchedules.mock.calls[0].slice(1)).toEqual([['AERBD'], TODAY])
    expect(seen.schedules).toBe(schedule)
    expect(seen.overrides).toEqual([{ ticker: 'AERBD', date: '2026-03-05', kind: 'coupon', amount: null }])
    expect(d.getBars.mock.calls[0][0]).toEqual(['AAA'])
    expect(d.fetchQuotes.mock.calls[0][0].sort()).toEqual(['AAA', 'AERBD'])
    expect(seen.today).toBe(TODAY)
  })

  it('backfills a held ON whose closes do not reach its first trade, once a day, then re-reads its closes', async () => {
    redisMock.set.mockResolvedValueOnce('OK').mockResolvedValue(null)
    const d = deps()
    const log: string[] = []
    const sb = fakeSupabase(tables({
      transactions: { data: [
        tx({ ticker: 'AERBD', asset_type: 'ON', quantity: 100, price: 100, date: '2026-03-02' }),
        tx({ ticker: 'COVD', asset_type: 'ON', quantity: 100, price: 100, date: '2026-03-02' }),
      ] },
      on_price_history: { data: [{ ticker: 'COVD', price_date: '2026-03-04', close: '99' }] },
      on_terms: { data: [{ isin: 'ARX1', ticker_o: 'AERBO', ticker_d: 'AERBD' }] },
    }), log)

    await getDerivedSeries(sb, 'u1', {}, d)
    expect(redisMock.set).toHaveBeenCalledWith('onbackfill:v1:AERBD', '1', 'EX', 86400, 'NX')
    expect(d.backfillOnPriceHistory.mock.calls.map(c => c.slice(1))).toEqual([['AERBD', '2026-03-02', TODAY]])
    expect(d.backfillPastFlows.mock.calls.map(c => c.slice(1))).toEqual([['ARX1', 'AERBO', TODAY]])
    expect(log.filter(t => t === 'on_price_history')).toHaveLength(2)

    store.clear()
    await getDerivedSeries(sb, 'u1', {}, d)
    expect(d.backfillOnPriceHistory).toHaveBeenCalledTimes(1)
  })

  it('a failed on-demand backfill is logged and the read still answers, not degraded', async () => {
    redisMock.set.mockResolvedValue('OK')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = deps({
      backfillOnPriceHistory: vi.fn(async () => { throw new Error('Rava 503') }),
      backfillPastFlows: vi.fn(async () => { throw new Error('bonistas 503') }),
    })
    const res = await getDerivedSeries(fakeSupabase(tables({
      transactions: { data: [tx(), tx({ ticker: 'AERBD', asset_type: 'ON', quantity: 100, price: 100 })] },
      on_terms: { data: [{ isin: 'ARX1', ticker_o: 'AERBO', ticker_d: 'AERBD' }] },
    })), 'u1', {}, d)
    expect(d.backfillOnPriceHistory).toHaveBeenCalledTimes(1)
    expect(d.backfillPastFlows).toHaveBeenCalledTimes(1)
    expect(res.degraded).toBe(false)
    expect(res.rows.at(-1)!.ons_value).toBeCloseTo(10000, 6)
    expect(warn.mock.calls.map(c => String(c[0])).join('|')).toMatch(/Rava backfill failed.*\|.*bonistas backfill failed/)
    warn.mockRestore()
  })

  it('W2b: a symbol with no bars and unknown splits (fallback path) is degraded and not cached', async () => {
    store.set('summary:version:u1', '7')
    const d = deps({ getBars: vi.fn(async (symbols: string[]) => new Map(symbols.map(s => [s, ok([], { splitsKnown: false })]))) })
    const res = await getDerivedSeries(fakeSupabase(tables()), 'u1', {}, d)
    expect(res.degraded).toBe(true)
    expect(redisMock.eval).not.toHaveBeenCalled()
  })
})

/** Holds `table`'s reads until the returned function is called. */
function holdTable(sb: any, table: string): () => void {
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  const from = sb.from
  sb.from = (n: string) => {
    const b = from(n)
    if (n === table) { const then = b.then; b.then = (res: any, rej: any) => gate.then(() => then(res, rej)) }
    return b
  }
  return release
}

describe('getDerivedSeries: one build at a time per user, its reads together', () => {
  it('concurrent callers of one user share one build, each with its own range', async () => {
    const log: string[] = []
    const sb = fakeSupabase(tables(), log)
    const d = deps()

    const [all, recent] = await Promise.all([
      getDerivedSeries(sb, 'u1', {}, d),
      getDerivedSeries(sb, 'u1', { fromDate: '2026-03-05' }, d),
    ])

    expect(log.filter(t => t === 'transactions')).toHaveLength(1)
    expect(d.getBars).toHaveBeenCalledTimes(1)
    expect(redisMock.eval).toHaveBeenCalledTimes(1)
    expect(recent.rows).toEqual(all.rows.filter(r => r.snapshot_date >= '2026-03-05'))
    expect(recent.rows.length).toBeLessThan(all.rows.length)
  })

  it('never shares a build across users', async () => {
    const log: string[] = []
    const sb = fakeSupabase(tables(), log)
    const d = deps()

    const [a, b] = await Promise.all([getDerivedSeries(sb, 'u1', {}, d), getDerivedSeries(sb, 'u2', {}, d)])

    expect(log.filter(t => t === 'transactions')).toHaveLength(2)
    expect(a.rows.at(-1)?.user_id).toBe('u1')
    expect(b.rows.at(-1)?.user_id).toBe('u2')
  })

  it('a caller after a mutation (version bumped) does not join the build that read the old ledger', async () => {
    store.set('summary:version:u1', '1')
    let release!: () => void
    const held = new Promise<void>(r => { release = r })
    const d = deps({ getBars: vi.fn(async (s: string[]) => { await held; return new Map(s.map(x => [x, ok()])) }) })

    const before = getDerivedSeries(fakeSupabase(tables()), 'u1', {}, d)
    await vi.waitFor(() => expect(d.getBars).toHaveBeenCalledTimes(1))
    store.set('summary:version:u1', '2')
    const after = getDerivedSeries(fakeSupabase(tables()), 'u1', {}, d)
    await vi.waitFor(() => expect(d.getBars).toHaveBeenCalledTimes(2))

    release()
    await Promise.all([before, after])
  })

  it('a failed build is not kept: the next caller builds again', async () => {
    const failing = fakeSupabase(tables({ transactions: { error: { message: 'x' } } }))
    await expect(Promise.all([
      getDerivedSeries(failing, 'u1', {}, deps()), getDerivedSeries(failing, 'u1', {}, deps()),
    ])).rejects.toThrow()

    const res = await getDerivedSeries(fakeSupabase(tables()), 'u1', {}, deps())
    expect(res.rows.length).toBeGreaterThan(0)
  })

  it('reads the ledger and the ticker catalog together, then bars, ON closes, schedules and quotes together', async () => {
    const log: string[] = []
    const sb = fakeSupabase(tables({
      transactions: { data: [tx(), tx({ ticker: 'AERBD', asset_type: 'ON', quantity: 100, price: 100 })] },
      on_price_history: { data: [{ ticker: 'AERBD', price_date: '2026-03-02', close: '101' }] },
    }), log)
    const releaseLedger = holdTable(sb, 'transactions')
    let releaseBars!: () => void
    const d = deps({ getBars: vi.fn((s: string[]) => new Promise(r => { releaseBars = () => r(new Map(s.map(x => [x, ok()]))) })) })

    const pending = getDerivedSeries(sb, 'u1', {}, d)

    // While the trades are still on their way, the other ledger reads and the catalog have started.
    await vi.waitFor(() => expect(log).toEqual(expect.arrayContaining(['transactions', 'cash_movements', 'on_payment_overrides', 'ticker_identity'])))
    releaseLedger()
    // While the bars are still on their way, the closes, schedules and quotes have started.
    await vi.waitFor(() => expect(d.getBars).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => {
      expect(log).toContain('on_price_history')
      expect(d.loadSchedules).toHaveBeenCalledTimes(1)
      expect(d.fetchQuotes).toHaveBeenCalledTimes(1)
    })
    releaseBars()

    const res = await pending
    expect(res.degraded).toBe(false)
    expect(res.rows.at(-1)).toMatchObject({ snapshot_date: TODAY, user_id: 'u1' })
  })
})
