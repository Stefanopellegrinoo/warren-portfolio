import { describe, it, expect } from 'vitest'
import { fmtPct, fmtNum, fmtBp, fmtUsdCompact, fmtDate, plazaCopy, rateTypeLabel, eventLabel, safeHref, parseEsArNumber, fmtMonth } from './on-format'

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

describe('parseEsArNumber', () => {
  it.each([
    ['10000', 10000], ['10.000', 10000], ['10.000,50', 10000.5], ['10000,50', 10000.5], ['10000.50', 10000.5],
    ['1.000', 1000], ['1000', 1000], ['1,5', 1.5], ['1.5', 1.5], ['0,5', 0.5], ['1.000.000', 1000000], ['1.000.000,25', 1000000.25],
    ['  42  ', 42], ['0.500', 0.5], ['00.500', 0.5], ['0001.000', 1], ['0,500', 0.5], ['1.234', 1234], ['1,000', 1], ['007', 7], ['0', 0], ['1.5000', 1.5],
  ])('accepts %s', (text, value) => {
    expect(parseEsArNumber(text)).toBe(value)
  })

  it.each(['abc', '', '   ', '1,2,3', '1..000', '1.00.0', '10.00,5', '-5', '+5', '1e5', '1 000', '$100', '.5', ',5', '5.', '5,', '1.000,5,5', '10,000.50', 'NaN', 'Infinity', '0.500.000', '0.500,5', '01.000.000'])('rejects %j', (text) => {
    expect(parseEsArNumber(text)).toBeNull()
  })

  it('formats a yyyy-mm month by slicing, so no timezone can shift it', () => {
    expect(fmtMonth('2027-04')).toBe('abr 2027')
    expect(fmtMonth('2027-12')).toBe('dic 2027')
    expect(fmtMonth('2027-13')).toBe('—')
    expect(fmtMonth(null)).toBe('—')
  })
})
