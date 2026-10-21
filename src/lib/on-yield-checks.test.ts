import { describe, it, expect } from 'vitest'
import { computeYieldChecks, FLAG_BP, MIN_DAYS_TO_MATURITY } from './on-yield-checks'
import type { OnRow } from './byma-educa'

const SETTLE = '2026-10-21'
const AS_OF = '2026-10-20'

// Public BYMA row CS50O of 2026-10-20 (regular fixed-rate bullet, ARG law).
const cs50 = (over: Partial<OnRow> = {}): OnRow => ({
  isin: 'AR0394353335',
  tickerO: 'CS50O',
  tickerD: 'CS50D',
  tickerC: 'CS50C',
  issuer: null,
  description: null,
  law: 'ARG',
  currency: 'USD',
  paymentPlaza: 'MEP',
  est: 'Tasa Fija',
  frequency: 'Semestral',
  issueDate: '2025-12-10',
  maturityDate: '2029-03-10',
  couponRate: 0.0725,
  residualPct: 100,
  accrualStart: '2026-09-10',
  issuedAmountByma: null,
  adtvO: null,
  adtvD: null,
  adtvC: null,
  bymaPx: 103.2278,
  bymaYtm: 6.2416,
  bymaAi: 0.8257,
  bymaDm: 2.0895,
  flows: [
    { date: '2027-03-10', ren: 3.625, amo: 0 },
    { date: '2027-09-10', ren: 3.625, amo: 0 },
    { date: '2028-03-10', ren: 3.625, amo: 0 },
    { date: '2028-09-10', ren: 3.625, amo: 0 },
    { date: '2029-03-10', ren: 3.625, amo: 100 },
  ],
  ...over,
})

describe('computeYieldChecks', () => {
  it('constants: 5bp flag, 90 days floor', () => {
    expect(FLAG_BP).toBe(5)
    expect(MIN_DAYS_TO_MATURITY).toBe(90)
  })

  it('method check reproduces BYMA ytm on BYMA flows with unadjusted dates: not flagged', () => {
    const [c] = computeYieldChecks([cs50()], [], SETTLE, AS_OF)
    expect(c).toMatchObject({ isin: 'AR0394353335', as_of: AS_OF, byma_px: 103.2278, byma_ytm: 6.2416, flagged: false, skip_reason: null })
    expect(Math.abs(c.method_diff_bp!)).toBeLessThan(FLAG_BP)
    expect(c.method_ytm).toBeCloseTo(6.2416, 1)
  })

  it('flags when the method differs from BYMA by more than 5bp', () => {
    const [c] = computeYieldChecks([cs50({ bymaYtm: 6.2416 + 0.1 })], [], SETTLE, AS_OF)
    expect(c.flagged).toBe(true)
    expect(c.method_diff_bp!).toBeLessThan(-FLAG_BP) // ours minus BYMA, signed
  })

  it('terms check is informational: filled, never flags, depends on the resolved day count', () => {
    const [arg] = computeYieldChecks([cs50()], [], SETTLE, AS_OF)
    expect(arg.terms_ytm).not.toBeNull()
    expect(arg.terms_diff_bp).not.toBeNull()
    // Force a large terms difference with a wrong secondary override: still not flagged.
    const ov = [{ isin: 'AR0394353335', field: 'day_count', value: 'ACT/360', sourceUrl: 'https://x', verifiedAt: null }]
    const [wild] = computeYieldChecks([cs50()], ov, SETTLE, AS_OF)
    expect(wild.terms_ytm).not.toBe(arg.terms_ytm)
    expect(wild.flagged).toBe(false)
  })

  it('terms check uses ACT/365 for ARG law: CS50 differs from BYMA cup/2', () => {
    const [c] = computeYieldChecks([cs50()], [], SETTLE, AS_OF)
    expect(c.terms_ytm).not.toBeCloseTo(c.method_ytm!, 4)
  })

  it('skips ONs under 90 days to maturity and records the reason', () => {
    const near = cs50({ maturityDate: '2026-12-15', flows: [{ date: '2026-12-15', ren: 1.8, amo: 100 }] })
    const [c] = computeYieldChecks([near], [], SETTLE, AS_OF)
    expect(c.skip_reason).toMatch(/90 days/)
    expect(c).toMatchObject({ method_ytm: null, method_diff_bp: null, terms_ytm: null, terms_diff_bp: null, flagged: false })
  })

  it('floating rate gets no row at all', () => {
    expect(computeYieldChecks([cs50({ est: 'Tasa Variable' })], [], SETTLE, AS_OF)).toEqual([])
  })

  it('no price or no BYMA ytm is recorded as skipped, not flagged', () => {
    const [a] = computeYieldChecks([cs50({ bymaPx: null })], [], SETTLE, AS_OF)
    expect(a.skip_reason).toMatch(/price/)
    const [b] = computeYieldChecks([cs50({ bymaYtm: null })], [], SETTLE, AS_OF)
    expect(b.skip_reason).toMatch(/ytm/)
    expect([a.flagged, b.flagged]).toEqual([false, false])
  })

  it('a bad row is skipped with a reason instead of throwing', () => {
    const bad = cs50({ flows: [{ date: 'garbage', ren: 1, amo: 100 }] })
    const [c] = computeYieldChecks([bad], [], SETTLE, AS_OF)
    expect(c.skip_reason).toBeTruthy()
    expect(c.flagged).toBe(false)
  })

  it('non-fixed structures (step-up) get the method check but no terms check', () => {
    const [c] = computeYieldChecks([cs50({ est: 'Step Up' })], [], SETTLE, AS_OF)
    expect(c.method_ytm).not.toBeNull()
    expect(c.terms_ytm).toBeNull()
  })
})
