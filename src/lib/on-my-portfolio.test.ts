import { describe, it, expect } from 'vitest'
import { buildMyOnPortfolio } from './on-my-portfolio'
import { analyzeOn, type OnAnalysis, type OnInput, type TermsRow } from './on-analytics'
import type { OverrideRow } from './on-terms'

// Synthetic ONs only. Today = Wednesday 2026-10-21 (settlement Thursday 2026-10-22).
const TODAY = '2026-10-21'
const terms = (isin: string, over: Partial<TermsRow>): TermsRow => ({
  isin, tickerO: 'TSTO', tickerD: 'TSTD', tickerC: 'TSTC', issuer: 'Emisor de Prueba S.A.', description: 'ON de prueba',
  law: 'ARG', currency: 'USD', paymentPlaza: 'CCL', est: 'Step Up', frequency: 'Semestral',
  issueDate: '2026-04-22', maturityDate: '2028-04-21', couponRate: 0.06, residualPct: 100, accrualStart: '2026-10-22',
  issuedAmountByma: null, adtvO: null, adtvD: null, adtvC: null, asOf: '2026-10-20', ...over,
})
const ov = (isin: string, field: string, value: unknown): OverrideRow => ({ isin, field, value, sourceUrl: 'https://example.org/p.pdf', verifiedAt: '2026-10-01' })
const make = (isin: string, t: Partial<TermsRow>, flows: OnInput['flows'], price: number | null, overrides: OverrideRow[] = [], events: OnInput['events'] = []): OnAnalysis =>
  analyzeOn({ terms: terms(isin, t), flows, overrides, events, check: null, curve: [], price, settle: '2026-10-22' })

const H1 = 'AR0000000011'
const H2 = 'AR0000000012'
const H3 = 'AR0000000013'
const FL = 'AR0000000014'
const NP = 'AR0000000015'
const MA = 'AR0000000016'
// H1: bullet, lot rules min 10,000 / step 1,000 (a purchase would be rounded; a holding never is). ARG law.
const on1 = make(H1, { tickerO: 'AAAAO', tickerD: 'AAAAD', tickerC: 'AAAAC' }, [
  { date: '2027-04-22', ren: 3, amo: 0 }, { date: '2028-04-21', ren: 3, amo: 100 },
], 100, [ov(H1, 'min_denomination', 10_000), ov(H1, 'increment', 1_000)])
// H2: amortizing 50 + 50, MEP plaza, NY law with NO day-count override ("sin verificar").
const on2 = make(H2, { tickerO: 'BBBBO', tickerD: 'BBBBD', tickerC: null, law: 'NY', paymentPlaza: 'MEP' }, [
  { date: '2027-04-30', ren: 4, amo: 50 }, { date: '2027-10-29', ren: 2, amo: 50 },
], 98)
// H3: record date 5 days before the payment; today is already past it, the pay date (2026-10-23, Friday) is not.
const on3 = make(H3, { tickerO: 'CCCCO', tickerD: 'CCCCD', tickerC: null }, [
  { date: '2026-10-23', ren: 3, amo: 0 }, { date: '2027-10-22', ren: 3, amo: 100 },
], 100, [ov(H3, 'record_offset_days', 5)], [{ kind: 'amendment', eventDate: '2026-09-01', note: null, sourceUrl: 'https://example.org/e', verifiedAt: null }])
const onFl = make(FL, { tickerO: 'FLOO', tickerD: 'FLOD', tickerC: null, est: 'Tasa Variable' }, [{ date: '2028-04-21', ren: 1, amo: 100 }], 100)
const onNp = make(NP, { tickerO: 'NPNO', tickerD: 'NPND', tickerC: null }, [{ date: '2027-04-22', ren: 3, amo: 100 }], null)
const onMa = make(MA, { tickerO: 'MATO', tickerD: 'MATD', tickerC: null }, [{ date: '2026-10-20', ren: 3, amo: 100 }], 100)
const ALL = [on1, on2, on3, onFl, onNp, onMa]
const build = (holdings: { ticker: string; quantity: number }[], analyses = ALL) => buildMyOnPortfolio({ holdings, analyses, today: TODAY })
const pos = (r: ReturnType<typeof build>, isin: string) => r.analysis.positions.find((p) => p.isin === isin)!

