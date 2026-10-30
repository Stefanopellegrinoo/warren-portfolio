// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAssetPage, AssetError, type AssetDeps } from '../service'
import { computeMetrics, type Metrics } from '../metrics'
import { TV_SNAPSHOT_FIELDS, type TvHistory, type TvSnapshot, type TvPeer } from '../tradingview'
import type { YahooProfile, YahooStatements } from '../yahoo'
import type { Market, Series } from '../types'

// Public company names only; every number is invented.
const TODAY = '2026-10-30'
const NOW = Date.parse('2026-10-30T15:00:00Z')
const HOUR_MS = 3_600_000
const ENDS = ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30']
const grow = (base: number): Series => ENDS.map((end, i) => ({ end, value: base * (1 + i / 10) }))

function snapshot(tvSymbol: string, over: Partial<TvSnapshot> = {}): TvSnapshot {
  const fields = Object.fromEntries(TV_SNAPSHOT_FIELDS.map((f) => [f, null])) as TvSnapshot['fields']
  return {
    tvSymbol, name: `${tvSymbol} Inc.`, sector: null, industry: 'Internet Retail', currency: 'USD', fundamentalCurrency: 'USD',
    close: 50, changePct: null, changeAbs: null, marketCap: 5000, logoid: tvSymbol.toLowerCase(), type: 'stock', country: 'United States',
    ...over,
    fields: { ...fields, total_shares_outstanding: 100, price_earnings_fwd: 20, ...over.fields },
  }
}

// Net income ÷ EPS = 100 shares every quarter.
function tvHistory(currency = 'USD', k = 1): TvHistory {
  const quarterly = {
    revenue: grow(100 * k), netIncome: grow(10 * k), grossProfit: grow(40 * k), ebitda: grow(20 * k),
    totalAssets: grow(1000 * k), totalDebt: grow(200 * k), freeCashFlow: grow(8 * k), epsDiluted: grow(0.1 * k),
  }
  const annual = Object.fromEntries(Object.keys(quarterly).map((l) => [l, []])) as unknown as TvHistory['annual']
  return { currency, quarterly, annual }
}

const yahoo = (currency = 'USD', k = 1): YahooStatements => ({
  currency,
  quarterly: { netIncome: grow(10 * k), revenue: grow(100 * k), operatingIncome: grow(15 * k), stockholdersEquity: grow(400 * k), ordinarySharesNumber: grow(100) },
  annual: {},
})

const PROFILE: YahooProfile = {
  longName: 'MercadoLibre, Inc.', sector: 'Consumer Cyclical', industry: 'Internet Retail', country: 'Uruguay', website: 'https://example.com',
  fullTimeEmployees: 1000, currency: 'USD', financialCurrency: 'USD', marketCap: 5000, fiftyTwoWeekLow: 40, fiftyTwoWeekHigh: 80,
  regularMarketPrice: 50, targetMeanPrice: 70, numberOfAnalystOpinions: 12, recommendationKey: 'buy', sharesOutstanding: 100,
  floatShares: 90, beta: 1.2, nextEarningsDate: '2026-11-05',
  earnings: [{ quarterEnd: '2026-06-30', epsEstimate: 1.1, epsActual: 1.2 }],
  kind: 'company', dayChange: null, circulatingSupply: null, volume24h: null, fund: null,
}
/** What the page keeps of it: Resumen's facts, no recommendation. */
const COMPACT = {
  sector: 'Consumer Cyclical', industry: 'Internet Retail', country: 'Uruguay', fullTimeEmployees: 1000, currency: 'USD',
  fiftyTwoWeekLow: 40, fiftyTwoWeekHigh: 80, targetMeanPrice: 70, numberOfAnalystOpinions: 12, nextEarningsDate: '2026-11-05',
  earnings: [{ quarterEnd: '2026-06-30', epsEstimate: 1.1, epsActual: 1.2 }],
  kind: 'company', marketCap: 5000, regularMarketPrice: 50, dayChange: null, circulatingSupply: null, volume24h: null, fund: null,
}

/** An in-memory Redis: every write is recorded with its TTL. */
function fakeCache() {
  const store = new Map<string, string>()
  const writes: { key: string; ttl: number; bytes: number }[] = []
  return {
    store,
    writes,
    get: vi.fn(async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : null)),
    set: vi.fn(async (key: string, value: unknown, ttl: number) => {
      const json = JSON.stringify(value)
      store.set(key, json)
      writes.push({ key, ttl, bytes: json.length })
    }),
  }
}

const IDENTITY: Record<string, { yahooSymbol: string; name: string; price: number }> = {
  MELI: { yahooSymbol: 'MELI', name: 'MercadoLibre, Inc.', price: 1660 },
  AMZN: { yahooSymbol: 'AMZN', name: 'Amazon.com, Inc.', price: 220 },
  SE: { yahooSymbol: 'SE', name: 'Sea Limited', price: 120 },
  EBAY: { yahooSymbol: 'EBAY', name: 'eBay Inc.', price: 70 },
  JD: { yahooSymbol: 'JD', name: 'JD.com, Inc.', price: 35 },
  BABA: { yahooSymbol: 'BABA', name: 'Alibaba Group', price: 130 },
  GGAL: { yahooSymbol: 'GGAL', name: 'Grupo Financiero Galicia S.A.', price: 40 },
  '7203.T': { yahooSymbol: '7203.T', name: 'Toyota Motor Corporation', price: 2900 },
}
const TV_SYMBOL: Record<string, string> = {
  MELI: 'NASDAQ:MELI', AMZN: 'NASDAQ:AMZN', SE: 'NYSE:SE', EBAY: 'NASDAQ:EBAY', JD: 'NASDAQ:JD', BABA: 'NYSE:BABA', GGAL: 'NASDAQ:GGAL',
}

