import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadOnAnalyses, loadPriceHistory, getOnPrices, resetOnCaches, type PriceFeed } from './on-catalog'

beforeEach(() => resetOnCaches())

const NOW = new Date('2026-10-21T15:00:00Z') // Wed; settle = Thu 2026-10-22
const PAGE = 1000

const termsRow = (isin: string, over: Record<string, unknown> = {}) => ({
  isin,
  ticker_o: `T${isin.slice(-3)}O`,
  ticker_d: `T${isin.slice(-3)}D`,
  ticker_c: null,
  issuer: 'Emisor de Prueba',
  description: 'ON Clase A',
  law: 'NY',
  currency: 'USD',
  payment_plaza: 'MEP',
  est: 'Tasa Fija',
  frequency: 'Semestral',
  issue_date: '2026-10-21',
  maturity_date: '2029-10-22',
  coupon_rate: '0.06',
  residual_pct: '100',
  accrual_start: '2026-10-21',
  issued_amount_byma: null,
  adtv_o: null,
  adtv_d: '500',
  adtv_c: null,
  as_of: '2026-10-20',
  ...over,
})
const flowRows = (isin: string) => [
  { isin, flow_date: '2027-10-22', ren: '6', amo: '0' },
  { isin, flow_date: '2029-10-22', ren: '6', amo: '100' },
]

type Tables = Record<string, Record<string, unknown>[]>

// Read-only fake: only select/eq/order/range exist, so any write call would throw.
function fakeSupabase(tables: Tables) {
  const log: { table: string; ranges: [number, number][] }[] = []
  return {
    log,
    from(table: string) {
      let rows = tables[table] ?? []
      const entry = { table, ranges: [] as [number, number][] }
      log.push(entry)
      const b: any = {
        select: () => b,
        eq: (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), b),
        order: (col: string, o?: { ascending?: boolean }) => {
          if (o?.ascending === false) rows = [...rows].sort((x, y) => String(y[col]).localeCompare(String(x[col])))
          return b
        },
        limit: (n: number) => Promise.resolve({ data: rows.slice(0, n), error: null }),
        range: (from: number, to: number) => {
          entry.ranges.push([from, to])
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
        },
      }
      return b
    },
  } as any
}

const feed = (entries: Record<string, number>, volumes: Record<string, number> = {}): (() => Promise<PriceFeed | null>) => async () => ({
  prices: new Map(Object.entries(entries)),
  volumes: new Map(Object.entries(volumes)),
  fetchedAt: '2026-10-21T14:58:00Z',
})

const base = (): Tables => ({
  on_terms: [termsRow('AR0000000001'), termsRow('AR0000000002', { ticker_d: null }), termsRow('AR0000000003', { est: 'Tasa Variable' })],
  on_cashflows: ['AR0000000001', 'AR0000000002', 'AR0000000003'].flatMap(flowRows),
  on_terms_overrides: [],
  on_corporate_events: [],
  on_yield_checks: [],
  on_sov_curve: [],
})

