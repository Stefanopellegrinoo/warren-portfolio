import { describe, it, expect } from 'vitest'
import {
  buildAddToWatchlistPayload,
  getAddButtonLabel,
  getAddButtonDisabled,
} from './AddToWatchlistButton'

describe('buildAddToWatchlistPayload', () => {
  it('returns correct JSON payload for a symbol', () => {
    const payload = buildAddToWatchlistPayload('AAPL')
    expect(payload).toEqual({ symbol: 'AAPL' })
  })

  it('preserves the symbol as-is (no transformation)', () => {
    const payload = buildAddToWatchlistPayload('GGAL.BA')
    expect(payload).toEqual({ symbol: 'GGAL.BA' })
  })

  it('handles uppercase symbols', () => {
    const payload = buildAddToWatchlistPayload('TSLA')
    expect(payload.symbol).toBe('TSLA')
  })
})

describe('getAddButtonLabel', () => {
  it('returns "Add to watchlist" when symbol is not in watchlist', () => {
    expect(getAddButtonLabel(false)).toBe('Add to watchlist')
  })

  it('returns "★ In watchlist" when symbol is already in watchlist', () => {
    expect(getAddButtonLabel(true)).toBe('★ In watchlist')
  })
})

describe('getAddButtonDisabled', () => {
  it('returns false when symbol is not in watchlist', () => {
    expect(getAddButtonDisabled(false, false)).toBe(false)
  })

  it('returns true when symbol is already in watchlist', () => {
    expect(getAddButtonDisabled(true, false)).toBe(true)
  })

  it('returns true when loading is in progress', () => {
    expect(getAddButtonDisabled(false, true)).toBe(true)
  })

  it('returns true when both in watchlist and loading', () => {
    expect(getAddButtonDisabled(true, true)).toBe(true)
  })
})