function fakes() {
  const cache = fakeCache()
  const deps = {
    resolveIdentity: vi.fn(async (t: string) => {
      const id = IDENTITY[t]
      return id
        ? { found: true as const, identity: { ticker: t, exchange: 'NasdaqGS', ...id } }
        : { found: false as const, reason: 'not-found' as const }
    }),
    resolveTvSymbol: vi.fn(async (t: string, _m: Market) => TV_SYMBOL[t] ?? null),
    fetchTvSnapshots: vi.fn(async (symbols: string[], _m: Market) => new Map(symbols.map((s) => [s, snapshot(s)]))),
    fetchTvHistory: vi.fn(async (symbols: string[], _m: Market) => new Map(symbols.map((s, i) => [s, tvHistory('USD', i + 1)]))),
    fetchTvPeers: vi.fn(async (_s: string, _m: Market): Promise<TvPeer[]> => [
      { tvSymbol: 'NASDAQ:AMZN', market: 'america' },
      { tvSymbol: 'NYSE:SE', market: 'america' },
    ]),
    findBymaListing: vi.fn(async (_logoid: string): Promise<string | null> => null),
    fetchYahooStatements: vi.fn(async (_symbol: string) => yahoo()),
    fetchYahooProfile: vi.fn(async (_symbol: string) => PROFILE),
    fetchUsdRates: vi.fn(async (currency: string, _from: string) => (currency === 'USD' ? null : new Map([['2000-01-03', 4]]))),
    getBars: vi.fn(async (symbols: string[], _from: Date) =>
      new Map(symbols.map((s) => [s, { bars: [{ date: '2020-01-02', close: 40 }], splits: [], splitsKnown: true, degraded: false, missing: false }])),
    ),
    cache: { get: cache.get, set: cache.set },
    memoryShare: vi.fn(async (): Promise<number | null> => 0.1),
    today: () => TODAY,
    now: vi.fn(() => NOW),
  } satisfies AssetDeps
  return { deps, cache }
}

type Fakes = ReturnType<typeof fakes>['deps']
const sourceCalls = (d: Fakes) =>
  [d.resolveTvSymbol, d.fetchTvSnapshots, d.fetchTvHistory, d.fetchTvPeers, d.findBymaListing, d.fetchYahooStatements, d.fetchUsdRates]
    .reduce((n, f) => n + f.mock.calls.length, 0)
const todayOf = (m: Metrics) => Object.fromEntries(Object.values(m).map((v) => [v.id, v.today]))

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))

describe('getAssetPage: the ticker', () => {
  it('rejects an invalid ticker or ?vs= entry before any source, identity or cache call', async () => {
    const { deps, cache } = fakes()
    for (const [ticker, vs] of [['MELI; DROP', null], ['', null], ['A'.repeat(17), null], ['MELI', ['AMZN', 'b@d']]] as const) {
      await expect(getAssetPage(ticker, vs as string[] | null, deps)).rejects.toMatchObject({ code: 'invalid' })
    }
    expect(deps.resolveIdentity).not.toHaveBeenCalled()
    expect(sourceCalls(deps)).toBe(0)
    expect(cache.get).not.toHaveBeenCalled()
  })

  it("throws not_found when the identity does not resolve, and reads GGAL.BA as BYMA's GGAL", async () => {
    const { deps } = fakes()
    await expect(getAssetPage('ZZZZQ', null, deps)).rejects.toBeInstanceOf(AssetError)
    await expect(getAssetPage('ZZZZQ', null, deps)).rejects.toMatchObject({ code: 'not_found' })
    expect(sourceCalls(deps)).toBe(0)

    deps.resolveIdentity.mockResolvedValueOnce({
      found: true, identity: { ticker: 'BCBA:GGAL', yahooSymbol: 'GGAL.BA', name: 'Grupo Financiero Galicia', exchange: 'Buenos Aires', price: 7000 },
    })
    const page = await getAssetPage('ggal.ba', null, deps)
    expect(deps.resolveIdentity).toHaveBeenLastCalledWith('BCBA:GGAL')
    expect(page.listing).toEqual({ ticker: 'BCBA:GGAL', market: 'argentina', tvSymbol: 'BCBA:GGAL', yahooSymbol: 'GGAL.BA' })
    expect(deps.resolveTvSymbol).not.toHaveBeenCalled()
  })

  it('outside america/argentina returns name and price only and writes no fundamentals key', async () => {
    const { deps, cache } = fakes()

    const page = await getAssetPage('7203.T', null, deps)

    expect(page).toMatchObject({ ticker: '7203.T', name: 'Toyota Motor Corporation', price: 2900, dayChange: null, supported: false, metrics: null, peers: [] })
    expect(deps.resolveTvSymbol).toHaveBeenCalledWith('7203.T', 'america')
    expect(cache.set).not.toHaveBeenCalled()
    expect(sourceCalls(deps)).toBe(1)
  })
})

