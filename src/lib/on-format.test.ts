import { describe, it, expect } from 'vitest'
import { fmtPct, fmtNum, fmtBp, fmtUsdCompact, fmtDate, plazaCopy, rateTypeLabel, eventLabel, safeHref } from './on-format'

describe('on-format', () => {
  it('formats numbers in es-AR and shows a dash for missing values', () => {
    expect(fmtNum(1234.5, 2)).toBe('1.234,50')
    expect(fmtNum(null)).toBe('—')
    expect(fmtNum(NaN)).toBe('—')
    expect(fmtPct(6.0912)).toBe('6,09%')
    expect(fmtPct(null)).toBe('—')
    expect(fmtBp(-12.4)).toBe('-12 pb')
    expect(fmtBp(120.6)).toBe('+121 pb')
    expect(fmtBp(null)).toBe('—')
    expect(fmtBp(undefined)).toBe('—')
    expect(fmtBp(0.3)).toBe('0 pb')
    expect(fmtBp(-0.3)).toBe('0 pb') // never "-0 pb"
  })

  it('compacts USD volumes', () => {
    expect(fmtUsdCompact(1_500_000)).toBe('USD 1,5 M')
    expect(fmtUsdCompact(850)).toBe('USD 850')
    expect(fmtUsdCompact(null)).toBe('—')
  })

  it('formats ISO dates without timezone drift', () => {
    expect(fmtDate('2027-04-22')).toBe('22/04/2027')
    expect(fmtDate(null)).toBe('—')
  })

  it('names the payment plaza independent of the line bought', () => {
    expect(plazaCopy('MEP')).toBe('Paga en dólar MEP (cuenta local)')
    expect(plazaCopy('CCL')).toBe('Paga en dólar cable (exterior)')
    expect(plazaCopy('ARS')).toBe('Paga en pesos')
    expect(plazaCopy(null)).toBe('Plaza de pago: sin dato')
  })

  it('labels rate types and corporate events in Spanish', () => {
    expect(rateTypeLabel('fixed')).toBe('Tasa fija')
    expect(rateTypeLabel('zero')).toBe('Cupón cero')
    expect(rateTypeLabel('floating')).toBe('Tasa variable')
    expect(eventLabel('canje')).toBe('Canje')
    expect(eventLabel('weird')).toBe('weird')
  })

  it('only lets http(s) links through', () => {
    expect(safeHref('https://example.org/p.pdf')).toBe('https://example.org/p.pdf')
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
    expect(safeHref('not a url')).toBeUndefined()
  })
})
