/**
 * The asset page's data (odd/tasks/asset-page.md T4, S1 S5 S7 S9 S12). Server only.
 *
 * Validates and resolves the ticker, reads each source through Redis, and runs the company and
 * each peer through the same computeMetrics. Nothing is written outside Redis; every key has a TTL
 * and derives from a ticker resolveTickerIdentity found in a supported market (or from the
 * sources' own answers about it), never from free text. Since T10 Yahoo's crypto feed is one of
 * them (design "Which assets get a page"); an ETF reads only its quote and profile.
 */
import { resolveTickerIdentity } from '../ticker-identity'
import { cacheRoute, getCachedRoute, redisMemoryShare } from '../redis'
import { getBars } from '../bars-cache'
import { closeOnOrBefore } from '../daily-bars'
import { argentinaDate } from '../utils'
import { fetchUsdRates } from './fx'
import { computeMetrics, type Metrics } from './metrics'
import type { MetricId } from './catalog'
import {
  fetchTvHistory, fetchTvPeers, fetchTvSnapshots, findBymaListing, resolveTvSymbol,
  type TvHistory, type TvSnapshot,
} from './tradingview'
import { fetchYahooProfile, fetchYahooStatements, type AssetKind, type YahooProfile, type YahooStatements } from './yahoo'
import { toStatements, type AssetStatements } from './statements'
import type { AssetRef, Market } from './types'
import { parseTicker } from './ticker'

export { parseTicker }

export type SourceStatus = 'ok' | 'stale' | 'error'

export interface PeerToday {
  tvSymbol: string
  name: string | null
  today: Record<MetricId, number | null>
  /** Per source of this peer, as the page's own: Comparar says which "—" is a source that did not answer. */
  sources?: AssetPage['sources']
}

/**
 * Resumen's facts about the asked listing (S11), from Yahoo; prices in `currency`, the listing's quote's. No recommendation.
 * Since T10 also its kind, an ETF's fund and a coin's market (optional: copies cached before lack them).
 */
export type AssetProfile = Pick<
  YahooProfile,
  | 'sector' | 'industry' | 'country' | 'fullTimeEmployees' | 'currency' | 'fiftyTwoWeekLow' | 'fiftyTwoWeekHigh'
  | 'targetMeanPrice' | 'numberOfAnalystOpinions' | 'nextEarningsDate' | 'earnings'
> & Partial<Pick<YahooProfile, 'kind' | 'marketCap' | 'regularMarketPrice' | 'dayChange' | 'circulatingSupply' | 'volume24h' | 'fund'>>

export interface AssetPage {
  /** As asked, normalized: `MELI`, `BCBA:GGAL`. */
  ticker: string
  name: string
  /** The badge: the asked listing's TradingView exchange (NASDAQ, BCBA), else Yahoo's name, shortened. */
  exchange: string | null
  /**
   * The asked listing's last price (an ADR keeps its own quote): TradingView's close, else the
   * identity's price. `currency` is null when TradingView could not say.
   */
  price: number
  currency: string | null
  /** Today's change of `price`, `pct` as a fraction (−0.0216); null unless TradingView's snapshot is fresh. */
  dayChange?: { abs: number; pct: number } | null
  /**
   * From the asked listing's Yahoo profile (T10): an ETF reads its fund, a coin its market, the rest Números. Absent
   * outside the supported markets, where nothing is asked.
   */
  kind?: AssetKind
  /** False outside TradingView's america/argentina markets: header and price only, no fundamentals (a coin: its own page, by `kind`). */
  supported: boolean
  /** The listing Números reads: the asked one, or the company's BYMA listing for an Argentine ADR. */
  listing: AssetRef | null
  /** `listing` is the BYMA one: the page says "Datos de <name> en BYMA" (S7). */
  bymaListing: boolean
  /**
   * The currency of `listing`'s quote: ARS for a BYMA listing, even for an ADR read there. The price target is no longer
   * in it: since T10 it is the asked listing's, in `profile.currency`.
   */
  listingCurrency?: string | null
  metrics: Metrics | null
  /** Today's values only, from the same computation as `metrics`. */
  peers: PeerToday[]
  /** Per source of `listing`: `stale` serves its last good copy, `error` leaves its metrics null. */
  sources: Partial<Record<'tradingview' | 'yahoo' | 'fx', SourceStatus>>
  /** The asked listing's (an ADR's own, like `price`), its last good copy when Yahoo fails; null when it never answered. */
  profile?: AssetProfile | null
}