describe('loadOnAnalyses', () => {
  it('joins the D-line price per ISIN; no D ticker or floating rate means no analytics', async () => {
    const r = await loadOnAnalyses(fakeSupabase(base()), { now: NOW, getPrices: feed({ T001D: 100, T002D: 100, T003D: 100 }) })
    const by = Object.fromEntries(r.analyses.map((a) => [a.row.isin, a.row]))
    expect(by.AR0000000001.status).toBe('ok')
    expect(by.AR0000000001.price).toBe(100)
    expect(by.AR0000000002.status).toBe('no-price') // no D ticker: never fall back to O/C
    expect(by.AR0000000003.status).toBe('floating')
    expect(r.asOf).toBe('2026-10-20')
    expect(r.stale).toBe(false)
    expect(r.prices).toEqual({ ok: true, quiet: false, fetchedAt: '2026-10-21T14:58:00Z' })
  })

  it('reads every page of a table larger than one PostgREST page', async () => {
    const t = base()
    t.on_terms = [termsRow('AR0000000001')]
    t.on_cashflows = Array.from({ length: PAGE + 5 }, (_, i) => ({ isin: 'AR0000000001', flow_date: `2027-${String((i % 12) + 1).padStart(2, '0')}-01`, ren: '0', amo: '0' }))
    const sb = fakeSupabase(t)
    await loadOnAnalyses(sb, { now: NOW, getPrices: feed({}) })
    const ranges = sb.log.filter((l: any) => l.table === 'on_cashflows').flatMap((l: any) => l.ranges)
    expect(ranges).toEqual([[0, PAGE - 1], [PAGE, 2 * PAGE - 1]])
  })

  it('an empty catalog gives no rows and a null as-of, marked stale', async () => {
    const r = await loadOnAnalyses(fakeSupabase({}), { now: NOW, getPrices: feed({}) })
    expect(r.analyses).toEqual([])
    expect(r.asOf).toBeNull()
    expect(r.stale).toBe(true)
  })

  it('flags the catalog stale after 2 business days', async () => {
    const t = base()
    t.on_terms = [termsRow('AR0000000001', { as_of: '2026-10-15' })]
    const r = await loadOnAnalyses(fakeSupabase(t), { now: NOW, getPrices: feed({}) })
    expect(r.stale).toBe(true)
    expect(r.asOf).toBe('2026-10-15')
  })

  it('a price feed outage keeps the catalog and says prices are unavailable', async () => {
    const r = await loadOnAnalyses(fakeSupabase(base()), { now: NOW, getPrices: async () => null })
    expect(r.prices).toEqual({ ok: false, quiet: false, fetchedAt: null })
    expect(r.analyses.map((a) => a.row.status)).toEqual(['no-price', 'no-price', 'floating'])
  })

  it('applies overrides, events and the latest check; curve feeds the spread', async () => {
    const t = base()
    t.on_terms = [termsRow('AR0000000001')]
    t.on_terms_overrides = [{ isin: 'AR0000000001', field: 'day_count', value: 'ACT/365', source_url: 'https://example.org/p', verified_at: '2026-10-01' }]
    t.on_corporate_events = [{ isin: 'AR0000000001', kind: 'reapertura', event_date: '2026-09-01', note: null, source_url: 'https://example.org/e', verified_at: null }]
    t.on_yield_checks = [{ isin: 'AR0000000001', as_of: '2026-10-20', byma_ytm: '6.2', method_ytm: '6.3', method_diff_bp: '10', terms_ytm: '6.1', terms_diff_bp: '-10', flagged: true }]
    t.on_sov_curve = [{ ticker: 'AL30', law: 'NY', ytm: '5', dm: '1', as_of: '2026-10-20' }, { ticker: 'GD41', law: 'NY', ytm: '6', dm: '5', as_of: '2026-10-20' }]
    const r = await loadOnAnalyses(fakeSupabase(t), { now: NOW, getPrices: feed({ T001D: 100 }) })
    const a = r.analyses[0]
    expect(a.detail.terms.dayCount).toMatchObject({ value: 'ACT/365', prov: 'verified' })
    expect(a.row.events).toHaveLength(1)
    expect(a.row.methodFlag).toMatchObject({ diffBp: 10, bymaYtmPct: 6.2 })
    expect(a.row.spreadBp).not.toBeNull()
  })

  it('narrows every query to one ISIN when asked', async () => {
    const r = await loadOnAnalyses(fakeSupabase(base()), { now: NOW, getPrices: feed({ T001D: 100 }), isin: 'AR0000000001' })
    expect(r.analyses.map((a) => a.row.isin)).toEqual(['AR0000000001'])
    expect(r.analyses[0].detail.schedule).toHaveLength(2)
  })

  it('throws when a table cannot be read', async () => {
    const sb: any = { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'boom' } }) }), eq: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'boom' } }) }) }) }) }) }
    await expect(loadOnAnalyses(sb, { now: NOW, getPrices: feed({}) })).rejects.toThrow(/boom/)
  })
})

describe('loadPriceHistory', () => {
  const hist = [
    { ticker: 'T001D', price_date: '2026-10-19', close: '100.5' },
    { ticker: 'T001D', price_date: '2026-10-20', close: '101' },
    { ticker: 'OTHER', price_date: '2026-10-20', close: '50' },
  ]

  it('returns the ticker closes oldest first as numbers', async () => {
    const sb = fakeSupabase({ on_price_history: hist })
    expect(await loadPriceHistory(sb, 'T001D')).toEqual([
      { date: '2026-10-19', close: 100.5 },
      { date: '2026-10-20', close: 101 },
    ])
  })

  it('no D ticker or a read error gives an empty history, never a failure', async () => {
    expect(await loadPriceHistory(fakeSupabase({}), null)).toEqual([])
    const broken: any = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: 'boom' } }) }) }) }) }) }
    expect(await loadPriceHistory(broken, 'T001D')).toEqual([])
  })
})

