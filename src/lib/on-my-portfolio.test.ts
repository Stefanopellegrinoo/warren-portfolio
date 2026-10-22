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
const onNp = make(NP, { tickerO: 'NPNO', tickerD: 'NPND', tickerC: null, issuer: 'Emisor Sin Precio S.A.' }, [{ date: '2027-04-22', ren: 3, amo: 100 }], null)
const onMa = make(MA, { tickerO: 'MATO', tickerD: 'MATD', tickerC: null }, [{ date: '2026-10-20', ren: 3, amo: 100 }], 100)
const ALL = [on1, on2, on3, onFl, onNp, onMa]
const NO_QUOTE_WARNING = 'Precios de mercado no disponibles: valor estimado con el precio de referencia'
const build = (holdings: { ticker: string; quantity: number }[], analyses = ALL, ownPrices?: Record<string, number>) => buildMyOnPortfolio({ holdings, analyses, today: TODAY, ownPrices })
// Independent effective-annual (ACT/365 from settlement) IRR by bisection: [pay date, amount] flows against a base value.
const SETTLE = '2026-10-22'
const handIrr = (flows: [string, number][], base: number): number => {
  const pv = (y: number) => flows.reduce((s, [d, cf]) => s + cf / Math.pow(1 + y, (Date.parse(d) - Date.parse(SETTLE)) / 86_400_000 / 365), 0)
  let lo = -0.5, hi = 2
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (pv(mid) > base) lo = mid; else hi = mid }
  return ((lo + hi) / 2) * 100
}
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

  it('YTM of a single held ON matches an independent hand IRR at the current price', () => {
    const r = build([{ ticker: 'AAAAD', quantity: 100 }]) // VN 10,000 at 100
    const hand = handIrr([['2027-04-22', 300], ['2028-04-21', 10_300]], 10_000)
    expect(pos(r, H1).ytmPct).toBeCloseTo(hand, 5)
    expect(r.analysis.ytmPct).toBeCloseTo(hand, 5)
  })

  it('M1: the pooled TIR leaves out a coupon whose record date has passed (the price is already ex), yet the calendar keeps it', () => {
    const r = build([{ ticker: 'AAAAD', quantity: 100 }, { ticker: 'CCCCD', quantity: 10 }])
    const hand = handIrr([['2027-04-22', 300], ['2027-10-22', 1_030], ['2028-04-21', 10_300]], 11_000) // the 30 of 2026-10-23 is not in the pool
    expect(r.analysis.ytmPct).toBeCloseTo(hand, 5)
    const withIt = handIrr([['2026-10-23', 30], ['2027-04-22', 300], ['2027-10-22', 1_030], ['2028-04-21', 10_300]], 11_000)
    expect(withIt).toBeGreaterThan(hand + 0.1) // the old (inclusive) pooling would have been visibly higher
    expect(pos(r, H3).ytmPct).toBeCloseTo(handIrr([['2027-10-22', 1_030]], 1_000), 5) // consistent with the per-ON TIR
    expect(r.analysis.payments.find((p) => p.payDate === '2026-10-23')).toMatchObject({ interest: 30 })
    expect(r.analysis.totals.interest).toBeCloseTo(600 + 30 + 30, 9) // the 30 of 2026-10-23 still counts as income
  })

  it('a payment whose adjusted pay date is today is not projected (already credited)', () => {
    const edge = make('AR0000000017', { tickerO: 'EDGO', tickerD: 'EDGD', tickerC: null }, [{ date: TODAY, ren: 3, amo: 0 }, { date: '2027-04-22', ren: 3, amo: 100 }], 100)
    const r = build([{ ticker: 'EDGD', quantity: 10 }], [edge])
    expect(r.analysis.payments.map((p) => p.payDate)).toEqual(['2027-04-22'])
  })

  it('M2: market value uses each held ticker at ITS OWN quote (like the dashboard); yields use the payment-plaza price', () => {
    const r = build([{ ticker: 'AAAAD', quantity: 100 }, { ticker: 'AAAAC', quantity: 50 }], ALL, { AAAAD: 98, AAAAC: 101 })
    expect(pos(r, H1).vn).toBe(15_000)
    expect(pos(r, H1).cost).toBeCloseTo(10_000 * 0.98 + 5_000 * 1.01, 9) // 14,850, not 15,000 x plaza price
    expect(r.analysis.totals.cost).toBeCloseTo(14_850, 9)
    // yield: the plaza line is 100, so the TIR is the one of VN 15,000 bought at 100 (independent hand IRR)
    const hand = handIrr([['2027-04-22', 450], ['2028-04-21', 15_450]], 15_000)
    expect(pos(r, H1).ytmPct).toBeCloseTo(hand, 5)
    expect(r.analysis.ytmPct).toBeCloseTo(hand, 5)
  })

  it('M2: a ticker without its own quote falls back to the payment-plaza price, with a warning', () => {
    const r = build([{ ticker: 'AAAAD', quantity: 100 }, { ticker: 'BBBBD', quantity: 50 }], ALL, { AAAAD: 98 })
    expect(pos(r, H2).cost).toBeCloseTo(4_900, 9) // plaza price 98 x 5,000
    expect(r.analysis.warnings.some((w) => w.kind === 'price-fallback' && w.isin === H2 && w.message.includes(NO_QUOTE_WARNING))).toBe(true)
    expect(r.analysis.warnings.some((w) => w.kind === 'price-fallback' && w.isin === H1)).toBe(false)
  })

  it.each([[undefined], [{}]])('feed down (ownPrices %j): every held priced ticker is warned and valued at the plaza price', (own) => {
    const r = build([{ ticker: 'AAAAD', quantity: 100 }, { ticker: 'BBBBD', quantity: 50 }], ALL, own)
    expect(pos(r, H1).cost).toBeCloseTo(10_000, 9) // plaza price 100 x 10,000 VN
    expect(pos(r, H2).cost).toBeCloseTo(4_900, 9) // plaza price 98 x 5,000 VN
    for (const isin of [H1, H2]) {
      expect(r.analysis.warnings.some((w) => w.kind === 'price-fallback' && w.isin === isin && w.message.includes(NO_QUOTE_WARNING))).toBe(true)
    }
  })

  it('all held tickers quoted on their own line: no reference-price warning', () => {
    const r = build([{ ticker: 'AAAAD', quantity: 100 }], ALL, { AAAAD: 98 })
    expect(r.analysis.warnings.some((w) => w.message.includes(NO_QUOTE_WARNING))).toBe(false)
  })

  it('unpriced holdings are left out of the issuer and plaza concentration', () => {
    const r = build([{ ticker: 'NPND', quantity: 10 }, { ticker: 'AAAAD', quantity: 100 }])
    expect(r.analysis.plazas.reduce((s, p) => s + p.costPct, 0)).toBeCloseTo(100, 9)
    expect(r.analysis.issuers).toHaveLength(1)
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
    expect(r.analysis.ytmPct).toBeCloseTo(handIrr([['2027-04-22', 300], ['2028-04-21', 10_300]], 10_000), 5)
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