/** `invalid`: not a ticker (400). `not_found`: no such instrument (404). */
export class AssetError extends Error {
  constructor(readonly code: 'invalid' | 'not_found') {
    super(`asset ${code}`)
    this.name = 'AssetError'
  }
}

const MINUTE = 60
const HOUR = 3_600
const DAY = 86_400
/** How long each copy is fresh. Every copy then lives on as its source's last good answer. */
const FRESH = {
  snap: 15 * MINUTE, tvh: DAY, yahoo: DAY, fx: DAY, peers: DAY, tvsym: 7 * DAY, byma: 7 * DAY, news: 30 * MINUTE, profile: 6 * HOUR,
  // A coin's profile carries its quote, which moves around the clock: as fresh as a listing's snapshot.
  crypto: 15 * MINUTE,
}
type Kind = keyof typeof FRESH
/** One key per copy, fresh or last good: Redis runs noeviction, so this is every key's TTL. */
const KEY_TTL = 7 * DAY
/** A ?vs= peer is a user's pick, not TradingView's: its copies keep one day of last good past the 24 h fresh, not six. */
const PEER_TTL = 2 * DAY
/** After a failed refresh, views serve the last good copy without asking that source again for this long. */
const FAILED_TTL = 5 * MINUTE
/**
 * Copies are written only while Redis uses less than this share of its maxmemory; above it the page is
 * served uncached. Redis also holds the alerts and the rate limiter, and noeviction fails every write once full.
 * ponytail: a fixed share; set it from production's INFO memory if the rest of Redis ever sits near it.
 */
const MAX_MEMORY_SHARE = 0.5
const MAX_PEERS = 5
/** Yahoo's name for its crypto feed (BTC-USD, ETH-USD…): known from the identity, before any key is written. */
const CRYPTO_EXCHANGE = 'CCC'
// TradingView keeps 20 fiscal years; the rates must reach the oldest one's end.
const FX_YEARS = 21
const CURRENCY = /^[A-Z]{3}$/

const DEFAULTS = {
  resolveIdentity: resolveTickerIdentity,
  resolveTvSymbol,
  fetchTvSnapshots,
  fetchTvHistory,
  fetchTvPeers,
  findBymaListing,
  fetchYahooStatements,
  fetchYahooProfile,
  fetchUsdRates,
  getBars,
  cache: { get: getCachedRoute, set: cacheRoute } as {
    get: <T>(key: string) => Promise<T | null>
    set: (key: string, value: unknown, ttlSeconds: number) => Promise<void>
  },
  memoryShare: redisMemoryShare,
  today: () => argentinaDate(),
  now: () => Date.now(),
}
export type AssetDeps = Partial<typeof DEFAULTS>
type Deps = typeof DEFAULTS

/** Yahoo's exchange names, short: NasdaqGS/GM/CM → NASDAQ, NYQ → NYSE; the rest as Yahoo says them. */
const shortExchange = (name: string | null) => (name && /^nasdaq/i.test(name) ? 'NASDAQ' : name === 'NYQ' ? 'NYSE' : name)

interface Got<T> {
  value: T | null
  status: SourceStatus
}
interface Entry<T> {
  at: number
  value: T
}

/**
 * Per id, the cached copy while fresh; the rest fetched in one call. An id the fetch fails or
 * leaves out gets its old copy as stale, else null as error, and a failure mark: until it expires
 * that id is answered the same way without a fetch. A null answer ("no such thing") is returned
 * as ok and never cached. Also news.ts's single cache path.
 */
