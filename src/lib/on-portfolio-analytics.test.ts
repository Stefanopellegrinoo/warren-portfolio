import { describe, it, expect } from 'vitest'
import { analyzePortfolio, plusOneYear, type PortfolioItem } from './on-portfolio-analytics'
import { analyzeOn, type OnAnalysis, type OnInput, type TermsRow } from './on-analytics'
import type { OverrideRow } from './on-terms'

// Two synthetic, Step Up ONs (BYMA `ren` is used as given, so every coupon is a round number).
// Settlement is Thursday 2026-10-22 (today = Wednesday 2026-10-21).
//   A: 3 per 100 VN each coupon, bullet 100 on 2028-04-21, price 100.            VN 10,000 -> cost 10,000
//   B: 4, 4, 2 per 100 VN, amortizes 50 + 50, price 98. 2027-10-31 is a Sunday:   VN 10,000 -> cost  9,800
//      the payment is adjusted to Monday 2027-11-01, a different MONTH.
// The expected figures below come from an independent Python XIRR/duration script (ACT/365 from
// settlement), not from the code under test.
const TODAY = '2026-10-21'
const SETTLE = '2026-10-22'
const terms = (isin: string, over: Partial<TermsRow>): TermsRow => ({
  isin, tickerO: 'TSTO', tickerD: 'TSTD', tickerC: 'TSTC', issuer: 'Emisor de Prueba S.A.', description: 'ON de prueba',
  law: 'NY', currency: 'USD', paymentPlaza: 'CCL', est: 'Step Up', frequency: 'Semestral',
  issueDate: '2026-04-22', maturityDate: '2028-04-21', couponRate: 0.06, residualPct: 100, accrualStart: SETTLE,
  issuedAmountByma: null, adtvO: null, adtvD: null, adtvC: null, asOf: '2026-10-20', ...over,
})
const ov = (isin: string, field: string, value: unknown): OverrideRow => ({ isin, field, value, sourceUrl: 'https://example.org/p.pdf', verifiedAt: '2026-10-01' })
const make = (isin: string, t: Partial<TermsRow>, flows: OnInput['flows'], price: number | null, overrides: OverrideRow[] = []): OnAnalysis =>
  analyzeOn({ terms: terms(isin, t), flows, overrides, events: [], check: null, curve: [], price, settle: SETTLE })

const A = 'AR0000000001'
const B = 'AR0000000002'
const onA = make(A, { tickerO: 'AAAAO', tickerD: 'AAAAD', issuer: 'Emisor Uno S.A.', paymentPlaza: 'CCL' }, [
  { date: '2027-04-22', ren: 3, amo: 0 }, { date: '2027-10-22', ren: 3, amo: 0 }, { date: '2028-04-21', ren: 3, amo: 100 },
], 100)
const onB = make(B, { tickerO: 'BBBBO', tickerD: 'BBBBD', issuer: 'Emisor Dos S.A.', paymentPlaza: 'MEP', maturityDate: '2028-04-28' }, [
  { date: '2027-04-30', ren: 4, amo: 0 }, { date: '2027-10-31', ren: 4, amo: 50 }, { date: '2028-04-28', ren: 2, amo: 50 },
], 98)
const run = (items: PortfolioItem[], analyses: OnAnalysis[] = [onA, onB]) => analyzePortfolio({ items, analyses, today: TODAY })
const BOTH: PortfolioItem[] = [
  { isin: A, mode: 'usd', amount: 10_000 },
  { isin: B, mode: 'vn', amount: 10_000 },
]
const ok = (items = BOTH, analyses?: OnAnalysis[]) => {
  const r = run(items, analyses)
  if (r.empty) throw new Error('expected a non-empty portfolio')
  return r
}

