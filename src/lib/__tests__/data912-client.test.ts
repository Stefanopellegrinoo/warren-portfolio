import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Quote } from '@/types'

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock Redis LKP layer (yahoo-finance): default = cache miss (empty Map)
const mockFetchQuotes = vi.fn()
const mockCachePrice = vi.fn()

vi.mock('../yahoo-finance', () => ({
  fetchQuotes: (...args: unknown[]) => mockFetchQuotes(...args),
  cachePrice: (...args: unknown[]) => mockCachePrice(...args),
}))

// Mock Supabase service client: .from('ons').select(...).in('ticker', [...])
let mockOnsRows: unknown[] | null = []
let mockOnsError: unknown = null

const mockIn = vi.fn()
const mockSelect = vi.fn()
const mockFrom = vi.fn()

vi.mock('../supabase-server', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
  createServerClientInstance: vi.fn(),
}))

// Mock global.fetch so the internal Data912 call resolves an empty array
// (tier 2 yields no quotes → tickers fall through to the DB tier)
const mockGlobalFetch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockOnsRows = []
  mockOnsError = null

  mockFetchQuotes.mockResolvedValue(new Map<string, Quote>())
  mockCachePrice.mockResolvedValue(undefined)

  mockIn.mockImplementation(async () => ({ data: mockOnsRows, error: mockOnsError }))
  mockSelect.mockReturnValue({ in: mockIn })
  mockFrom.mockReturnValue({ select: mockSelect })

  mockGlobalFetch.mockResolvedValue({ ok: true, json: async () => [] })
  vi.stubGlobal('fetch', mockGlobalFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Import after mocks are set up ────────────────────────────────────────────

const { fetchONQuotesWithFallback } = await import('../data912-client')

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fetchONQuotesWithFallback — DB last_price tertiary fallback', () => {
  it('falls back to ons.last_price when Redis misses and Data912 is empty', async () => {
    // Arrange
    mockOnsRows = [
      { ticker: 'CS50D', last_price: '104.65', last_updated: '2026-07-21T18:00:00Z' },
    ]

    // Act
    const result = await fetchONQuotesWithFallback(['CS50D'])

    // Assert — degraded Quote built from the persisted last price
    const quote = result.get('CS50D')
    expect(quote).toBeDefined()
    expect(quote!.price).toBe(104.65)
    expect(quote!.change).toBe(0)
    expect(quote!.changePercent).toBe(0)
    expect(quote!.previousClose).toBe(104.65)
    expect(quote!.updatedAt).toBe('2026-07-21T18:00:00Z')

    // The DB tier queried the ons table for the still-missing ticker
    expect(mockFrom).toHaveBeenCalledWith('ons')
    expect(mockIn).toHaveBeenCalledWith('ticker', ['CS50D'])
  })

  it('leaves ticker absent when ons has no row for it', async () => {
    // Arrange
    mockOnsRows = []

    // Act
    const result = await fetchONQuotesWithFallback(['AERBD'])

    // Assert — no crash, ticker simply missing
    expect(result.has('AERBD')).toBe(false)
    expect(result.size).toBe(0)
  })

  it('resolves gracefully when the DB query returns an error', async () => {
    // Arrange
    mockOnsRows = null
    mockOnsError = { message: 'connection refused' }

    // Act + Assert — no throw, ticker absent
    await expect(fetchONQuotesWithFallback(['MGCRD'])).resolves.toBeInstanceOf(Map)
    const result = await fetchONQuotesWithFallback(['MGCRD'])
    expect(result.has('MGCRD')).toBe(false)
  })

  it('never overwrites a Redis LKP quote — DB fallback only fills gaps', async () => {
    // Arrange — TESTD comes from LKP; OTROD is genuinely missing
    const lkpQuote: Quote = {
      ticker: 'TESTD',
      price: 50,
      change: 1,
      changePercent: 2,
      previousClose: 49,
      updatedAt: '2026-07-22T10:00:00Z',
    }
    mockFetchQuotes.mockResolvedValue(new Map([['TESTD', lkpQuote]]))
    // DB returns rows for BOTH tickers — the fallback must ignore TESTD
    mockOnsRows = [
      { ticker: 'TESTD', last_price: '99.99', last_updated: '2026-07-01T00:00:00Z' },
      { ticker: 'OTROD', last_price: '87.5', last_updated: '2026-07-20T00:00:00Z' },
    ]

    // Act
    const result = await fetchONQuotesWithFallback(['TESTD', 'OTROD'])

    // Assert — LKP quote untouched
    expect(result.get('TESTD')).toEqual(lkpQuote)
    // Gap filled from DB
    expect(result.get('OTROD')?.price).toBe(87.5)
    expect(result.get('OTROD')?.previousClose).toBe(87.5)
    // DB tier only asked for the ticker that was still missing
    expect(mockIn).toHaveBeenCalledWith('ticker', ['OTROD'])
  })

  it('keys the DB fallback quote by the caller original-case ticker', async () => {
    // Arrange — lowercase caller, uppercase DB row (ons stores uppercase)
    mockOnsRows = [
      { ticker: 'CS50D', last_price: 104.65, last_updated: '2026-07-21T18:00:00Z' },
    ]

    // Act
    const result = await fetchONQuotesWithFallback(['cs50d'])

    // Assert — key contract matches tiers 1 & 2: original requested casing
    const quote = result.get('cs50d')
    expect(quote).toBeDefined()
    expect(quote!.price).toBe(104.65)
    expect(quote!.ticker).toBe('cs50d')
    // DB was still queried with the uppercase ticker
    expect(mockIn).toHaveBeenCalledWith('ticker', ['CS50D'])
  })

  // A persisted last_price is only usable when it is a real positive number.
  // Zero, negatives and anything that does not parse are all "no price" — never a quote.
  it.each([
    ['null', null],
    ['zero', 0],
    ['zero as a string', '0'],
    ['a negative number', -5],
    ['a negative string', '-3.5'],
    ['an empty string', ''],
    ['a non-numeric string', 'N/A'],
    ['undefined', undefined],
  ])('skips DB rows whose last_price is %s', async (_label, lastPrice) => {
    // Arrange
    mockOnsRows = [
      { ticker: 'AERBD', last_price: lastPrice, last_updated: '2026-07-21T18:00:00Z' },
    ]

    // Act
    const result = await fetchONQuotesWithFallback(['AERBD'])

    // Assert — no quote at all, rather than a bogus 0/negative price
    expect(result.has('AERBD')).toBe(false)
    expect(result.size).toBe(0)
  })

  it('merges Data912 live quotes with DB fallback for tickers Data912 misses', async () => {
    // Arrange — Data912 knows CS50D; AERBD only exists as a persisted DB price
    mockGlobalFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          symbol: 'CS50D',
          c: 104.65,
          pct_change: 0.5,
          q_bid: 0,
          px_bid: 0,
          px_ask: 0,
          q_ask: 0,
          v: 0,
          q_op: 0,
        },
      ],
    })
    mockOnsRows = [
      { ticker: 'AERBD', last_price: '98.5', last_updated: '2026-07-20T00:00:00Z' },
    ]

    // Act
    const result = await fetchONQuotesWithFallback(['CS50D', 'AERBD'])

    // Assert — live quote from Data912. changePercent is a FRACTION
    // (0.005 = 0.5%): data912 reports percent units, but every Quote in the
    // LKP store must share one convention or the UI shows day changes 100×
    // off depending on which writer cached the price.
    expect(result.get('CS50D')?.price).toBe(104.65)
    expect(result.get('CS50D')?.changePercent).toBeCloseTo(0.005)
    expect(result.get('CS50D')?.change).toBeCloseTo(104.65 * 0.005)
    // Degraded quote from the DB tier
    expect(result.get('AERBD')?.price).toBe(98.5)
    expect(result.get('AERBD')?.change).toBe(0)
    // DB tier only asked for the ticker Data912 could not provide
    expect(mockIn).toHaveBeenCalledWith('ticker', ['AERBD'])
  })
})