export async function cachedEach<T>(
  kind: Kind,
  ids: string[],
  fetchMany: (ids: string[]) => Promise<Map<string, T | null>>,
  d: Pick<Deps, 'cache' | 'now' | 'memoryShare'>,
  ttl: (id: string) => number = () => KEY_TTL,
): Promise<Map<string, Got<T>>> {
  const key = (id: string) => `fund:v1:${kind}:${id}`
  const failedKey = (id: string) => `fund:v1:failed:${kind}:${id}`
  const now = d.now()
  const stored = new Map(await Promise.all(ids.map(async (id) => [id, await d.cache.get<Entry<T>>(key(id))] as const)))
  const lastGood = (id: string): Got<T> => {
    const old = stored.get(id)
    return old ? { value: old.value, status: 'stale' } : { value: null, status: 'error' }
  }
  const out = new Map<string, Got<T>>()
  for (const [id, e] of stored) if (e && now - e.at < FRESH[kind] * 1000) out.set(id, { value: e.value, status: 'ok' })
  const failed = await Promise.all(ids.filter((id) => !out.has(id)).map(async (id) => [id, await d.cache.get(failedKey(id))] as const))
  for (const [id, mark] of failed) if (mark) out.set(id, lastGood(id))
  const missing = ids.filter((id) => !out.has(id))
  if (missing.length === 0) return out

  const got = await fetchMany(missing).catch((err) => {
    console.warn(`[asset] ${kind} ${missing.join(',')}:`, err instanceof Error ? err.message : err)
    return new Map<string, T | null>()
  })
  const roomy = ((await d.memoryShare()) ?? 0) < MAX_MEMORY_SHARE
  for (const id of missing) {
    const value = got.get(id)
    if (value === undefined) {
      out.set(id, lastGood(id))
      // Tiny and short-lived, so written even when Redis is not roomy: a failing source is not asked again meanwhile.
      await d.cache.set(failedKey(id), 1, FAILED_TTL)
    } else {
      out.set(id, { value, status: 'ok' })
      if (value && roomy) await d.cache.set(key(id), { at: now, value }, ttl(id))
    }
  }
  return out
}

/** A one-id fetch as a batch: a failure leaves only that id out. */
export const eachOf =
  <T>(kind: Kind, fetchOne: (id: string) => Promise<T | null>) =>
  async (ids: string[]): Promise<Map<string, T | null>> => {
    const got = await Promise.allSettled(ids.map((id) => fetchOne(id)))
    return new Map(
      ids.flatMap((id, i) => {
        const r = got[i]
        if (r.status === 'fulfilled') return [[id, r.value] as const]
        console.warn(`[asset] ${kind} ${id}:`, r.reason instanceof Error ? r.reason.message : r.reason)
        return []
      }),
    )
  }

/** TradingView batches go one request per market. */
async function tvEach<T>(
  kind: 'snap' | 'tvh',
  refs: AssetRef[],
  fetch: (symbols: string[], market: Market) => Promise<Map<string, T>>,
  d: Deps,
  ttl?: (id: string) => number,
): Promise<Map<string, Got<T>>> {
  const maps = await Promise.all(
    (['america', 'argentina'] as const).map((m) => {
      const symbols = [...new Set(refs.filter((r) => r.market === m).map((r) => r.tvSymbol))]
      return symbols.length ? cachedEach(kind, symbols, (missing) => fetch(missing, m), d, ttl) : new Map<string, Got<T>>()
    }),
  )
  return new Map(maps.flatMap((m) => [...m]))
}

function refOf(tvSymbol: string, market: Market): AssetRef {
  const name = tvSymbol.slice(tvSymbol.indexOf(':') + 1)
  return market === 'argentina'
    ? { ticker: `BCBA:${name}`, market, tvSymbol, yahooSymbol: `${name}.BA` }
    : // TradingView's class shares (BRK.B) are BRK-B on Yahoo.
      { ticker: name, market, tvSymbol, yahooSymbol: name.replace(/\./g, '-') }
}

/** The listing of a valid ticker; value null with status ok means outside america/argentina. */
async function refFor(ticker: string, d: Deps, ttl = KEY_TTL): Promise<Got<AssetRef>> {
  if (ticker.startsWith('BCBA:')) return { value: refOf(ticker, 'argentina'), status: 'ok' }
  const got = (await cachedEach('tvsym', [ticker], eachOf('tvsym', (t) => d.resolveTvSymbol(t, 'america')), d, () => ttl)).get(ticker)!
  return { status: got.status, value: got.value ? refOf(got.value, 'america') : null }
}

/** `?vs=`: unique, at most MAX_PEERS, each found by its identity and in a supported market. */
async function vsPeers(vs: string[], asked: string, listing: AssetRef, d: Deps): Promise<AssetRef[]> {
  const picked = [...new Set(vs)].filter((t) => t !== asked).slice(0, MAX_PEERS)
  const refs = await Promise.all(
    picked.map(async (t) => {
      const id = await d.resolveIdentity(t).catch((err) => console.warn(`[asset] vs ${t}:`, err instanceof Error ? err.message : err))
      return id?.found ? (await refFor(t, d, PEER_TTL)).value : null
    }),
  )
  return refs.filter((r): r is AssetRef => r !== null && r.tvSymbol !== listing.tvSymbol)
}