describe('H1: a scoped read keeps the global sovereign curve', () => {
  it('detail (one ISIN) still gets a spread', async () => {
    const t = base()
    t.on_terms = [termsRow('AR0000000001')]
    t.on_sov_curve = [{ ticker: 'AL30', law: 'NY', ytm: '5', dm: '1', as_of: '2026-10-20' }, { ticker: 'GD41', law: 'NY', ytm: '6', dm: '5', as_of: '2026-10-20' }]
    const r = await loadOnAnalyses(fakeSupabase(t), { now: NOW, getPrices: feed({ T001D: 100 }), isin: 'AR0000000001' })
    expect(r.analyses[0].row.spreadBp).not.toBeNull()
  })
})

describe('M2: catalog reads are cached in-process for ~60s', () => {
  it('a second load reuses the tables; after the TTL it reads again', async () => {
    const sb = fakeSupabase(base())
    const opts = { now: NOW, getPrices: feed({ T001D: 100 }) }
    await loadOnAnalyses(sb, opts)
    const calls = sb.log.length
    await loadOnAnalyses(sb, opts)
    await loadOnAnalyses(sb, { ...opts, isin: 'AR0000000001' }) // detail reuses the same snapshot
    expect(sb.log.length).toBe(calls)
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] })
    await loadOnAnalyses(sb, opts)
    vi.useRealTimers()
    expect(sb.log.length).toBeGreaterThan(calls)
  })

  it('a failed read is not cached', async () => {
    const bad: any = { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'boom' } }) }) }) }) }
    await expect(loadOnAnalyses(bad, { now: NOW, getPrices: feed({}) })).rejects.toThrow()
    const ok = await loadOnAnalyses(fakeSupabase(base()), { now: NOW, getPrices: feed({}) })
    expect(ok.analyses.length).toBe(3)
  })
})

describe('M1: data912 on the ON path', () => {
  const quote = { symbol: 'T001D', c: 100 }
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('passes a timeout signal and caches success', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => [quote] }))
    vi.stubGlobal('fetch', f)
    expect((await getOnPrices())?.prices.get('T001D')).toBe(100)
    await getOnPrices()
    expect(f).toHaveBeenCalledTimes(1)
    expect((f.mock.calls[0] as any)[1].signal).toBeInstanceOf(AbortSignal)
  })

  it('a failure is negative-cached ~45s, then retried', async () => {
    const f = vi.fn(async () => { throw new Error('timeout') })
    vi.stubGlobal('fetch', f)
    expect(await getOnPrices()).toBeNull()
    expect(await getOnPrices()).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
    vi.useFakeTimers({ now: Date.now() + 46_000, toFake: ['Date'] })
    await getOnPrices()
    expect(f).toHaveBeenCalledTimes(2)
  })
})

describe('price quality from data912 volume', () => {
  it('zero volume today marks the row no-trades; positive or unknown volume is ok', async () => {
    const t = base()
    t.on_terms = [termsRow('AR0000000001'), termsRow('AR0000000002', { ticker_d: 'T002D' }), termsRow('AR0000000003', { ticker_d: 'T003D' })]
    t.on_cashflows = ['AR0000000001', 'AR0000000002', 'AR0000000003'].flatMap(flowRows)
    const r = await loadOnAnalyses(fakeSupabase(t), { now: NOW, getPrices: feed({ T001D: 100, T002D: 100, T003D: 100 }, { T001D: 0, T002D: 25 }) })
    const q = Object.fromEntries(r.analyses.map((a) => [a.row.isin, a.row.priceQuality]))
    expect(q).toEqual({ AR0000000001: 'no-trades', AR0000000002: 'ok', AR0000000003: 'ok' })
  })

  it('getOnPrices keeps data912 volume per D ticker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ symbol: 'T001D', c: 100, v: 0 }, { symbol: 'T002D', c: 90, v: 12 }] })))
    const f = await getOnPrices()
    vi.unstubAllGlobals()
    expect(f?.volumes.get('T001D')).toBe(0)
    expect(f?.volumes.get('T002D')).toBe(12)
  })
})

