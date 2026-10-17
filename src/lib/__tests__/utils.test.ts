import { describe, it, expect } from 'vitest'
import { formatPct, isMarketOpen, isPriceStale, priceHealthSummary, PRICE_STALE_OPEN_MS, PRICE_STALE_CLOSED_MS } from '../utils'

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

describe('isMarketOpen(now)', () => {
  it('uses the injected instant (Argentina time), not the wall clock', () => {
    expect(isMarketOpen(new Date('2026-10-14T15:00:00Z'))).toBe(true) // Wed 12:00 AR
    expect(isMarketOpen(new Date('2026-10-14T22:00:00Z'))).toBe(false) // Wed 19:00 AR
    expect(isMarketOpen(new Date('2026-10-17T15:00:00Z'))).toBe(false) // Sat
  })
})

describe('isPriceStale', () => {
  const open = new Date('2026-10-14T15:00:00Z') // Wed 12:00 AR, market open
  const closed = new Date('2026-10-17T15:00:00Z') // Sat

  it('treats a missing or unparseable as-of as stale', () => {
    expect(isPriceStale(undefined, open)).toBe(true)
    expect(isPriceStale('garbage', open)).toBe(true)
  })

  it('open market: exactly 30 min is fresh, +1 ms is stale', () => {
    const edge = new Date(open.getTime() - PRICE_STALE_OPEN_MS).toISOString()
    const over = new Date(open.getTime() - PRICE_STALE_OPEN_MS - 1).toISOString()
    expect(isPriceStale(edge, open)).toBe(false)
    expect(isPriceStale(over, open)).toBe(true)
  })

  it('closed market: tolerates a weekend, flags past 96 h', () => {
    const fri = new Date(closed.getTime() - 20 * 3600_000).toISOString()
    const edge = new Date(closed.getTime() - PRICE_STALE_CLOSED_MS).toISOString()
    const over = new Date(closed.getTime() - PRICE_STALE_CLOSED_MS - 1).toISOString()
    expect(isPriceStale(fri, closed)).toBe(false)
    expect(isPriceStale(edge, closed)).toBe(false)
    expect(isPriceStale(over, closed)).toBe(true)
  })

  it('clamps a future as-of (clock skew) to fresh', () => {
    expect(isPriceStale(new Date(open.getTime() + 60_000).toISOString(), open)).toBe(false)
  })
})

describe('priceHealthSummary', () => {
  const now = new Date('2026-10-14T15:00:00Z') // open market
  const fresh = { current_price: 10, price_as_of: '2026-10-14T14:55:00Z' }
  const stale = { current_price: 10, price_as_of: '2026-10-14T10:00:00Z' }
  const unpriced = { current_price: 0 }

  it('is empty when everything is fresh and priced', () => {
    expect(priceHealthSummary([fresh], now)).toBe('')
  })

  it('uses the singular for exactly one', () => {
    expect(priceHealthSummary([fresh, stale], now)).toBe('1 desactualizado')
  })

  it('uses the plural for several', () => {
    expect(priceHealthSummary([stale, stale, fresh], now)).toBe('2 desactualizados')
  })

  it('appends the unpriced count and does not count unpriced as stale', () => {
    expect(priceHealthSummary([stale, unpriced, unpriced], now)).toBe('1 desactualizado · 2 sin precio')
    expect(priceHealthSummary([unpriced], now)).toBe('1 sin precio')
  })
})
