import { describe, it, expect } from 'vitest'
import {
  // Existing exports (now refactored)
  getAddButtonLabel,
  getAddButtonDisabled,
  // New multi-watchlist exports
  buildAddPayload,
  isSymbolInList,
  getListsUrl,
} from './AddToWatchlistButton'
import type { WatchlistItem } from '@/app/api/watchlist/route'

// ── New utility exports ────────────────────────────────────────────────────

describe('buildAddPayload', () => {
  it('returns symbol and watchlistId in the payload', () => {
    const payload = buildAddPayload('AAPL', 'list-1')
    expect(payload).toEqual({ symbol: 'AAPL', watchlistId: 'list-1' })
  })

  it('preserves the symbol as-is (no transformation)', () => {
    const payload = buildAddPayload('GGAL.BA', 'list-2')
    expect(payload).toEqual({ symbol: 'GGAL.BA', watchlistId: 'list-2' })
  })

  it('handles uppercase symbols', () => {
    const payload = buildAddPayload('TSLA', 'list-3')
    expect(payload.symbol).toBe('TSLA')
    expect(payload.watchlistId).toBe('list-3')
  })
})

describe('isSymbolInList', () => {
  const items: WatchlistItem[] = [
    { id: 'item-1', symbol: 'AAPL', added_at: '2024-01-01', price: 150, changePercent: 1.5 },
    { id: 'item-2', symbol: 'MSFT', added_at: '2024-01-01', price: 300, changePercent: -0.5 },
  ]

  it('returns true when symbol is in the item list', () => {
    expect(isSymbolInList(items, 'AAPL')).toBe(true)
  })

  it('returns false when symbol is not in the item list', () => {
    expect(isSymbolInList(items, 'TSLA')).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(isSymbolInList(items, 'aapl')).toBe(false)
  })

  it('returns false for empty item list', () => {
    expect(isSymbolInList([], 'AAPL')).toBe(false)
  })
})

describe('getListsUrl', () => {
  it('returns the watchlist lists endpoint', () => {
    expect(getListsUrl()).toBe('/api/watchlist/lists')
  })
})

// ── Existing label / disabled helpers (still exported, tested for regression) ──

describe('getAddButtonLabel', () => {
  it('returns "Add to watchlist" when symbol is not in watchlist', () => {
    expect(getAddButtonLabel(false)).toBe('Add to watchlist')
  })

  it('returns "★ In watchlist" when symbol is already in watchlist', () => {
    expect(getAddButtonLabel(true)).toBe('★ In watchlist')
  })
})

describe('getAddButtonDisabled', () => {
  it('returns false when symbol is not in watchlist and not loading', () => {
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

describe('watchlistId-absent branch (popover path)', () => {
  it('buildAddPayload includes watchlistId from the list selection', () => {
    // When watchlistId is not provided via props, the popover provides it at click time
    const payload = buildAddPayload('AAPL', 'chosen-list-id')
    expect(payload.watchlistId).toBe('chosen-list-id')
    expect(payload.symbol).toBe('AAPL')
  })
})