const RANK: Record<SourceStatus, number> = { ok: 0, stale: 1, error: 2 }
const worst = (...s: SourceStatus[]): SourceStatus => s.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'ok')

const EMPTY_SNAPSHOT = { close: null, marketCap: null, currency: null, fields: {} as TvSnapshot['fields'] }

/**
 * Each month's last rate, the latest included: computeMetrics reads rates only at period ends and
 * today, and period ends are month ends, so it reads the same as from the daily series (~6 KB, not
 * ~180 KB for 21 years). ponytail: a period ending mid-month (a 52-week foreign reporter) gets the
 * previous month's rate; keep the daily series for the last years if one shows up.
 */
function monthEnds(rates: Map<string, number> | null): [string, number][] {
  const last = new Map<string, [string, number]>()
  for (const [date, rate] of [...(rates ?? [])].sort(([a], [b]) => (a < b ? -1 : 1))) last.set(date.slice(0, 7), [date, rate])
  return [...last.values()]
}

/** The asked listing's profile, compact: Resumen's facts, its kind, an ETF's fund and a coin's market; no recommendation. */
const profileOf = (d: Deps) => eachOf('profile', async (s): Promise<AssetProfile> => {
  const p = await d.fetchYahooProfile(s)
  return {
    sector: p.sector, industry: p.industry, country: p.country, fullTimeEmployees: p.fullTimeEmployees, currency: p.currency,
    fiftyTwoWeekLow: p.fiftyTwoWeekLow, fiftyTwoWeekHigh: p.fiftyTwoWeekHigh, targetMeanPrice: p.targetMeanPrice,
    numberOfAnalystOpinions: p.numberOfAnalystOpinions, nextEarningsDate: p.nextEarningsDate, earnings: p.earnings,
    kind: p.kind, marketCap: p.marketCap, regularMarketPrice: p.regularMarketPrice, dayChange: p.dayChange,
    circulatingSupply: p.circulatingSupply, volume24h: p.volume24h, fund: p.fund,
  }
})

function earliestEnd(tv: TvHistory | null, yahoo: YahooStatements | null): string | undefined {
  return [tv?.quarterly, tv?.annual, yahoo?.quarterly, yahoo?.annual]
    .flatMap((lines) => Object.values(lines ?? {}).map((s) => s?.[0]?.end))
    .filter((e): e is string => !!e)
    .sort()[0]
}

interface Located {
  asked: AssetRef
  askedSnap: Got<TvSnapshot>
  own: Got<AssetProfile>
  kind: AssetKind
  /** The listing Números reads: the asked one, or an Argentine ADR's BYMA one. */
  listing: AssetRef
  snap: Got<TvSnapshot>
}

/**
 * The asked listing, its quote and profile, and the listing Números reads, through the same keys for the page and
 * its statements. Outside america/argentina it answers the status alone: ok when unsupported, else error.
 */
async function locate(ticker: string, d: Deps): Promise<Located | SourceStatus> {
  const asked = await refFor(ticker, d)
  if (!asked.value) return asked.status === 'ok' ? 'ok' : 'error'
  const ref = asked.value
  // The profile alongside the first snapshot: its kind decides what else to read.
  const [firstSnap, profile] = await Promise.all([
    tvEach('snap', [ref], d.fetchTvSnapshots, d),
    cachedEach('profile', [ref.yahooSymbol], profileOf(d), d),
  ])
  const askedSnap = firstSnap.get(ref.tvSymbol)!
  const own = profile.get(ref.yahooSymbol)!
  // Without its profile, TradingView's own type still tells a fund.
  const kind = own.value?.kind ?? (askedSnap.value?.type === 'fund' ? 'etf' : 'company')
  let listing = ref
  let snap = askedSnap
  // An Argentine ADR (GGAL, YPF…) reads its BYMA listing: ARS price over ARS statements, amounts in CCL (S7). A fund has none.
  const { country, logoid } = askedSnap.value ?? {}
  if (kind !== 'etf' && ref.market === 'america' && country === 'Argentina' && logoid) {
    const byma = (await cachedEach('byma', [logoid], eachOf('byma', (l) => d.findBymaListing(l)), d)).get(logoid)!
    if (byma.value) {
      listing = refOf(byma.value, 'argentina')
      snap = (await tvEach('snap', [listing], d.fetchTvSnapshots, d)).get(listing.tvSymbol)!
    }
  }
  return { asked: ref, askedSnap, own, kind, listing, snap }
}