describe('analyzePortfolio: totals and calendar', () => {
  it('sums the per-ON simulator results (cost, interest, principal, profit)', () => {
    const r = ok()
    expect(r.settle).toBe(SETTLE)
    expect(r.totals.cost).toBeCloseTo(19_800, 6)
    expect(r.totals.interest).toBeCloseTo(1_900, 6)
    expect(r.totals.principal).toBeCloseTo(20_000, 6)
    expect(r.totals.collected).toBeCloseTo(21_900, 6)
    expect(r.totals.profit).toBeCloseTo(2_100, 6)
    expect(r.positions.map((p) => p.cost)).toEqual([expect.closeTo(10_000, 6), expect.closeTo(9_800, 6)])
  })

  it('calendar: one row per month of the ADJUSTED pay date, interest apart from principal, with a running total', () => {
    const m = ok().monthly
    // 2027-10-31 is a Sunday: it is paid on 2027-11-01, so it lands in November, not October.
    const by = (month: string) => m.find((x) => x.month === month)!
    expect(by('2027-04')).toMatchObject({ interest: 700, principal: 0, total: 700 }) // 300 (A) + 400 (B)
    expect(by('2027-10')).toMatchObject({ interest: 300, principal: 0, total: 300 }) // only A
    expect(by('2027-11')).toMatchObject({ interest: 400, principal: 5_000, total: 5_400 }) // B, shifted
    expect(by('2028-04')).toMatchObject({ interest: 500, principal: 15_000, total: 15_500 })
    expect(by('2028-04').cumulative).toBeCloseTo(21_900, 6)
  })

  it('calendar is continuous: months without payments are listed with zeros', () => {
    const m = ok().monthly
    expect(m[0].month).toBe('2027-04')
    expect(m.at(-1)!.month).toBe('2028-04')
    expect(m).toHaveLength(13)
    expect(m.find((x) => x.month === '2027-05')).toMatchObject({ interest: 0, principal: 0, total: 0 })
  })

  it('lists every payment sorted by pay date with its ON', () => {
    const p = ok().payments
    expect(p.map((x) => [x.payDate, x.isin, x.total])).toEqual([
      ['2027-04-22', A, 300], ['2027-04-30', B, 400], ['2027-10-22', A, 300], ['2027-11-01', B, 5_400], ['2028-04-21', A, 10_300], ['2028-04-28', B, 5_200],
    ])
  })

  it('annual income per calendar year (interest + principal) and the next 12 months', () => {
    const r = ok()
    expect(r.annual).toEqual([
      { year: 2027, interest: 1_400, principal: 5_000, total: 6_400 },
      { year: 2028, interest: 500, principal: 15_000, total: 15_500 },
    ])
    // Next 12 months = payments up to 2027-10-22 inclusive: 300 + 400 + 300 (the 2027-11-01 flow falls outside).
    expect(r.next12m.interest).toBeCloseTo(1_000, 6)
  })

  it('maturity ladder: principal repaid per year, with its share', () => {
    const l = ok().ladder
    expect(l).toEqual([
      { year: 2027, principal: 5_000, pct: 25 },
      { year: 2028, principal: 15_000, pct: 75 },
    ])
  })
})

describe('analyzePortfolio: yield, duration, WAL', () => {
  it('portfolio YTM is the IRR of the POOLED flows vs the total dirty cost, not an average of ONs', () => {
    const r = ok()
    expect(r.ytmPct).toBeCloseTo(7.776377549, 4) // independent XIRR, ACT/365
    const avg = (r.positions[0].ytmPct! * 10_000 + r.positions[1].ytmPct! * 9_800) / 19_800
    expect(avg).toBeCloseTo(7.92255755, 4)
    expect(Math.abs(r.ytmPct! - avg)).toBeGreaterThan(0.1) // the shortcut is visibly different
    expect(r.positions[0].ytmPct).toBeCloseTo(6.095736397, 4)
    expect(r.positions[1].ytmPct).toBeCloseTo(9.786660768, 4)
  })

  it('modified duration is market-value weighted (weights = dirty cost)', () => {
    const r = ok()
    expect(r.positions[0].mdYears).toBeCloseTo(1.371782656, 4)
    expect(r.positions[1].mdYears).toBeCloseTo(1.123566208, 4)
    expect(r.mdYears).toBeCloseTo(1.24892805, 4)
  })

  it('WAL is the principal-weighted time to payment', () => {
    expect(ok().walYears).toBeCloseTo(1.385616438, 4)
  })

  it('a manual price changes that ON cost, yield and duration (and so the portfolio)', () => {
    const r = ok([{ isin: A, mode: 'vn', amount: 10_000, manualPrice: 90 }, BOTH[1]])
    expect(r.positions[0].cost).toBeCloseTo(9_000, 6)
    expect(r.positions[0].ytmPct!).toBeGreaterThan(6.2)
    expect(r.totals.cost).toBeCloseTo(18_800, 6)
  })

  it('a single ON is its own portfolio', () => {
    const r = ok([BOTH[0]])
    expect(r.ytmPct).toBeCloseTo(r.positions[0].ytmPct!, 6)
    expect(r.mdYears).toBeCloseTo(r.positions[0].mdYears!, 10)
  })
})