describe('getAssetPage: header price', () => {
  const moved = (s: string) => snapshot(s, s === 'NASDAQ:MELI' ? { close: 1700, changePct: -2.16, changeAbs: -36.09 } : {})

  it("takes the asked listing's TradingView close and day change over the identity price", async () => {
    const { deps } = fakes()
    deps.fetchTvSnapshots.mockImplementation(async (symbols: string[]) => new Map(symbols.map((s) => [s, moved(s)])))

    const page = await getAssetPage('MELI', null, deps)

    expect(page).toMatchObject({ price: 1700, currency: 'USD', dayChange: { abs: -36.09, pct: expect.closeTo(-0.0216) } })
  })

  it('a stale snapshot keeps its close but no day change; no snapshot at all keeps the identity price', async () => {
    const { deps } = fakes()
    deps.fetchTvSnapshots.mockImplementation(async (symbols: string[]) => new Map(symbols.map((s) => [s, moved(s)])))
    await getAssetPage('MELI', null, deps)
    deps.now.mockReturnValue(NOW + HOUR_MS) // past the snapshot's 15 min
    deps.fetchTvSnapshots.mockRejectedValue(new Error('HTTP 503'))

    expect(await getAssetPage('MELI', null, deps)).toMatchObject({ price: 1700, currency: 'USD', dayChange: null })

    const { deps: never } = fakes()
    never.fetchTvSnapshots.mockRejectedValue(new Error('HTTP 503'))
    expect(await getAssetPage('MELI', null, never)).toMatchObject({ price: 1660, currency: null, dayChange: null })
  })
})

describe('getAssetPage: header fields', () => {
  const ggalAdr = (s: string) => (s === 'NASDAQ:GGAL'
    ? snapshot(s, { logoid: 'gpo-fin-galicia', type: 'dr', country: 'Argentina', close: 41 })
    : s.startsWith('BCBA:') ? snapshot(s, { currency: 'ARS', close: 7000 }) : snapshot(s))

  it("badges the asked listing's TradingView exchange, and Yahoo's name, shortened, only without one", async () => {
    const { deps } = fakes()
    deps.fetchTvSnapshots.mockImplementation(async (symbols: string[]) => new Map(symbols.map((s) => [s, ggalAdr(s)])))
    deps.findBymaListing.mockResolvedValue('BCBA:GGAL')
    deps.resolveIdentity.mockImplementation(async (t: string) => ({
      found: true as const,
      identity: { ticker: t, yahooSymbol: t, name: t, price: 1, exchange: { GGAL: 'NasdaqCM', SE: 'NasdaqGS', '7203.T': 'Tokyo', 'BCBA:GGAL': 'Buenos Aires' }[t] ?? 'NYQ' },
    }))

    // GGAL reads its BYMA listing, but the badge is the asked one's: NASDAQ, not Yahoo's "NasdaqCM".
    expect((await getAssetPage('GGAL', null, deps)).exchange).toBe('NASDAQ')
    expect((await getAssetPage('SE', null, deps)).exchange).toBe('NYSE')
    expect((await getAssetPage('BCBA:GGAL', null, deps)).exchange).toBe('BCBA')
    expect((await getAssetPage('7203.T', null, deps)).exchange).toBe('Tokyo')

    const { deps: down } = fakes()
    down.resolveTvSymbol.mockRejectedValue(new Error('HTTP 503'))
    expect(await getAssetPage('MELI', null, down)).toMatchObject({ exchange: 'NASDAQ', sources: { tradingview: 'error' } })
    down.resolveIdentity.mockResolvedValue({ found: true, identity: { ticker: 'KO', yahooSymbol: 'KO', name: 'Coca-Cola', price: 60, exchange: 'NYQ' } })
    expect((await getAssetPage('KO', null, down)).exchange).toBe('NYSE')
  })

  it('names the currency of the listing whose numbers are shown: ARS for a BYMA listing, also for an ADR read there', async () => {
    const { deps } = fakes()
    deps.fetchTvSnapshots.mockImplementation(async (symbols: string[]) => new Map(symbols.map((s) => [s, ggalAdr(s)])))
    deps.findBymaListing.mockResolvedValue('BCBA:GGAL')
    deps.resolveIdentity.mockImplementation(async (t: string) => ({
      found: true as const, identity: { ticker: t, yahooSymbol: t, name: t, price: 1, exchange: 'NasdaqGS' },
    }))

    expect(await getAssetPage('BCBA:GGAL', null, deps)).toMatchObject({ currency: 'ARS', listingCurrency: 'ARS' })
    // The header keeps the ADR's own USD quote; its price target and numbers are BYMA's, in pesos.
    expect(await getAssetPage('GGAL', null, deps)).toMatchObject({ currency: 'USD', listingCurrency: 'ARS' })
    expect(await getAssetPage('MELI', null, deps)).toMatchObject({ currency: 'USD', listingCurrency: 'USD' })
    expect(await getAssetPage('7203.T', null, deps)).toMatchObject({ supported: false, listingCurrency: null })
  })
})