/** Month-end rates per dollar for each currency, through the `fx` copies. */
async function ratesOf(currencies: string[], d: Deps) {
  const today = d.today()
  const fxFrom = `${Number(today.slice(0, 4)) - FX_YEARS}${today.slice(4)}`
  const fx = await cachedEach('fx', [...new Set(currencies)], eachOf('fx', async (c) => monthEnds(await d.fetchUsdRates(c, fxFrom))), d)
  const rates = new Map([...fx].flatMap(([c, g]) => (g.value ? [[c, new Map(g.value)] as const] : [])))
  return { fx, rates }
}

const foreign = (...currencies: (string | null | undefined)[]) => currencies.filter((c): c is string => !!c && c !== 'USD' && CURRENCY.test(c))

/** Validates and resolves a ticker as both routes do: `invalid` before any lookup, `not_found` when no such instrument. */
async function identify(rawTicker: string, rawVs: string[] | null, d: Deps) {
  const ticker = parseTicker(rawTicker)
  const vs = rawVs?.map(parseTicker)
  if (!ticker || vs?.includes(null)) throw new AssetError('invalid')
  const id = await d.resolveIdentity(ticker)
  if (!id.found) throw new AssetError('not_found')
  return { ticker, vs: vs as string[] | undefined, identity: id.identity }
}

const NO_STATEMENTS: AssetStatements = { yahoo: null, tradingview: null, sources: {} }

/**
 * Balances completos (T11, S8): the statements of the listing Números reads, in USD at each period end. Reads
 * the page's own copies (keys, fresh windows, memory guard, failure marks), so right after the page it asks no
 * source; cold, it asks only this listing's history, statements and rates.
 */
export async function getAssetStatements(rawTicker: string, deps: AssetDeps = {}): Promise<AssetStatements> {
  const d: Deps = { ...DEFAULTS, ...deps }
  const { ticker, identity } = await identify(rawTicker, null, d)
  if (identity.exchange === CRYPTO_EXCHANGE) return NO_STATEMENTS
  const at = await locate(ticker, d)
  if (typeof at === 'string') return at === 'ok' ? NO_STATEMENTS : { ...NO_STATEMENTS, sources: { tradingview: 'error' } }
  if (at.kind === 'etf') return NO_STATEMENTS
  const { listing } = at
  const [histories, statements] = await Promise.all([
    tvEach('tvh', [listing], d.fetchTvHistory, d),
    cachedEach('yahoo', [listing.yahooSymbol], eachOf('yahoo', (s) => d.fetchYahooStatements(s)), d),
  ])
  const tv = histories.get(listing.tvSymbol)!
  const yahoo = statements.get(listing.yahooSymbol)!
  const currencies = foreign(tv.value?.currency, yahoo.value?.currency)
  const { fx, rates } = await ratesOf(currencies, d)
  return {
    ...toStatements(tv.value, yahoo.value, rates),
    sources: { tradingview: tv.status, yahoo: yahoo.status, fx: worst(...currencies.map((c) => fx.get(c)!.status)) },
  }
}