describe('analyzePortfolio: concentration and plaza', () => {
  it('weights by dirty cost, per issuer, largest first', () => {
    const c = ok().issuers
    expect(c.map((x) => x.name)).toEqual(['Emisor Uno S.A.', 'Emisor Dos S.A.'])
    expect(c[0].pct).toBeCloseTo((10_000 / 19_800) * 100, 6)
    expect(c[1].pct).toBeCloseTo((9_800 / 19_800) * 100, 6)
    expect(c.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 8)
  })

  it('two ONs of the same issuer are one slice', () => {
    const sameIssuer = make(B, { issuer: 'Emisor Uno S.A.', paymentPlaza: 'MEP', maturityDate: '2028-04-28' }, [
      { date: '2027-04-30', ren: 4, amo: 0 }, { date: '2027-10-31', ren: 4, amo: 50 }, { date: '2028-04-28', ren: 2, amo: 50 },
    ], 98)
    const c = ok(BOTH, [onA, sameIssuer]).issuers
    expect(c).toHaveLength(1)
    expect(c[0].pct).toBeCloseTo(100, 8)
  })

  it('an ON without issuer data is grouped as "Sin emisor"', () => {
    const none = make(B, { issuer: null, paymentPlaza: 'MEP', maturityDate: '2028-04-28' }, [{ date: '2028-04-28', ren: 2, amo: 100 }], 98)
    expect(ok(BOTH, [onA, none]).issuers.map((x) => x.name)).toContain('Sin emisor')
  })

  it('payment plaza split (MEP vs cable) by cost and by money collected', () => {
    const p = ok().plazas
    const cable = p.find((x) => x.plaza === 'CCL')!
    const mep = p.find((x) => x.plaza === 'MEP')!
    expect(cable.costPct).toBeCloseTo((10_000 / 19_800) * 100, 6)
    expect(mep.costPct).toBeCloseTo((9_800 / 19_800) * 100, 6)
    expect(cable.collected).toBeCloseTo(10_900, 6)
    expect(mep.collected).toBeCloseTo(11_000, 6)
  })
})