describe('getAssetPage: sources', () => {
  it("uses an Argentine ADR's BYMA listing for Números and says so", async () => {
    const { deps } = fakes()
    deps.fetchTvSnapshots.mockImplementation(async (symbols: string[]) =>
      new Map(symbols.map((s) => [s, s === 'NASDAQ:GGAL'
        ? snapshot(s, { logoid: 'gpo-fin-galicia', type: 'dr', country: 'Argentina', close: 41, changePct: 1, changeAbs: 0.41 })
        : snapshot(s, { currency: 'ARS', close: 7000, changePct: -1, changeAbs: -70 })])),
    )
    deps.findBymaListing.mockResolvedValue('BCBA:GGAL')

    const page = await getAssetPage('GGAL', null, deps)

    expect(deps.findBymaListing).toHaveBeenCalledWith('gpo-fin-galicia')
    expect(page).toMatchObject({
      // The header keeps the ADR's own quote, not the BYMA one.
      ticker: 'GGAL', price: 41, currency: 'USD', dayChange: { abs: 0.41, pct: expect.closeTo(0.01) }, bymaListing: true,
      listing: { ticker: 'BCBA:GGAL', market: 'argentina', tvSymbol: 'BCBA:GGAL', yahooSymbol: 'GGAL.BA' },
    })
    expect(deps.fetchTvSnapshots).toHaveBeenCalledWith(['BCBA:GGAL'], 'argentina')
    expect(deps.fetchTvHistory).toHaveBeenCalledWith(['BCBA:GGAL'], 'argentina')
    expect(deps.fetchTvPeers).toHaveBeenCalledWith('BCBA:GGAL', 'argentina')
    expect(deps.fetchYahooStatements).toHaveBeenCalledWith('GGAL.BA')
    expect(deps.getBars.mock.calls[0][0]).toEqual(['GGAL.BA'])
  })

  it('keeps the asked listing when the company is not Argentine', async () => {
    const { deps } = fakes()
    const page = await getAssetPage('MELI', null, deps)
    expect(deps.findBymaListing).not.toHaveBeenCalled()
    expect(page).toMatchObject({ bymaListing: false, supported: true, listing: { tvSymbol: 'NASDAQ:MELI', yahooSymbol: 'MELI' } })
  })

  it('asks rates for every currency involved, from the earliest period end, and converts with them', async () => {
    const { deps } = fakes()
    deps.fetchTvPeers.mockResolvedValue([])
    deps.fetchTvSnapshots.mockImplementation(async (symbols: string[]) => new Map(symbols.map((s) => [s, snapshot(s, { currency: 'EUR' })])))
    deps.fetchTvHistory.mockImplementation(async (symbols: string[]) => new Map(symbols.map((s) => [s, tvHistory('TWD')])))
    deps.fetchYahooStatements.mockResolvedValue(yahoo('JPY'))
    const rates = { EUR: 0.9, TWD: 30, JPY: 150 }
    deps.fetchUsdRates.mockImplementation(async (c: string) => new Map([['2000-01-03', rates[c as keyof typeof rates]]]))

    const page = await getAssetPage('MELI', null, deps)

    expect(deps.fetchUsdRates.mock.calls.map(([c]) => c).sort()).toEqual(['EUR', 'JPY', 'TWD'])
    for (const [, from] of deps.fetchUsdRates.mock.calls) expect(from <= ENDS[0]).toBe(true)
    const expected = computeMetrics({
      today: TODAY, snapshot: snapshot('NASDAQ:MELI', { currency: 'EUR' }), tv: tvHistory('TWD'), yahoo: yahoo('JPY'),
      rates: new Map(Object.entries(rates).map(([c, r]) => [c, new Map([['2000-01-03', r]])])),
      priceOn: (date) => (date >= '2020-01-02' ? 40 : null), target: PROFILE.targetMeanPrice,
    })
    expect(page.metrics).toEqual(expected)
    expect(page.metrics!.pe.today).not.toBeNull()
    expect(page.sources).toEqual({ tradingview: 'ok', yahoo: 'ok', fx: 'ok' })
  })

  it('computes each peer with the same computeMetrics and its own inputs, histories in one batch per market', async () => {
    const { deps } = fakes()

    const page = await getAssetPage('MELI', null, deps)

    expect(deps.fetchTvHistory).toHaveBeenCalledTimes(1)
    expect(deps.fetchTvHistory).toHaveBeenCalledWith(['NASDAQ:MELI', 'NASDAQ:AMZN', 'NYSE:SE'], 'america')
    expect(deps.fetchTvSnapshots).toHaveBeenCalledWith(['NASDAQ:AMZN', 'NYSE:SE'], 'america')
    expect(page.peers.map((p) => Object.keys(p).sort())).toEqual([['name', 'sources', 'today', 'tvSymbol'], ['name', 'sources', 'today', 'tvSymbol']])
    ;['NASDAQ:AMZN', 'NYSE:SE'].forEach((s, i) => {
      const own = computeMetrics({ today: TODAY, snapshot: snapshot(s), tv: tvHistory('USD', i + 2), yahoo: yahoo(), rates: new Map(), priceOn: () => null })
      expect(page.peers[i]).toEqual({ tvSymbol: s, name: `${s} Inc.`, today: todayOf(own), sources: { tradingview: 'ok', yahoo: 'ok', fx: 'ok' } })
    })
    expect(page.peers[0].today.netMargin).not.toBeNull()
  })

  it('takes ?vs= peers instead of the default ones: unique, at most 5, known and supported only', async () => {
    const { deps } = fakes()

    const page = await getAssetPage('MELI', ['amzn', 'AMZN', 'SE', 'MELI', 'EBAY', '7203.T', 'ZZZZQ', 'JD', 'BABA'], deps)

    expect(deps.fetchTvPeers).not.toHaveBeenCalled()
    // MELI is the page itself; the first five others are asked, JD and BABA never are.
    expect(deps.resolveIdentity.mock.calls.map(([t]) => t)).toEqual(['MELI', 'AMZN', 'SE', 'EBAY', '7203.T', 'ZZZZQ'])
    expect(page.peers.map((p) => p.tvSymbol)).toEqual(['NASDAQ:AMZN', 'NYSE:SE', 'NASDAQ:EBAY'])
  })
})

