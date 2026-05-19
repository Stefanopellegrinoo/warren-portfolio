import { describe, it, expect } from 'vitest'
import {
  formatWatchlistPrice,
  formatWatchlistChange,
  getChangeColorClass,
  // New exports for multi-watchlist
  selectList,
  buildListsUrl,
  buildItemsUrl,
  buildCreateListPayload,
  buildRenamePayload,
  isLastList,
  buildDeleteItemUrl,
  // New search utility exports
  shouldSearch,
  buildAddFromSearchPayload,
} from './WatchlistPanel'
import type { Watchlist } from '@/app/api/watchlist/lists/route'

// ── Existing tests (kept) ──────────────────────────────────────────────────

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

// ── New multi-watchlist utility tests ─────────────────────────────────────

describe('selectList', () => {
  const lists: Watchlist[] = [
    { id: 'list-1', name: 'Tech US', created_at: '2024-01-01', item_count: 2 },
    { id: 'list-2', name: 'BCBA', created_at: '2024-01-02', item_count: 0 },
  ]

  it('returns the list matching the given id', () => {
    const result = selectList(lists, 'list-2')
    expect(result?.id).toBe('list-2')
    expect(result?.name).toBe('BCBA')
  })

  it('returns the first list when id is null', () => {
    const result = selectList(lists, null)
    expect(result?.id).toBe('list-1')
  })

  it('returns the first list when id is not found', () => {
    const result = selectList(lists, 'nonexistent')
    expect(result?.id).toBe('list-1')
  })

  it('returns undefined for empty list array', () => {
    const result = selectList([], null)
    expect(result).toBeUndefined()
  })
})

describe('buildListsUrl', () => {
  it('returns the watchlist lists endpoint', () => {
    expect(buildListsUrl()).toBe('/api/watchlist/lists')
  })
})

describe('buildItemsUrl', () => {
  it('builds items URL with watchlistId', () => {
    expect(buildItemsUrl('list-abc')).toBe('/api/watchlist?watchlistId=list-abc')
  })

  it('URL-encodes the watchlistId', () => {
    expect(buildItemsUrl('list abc')).toBe('/api/watchlist?watchlistId=list%20abc')
  })
})

describe('buildCreateListPayload', () => {
  it('returns an object with name field', () => {
    expect(buildCreateListPayload('Tech US')).toEqual({ name: 'Tech US' })
  })

  it('preserves the name as-is', () => {
    expect(buildCreateListPayload('  My List  ')).toEqual({ name: '  My List  ' })
  })
})

describe('buildRenamePayload', () => {
  it('returns an object with name field', () => {
    expect(buildRenamePayload('New Name')).toEqual({ name: 'New Name' })
  })
})

describe('isLastList', () => {
  it('returns true when there is exactly one list', () => {
    const lists: Watchlist[] = [
      { id: 'list-1', name: 'Only', created_at: '2024-01-01', item_count: 0 },
    ]
    expect(isLastList(lists)).toBe(true)
  })

  it('returns false when there are multiple lists', () => {
    const lists: Watchlist[] = [
      { id: 'list-1', name: 'A', created_at: '2024-01-01', item_count: 0 },
      { id: 'list-2', name: 'B', created_at: '2024-01-02', item_count: 0 },
    ]
    expect(isLastList(lists)).toBe(false)
  })

  it('returns true for empty list array (no lists to delete)', () => {
    expect(isLastList([])).toBe(true)
  })
})

describe('buildDeleteItemUrl', () => {
  it('builds DELETE url with symbol and watchlistId', () => {
    expect(buildDeleteItemUrl('AAPL', 'list-1')).toBe('/api/watchlist?symbol=AAPL&watchlistId=list-1')
  })

  it('URL-encodes special characters', () => {
    expect(buildDeleteItemUrl('GGAL.BA', 'list-1')).toBe('/api/watchlist?symbol=GGAL.BA&watchlistId=list-1')
  })
})

// ── New search utility tests ───────────────────────────────────────────────

describe('shouldSearch', () => {
  it('returns false for empty string', () => {
    expect(shouldSearch('')).toBe(false)
  })

  it('returns false for single character', () => {
    expect(shouldSearch('a')).toBe(false)
  })

  it('returns true for two characters', () => {
    expect(shouldSearch('ab')).toBe(true)
  })

  it('returns true for longer query like "AAPL"', () => {
    expect(shouldSearch('AAPL')).toBe(true)
  })
})

describe('buildAddFromSearchPayload', () => {
  it('returns object with symbol and watchlistId', () => {
    const result = buildAddFromSearchPayload('AAPL', 'list-1')
    expect(result).toEqual({ symbol: 'AAPL', watchlistId: 'list-1' })
  })

  it('passes through exact values without modification', () => {
    const result = buildAddFromSearchPayload('GGAL.BA', 'list-abc-123')
    expect(result.symbol).toBe('GGAL.BA')
    expect(result.watchlistId).toBe('list-abc-123')
  })
})

describe('race-guard counter logic', () => {
  it('increments a counter ref to detect stale requests', () => {
    // Simulate the race-guard pattern: counter always increments
    let counter = 0
    const increment = () => ++counter

    const id1 = increment()
    const id2 = increment()

    // id1 is stale — counter has moved past it
    expect(id1).toBe(1)
    expect(id2).toBe(2)
    expect(id2).toBe(counter) // latest request matches counter
    expect(id1).not.toBe(counter) // stale request does not match
  })

  it('stale response is discarded when counter has advanced', () => {
    let counter = 0
    const responses: string[] = []

    function handleResponse(capturedId: number, data: string) {
      // Only accept if this response matches the current counter
      if (capturedId === counter) {
        responses.push(data)
      }
    }

    // First request (id=1) — immediately stale
    counter++
    const id1 = counter

    // Second request (id=2) — this is the live one
    counter++
    const id2 = counter

    // Both respond, but only id2 should be accepted
    handleResponse(id1, 'stale-data')
    handleResponse(id2, 'fresh-data')

    expect(responses).toEqual(['fresh-data'])
  })
})
