import { describe, it, expect } from 'vitest'
import {
  formatWatchlistPrice,
  formatWatchlistChange,
  getChangeColorClass,
  buildDeleteUrl,
} from './WatchlistPanel'

describe('formatWatchlistPrice', () => {
  it('formats a positive price with 2 decimal places', () => {
    expect(formatWatchlistPrice(150)).toBe('$150.00')
  })

  it('formats a price with cents', () => {
    expect(formatWatchlistPrice(12.5)).toBe('$12.50')
  })

  it('returns "—" for null price', () => {
    expect(formatWatchlistPrice(null)).toBe('—')
  })

  it('returns "—" for zero price', () => {
    expect(formatWatchlistPrice(0)).toBe('—')
  })
})

describe('formatWatchlistChange', () => {
  it('formats a positive change with + sign', () => {
    expect(formatWatchlistChange(1.5)).toBe('+1.50%')
  })

  it('formats a negative change with − sign', () => {
    expect(formatWatchlistChange(-0.75)).toBe('-0.75%')
  })

  it('returns "—" for null change', () => {
    expect(formatWatchlistChange(null)).toBe('—')
  })

  it('formats zero change as +0.00%', () => {
    expect(formatWatchlistChange(0)).toBe('+0.00%')
  })
})

describe('getChangeColorClass', () => {
  it('returns green class for positive change', () => {
    const cls = getChangeColorClass(1.5)
    expect(cls).toContain('green')
  })

  it('returns red class for negative change', () => {
    const cls = getChangeColorClass(-0.5)
    expect(cls).toContain('red')
  })

  it('returns muted class for null change', () => {
    const cls = getChangeColorClass(null)
    expect(cls).toContain('muted')
  })

  it('positive and negative have distinct classes', () => {
    const positive = getChangeColorClass(1)
    const negative = getChangeColorClass(-1)
    expect(positive).not.toBe(negative)
  })
})

describe('buildDeleteUrl', () => {
  it('builds DELETE url with encoded symbol', () => {
    expect(buildDeleteUrl('AAPL')).toBe('/api/watchlist?symbol=AAPL')
  })

  it('encodes special characters in symbol', () => {
    expect(buildDeleteUrl('GGAL.BA')).toBe('/api/watchlist?symbol=GGAL.BA')
  })
})