describe('getAssetPage: profile (Resumen)', () => {
  it("carries the asked listing's Yahoo profile, compact: Resumen's facts only", async () => {
    const { deps } = fakes()

    const page = await getAssetPage('MELI', null, deps)

    expect(deps.fetchYahooProfile).toHaveBeenCalledTimes(1)
    expect(deps.fetchYahooProfile).toHaveBeenCalledWith('MELI')
    expect(page.profile).toEqual(COMPACT)
  })

  it("an Argentine ADR's profile is its own listing's, like the header price, not BYMA's", async () => {
    const { deps } = fakes()
    deps.fetchTvSnapshots.mockImplementation(async (symbols: string[]) =>
      new Map(symbols.map((s) => [s, s === 'NASDAQ:GGAL' ? snapshot(s, { logoid: 'gpo-fin-galicia', type: 'dr', country: 'Argentina' }) : snapshot(s, { currency: 'ARS' })])),
    )
    deps.findBymaListing.mockResolvedValue('BCBA:GGAL')

    await getAssetPage('GGAL', null, deps)

    expect(deps.fetchYahooProfile.mock.calls).toEqual([['GGAL']])
  })

  it('is fresh for 6 hours, then asked again; its copy lives 7 days', async () => {
    const { deps, cache } = fakes()
    await getAssetPage('MELI', null, deps)
    deps.now.mockReturnValue(NOW + 5 * HOUR_MS)
    await getAssetPage('MELI', null, deps)
    expect(deps.fetchYahooProfile).toHaveBeenCalledTimes(1)

    deps.now.mockReturnValue(NOW + 7 * HOUR_MS)
    await getAssetPage('MELI', null, deps)

    expect(deps.fetchYahooProfile).toHaveBeenCalledTimes(2)
    expect(cache.writes.filter((w) => w.key === 'fund:v1:profile:MELI').map((w) => w.ttl)).toEqual([7 * 86400, 7 * 86400])
  })

  it('fails on its own: no profile, the rest of the page unchanged, a failure mark; then its last good copy', async () => {
    const { deps: fine } = fakes()
    const expected = await getAssetPage('MELI', null, fine)
    const { deps, cache } = fakes()
    deps.fetchYahooProfile.mockRejectedValue(new Error('HTTP 503'))

    const page = await getAssetPage('MELI', null, deps)

    // Números' target is the profile's (T10, S5): without it, none.
    const metrics = { ...expected.metrics!, priceTarget: { ...expected.metrics!.priceTarget, today: null } }
    expect(page).toEqual({ ...expected, metrics, profile: null })
    expect(cache.writes.find((w) => w.key === 'fund:v1:failed:profile:MELI')?.ttl).toBe(300)

    const { deps: later } = fakes()
    await getAssetPage('MELI', null, later)
    later.now.mockReturnValue(NOW + 7 * HOUR_MS)
    later.fetchYahooProfile.mockRejectedValue(new Error('HTTP 503'))
    expect((await getAssetPage('MELI', null, later)).profile).toEqual(COMPACT)
  })
})

describe('getAssetPage: peers sources', () => {
  it("names each peer's own sources: one peer's failed statements leave the others ok", async () => {
    const { deps } = fakes()
    deps.fetchYahooStatements.mockImplementation(async (s: string) => {
      if (s === 'SE') throw new Error('HTTP 503')
      return yahoo()
    })

    const page = await getAssetPage('MELI', null, deps)

    expect(page.sources).toEqual({ tradingview: 'ok', yahoo: 'ok', fx: 'ok' })
    expect(page.peers.map((p) => [p.tvSymbol, p.sources])).toEqual([
      ['NASDAQ:AMZN', { tradingview: 'ok', yahoo: 'ok', fx: 'ok' }],
      ['NYSE:SE', { tradingview: 'ok', yahoo: 'error', fx: 'ok' }],
    ])
  })
})