describe('analyzePortfolio: refusals and warnings', () => {
  const floating = make('AR0000000003', { est: 'Tasa Variable', tickerO: 'FLOAO' }, [{ date: '2028-04-21', ren: 1, amo: 100 }], 100)
  const ars = make('AR0000000004', { currency: 'ARS', tickerO: 'PESOO' }, [{ date: '2028-04-21', ren: 1, amo: 100 }], 100)
  const noPrice = make('AR0000000005', { tickerO: 'NOPXO' }, [{ date: '2028-04-21', ren: 3, amo: 100 }], null)

  it('floating, non-USD and unpriced ONs are left out of every figure, each with its own warning', () => {
    const r = ok(
      [...BOTH, { isin: 'AR0000000003', mode: 'usd', amount: 1_000 }, { isin: 'AR0000000004', mode: 'usd', amount: 1_000 }, { isin: 'AR0000000005', mode: 'usd', amount: 1_000 }],
      [onA, onB, floating, ars, noPrice],
    )
    expect(r.totals.cost).toBeCloseTo(19_800, 6) // identical to the two-ON portfolio
    expect(r.positions).toHaveLength(2)
    expect(r.skipped.map((s) => [s.isin, s.reason])).toEqual([
      ['AR0000000003', 'floating'], ['AR0000000004', 'not-usd'], ['AR0000000005', 'no-price'],
    ])
    const kinds = r.warnings.map((w) => w.kind)
    expect(kinds).toEqual(expect.arrayContaining(['floating', 'not-usd', 'no-price']))
    expect(r.warnings.find((w) => w.kind === 'no-price')!.message).toMatch(/precio manual/i)
  })

  it('a manual price rescues an ON without market price', () => {
    const r = ok([{ isin: 'AR0000000005', mode: 'usd', amount: 1_000, manualPrice: 100 }], [noPrice])
    expect(r.positions).toHaveLength(1)
    expect(r.skipped).toHaveLength(0)
  })

  it('an ISIN that is not in the catalog is skipped with a warning', () => {
    const r = ok([...BOTH, { isin: 'AR0000000099', mode: 'usd', amount: 1_000 }])
    expect(r.skipped.at(-1)).toMatchObject({ isin: 'AR0000000099', reason: 'unknown-isin' })
    expect(r.warnings.some((w) => w.kind === 'unknown-isin')).toBe(true)
  })

  it('lot adjustments are reported (VN rounded down to the minimum lot / multiple)', () => {
    const lot = make(A, { tickerO: 'AAAAO', issuer: 'Emisor Uno S.A.' }, [{ date: '2028-04-21', ren: 3, amo: 100 }], 100, [ov(A, 'min_denomination', 10_000), ov(A, 'increment', 1_000)])
    const r = ok([{ isin: A, mode: 'vn', amount: 10_500 }], [lot])
    expect(r.positions[0].vn).toBe(10_000)
    expect(r.warnings.find((w) => w.kind === 'lot-adjusted')).toBeTruthy()
  })

  it('USD mode: whole-VN rounding alone is not a warning; losing more than one VN to the lot rules is', () => {
    const unknownLot = ok([{ isin: A, mode: 'usd', amount: 10_001 }]) // leftover < 1 VN
    expect(unknownLot.warnings.some((w) => w.kind === 'lot-adjusted')).toBe(false)
    const small = make(A, { tickerO: 'AAAAO', issuer: 'Emisor Uno S.A.' }, [{ date: '2028-04-21', ren: 3, amo: 100 }], 98, [ov(A, 'min_denomination', 1), ov(A, 'increment', 1)])
    expect(ok([{ isin: A, mode: 'usd', amount: 10_001 }], [small]).warnings.some((w) => w.kind === 'lot-adjusted')).toBe(false) // known 1-VN lot, USD 0.08 left over
    const lot = make(A, { tickerO: 'AAAAO', issuer: 'Emisor Uno S.A.' }, [{ date: '2028-04-21', ren: 3, amo: 100 }], 100, [ov(A, 'min_denomination', 10_000), ov(A, 'increment', 1_000)])
    const r = ok([{ isin: A, mode: 'usd', amount: 10_900 }], [lot]) // 10,900 VN -> 10,000 VN: USD 900 stay out
    expect(r.positions[0].vn).toBe(10_000)
    expect(r.warnings.find((w) => w.kind === 'lot-adjusted')!.message).toContain('900')
  })

  it('buying inside the record window loses that coupon: warned with the amount, and the totals exclude it', () => {
    // Coupon on Monday 2026-10-26 with a 5 day record offset: the record date (10-21) is before settlement (10-22).
    const ex = make(A, { tickerO: 'AAAAO', issuer: 'Emisor Uno S.A.' }, [
      { date: '2026-10-26', ren: 3, amo: 0 }, { date: '2027-04-22', ren: 3, amo: 100 },
    ], 100, [ov(A, 'record_offset_days', 5)])
    const r = ok([{ isin: A, mode: 'vn', amount: 10_000 }], [ex])
    expect(r.totals.interest).toBeCloseTo(300, 6) // only the second coupon
    const w = r.warnings.find((x) => x.kind === 'record-window')!
    expect(w.message).toContain('300')
  })

  it('an ON that is worse to the call warns that the portfolio YTM assumes maturity', () => {
    const callable = make(A, { tickerO: 'AAAAO', issuer: 'Emisor Uno S.A.' }, [
      { date: '2027-04-22', ren: 3, amo: 0 }, { date: '2027-10-22', ren: 3, amo: 0 }, { date: '2028-04-21', ren: 3, amo: 100 },
    ], 104, [ov(A, 'calls', [{ from: '2027-04-22', to: null, pricePct: 100 }])])
    const r = ok([{ isin: A, mode: 'vn', amount: 10_000 }], [callable])
    expect(r.positions[0].ytwKind).toBe('call')
    expect(r.warnings.some((w) => w.kind === 'call')).toBe(true)
  })

  it('no sector breakdown is produced (the catalog has no sector data)', () => {
    expect(ok()).not.toHaveProperty('sectors')
  })
})

