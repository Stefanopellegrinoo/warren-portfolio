import { describe, it, expect } from 'vitest'
import { formatAge, formatNumber, formatUSD, PRICE_STALE_OPEN_GRACE_MS, formatPct, isMarketOpen, isPriceStale, priceHealthSummary, PRICE_STALE_OPEN_MS, PRICE_STALE_CLOSED_MS } from '../utils'

describe('formatNumber (es-AR)', () => {
  it('uses dot thousands and comma decimals', () => {
    expect(formatNumber(39951.8)).toBe('39.951,80')
    expect(formatNumber(4827, { decimals: 0 })).toBe('4.827')
  })

  it('always marks negatives with the minus sign U+2212', () => {
    expect(formatNumber(-310.45)).toBe('−310,45')
    expect(formatNumber(-310.45, { sign: true })).toBe('−310,45')
  })

  it('adds a plus only when asked and only for positives', () => {
    expect(formatNumber(2529.02, { sign: true })).toBe('+2.529,02')
    expect(formatNumber(2529.02)).toBe('2.529,02')
    expect(formatNumber(0, { sign: true })).toBe('0,00')
    expect(formatNumber(-0, { sign: true })).toBe('0,00')
  })
})

describe('formatUSD (es-AR)', () => {
  it('keeps US$ glued to the amount with a non-breaking space', () => {
    expect(formatUSD(39951.8)).toBe('US$\u00a039.951,80')
  })

  it('prefixes US$ and puts the minus before it', () => {
    expect(formatUSD(-310.45).replace('\u00a0', ' ')).toBe('−US$ 310,45')
    expect(formatUSD(0).replace('\u00a0', ' ')).toBe('US$ 0,00')
  })

  it('keeps small values exact in compact mode', () => {
    expect(formatUSD(512.3, true).replace('\u00a0', ' ')).toBe('US$ 512,30')
  })

  it('shortens large values in compact mode', () => {
    expect(formatUSD(39951.8, true)).toMatch(/^US\$\u00a040/)
  })
})

describe('formatPct (fraction in, es-AR)', () => {
  it('formats a fraction as a signed percent by default', () => {
    expect(formatPct(0.1234)).toBe('+12,34 %')
    expect(formatPct(-0.05)).toBe('−5,00 %')
  })

  it('treats the input as a fraction, not a percent', () => {
    expect(formatPct(12.34)).toBe('+1.234,00 %')
  })

  it('omits the plus sign with sign:false but keeps the minus', () => {
    expect(formatPct(0.1234, { sign: false })).toBe('12,34 %')
    expect(formatPct(-0.05, { sign: false })).toBe('−5,00 %')
  })

  it('honours digits', () => {
    expect(formatPct(0.1234, { digits: 1, sign: false })).toBe('12,3 %')
    expect(formatPct(0.55, { digits: 0, sign: false })).toBe('55 %')
  })

  it('renders an em dash for non-finite or missing values', () => {
    for (const v of [NaN, Infinity, -Infinity, null, undefined]) {
      expect(formatPct(v as number)).toBe('—')
    }
  })

  it('renders zero without any sign', () => {
    expect(formatPct(-0, { sign: false })).toBe('0,00 %')
    expect(formatPct(0, { sign: false })).toBe('0,00 %')
    expect(formatPct(0)).toBe('0,00 %')
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

  it('open grace: a previous-session price is not stale until open + grace, then it is', () => {
    const prev = '2026-10-13T20:55:00Z' // Tue 17:55 AR, last fetch before close
    const open1030 = new Date('2026-10-14T13:30:00Z').getTime() // Wed 10:30 AR
    expect(isPriceStale(prev, new Date(open1030 + 60_000))).toBe(false)
    expect(isPriceStale(prev, new Date(open1030 + PRICE_STALE_OPEN_GRACE_MS))).toBe(false)
    expect(isPriceStale(prev, new Date(open1030 + PRICE_STALE_OPEN_GRACE_MS + 1))).toBe(true)
  })

  it('open grace never rescues a price older than the closed-market limit or a current-session price', () => {
    const open1030 = new Date('2026-10-14T13:30:00Z').getTime()
    const inGrace = new Date(open1030 + 60_000)
    expect(isPriceStale(new Date(inGrace.getTime() - PRICE_STALE_CLOSED_MS - 1).toISOString(), inGrace)).toBe(true)
    // fetched at 10:31 this session, checked at 11:05: 34 min old, past the 30 min open limit, grace over
    expect(isPriceStale('2026-10-14T13:31:00Z', new Date('2026-10-14T14:05:00Z'))).toBe(true)
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

describe('formatAge', () => {
  const now = new Date('2026-10-14T15:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
  it('formats minutes, hours and days in Spanish', () => {
    expect(formatAge(ago(5 * 60_000), now)).toBe('hace 5 min')
    expect(formatAge(ago(2 * 3_600_000 + 1000), now)).toBe('hace 2 h')
    expect(formatAge(ago(3 * 86_400_000), now)).toBe('hace 3 d')
  })
  it('says "sin dato" for missing/unparseable and clamps the future', () => {
    expect(formatAge(undefined, now)).toBe('sin dato')
    expect(formatAge('nope', now)).toBe('sin dato')
    expect(formatAge(ago(-60_000), now)).toBe('hace 0 min')
  })
})