describe('getAssetPage: cache', () => {
  it('a second view inside the fresh window makes no source call and answers the same', async () => {
    const { deps } = fakes()
    const first = await getAssetPage('MELI', null, deps)
    const before = sourceCalls(deps)

    const second = await getAssetPage('MELI', null, deps)

    expect(sourceCalls(deps)).toBe(before)
    expect(second).toEqual(first)
  })

  it('writes every key with a TTL, under fund:v1:, from validated symbols only, each well under 30 KB', async () => {
    const { deps, cache } = fakes()
    deps.fetchTvSnapshots.mockImplementation(async (symbols: string[]) => new Map(symbols.map((s) => [s, snapshot(s, { currency: 'EUR' })])))

    await getAssetPage('MELI', null, deps)

    expect(cache.writes.map((w) => w.key).sort()).toEqual([
      'fund:v1:fx:EUR',
      'fund:v1:peers:NASDAQ:MELI',
      'fund:v1:profile:MELI',
      'fund:v1:snap:NASDAQ:AMZN', 'fund:v1:snap:NASDAQ:MELI', 'fund:v1:snap:NYSE:SE',
      'fund:v1:tvh:NASDAQ:AMZN', 'fund:v1:tvh:NASDAQ:MELI', 'fund:v1:tvh:NYSE:SE',
      'fund:v1:tvsym:MELI',
      'fund:v1:yahoo:AMZN', 'fund:v1:yahoo:MELI', 'fund:v1:yahoo:SE',
    ])
    for (const w of cache.writes) {
      expect(w.ttl).toBe(7 * 86400)
      expect(w.bytes).toBeLessThan(30_000)
    }
  })

  it('keeps one FX rate per month, its last, which is what month-end period ends read', async () => {
    const { deps, cache } = fakes()
    deps.fetchTvSnapshots.mockImplementation(async (symbols: string[]) => new Map(symbols.map((s) => [s, snapshot(s, { currency: 'EUR' })])))
    const daily: [string, number][] = [['2026-05-04', 0.91], ['2026-05-29', 0.92], ['2026-06-01', 0.93], ['2026-06-30', 0.94], ['2026-10-29', 0.95]]
    deps.fetchUsdRates.mockResolvedValue(new Map(daily))

    const page = await getAssetPage('MELI', null, deps)

    expect(JSON.parse(cache.store.get('fund:v1:fx:EUR')!).value).toEqual([['2026-05-29', 0.92], ['2026-06-30', 0.94], ['2026-10-29', 0.95]])
    const full = computeMetrics({
      today: TODAY, snapshot: snapshot('NASDAQ:MELI', { currency: 'EUR' }), tv: tvHistory(), yahoo: yahoo(),
      rates: new Map([['EUR', new Map(daily)]]), priceOn: (date) => (date >= '2020-01-02' ? 40 : null), target: PROFILE.targetMeanPrice,
    })
    expect(page.metrics).toEqual(full)
  })

  it("serves a failed source's last good copy marked stale", async () => {
    const { deps } = fakes()
    const first = await getAssetPage('MELI', null, deps)
    deps.now.mockReturnValue(NOW + 25 * HOUR_MS) // past the 24 h freshness of statements
    deps.fetchYahooStatements.mockRejectedValue(new Error('HTTP 503'))

    const page = await getAssetPage('MELI', null, deps)

    expect(deps.fetchYahooStatements).toHaveBeenCalledTimes(6) // 3 fetched, then 3 failed retries
    expect(page.sources).toEqual({ tradingview: 'ok', yahoo: 'stale', fx: 'ok' })
    expect(page.metrics!.roe).toEqual(first.metrics!.roe)
    expect(page.metrics!.roe.today).not.toBeNull()
  })

  it("a ?vs= peer's copies live two days, the listing's own seven", async () => {
    const { deps, cache } = fakes()

    await getAssetPage('MELI', ['AMZN', 'SE'], deps)

    expect(Object.fromEntries(cache.writes.map((w) => [w.key, w.ttl / 86400]))).toEqual({
      'fund:v1:tvsym:MELI': 7, 'fund:v1:snap:NASDAQ:MELI': 7, 'fund:v1:tvh:NASDAQ:MELI': 7, 'fund:v1:yahoo:MELI': 7, 'fund:v1:profile:MELI': 7,
      'fund:v1:tvsym:AMZN': 2, 'fund:v1:tvsym:SE': 2,
      'fund:v1:snap:NASDAQ:AMZN': 2, 'fund:v1:snap:NYSE:SE': 2,
      'fund:v1:tvh:NASDAQ:AMZN': 2, 'fund:v1:tvh:NYSE:SE': 2,
      'fund:v1:yahoo:AMZN': 2, 'fund:v1:yahoo:SE': 2,
    })
  })

  it('at half of maxmemory or more writes no copy and still serves the same page', async () => {
    const { deps: roomy } = fakes()
    const expected = await getAssetPage('MELI', null, roomy)
    const { deps, cache } = fakes()
    deps.memoryShare.mockResolvedValue(0.5)

    const page = await getAssetPage('MELI', null, deps)

    expect(page).toEqual(expected)
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('below half, or when Redis cannot say, writes its copies', async () => {
    for (const share of [0.49, null]) {
      const { deps, cache } = fakes()
      deps.memoryShare.mockResolvedValue(share)
      await getAssetPage('MELI', null, deps)
      expect(cache.writes).toHaveLength(12)
    }
  })

  /** A first view, then a failed refresh of every company's statements past their 24 h. */
  async function failedRefresh() {
    const { deps, cache } = fakes()
    const first = await getAssetPage('MELI', null, deps)
    deps.now.mockReturnValue(NOW + 25 * HOUR_MS)
    deps.fetchYahooStatements.mockRejectedValue(new Error('HTTP 503'))
    await getAssetPage('MELI', null, deps)
    return { deps, cache, first, calls: deps.fetchYahooStatements.mock.calls.length }
  }
  const marks = (writes: { key: string; ttl: number }[]) =>
    writes.filter((w) => w.key.startsWith('fund:v1:failed:')).map(({ key, ttl }) => [key, ttl]).sort()

  it('a failed refresh marks each failed copy for 5 minutes, and meanwhile views serve it stale without asking', async () => {
    const { deps, cache, first, calls } = await failedRefresh()
    expect(marks(cache.writes)).toEqual([
      ['fund:v1:failed:yahoo:AMZN', 300], ['fund:v1:failed:yahoo:MELI', 300], ['fund:v1:failed:yahoo:SE', 300],
    ])

    const page = await getAssetPage('MELI', null, deps)

    expect(deps.fetchYahooStatements).toHaveBeenCalledTimes(calls)
    expect(page.sources).toEqual({ tradingview: 'ok', yahoo: 'stale', fx: 'ok' })
    expect(page.metrics!.roe).toEqual(first.metrics!.roe)
  })

  it('once Redis drops the mark, the next view asks the source again', async () => {
    const { deps, cache, calls } = await failedRefresh()
    for (const [key] of marks(cache.writes)) cache.store.delete(key as string)
    deps.fetchYahooStatements.mockResolvedValue(yahoo())

    const page = await getAssetPage('MELI', null, deps)

    expect(deps.fetchYahooStatements).toHaveBeenCalledTimes(calls + 3)
    expect(page.sources.yahoo).toBe('ok')
  })

  it('without a last good copy, that source alone comes back null and is named', async () => {
    const { deps } = fakes()
    deps.fetchYahooStatements.mockRejectedValue(new Error('HTTP 503'))

    const page = await getAssetPage('MELI', null, deps)

    expect(page.sources).toEqual({ tradingview: 'ok', yahoo: 'error', fx: 'ok' })
    expect(page.metrics!.roe.today).toBeNull() // group Y: Yahoo
    expect(page.metrics!.netMargin.today).not.toBeNull() // group T: TradingView
  })
})

describe('getAssetPage: kinds (T10)', () => {
  const FUND = {
    category: 'Large Blend', family: 'State Street', inceptionDate: '1993-01-22', expenseRatio: 0.000945, totalAssets: 8e11,
    yield: 0.0099, ytdReturn: 0.14, threeYearReturn: 0.25, fiveYearReturn: 0.12,
    holdings: [{ symbol: 'NVDA', name: 'NVIDIA Corp', weight: 0.08 }], sectors: [{ sector: 'Technology', weight: 0.4 }],
  }
  const ETF: YahooProfile = { ...PROFILE, longName: 'SPDR S&P 500 ETF Trust', sector: null, industry: null, kind: 'etf', fund: FUND }
  const BTC: YahooProfile = {
    ...PROFILE, longName: 'Bitcoin USD', sector: null, industry: null, kind: 'crypto', regularMarketPrice: 77319.46, marketCap: 1.55e12,
    dayChange: { abs: -3853.57, pct: -0.0475 }, circulatingSupply: 20105364, volume24h: 5.9e10, fiftyTwoWeekLow: 57747, fiftyTwoWeekHigh: 111167,
  }
  const identity = (deps: Fakes, ticker: string, exchange: string, price: number) =>
    deps.resolveIdentity.mockImplementation(async (t: string) => (t === ticker
      ? { found: true as const, identity: { ticker: t, yahooSymbol: t, name: t === 'SPY' ? 'SPDR S&P 500 ETF Trust' : 'Bitcoin USD', exchange, price } }
      : { found: false as const, reason: 'not-found' as const }))

  function etf() {
    const f = fakes()
    identity(f.deps, 'SPY', 'NYSEArca', 700)
    f.deps.resolveTvSymbol.mockResolvedValue('AMEX:SPY')
    f.deps.fetchTvSnapshots.mockImplementation(async (symbols: string[]) =>
      new Map(symbols.map((s) => [s, snapshot(s, { type: 'fund', close: 757.32, changePct: -1.56, changeAbs: -12.04, marketCap: null })])))
    f.deps.fetchYahooProfile.mockResolvedValue(ETF)
    return f
  }

  it("names a company's kind from its profile", async () => {
    const { deps } = fakes()
    expect((await getAssetPage('MELI', null, deps)).kind).toBe('company')
  })

  it('an ETF: its quote, facts and composition from the profile; no statements, history, peers or rates asked', async () => {
    const { deps, cache } = etf()

    const page = await getAssetPage('SPY', null, deps)

    expect(page).toMatchObject({
      ticker: 'SPY', kind: 'etf', supported: true, exchange: 'AMEX', price: 757.32, currency: 'USD', dayChange: { abs: -12.04, pct: expect.closeTo(-0.0156) },
      metrics: null, peers: [], sources: { tradingview: 'ok', yahoo: 'ok' }, profile: { kind: 'etf', fund: FUND },
    })
    for (const f of [deps.fetchTvHistory, deps.fetchTvPeers, deps.fetchYahooStatements, deps.fetchUsdRates, deps.getBars]) expect(f).not.toHaveBeenCalled()
    expect(cache.writes.map((w) => w.key).sort()).toEqual(['fund:v1:profile:SPY', 'fund:v1:snap:AMEX:SPY', 'fund:v1:tvsym:SPY'])
    for (const w of cache.writes) expect([w.ttl, w.bytes < 30_000]).toEqual([7 * 86400, true])
  })

  it("an ETF's copies follow the memory guard; without its profile, TradingView's type still says ETF", async () => {
    const { deps, cache } = etf()
    deps.memoryShare.mockResolvedValue(0.5)
    expect((await getAssetPage('SPY', null, deps)).profile).toMatchObject({ fund: FUND })
    expect(cache.set).not.toHaveBeenCalled()

    const { deps: down } = etf()
    down.fetchYahooProfile.mockRejectedValue(new Error('HTTP 503'))
    expect(await getAssetPage('SPY', null, down)).toMatchObject({ kind: 'etf', profile: null, sources: { yahoo: 'error' } })
    expect(down.fetchYahooStatements).not.toHaveBeenCalled()
  })

  it("a crypto (Yahoo's CCC): price and day change from its profile, fresh 15 minutes, and no TradingView", async () => {
    const { deps, cache } = fakes()
    identity(deps, 'BTC-USD', 'CCC', 70000)
    deps.fetchYahooProfile.mockResolvedValue(BTC)

    const page = await getAssetPage('btcusdt', null, deps)

    expect(deps.resolveIdentity).toHaveBeenCalledWith('BTC-USD')
    expect(page).toMatchObject({
      ticker: 'BTC-USD', kind: 'crypto', supported: false, price: 77319.46, currency: 'USD', dayChange: { abs: -3853.57, pct: -0.0475 },
      listing: null, metrics: null, sources: { yahoo: 'ok' }, profile: { circulatingSupply: 20105364, volume24h: 5.9e10, marketCap: 1.55e12 },
    })
    expect(sourceCalls(deps)).toBe(0)
    expect(cache.writes.map((w) => [w.key, w.ttl])).toEqual([['fund:v1:crypto:BTC-USD', 7 * 86400]])

    deps.now.mockReturnValue(NOW + 10 * 60_000)
    await getAssetPage('BTC-USD', null, deps)
    expect(deps.fetchYahooProfile).toHaveBeenCalledTimes(1)
    deps.now.mockReturnValue(NOW + 20 * 60_000)
    deps.fetchYahooProfile.mockRejectedValue(new Error('HTTP 503'))
    // A stale quote keeps its price, but its change is not today's.
    expect(await getAssetPage('BTC-USD', null, deps)).toMatchObject({ price: 77319.46, dayChange: null, sources: { yahoo: 'stale' } })
  })

  it("a crypto Yahoo cannot describe keeps the identity's price and says so", async () => {
    const { deps } = fakes()
    identity(deps, 'BTC-USD', 'CCC', 70000)
    deps.fetchYahooProfile.mockRejectedValue(new Error('HTTP 503'))

    expect(await getAssetPage('BTC-USD', null, deps)).toMatchObject({ kind: 'crypto', price: 70000, dayChange: null, profile: null, sources: { yahoo: 'error' } })
  })
})

describe('getAssetPage: price target (T10, S5)', () => {
  it("Números' target is Resumen's: the asked listing's profile, never TradingView's, also for an ADR read in BYMA", async () => {
    const { deps } = fakes()
    deps.fetchTvSnapshots.mockImplementation(async (symbols: string[]) => new Map(symbols.map((s) => [s, s === 'NASDAQ:GGAL'
      ? snapshot(s, { logoid: 'gpo-fin-galicia', type: 'dr', country: 'Argentina', fields: { price_target_average: 99 } as TvSnapshot['fields'] })
      : snapshot(s, { currency: s.startsWith('BCBA:') ? 'ARS' : 'USD', fields: { price_target_average: 9000 } as TvSnapshot['fields'] })])))
    deps.findBymaListing.mockResolvedValue('BCBA:GGAL')

    for (const ticker of ['MELI', 'GGAL']) {
      const page = await getAssetPage(ticker, null, deps)
      expect(page.metrics!.priceTarget.today).toBe(page.profile!.targetMeanPrice)
      expect(page.metrics!.priceTarget.today).toBe(70)
      expect(page.peers.every((p) => p.today.priceTarget === null)).toBe(true)
    }
    expect((await getAssetPage('GGAL', null, deps)).bymaListing).toBe(true)
  })

  it('without analysts, none: as Resumen, a target needs at least one', async () => {
    const { deps } = fakes()
    deps.fetchYahooProfile.mockResolvedValue({ ...PROFILE, numberOfAnalystOpinions: 0 })
    expect((await getAssetPage('MELI', null, deps)).metrics!.priceTarget.today).toBeNull()
  })
})