describe('display tickers and horizon', () => {
  it('positions and warnings lead with the D (dollar) ticker; the O ticker is secondary', () => {
    const r = ok([{ isin: A, mode: 'vn', amount: 10_000 }, { isin: 'AR0000000003', mode: 'usd', amount: 1 }], [onA, make('AR0000000003', { est: 'Tasa Variable', tickerO: 'FLOAO', tickerD: 'FLOAD' }, [{ date: '2028-04-21', ren: 1, amo: 100 }], 100)])
    expect(r.positions[0]).toMatchObject({ ticker: 'AAAAD', tickerO: 'AAAAO' })
    expect(r.skipped[0].message).toContain('FLOAD')
    expect(r.skipped[0].message).not.toContain('FLOAO')
  })

  it('falls back to the O ticker when the ON has no D line', () => {
    const noD = make(A, { tickerO: 'NODLO', tickerD: null }, [{ date: '2028-04-21', ren: 3, amo: 100 }], 100)
    expect(ok([{ isin: A, mode: 'vn', amount: 10_000 }], [noD]).positions[0].ticker).toBe('NODLO')
  })

  it('a matured ON is reported as vencida', () => {
    const old = make(A, { maturityDate: '2026-04-21' }, [{ date: '2026-04-21', ren: 3, amo: 100 }], 100)
    const r = run([{ isin: A, mode: 'vn', amount: 10_000 }], [old])
    expect(r.skipped[0].reason).toBe('no-payments')
    expect(r.skipped[0].message).toMatch(/vencida/i)
  })

  it('plusOneYear is calendar math: Feb 29 maps to Feb 28 and ordinary dates keep their day', () => {
    expect(plusOneYear('2027-10-22')).toBe('2028-10-22')
    expect(plusOneYear('2028-02-29')).toBe('2029-02-28')
    expect(plusOneYear('2027-12-31')).toBe('2028-12-31')
  })
})

describe('analyzePortfolio: empty and degenerate', () => {
  it('no items: empty state, no figures', () => {
    const r = run([])
    expect(r.empty).toBe(true)
    expect(r.ytmPct).toBeNull()
    expect(r.monthly).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('every item refused: empty, but the reasons are kept', () => {
    const floating = make('AR0000000003', { est: 'Tasa Variable' }, [{ date: '2028-04-21', ren: 1, amo: 100 }], 100)
    const r = run([{ isin: 'AR0000000003', mode: 'usd', amount: 1_000 }], [floating])
    expect(r.empty).toBe(true)
    expect(r.skipped).toHaveLength(1)
    expect(r.warnings).toHaveLength(1)
  })

  it('is pure: the inputs are not mutated and two runs agree', () => {
    const items = JSON.parse(JSON.stringify(BOTH))
    const before = JSON.stringify([onA, onB, items])
    const a = run(items)
    expect(JSON.stringify([onA, onB, items])).toBe(before)
    expect(run(items)).toEqual(a)
  })
})

describe('fixtures carry no account data', () => {
  it('uses synthetic ISINs and issuers only', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(__filename, 'utf8')
    expect(src).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(src).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i)
  })
})
