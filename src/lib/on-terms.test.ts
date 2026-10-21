import { describe, it, expect } from 'vitest'
import { resolveTerms, type OverrideRow, type TermsBase } from './on-terms'

const base = (over: Partial<TermsBase> = {}): TermsBase => ({
  isin: 'AR0394353335',
  law: 'ARG',
  paymentPlaza: 'MEP',
  issuedAmountByma: 70_381_079,
  ...over,
})
const ov = (field: string, value: unknown, verifiedAt: string | null = '2026-10-21'): OverrideRow => ({
  isin: 'AR0394353335',
  field,
  value,
  sourceUrl: 'https://example.org/prospectus.pdf',
  verifiedAt,
})

describe('resolveTerms: precedence override > BYMA > default', () => {
  it('uses the per-law default day count with provenance default', () => {
    expect(resolveTerms(base({ law: 'ARG' }), []).dayCount).toEqual({ value: 'ACT/365', prov: 'default' })
    expect(resolveTerms(base({ law: 'NY' }), []).dayCount).toEqual({ value: '30/360', prov: 'default' })
  })

  it('an override wins and is verified when verified_at is set', () => {
    const r = resolveTerms(base({ law: 'NY' }), [ov('day_count', 'ACT/365')])
    expect(r.dayCount).toEqual({ value: 'ACT/365', prov: 'verified', sourceUrl: 'https://example.org/prospectus.pdf', verifiedAt: '2026-10-21' })
  })

  it('an override without verified_at is secondary ("sin verificar")', () => {
    const r = resolveTerms(base(), [ov('day_count', 'ACT/360', null)])
    expect(r.dayCount.prov).toBe('secondary')
    expect(r.dayCount.value).toBe('ACT/360')
  })

  it('payment plaza: override > BYMA mp > unknown', () => {
    expect(resolveTerms(base({ paymentPlaza: 'MEP' }), []).paymentPlaza).toEqual({ value: 'MEP', prov: 'byma' })
    expect(resolveTerms(base({ paymentPlaza: 'MEP' }), [ov('payment_plaza', 'CCL')]).paymentPlaza.value).toBe('CCL')
    expect(resolveTerms(base({ paymentPlaza: null }), []).paymentPlaza).toEqual({ value: null, prov: 'default' })
  })

  it('issued amount: override beats BYMA mto, BYMA kept as secondary text', () => {
    const r = resolveTerms(base({ issuedAmountByma: 313_462_519 }), [ov('issued_amount', 213_462_519)])
    expect(r.issuedAmount.value).toBe(213_462_519)
    expect(r.issuedAmountByma).toBe(313_462_519)
    expect(resolveTerms(base(), []).issuedAmount).toEqual({ value: 70_381_079, prov: 'byma' })
  })

  it('partial verification: each field carries its own provenance', () => {
    const r = resolveTerms(base(), [ov('min_denomination', 10_000), ov('increment', 1_000, null)])
    expect(r.minDenomination.prov).toBe('verified')
    expect(r.increment.prov).toBe('secondary')
    expect(r.minTradeUnit).toEqual({ value: null, prov: 'default' })
    expect(r.dayCount.prov).toBe('default')
  })

  it('defaults for bdc, record offset and options', () => {
    const r = resolveTerms(base(), [])
    expect(r.bdc).toEqual({ value: 'following', prov: 'default' })
    expect(r.maturityBdc.value).toBe('following')
    expect(r.recordOffsetDays).toEqual({ value: null, prov: 'default' })
    expect(r.calls).toEqual({ value: [], prov: 'default' })
    expect(r.puts).toEqual({ value: [], prov: 'default' })
  })

  it('parses calls and record offset overrides', () => {
    const calls = [{ from: '2026-07-03', to: '2027-07-03', pricePct: 103.75 }, { from: '2028-07-03', to: null, pricePct: 100 }]
    const r = resolveTerms(base(), [ov('calls', calls), ov('record_offset_days', 15)])
    expect(r.calls.value).toEqual(calls)
    expect(r.recordOffsetDays.value).toBe(15)
  })

  it('ignores overrides that fail validation (lot parsing) and keeps the lower layer', () => {
    const r = resolveTerms(base(), [
      ov('min_denomination', -5),
      ov('increment', 'mil'),
      ov('day_count', '30/365'),
      ov('calls', [{ from: 'x', to: null, pricePct: 100 }]),
      ov('payment_plaza', 'EUR'),
    ])
    expect(r.minDenomination.prov).toBe('default')
    expect(r.increment.prov).toBe('default')
    expect(r.dayCount.prov).toBe('default')
    expect(r.calls.prov).toBe('default')
    expect(r.paymentPlaza.prov).toBe('byma')
  })

  it('ignores overrides of another ISIN and unknown fields', () => {
    const r = resolveTerms(base(), [{ ...ov('day_count', 'ACT/360'), isin: 'AR0000000000' }, ov('whatever', 1)])
    expect(r.dayCount.prov).toBe('default')
  })
})
