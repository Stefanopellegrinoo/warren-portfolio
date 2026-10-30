/**
 * The asset page's Noticias (odd/tasks/asset-page.md T8, S10 S12). Server only.
 *
 * Spanish headlines from Google News (es-419/AR) first, then Yahoo's English ones; each source is
 * cached and fails on its own, through service.ts's cache path (TTLs, memory guard, failure mark).
 */
import { resolveTickerIdentity } from '../ticker-identity'
import { cacheRoute, getCachedRoute, redisMemoryShare } from '../redis'
import { getYahooFinanceInstance } from '../yahoo-finance'
import { shortName } from './explain'
import { AssetError, cachedEach, eachOf, parseTicker, type SourceStatus } from './service'

export interface NewsItem {
  title: string
  /** Always http(s): it becomes an href. */
  link: string
  source: string
  /** ISO 8601. */
  publishedAt: string
  lang: 'es' | 'en'
}

export interface AssetNews {
  /** Spanish first, then English, each newest first. */
  items: NewsItem[]
  sources: { es: SourceStatus; en: SourceStatus }
}

const TIMEOUT_MS = 10_000
const DAY = 86_400
const MAX_ITEMS = 20
/** Room kept for Yahoo's English headlines, or Google's dozens of Spanish ones would always fill the list. */
const MIN_ENGLISH = 5

const DEFAULTS = {
  resolveIdentity: resolveTickerIdentity,
  fetch: (url: string, init?: RequestInit) => fetch(url, init),
  getYahoo: getYahooFinanceInstance as () => Promise<{ search: (q: string, o: object, m: object) => Promise<unknown> }>,
  cache: { get: getCachedRoute, set: cacheRoute } as {
    get: <T>(key: string) => Promise<T | null>
    set: (key: string, value: unknown, ttlSeconds: number) => Promise<void>
  },
  memoryShare: redisMemoryShare,
  now: () => Date.now(),
}
export type NewsDeps = Partial<typeof DEFAULTS>

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** CDATA as is; otherwise entities decoded in one pass, so "&amp;lt;" stays "&lt;". */
function text(raw: string | undefined): string {
  if (raw === undefined) return ''
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw)
  if (cdata) return cdata[1].trim()
  return raw
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? all
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all
    })
    .trim()
}

const isWebLink = (s: string) => /^https?:\/\//i.test(s)
const iso = (t: number) => (Number.isFinite(t) ? new Date(t).toISOString() : null)

/**
 * Google News' items: title (its " - Fuente" suffix moved to the source), link, source, date.
 * Items missing a title, a web link or a readable date are dropped.
 * ponytail: a regex reader for flat RSS 2.0 items (no nested same-name tags, no namespaced fields);
 * swap in an XML parser if a feed ever needs them.
 */
export function parseRss(xml: string): Omit<NewsItem, 'lang'>[] {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].flatMap(([, body]) => {
    const tag = (name: string) => text(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(body)?.[1])
    let title = tag('title')
    let source = tag('source')
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -source.length - 3)
    else if (!source && title.includes(' - ')) [title, source] = [title.slice(0, title.lastIndexOf(' - ')), title.slice(title.lastIndexOf(' - ') + 3)]
    const link = tag('link')
    const publishedAt = iso(Date.parse(tag('pubDate')))
    return title && isWebLink(link) && publishedAt ? [{ title: title.trim(), link, source: source || 'Google Noticias', publishedAt }] : []
  })
}

/** Yahoo search's `news`: providerPublishTime is a Date (epoch seconds if the library ever stops converting it). */
export function mapYahooNews(news: unknown): NewsItem[] {
  if (!Array.isArray(news)) return []
  return news.flatMap((n) => {
    const { title, link, publisher, providerPublishTime: t } = (n ?? {}) as Record<string, unknown>
    const publishedAt = t instanceof Date ? iso(t.getTime()) : typeof t === 'number' ? iso(t * 1000) : null
    if (typeof title !== 'string' || !title.trim() || typeof link !== 'string' || !isWebLink(link) || !publishedAt) return []
    return [{ title: title.trim(), link, source: typeof publisher === 'string' && publisher ? publisher : 'Yahoo Finance', publishedAt, lang: 'en' as const }]
  })
}

const titleKey = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '')
const squash = (s: string) => plain(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Whether a headline names the company: a 3+ letter word of its name, spaces and accents aside
 * ("Mercado Libre", "Taiwán"), or a word starting with its symbol (TSM → TSMC). Drops the spam a
 * quoted search lets through. ponytail: lenient on purpose (a generic word like "Banco" passes);
 * tighten per word if noise shows up.
 */
function namesCompany(name: string, ticker: string): (title: string) => boolean {
  const words = name.split(/[^\p{L}\p{N}]+/u).map(squash).filter((w) => w.length >= 3)
  // parseTicker leaves only [A-Z0-9] here, so it is safe inside a RegExp.
  const symbol = ticker.replace(/^BCBA:/, '').split(/[.-]/)[0]
  const start = symbol.length >= 3 ? new RegExp(`(^|[^\\p{L}\\p{N}])${symbol}`, 'iu') : null
  return (title) => words.some((w) => squash(title).includes(w)) || !!start?.test(title)
}
const newestFirst = (a: NewsItem, b: NewsItem) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0)

