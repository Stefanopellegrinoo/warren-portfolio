/**
 * Tests for SymbolSelector ticker search logic.
 *
 * We test the pure search/debounce logic via the useTickerSearch hook which
 * encapsulates: debouncing, fetch, loading state, and result shape.
 * No React Testing Library is available in this project — component render
 * tests are done as integration tests by hand (manual smoke test).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Types shared with the hook ───────────────────────────────────────────────
import type { SearchResult } from '@/lib/market-data/types'

// ── Mock global fetch ────────────────────────────────────────────────────────
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function makeSearchResponse(results: SearchResult[]): Response {
  return {
    ok: true,
    json: async () => ({ results }),
  } as unknown as Response
}

const fakeResults: SearchResult[] = [
  { symbol: 'AAPL', shortname: 'Apple Inc.', quoteType: 'EQUITY', exchange: 'NMS' },
  { symbol: 'AAPD', shortname: 'Direxion Apple Bear', quoteType: 'ETF', exchange: 'PCX' },
]

// ── Import the functions under test ─────────────────────────────────────────
// We import after vi.stubGlobal so the mock is in place
describe('buildSearchUrl', () => {
  it('builds the correct search URL from a query', async () => {
    const { buildSearchUrl } = await import('./SymbolSelector')
    expect(buildSearchUrl('app')).toBe('/api/ticker/search?q=app')
    expect(buildSearchUrl('AAPL')).toBe('/api/ticker/search?q=AAPL')
  })
})

describe('fetchTickerSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns SearchResult[] from API on success', async () => {
    mockFetch.mockResolvedValue(makeSearchResponse(fakeResults))

    const { fetchTickerSearch } = await import('./SymbolSelector')
    const results = await fetchTickerSearch('app')

    expect(results).toHaveLength(2)
    expect(results[0].symbol).toBe('AAPL')
    expect(results[0].shortname).toBe('Apple Inc.')
    expect(results[0].exchange).toBe('NMS')
  })

  it('calls fetch with the correct URL', async () => {
    mockFetch.mockResolvedValue(makeSearchResponse(fakeResults))

    const { fetchTickerSearch } = await import('./SymbolSelector')
    await fetchTickerSearch('msft')

    expect(mockFetch).toHaveBeenCalledWith('/api/ticker/search?q=msft')
  })

  it('returns empty array when API response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) } as Response)

    const { fetchTickerSearch } = await import('./SymbolSelector')
    const results = await fetchTickerSearch('err')

    expect(results).toHaveLength(0)
  })

  it('returns empty array when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const { fetchTickerSearch } = await import('./SymbolSelector')
    const results = await fetchTickerSearch('err')

    expect(results).toHaveLength(0)
  })
})

describe('shouldFetchSearch', () => {
  it('returns true when query length >= 2', async () => {
    const { shouldFetchSearch } = await import('./SymbolSelector')
    expect(shouldFetchSearch('ap')).toBe(true)
    expect(shouldFetchSearch('app')).toBe(true)
  })

  it('returns false when query is shorter than 2 chars', async () => {
    const { shouldFetchSearch } = await import('./SymbolSelector')
    expect(shouldFetchSearch('a')).toBe(false)
    expect(shouldFetchSearch('')).toBe(false)
  })
})

describe('debounce helper', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls the function once after the delay when called multiple times within delay', async () => {
    const { debounce } = await import('./SymbolSelector')
    const fn = vi.fn()
    const debounced = debounce(fn, 300)

    debounced('first')
    debounced('second')
    debounced('third')

    // Not yet called
    expect(fn).not.toHaveBeenCalled()

    // Advance past debounce delay
    vi.advanceTimersByTime(300)

    // Called once with the last value
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('third')
  })

  it('calls the function immediately after delay when called once', async () => {
    const { debounce } = await import('./SymbolSelector')
    const fn = vi.fn()
    const debounced = debounce(fn, 300)

    debounced('query')
    vi.advanceTimersByTime(300)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('query')
  })

  it('does NOT call the function before the delay has passed', async () => {
    const { debounce } = await import('./SymbolSelector')
    const fn = vi.fn()
    const debounced = debounce(fn, 300)

    debounced('query')
    vi.advanceTimersByTime(299)

    expect(fn).not.toHaveBeenCalled()
  })
})