export async function getAssetPage(rawTicker: string, rawVs: string[] | null = null, deps: AssetDeps = {}): Promise<AssetPage> {
  const d: Deps = { ...DEFAULTS, ...deps }
  const { ticker, vs, identity } = await identify(rawTicker, rawVs, d)

  const { name, exchange, price } = identity
  const page: AssetPage = {
    ticker, name, exchange: shortExchange(exchange), price, currency: null, dayChange: null, supported: true, listing: null, bymaListing: false,
    listingCurrency: null, metrics: null, peers: [], sources: {}, profile: null,
  }

  // A coin (T10): outside TradingView's markets; its profile is its page, quote included.
  if (exchange === CRYPTO_EXCHANGE) {
    const sym = identity.yahooSymbol
    const { value: p, status } = (await cachedEach('crypto', [sym], profileOf(d), d)).get(sym)!
    return {
      ...page, kind: p?.kind ?? 'crypto', supported: false, price: p?.regularMarketPrice ?? price, currency: p?.currency ?? null,
      // A stale copy's change is not today's.
      dayChange: status === 'ok' ? p?.dayChange ?? null : null, sources: { yahoo: status }, profile: p,
    }
  }

  const at = await locate(ticker, d)
  if (typeof at === 'string') return at === 'ok' ? { ...page, supported: false } : { ...page, sources: { tradingview: 'error' } }
  const { asked, askedSnap, own: { value: own, status: profileStatus }, kind, listing, snap } = at
  // A stale copy's change is not today's. Copies cached before T5b have no change fields.
  const { close, currency = null, changePct, changeAbs } = askedSnap.value ?? {}
  const quote = {
    price: close ?? price,
    currency,
    dayChange: askedSnap.status === 'ok' && changePct != null && changeAbs != null ? { abs: changeAbs, pct: changePct / 100 } : null,
  }
  const askedExchange = asked.tvSymbol.slice(0, asked.tvSymbol.indexOf(':'))
  // An ETF has no statements: its fund is in the profile; no Números, peers or rates (T10).
  if (kind === 'etf') {
    return {
      ...page, ...quote, kind, exchange: askedExchange, listing, listingCurrency: currency,
      sources: { tradingview: askedSnap.status, yahoo: profileStatus }, profile: own,
    }
  }

  let peerStatus: SourceStatus = 'ok'
  let peerRefs: AssetRef[]
  if (vs) peerRefs = await vsPeers(vs, ticker, listing, d)
  else {
    const got = (await cachedEach('peers', [listing.tvSymbol], eachOf('peers', (s) => d.fetchTvPeers(s, listing.market)), d)).get(listing.tvSymbol)!
    peerStatus = got.status
    peerRefs = (got.value ?? []).map((p) => refOf(p.tvSymbol, p.market))
  }

  const all = [listing, ...peerRefs]
  const listingIds = [listing.tvSymbol, listing.yahooSymbol]
  const ttl = (id: string) => (vs && !listingIds.includes(id) ? PEER_TTL : KEY_TTL)
  const [snaps, histories, statements] = await Promise.all([
    tvEach('snap', peerRefs, d.fetchTvSnapshots, d, ttl),
    tvEach('tvh', all, d.fetchTvHistory, d, ttl),
    cachedEach('yahoo', [...new Set(all.map((r) => r.yahooSymbol))], eachOf('yahoo', (s) => d.fetchYahooStatements(s)), d, ttl),
  ])
  snaps.set(listing.tvSymbol, snap)
  const inputs = all.map((ref) => ({
    ref,
    snap: snaps.get(ref.tvSymbol)?.value ?? null,
    tv: histories.get(ref.tvSymbol)?.value ?? null,
    yahoo: statements.get(ref.yahooSymbol)?.value ?? null,
  }))
  const currenciesOf = (i: (typeof inputs)[number]) => foreign(i.snap?.currency, i.tv?.currency, i.yahoo?.currency)

  const today = d.today()
  const { fx, rates } = await ratesOf(inputs.flatMap(currenciesOf), d)

  const [self, ...others] = inputs
  const from = earliestEnd(self.tv, self.yahoo)
  const bars = from ? (await d.getBars([listing.yahooSymbol], new Date(`${from}T00:00:00Z`))).get(listing.yahooSymbol)?.bars ?? [] : []
  const run = (i: (typeof inputs)[number], priceOn: (date: string) => number | null, target: number | null = null) =>
    computeMetrics({ today, snapshot: i.snap ?? EMPTY_SNAPSHOT, tv: i.tv, yahoo: i.yahoo, rates, priceOn, target })
  /** One company's sources; the listing's TradingView also answers for its default peers. */
  const sourcesOf = (i: (typeof inputs)[number], ...tv: SourceStatus[]): AssetPage['sources'] => ({
    tradingview: worst(snaps.get(i.ref.tvSymbol)!.status, histories.get(i.ref.tvSymbol)!.status, ...tv),
    yahoo: statements.get(i.ref.yahooSymbol)!.status,
    fx: worst(...currenciesOf(i).map((c) => fx.get(c)!.status)),
  })

  return {
    ...page,
    ...quote,
    kind,
    exchange: askedExchange,
    listing,
    bymaListing: listing !== asked,
    listingCurrency: snap.value?.currency ?? null,
    // Números' target is Resumen's, analysts included (S5): the asked listing's, in its quote's currency.
    metrics: run(self, (date) => closeOnOrBefore(bars, date), own?.numberOfAnalystOpinions ? own.targetMeanPrice : null),
    // Peers show today's values only, which price at today's quote, never a past close.
    peers: others.map((i) => ({
      tvSymbol: i.ref.tvSymbol,
      name: i.snap?.name ?? null,
      today: Object.fromEntries(Object.values(run(i, () => null)).map((m) => [m.id, m.today])) as PeerToday['today'],
      sources: sourcesOf(i),
    })),
    sources: sourcesOf(self, peerStatus),
    profile: own,
  }
}
