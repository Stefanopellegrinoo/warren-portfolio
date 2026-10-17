import { describe, it, expect } from 'vitest'
import { formatPct } from '../utils'

describe('formatPct (fraction in)', () => {
  it('formats a fraction as a signed percent by default', () => {
    expect(formatPct(0.1234)).toBe('+12.34%')
    expect(formatPct(-0.05)).toBe('-5.00%')
  })

  it('treats the input as a fraction, not a percent', () => {
    expect(formatPct(12.34)).toBe('+1234.00%')
  })

  it('omits the plus sign with sign:false but keeps the minus', () => {
    expect(formatPct(0.1234, { sign: false })).toBe('12.34%')
    expect(formatPct(-0.05, { sign: false })).toBe('-5.00%')
  })

  it('honours digits', () => {
    expect(formatPct(0.1234, { digits: 1, sign: false })).toBe('12.3%')
    expect(formatPct(0.55, { digits: 0, sign: false })).toBe('55%')
  })

  it('renders an em dash for non-finite or missing values', () => {
    for (const v of [NaN, Infinity, -Infinity, null, undefined]) {
      expect(formatPct(v as number)).toBe('—')
    }
  })

  it('renders zero and negative zero without a minus', () => {
    expect(formatPct(-0, { sign: false })).toBe('0.00%')
    expect(formatPct(0, { sign: false })).toBe('0.00%')
    expect(formatPct(0)).toBe('+0.00%')
  })
})