/** Spanish, then English, each newest first; one item per title, the Spanish or newest copy; MAX_ITEMS in all. */
export function mergeNews(es: NewsItem[], en: NewsItem[]): NewsItem[] {
  const seen = new Set<string>()
  const unique = (items: NewsItem[]) =>
    [...items].sort(newestFirst).filter((i) => !seen.has(titleKey(i.title)) && !!seen.add(titleKey(i.title)))
  const [spanish, english] = [unique(es), unique(en)]
  const room = Math.min(spanish.length, MAX_ITEMS - Math.min(english.length, MIN_ENGLISH))
  return [...spanish.slice(0, room), ...english.slice(0, MAX_ITEMS - room)]
}

/**
 * Google also indexes quote pages as news ("Gráfico de rentabilidades estacionales de X (MELI) - Yahoo",
 * "Deuda total de X – BCBA:GGAL - TradingView", "Precio de X hoy - Binance"). They are re-dated often,
 * so newest first would put them on top. Matched by shape: an EXCHANGE:SYMBOL, a "(SYMBOL)" (letter
 * first, or digits with a market: 2330.TW; never a year), TradingView's ", TV" or a crypto price site.
 * ponytail: shapes seen live on 2026-10-30; extend when a new kind shows up.
 */
const QUOTE_PAGE = /\b[A-Z]{2,}:[A-Z0-9.]+\b|, TV$|\((?:[A-Z][A-Z0-9]{0,4}(?:\.[A-Z]{1,2})?|\d{1,5}\.[A-Z]{1,2})\)|^Precio de .* hoy$/
const QUOTE_SITE = /^(binance|coinmarketcap|bybit)$/i

async function fetchGoogleNews(name: string, d: typeof DEFAULTS): Promise<NewsItem[]> {
  const q = new URLSearchParams({ q: `"${name}"`, hl: 'es-419', gl: 'AR', ceid: 'AR:es-419' })
  const res = await d.fetch(`https://news.google.com/rss/search?${q}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`)
  return parseRss(await res.text())
    .filter((i) => !QUOTE_PAGE.test(i.title) && !QUOTE_SITE.test(i.source))
    .map((i) => ({ ...i, lang: 'es' as const }))
}

async function fetchYahooNews(query: string, d: typeof DEFAULTS): Promise<NewsItem[]> {
  const yf = await d.getYahoo()
  const r = await yf.search(query, { quotesCount: 0, newsCount: 10 }, { validateResult: false, fetchOptions: { signal: AbortSignal.timeout(TIMEOUT_MS) } })
  return mapYahooNews((r as { news?: unknown } | null)?.news)
}

/** Keys `fund:v1:news:<ticker>:es|en`: fresh 30 min (service.ts FRESH.news), kept a day as the last good copy. */
export async function getAssetNews(rawTicker: string, deps: NewsDeps = {}): Promise<AssetNews> {
  const d = { ...DEFAULTS, ...deps }
  const ticker = parseTicker(rawTicker)
  if (!ticker) throw new AssetError('invalid')
  const id = await d.resolveIdentity(ticker)
  if (!id.found) throw new AssetError('not_found')

  // shortName drops a final "S.A.", not "Sociedad Anónima" or "S.A.I.C.": with them Google finds quote pages, not the press.
  // A coin is "Bitcoin USD" on Yahoo; the press says "Bitcoin".
  const name = shortName(id.identity.name).split(/\s+(?:sociedad an[oó]nima|s\.\s?a\.)/i)[0].replace(/\s+USD$/, '')
  // Yahoo files no news under BYMA symbols (GGAL.BA); the company's name finds them, but not with accents.
  const yahooQuery = ticker.startsWith('BCBA:') ? plain(name) : id.identity.yahooSymbol
  const about = namesCompany(name, ticker)
  // What gets cached: the newest MAX_ITEMS that name the company (~10 KB, not Google's ~50 KB of 100 items).
  const keep = (items: NewsItem[]) => items.filter((i) => about(i.title)).sort(newestFirst).slice(0, MAX_ITEMS)
  const [esId, enId] = [`${ticker}:es`, `${ticker}:en`]
  const got = await cachedEach(
    'news',
    [esId, enId],
    eachOf('news', async (key) => keep(key === esId ? await fetchGoogleNews(name, d) : await fetchYahooNews(yahooQuery, d))),
    d,
    () => DAY,
  )
  const [es, en] = [got.get(esId)!, got.get(enId)!]
  return { items: mergeNews(es.value ?? [], en.value ?? []), sources: { es: es.status, en: en.status } }
}
