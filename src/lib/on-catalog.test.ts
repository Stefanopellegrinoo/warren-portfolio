import { describe, it, expect } from 'vitest'
import { loadOnAnalyses, type PriceFeed } from './on-catalog'

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
        order: () => b,
        range: (from: number, to: number) => {
          entry.ranges.push([from, to])
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
        },
      }
      return b
    },
  } as any
}

const feed = (entries: Record<string, number>): (() => Promise<PriceFeed | null>) => async () => ({
  prices: new Map(Object.entries(entries)),
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
    expect(r.prices).toEqual({ ok: true, fetchedAt: '2026-10-21T14:58:00Z' })
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
    expect(r.prices).toEqual({ ok: false, fetchedAt: null })
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