describe('buildMyOnPortfolio: held semantics', () => {
  it('VN = quantity x 100 exactly (no lot rounding) and market value = VN x price / 100', () => {
    const r = build([{ ticker: 'AAAAD', quantity: 105.5 }])
    expect(pos(r, H1).vn).toBeCloseTo(10_550, 9) // a purchase would round down to 10,000
    expect(pos(r, H1).cost).toBeCloseTo(10_550, 9)
    expect(r.analysis.warnings.map((w) => w.kind)).not.toContain('lot-adjusted')
  })

  it('amortizing ON: coupon on the residual, amortization as % of original VN; next payment date and amount', () => {
    const p = pos(build([{ ticker: 'BBBBD', quantity: 50 }]), H2) // VN 5,000
    expect(p.cost).toBeCloseTo(4_900, 9) // 5,000 x 98%
    expect(p.nextPayDate).toBe('2027-04-30')
    expect(p.nextPayAmount).toBeCloseTo(2_700, 9) // 4% x 5,000 = 200 interest + 50% x 5,000 = 2,500 principal
  })

  it('a current holder past the record date still collects the next coupon, with an explicit label', () => {
    const r = build([{ ticker: 'CCCCD', quantity: 10 }]) // VN 1,000
    const first = r.analysis.payments[0]
    expect(first).toMatchObject({ payDate: '2026-10-23', interest: 30, principal: 0 })
    expect(r.analysis.warnings.map((w) => w.message).join('\n')).toContain('corte ya pasado: lo cobrás')
    expect(r.analysis.warnings.map((w) => w.kind)).not.toContain('record-window')
  })

  it('YTM of a single held ON equals its yield at the current price', () => {
    const r = build([{ ticker: 'AAAAD', quantity: 100 }])
    expect(pos(r, H1).ytmPct).toBeCloseTo(on1.row.ytmPct!, 6)
    expect(r.analysis.ytmPct).toBeCloseTo(on1.row.ytmPct!, 4)
  })

  it('monthly calendar, annual totals and ladder come from the held flows by adjusted pay date', () => {
    const r = build([{ ticker: 'AAAAD', quantity: 100 }, { ticker: 'BBBBD', quantity: 50 }])
    const a = r.analysis
    expect(a.monthly[0]).toMatchObject({ month: '2027-04', interest: 500, principal: 2_500 }) // 300 + 200, 2,500
    // 2027-10-29 is a Friday: stays in October.
    expect(a.monthly.find((m) => m.month === '2027-10')).toMatchObject({ interest: 100, principal: 2_500 })
    expect(a.annual.map((y) => [y.year, y.total])).toEqual([[2027, 300 + 200 + 2_500 + 100 + 2_500], [2028, 300 + 10_000]])
    expect(a.ladder.map((l) => l.year)).toEqual([2027, 2028])
  })
})

describe('buildMyOnPortfolio: mapping and warnings', () => {
  it('maps by ticker D, then C, then O, and merges holdings of the same ISIN', () => {
    const r = build([{ ticker: 'aaaac ', quantity: 100 }, { ticker: 'AAAAO', quantity: 100 }, { ticker: 'AAAAD', quantity: 100 }])
    expect(r.analysis.positions).toHaveLength(1)
    expect(pos(r, H1).vn).toBe(30_000)
  })

  it('lists tickers without terms apart, with a warning, and keeps projecting the rest', () => {
    const r = build([{ ticker: 'ZZZZD', quantity: 10 }, { ticker: 'AAAAD', quantity: 100 }])
    expect(r.unmapped).toEqual([{ ticker: 'ZZZZD', vn: 1_000 }])
    expect(r.analysis.warnings.find((w) => w.kind === 'unmapped')?.message).toContain('sin términos en el catálogo')
    expect(r.analysis.positions).toHaveLength(1)
  })

  it('ignores non-positive quantities', () => {
    expect(build([{ ticker: 'AAAAD', quantity: 0 }, { ticker: 'BBBBD', quantity: -5 }]).analysis.empty).toBe(true)
  })

  it('floating ON: listed (the catalog does not price it), not projected, warned once', () => {
    const r = build([{ ticker: 'FLOD', quantity: 20 }, { ticker: 'AAAAD', quantity: 100 }])
    expect(pos(r, FL)).toMatchObject({ vn: 2_000, priced: false, cost: 0, nextPayDate: null, nextPayAmount: null, ytmPct: null })
    expect(r.analysis.payments.some((p) => p.isin === FL)).toBe(false)
    expect(r.analysis.warnings.filter((w) => w.isin === FL).map((w) => w.kind)).toEqual(['floating'])
    // the pooled YTM ignores it: same as the fixed ON alone
    expect(r.analysis.ytmPct).toBeCloseTo(on1.row.ytmPct!, 4)
  })

  it('no price: payments are still projected, but there is no market value or yield, and it is warned', () => {
    const r = build([{ ticker: 'NPND', quantity: 10 }, { ticker: 'AAAAD', quantity: 100 }])
    expect(pos(r, NP)).toMatchObject({ vn: 1_000, priced: false, cost: 0, ytmPct: null, nextPayDate: '2027-04-22' })
    expect(pos(r, NP).nextPayAmount).toBeCloseTo(1_030, 9)
    expect(r.analysis.totals.cost).toBeCloseTo(10_000, 9)
    expect(r.analysis.warnings.some((w) => w.kind === 'no-price' && w.isin === NP)).toBe(true)
  })

  it('a matured ON is skipped with a warning', () => {
    const r = build([{ ticker: 'MATD', quantity: 10 }])
    expect(r.analysis.empty).toBe(true)
    expect(r.analysis.skipped[0].reason).toBe('no-payments')
  })

  it('warns about an unverified day count only for NY law, and about corporate events', () => {
    const r = build([{ ticker: 'AAAAD', quantity: 100 }, { ticker: 'BBBBD', quantity: 50 }, { ticker: 'CCCCD', quantity: 10 }])
    const unv = r.analysis.warnings.filter((w) => w.kind === 'day-count-unverified')
    expect(unv.map((w) => w.isin)).toEqual([H2])
    expect(unv[0].message).toContain('sin verificar')
    expect(r.analysis.warnings.filter((w) => w.kind === 'event').map((w) => w.isin)).toEqual([H3])
  })

  it('only unpriced / floating holdings: no crash, calendar may be empty', () => {
    const r = build([{ ticker: 'FLOD', quantity: 20 }])
    expect(r.analysis.empty).toBe(false)
    expect(r.analysis.monthly).toEqual([])
    expect(r.analysis.ytmPct).toBeNull()
  })
})