describe('single-flight and stale-on-error', () => {
  it('N concurrent price loads share one fetch', async () => {
    const f = vi.fn(async () => { await new Promise((r) => setTimeout(r, 10)); return { ok: true, json: async () => [{ symbol: 'T001D', c: 100, v: 5 }] } })
    vi.stubGlobal('fetch', f)
    const rs = await Promise.all(Array.from({ length: 8 }, () => getOnPrices()))
    vi.unstubAllGlobals()
    expect(f).toHaveBeenCalledTimes(1)
    expect(rs.every((r) => r?.prices.get('T001D') === 100)).toBe(true)
  })

  it('N concurrent catalog loads read the tables once', async () => {
    const sb = fakeSupabase(base())
    await Promise.all(Array.from({ length: 6 }, () => loadOnAnalyses(sb, { now: NOW, getPrices: feed({}) })))
    expect(sb.log.filter((l: any) => l.table === 'on_terms')).toHaveLength(1)
  })

  it('a failed refresh serves the last-good snapshot with its as-of, and is not cached', async () => {
    const sb = fakeSupabase(base())
    const opts = { now: NOW, getPrices: feed({}) }
    await loadOnAnalyses(sb, opts)
    const bad: any = { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'boom' } }) }) }) }) }
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] })
    const r = await loadOnAnalyses(bad, opts)
    expect(r.analyses).toHaveLength(3)
    expect(r.asOf).toBe('2026-10-20')
    const calls = sb.log.length
    await loadOnAnalyses(sb, opts) // not cached as a failure: the next call retries
    vi.useRealTimers()
    expect(sb.log.length).toBeGreaterThan(calls)
  })
})

describe('quiet market: no per-row no-trades labels', () => {
  const t = () => {
    const x = base()
    x.on_terms = ['1', '2', '3', '4', '5'].map((n) => termsRow(`AR000000000${n}`, { ticker_d: `T00${n}D` }))
    x.on_cashflows = x.on_terms.flatMap((r) => flowRows(String(r.isin)))
    return x
  }
  const prices = { T001D: 100, T002D: 100, T003D: 100, T004D: 100, T005D: 100 }

  it('active session (< 60% zero volume): zero-volume lines are labelled', async () => {
    const r = await loadOnAnalyses(fakeSupabase(t()), { now: NOW, getPrices: feed(prices, { T001D: 0, T002D: 9, T003D: 9, T004D: 9, T005D: 9 }) })
    expect(r.prices.quiet).toBe(false)
    expect(r.analyses[0].row.priceQuality).toBe('no-trades')
  })

  it('quiet session (>= 60% zero volume): nothing labelled, feed flagged quiet', async () => {
    const r = await loadOnAnalyses(fakeSupabase(t()), { now: NOW, getPrices: feed(prices, { T001D: 0, T002D: 0, T003D: 0, T004D: 9, T005D: 9 }) })
    expect(r.prices.quiet).toBe(true)
    expect(r.analyses.every((a) => a.row.priceQuality === 'ok')).toBe(true)
  })
})

describe('C lines in the price feed', () => {
  it('getOnPrices keeps C prices and volumes next to D', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ symbol: 'T001D', c: 100, v: 5 }, { symbol: 'T001C', c: 96, v: 7 }, { symbol: 'T001O', c: 150000, v: 9 }] })))
    const f = await getOnPrices()
    vi.unstubAllGlobals()
    expect(f?.prices.get('T001C')).toBe(96)
    expect(f?.volumes.get('T001C')).toBe(7)
    expect(f?.prices.has('T001O')).toBe(false)
  })

  it('a CCL ON takes its C line; a missing C falls back to D', async () => {
    const t = base()
    t.on_terms = [termsRow('AR0000000001', { payment_plaza: 'CCL', ticker_c: 'T001C' }), termsRow('AR0000000002', { payment_plaza: 'CCL', ticker_c: null })]
    t.on_cashflows = ['AR0000000001', 'AR0000000002'].flatMap(flowRows)
    const r = await loadOnAnalyses(fakeSupabase(t), { now: NOW, getPrices: feed({ T001D: 100, T001C: 96, T002D: 100 }, { T001D: 5, T001C: 5, T002D: 5 }) })
    const by = Object.fromEntries(r.analyses.map((a) => [a.row.isin, a.row]))
    expect([by.AR0000000001.priceLine, by.AR0000000001.price]).toEqual(['C', 96])
    expect([by.AR0000000002.priceLine, by.AR0000000002.lineFallback]).toEqual(['D', true])
  })
})
