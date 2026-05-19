import { describe, it, expect } from 'vitest'
import { getWatchlistComponent } from './RightSidebar'

describe('getWatchlistComponent', () => {
  it('returns "binance" when dataSource is "binance"', () => {
    expect(getWatchlistComponent('binance')).toBe('binance')
  })

  it('returns "yahoo" when dataSource is "yahoo"', () => {
    expect(getWatchlistComponent('yahoo')).toBe('yahoo')
  })

  it('returns "yahoo" as fallback for unknown dataSource values', () => {
    expect(getWatchlistComponent('unknown')).toBe('yahoo')
  })

  it('returns "binance" only for exact "binance" string', () => {
    expect(getWatchlistComponent('Binance')).toBe('yahoo')
    expect(getWatchlistComponent('BINANCE')).toBe('yahoo')
  })
})
