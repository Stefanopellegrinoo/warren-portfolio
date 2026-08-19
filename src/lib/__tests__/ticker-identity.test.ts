import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuote = vi.fn()
vi.mock('@/lib/yahoo-finance', () => ({
  normalizeTickerForYahoo: (t: string) => (t.startsWith('BCBA:') ? `${t.split(':')[1]}.BA` : t),
  getYahooFinanceInstance: async () => ({ quote: mockQuote }),
}))

const mockGetCachedRoute = vi.fn()
const mockCacheRoute = vi.fn()
vi.mock('@/lib/redis', () => ({
  getCachedRoute: (...a: unknown[]) => mockGetCachedRoute(...a),
  cacheRoute: (...a: unknown[]) => mockCacheRoute(...a),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCachedRoute.mockResolvedValue(null)
  mockCacheRoute.mockResolvedValue(undefined)
})

describe('resolveTickerIdentity', () => {
  it('returns the instrument Yahoo reports for a known symbol', async () => {
    const { resolveTickerIdentity } = await import('../ticker-identity')
    mockQuote.mockResolvedValue({
      longName: 'NVIDIA Corporation',
      fullExchangeName: 'NasdaqGS',
      regularMarketPrice: 206.84,
    })

    const result = await resolveTickerIdentity('NVDA')

    expect(result).toEqual({
      found: true,
      identity: {
        ticker: 'NVDA',
        yahooSymbol: 'NVDA',
        name: 'NVIDIA Corporation',
        exchange: 'NasdaqGS',
        price: 206.84,
      },
    })
  })

  it('surfaces the unrelated instrument rather than hiding it — the UN case', async () => {
    const { resolveTickerIdentity } = await import('../ticker-identity')
    mockQuote.mockResolvedValue({
      longName: 'Corgi UNH 2x Daily ETF',
      fullExchangeName: 'Cboe US',
      regularMarketPrice: 25.0261,
    })

    const result = await resolveTickerIdentity('UN')

    expect(result.found).toBe(true)
    expect(result.found && result.identity.name).toBe('Corgi UNH 2x Daily ETF')
  })

  it('uppercases and trims the ticker before resolving', async () => {
    const { resolveTickerIdentity } = await import('../ticker-identity')
    mockQuote.mockResolvedValue({ longName: 'Apple Inc.', regularMarketPrice: 333 })

    const result = await resolveTickerIdentity('  aapl  ')

    expect(mockQuote).toHaveBeenCalledWith('AAPL')
    expect(result.found && result.identity.ticker).toBe('AAPL')
  })

  it('normalizes an exchange-prefixed ticker to its Yahoo symbol', async () => {
    const { resolveTickerIdentity } = await import('../ticker-identity')
    mockQuote.mockResolvedValue({ longName: 'Grupo Galicia', regularMarketPrice: 100 })

    const result = await resolveTickerIdentity('BCBA:GGAL')

    expect(mockQuote).toHaveBeenCalledWith('GGAL.BA')
    expect(result.found && result.identity.yahooSymbol).toBe('GGAL.BA')
  })

  it('falls back to shortName when longName is absent', async () => {
    const { resolveTickerIdentity } = await import('../ticker-identity')
    mockQuote.mockResolvedValue({ shortName: 'SOME ETF', regularMarketPrice: 10 })

    const result = await resolveTickerIdentity('XYZ')

    expect(result.found && result.identity.name).toBe('SOME ETF')
  })

  it('reports no-price when the symbol exists but carries no price', async () => {
    const { resolveTickerIdentity } = await import('../ticker-identity')
    mockQuote.mockResolvedValue({ longName: 'Something', regularMarketPrice: undefined })

    expect(await resolveTickerIdentity('DISNEY')).toEqual({ found: false, reason: 'no-price' })
  })

  it('reports not-found when Yahoo answers that the symbol does not exist', async () => {
    const { resolveTickerIdentity } = await import('../ticker-identity')
    mockQuote.mockRejectedValue(new Error('No data found, symbol may be delisted'))

    expect(await resolveTickerIdentity('TESLA')).toEqual({ found: false, reason: 'not-found' })
  })

  it.each([
    ['a timeout', new Error('ETIMEDOUT connect timed out')],
    ['a DNS failure', new Error('getaddrinfo ENOTFOUND query2.finance.yahoo.com')],
    ['a rate limit', new Error('429 Too Many Requests')],
    ['an upstream 5xx', new Error('Internal Server Error')],
    ['a module load failure', new Error('Cannot find module yahoo-finance2')],
  ])('throws on %s — a non-answer must never read as "no such instrument"', async (_label, err) => {
    const { resolveTickerIdentity } = await import('../ticker-identity')
    mockQuote.mockRejectedValue(err)

    // Design §9: Yahoo unreachable → the caller returns 503 and writes nothing.
    // Answering `found: false` here would invite the user to confirm an outage
    // and permanently catalogue a real company as having no instrument.
    await expect(resolveTickerIdentity('NVDA')).rejects.toThrow(err)
    expect(mockCacheRoute).not.toHaveBeenCalled()
  })

  it('serves a cached identity without calling Yahoo again', async () => {
    const { resolveTickerIdentity } = await import('../ticker-identity')
    mockGetCachedRoute.mockResolvedValue({
      found: true,
      identity: { ticker: 'NVDA', yahooSymbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NasdaqGS', price: 206.84 },
    })

    const result = await resolveTickerIdentity('NVDA')

    expect(mockQuote).not.toHaveBeenCalled()
    expect(result.found && result.identity.name).toBe('NVIDIA Corporation')
  })

  it('caches a successful resolution for 7 days', async () => {
    const { resolveTickerIdentity, TICKER_IDENTITY_TTL } = await import('../ticker-identity')
    mockQuote.mockResolvedValue({ longName: 'NVIDIA Corporation', regularMarketPrice: 206.84 })

    await resolveTickerIdentity('NVDA')

    expect(mockCacheRoute).toHaveBeenCalledWith('ticker-identity:NVDA', expect.anything(), TICKER_IDENTITY_TTL)
    expect(TICKER_IDENTITY_TTL).toBe(604800)
  })

  it('does NOT cache a failure — a delisting today may be a typo fixed tomorrow', async () => {
    const { resolveTickerIdentity } = await import('../ticker-identity')
    mockQuote.mockRejectedValue(new Error('No data found, symbol may be delisted'))

    await resolveTickerIdentity('WHATEVER')

    expect(mockCacheRoute).not.toHaveBeenCalled()
  })
})

describe('isUnknownSymbolError', () => {
  it('recognises the message yahoo-finance2 uses for an unknown or delisted symbol', async () => {
    const { isUnknownSymbolError } = await import('../ticker-identity')

    expect(isUnknownSymbolError(new Error('No data found, symbol may be delisted'))).toBe(true)
    expect(isUnknownSymbolError(new Error('No fundamentals data found for XYZ'))).toBe(true)
  })

  it('treats everything it does not recognise as a transport failure', async () => {
    const { isUnknownSymbolError } = await import('../ticker-identity')

    // Unrecognised must mean "propagate": a wrong `found: false` is written to
    // the catalog forever, a wrong 503 costs one retry.
    expect(isUnknownSymbolError(new Error('socket hang up'))).toBe(false)
    expect(isUnknownSymbolError(new Error('429 Too Many Requests'))).toBe(false)
    expect(isUnknownSymbolError('not even an Error')).toBe(false)
  })
})
