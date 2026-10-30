// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { getAssetNews, mapYahooNews, mergeNews, parseRss, type NewsDeps, type NewsItem } from '../news'
import { AssetError } from '../service'

// odd/tasks/asset-page.md T8, S10 S12. Every title, source and link is invented.
const NOW = Date.parse('2026-10-30T15:00:00Z')
const MINUTE_MS = 60_000

function rssItem(title: string, o: { source?: string | null; date?: string | null; link?: string } = {}) {
  const { source = 'Diario Uno', date = 'Fri, 30 Oct 2026 09:00:46 GMT', link = 'https://news.google.com/rss/articles/a1?oc=5' } = o
  return (
    `<item><title>${title}</title><link>${link}</link><guid isPermaLink="false">a1</guid>` +
    (date ? `<pubDate>${date}</pubDate>` : '') +
    `<description>&lt;a href="${link}"&gt;x&lt;/a&gt;</description>` +
    (source ? `<source url="https://uno.example">${source}</source>` : '') +
    '</item>'
  )
}
const rss = (...items: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>"Acme" - Google Noticias</title><link>https://news.google.com/</link>${items.join('')}</channel></rss>`

const item = (title: string, lang: 'es' | 'en', publishedAt: string, source = 'Fuente'): NewsItem =>
  ({ title, link: `https://example.com/${encodeURIComponent(title)}`, source, publishedAt, lang })

describe('parseRss', () => {
  it('reads each item: the title without its " - Fuente" suffix, the link, the source and the date as ISO', () => {
    expect(parseRss(rss(rssItem('Acme sube 5% tras su balance - Diario Uno')))).toEqual([
      { title: 'Acme sube 5% tras su balance', link: 'https://news.google.com/rss/articles/a1?oc=5', source: 'Diario Uno', publishedAt: '2026-10-30T09:00:46.000Z' },
    ])
  })

  it('decodes CDATA and HTML entities in titles and sources', () => {
    const got = parseRss(rss(
      rssItem('<![CDATA[Acme & Hijos: "récord" <hoy> - Diario & Cía]]>', { source: '<![CDATA[Diario & Cía]]>' }),
      rssItem('Acme &amp; Hijos: &quot;r&#233;cord&quot; &#x201C;hoy&#x201D; &#39;ya&#39; &lt;b&gt; - Diario &amp; Cía', { source: 'Diario &amp; Cía' }),
    ))
    expect(got.map((i) => [i.title, i.source])).toEqual([
      ['Acme & Hijos: "récord" <hoy>', 'Diario & Cía'],
      ['Acme & Hijos: "récord" “hoy” \'ya\' <b>', 'Diario & Cía'],
    ])
  })

  it('without a <source>, takes the source from the title suffix', () => {
    const [got] = parseRss(rss(rssItem('Acme - la empresa que crece - Diario Dos', { source: null })))
    expect([got.title, got.source]).toEqual(['Acme - la empresa que crece', 'Diario Dos'])
  })

  it('drops an item without a date, a title or a web link, and keeps the rest', () => {
    const got = parseRss(rss(
      rssItem('Sin fecha - Diario Uno', { date: null }),
      rssItem('Fecha rota - Diario Uno', { date: 'ayer a la tarde' }),
      rssItem('', {}),
      rssItem('Script - Diario Uno', { link: 'javascript:alert(1)' }),
      rssItem('Buena - Diario Uno'),
    ))
    expect(got.map((i) => i.title)).toEqual(['Buena'])
  })

  it('answers no items for something that is not RSS', () => {
    expect(parseRss('<html><body>Error 502</body></html>')).toEqual([])
  })
})

describe('mapYahooNews', () => {
  it('maps title, link, publisher and publish time (a Date or epoch seconds) to English items', () => {
    expect(mapYahooNews([
      { uuid: '1', title: 'Acme beats estimates', publisher: 'Wire Daily', link: 'https://finance.yahoo.com/a', providerPublishTime: new Date('2026-10-30T14:24:32Z'), type: 'STORY' },
      { uuid: '2', title: 'Acme guidance', publisher: 'Street Post', link: 'https://finance.yahoo.com/b', providerPublishTime: 1793277000 },
    ])).toEqual([
      { title: 'Acme beats estimates', link: 'https://finance.yahoo.com/a', source: 'Wire Daily', publishedAt: '2026-10-30T14:24:32.000Z', lang: 'en' },
      { title: 'Acme guidance', link: 'https://finance.yahoo.com/b', source: 'Street Post', publishedAt: new Date(1793277000 * 1000).toISOString(), lang: 'en' },
    ])
  })

  it('drops entries without a title, a web link or a date, and survives a non-list', () => {
    expect(mapYahooNews([
      { title: 'No link', publisher: 'W', providerPublishTime: new Date(NOW) },
      { title: 'Bad link', publisher: 'W', link: 'javascript:alert(1)', providerPublishTime: new Date(NOW) },
      { title: 'No date', publisher: 'W', link: 'https://finance.yahoo.com/c' },
      null,
    ])).toEqual([])
    expect(mapYahooNews(undefined)).toEqual([])
  })

  it('names the source Yahoo Finance when the publisher is missing', () => {
    expect(mapYahooNews([{ title: 'T', link: 'https://finance.yahoo.com/d', providerPublishTime: new Date(NOW) }])[0].source).toBe('Yahoo Finance')
  })
})

describe('mergeNews', () => {
  it('puts Spanish first, then English, each newest first', () => {
    const got = mergeNews(
      [item('es viejo', 'es', '2026-10-20T10:00:00.000Z'), item('es nuevo', 'es', '2026-10-29T10:00:00.000Z')],
      [item('en new', 'en', '2026-10-30T12:00:00.000Z'), item('en old', 'en', '2026-10-01T10:00:00.000Z')],
    )
    expect(got.map((i) => i.title)).toEqual(['es nuevo', 'es viejo', 'en new', 'en old'])
  })

  it('de-duplicates by title, ignoring case and punctuation: keeps the Spanish copy, else the newest', () => {
    const got = mergeNews(
      [item('¿Por qué sube hoy Acme?', 'es', '2026-10-29T10:00:00.000Z', 'Uno'), item('Por qué sube hoy ACME', 'es', '2026-10-28T10:00:00.000Z', 'Dos')],
      [item('Acme: news', 'en', '2026-10-27T10:00:00.000Z', 'Old'), item('ACME news!', 'en', '2026-10-30T10:00:00.000Z', 'New'), item('¿por qué sube hoy acme?', 'en', '2026-10-30T11:00:00.000Z')],
    )
    expect(got.map((i) => [i.title, i.source])).toEqual([['¿Por qué sube hoy Acme?', 'Uno'], ['ACME news!', 'New']])
  })

  it('keeps 20 items, 5 of them English when there are that many', () => {
    const es = Array.from({ length: 30 }, (_, i) => item(`es ${i}`, 'es', new Date(NOW - i * MINUTE_MS).toISOString()))
    const en = Array.from({ length: 10 }, (_, i) => item(`en ${i}`, 'en', new Date(NOW - i * MINUTE_MS).toISOString()))
    const got = mergeNews(es, en)
    expect(got).toHaveLength(20)
    expect(got.slice(0, 15).map((i) => i.title)).toEqual(es.slice(0, 15).map((i) => i.title))
    expect(got.slice(15).map((i) => i.title)).toEqual(en.slice(0, 5).map((i) => i.title))
    // Few Spanish items leave the room to English.
    expect(mergeNews(es.slice(0, 3), en).map((i) => i.lang)).toEqual([...Array(3).fill('es'), ...Array(10).fill('en')])
  })
})

/** An in-memory Redis: every write is recorded with its TTL. */
function fakeCache() {
  const store = new Map<string, string>()
  const writes: { key: string; ttl: number }[] = []
  return {
    store,
    writes,
    get: vi.fn(async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : null)),
    set: vi.fn(async (key: string, value: unknown, ttl: number) => {
      store.set(key, JSON.stringify(value))
      writes.push({ key, ttl })
    }),
  }
}

const IDENTITY: Record<string, { yahooSymbol: string; name: string }> = {
  ACME: { yahooSymbol: 'ACME', name: 'Acme Holdings, Inc.' },
  'BCBA:ACMA': { yahooSymbol: 'ACMA.BA', name: 'Acmé Argentina S.A.' },
  TSM: { yahooSymbol: 'TSM', name: 'Taiwan Semiconductor Manufacturing Company Limited' },
  'BCBA:YPEF': { yahooSymbol: 'YPEF.BA', name: 'Ypefe Sociedad Anónima' },
  'BCBA:ALUM': { yahooSymbol: 'ALUM.BA', name: 'Alumi Argentino S.A.I.C.' },
  'BTC-USD': { yahooSymbol: 'BTC-USD', name: 'Bitcoin USD' },
}
const YAHOO_NEWS = [{ title: 'Acme beats estimates', publisher: 'Wire Daily', link: 'https://finance.yahoo.com/a', providerPublishTime: new Date('2026-10-30T14:00:00Z') }]

function fakes() {
  const cache = fakeCache()
  let now = NOW
  const search = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ news: YAHOO_NEWS }))
  const deps = {
    resolveIdentity: vi.fn(async (t: string) =>
      IDENTITY[t]
        ? { found: true as const, identity: { ticker: t, exchange: null, price: 1, ...IDENTITY[t] } }
        : { found: false as const, reason: 'not-found' as const }),
    fetch: vi.fn(async (_url: string, _init?: RequestInit) => new Response(rss(rssItem('Acme crece - Diario Uno')), { status: 200 })),
    getYahoo: vi.fn(async () => ({ search })),
    cache: { get: cache.get, set: cache.set },
    memoryShare: vi.fn(async (): Promise<number | null> => 0.1),
    now: () => now,
  }
  return { deps, cache, search, later: (ms: number) => { now += ms } }
}
const run = (t: string, deps: ReturnType<typeof fakes>['deps']) => getAssetNews(t, deps as unknown as NewsDeps)

describe('getAssetNews', () => {
  it('asks Google News es-419/AR for the quoted short name and Yahoo for the symbol, and merges both', async () => {
    const { deps, search } = fakes()
    const got = await run('acme', deps)

    const url = new URL(deps.fetch.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe('https://news.google.com/rss/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: '"Acme"', hl: 'es-419', gl: 'AR', ceid: 'AR:es-419' })
    expect(deps.fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
    expect(search).toHaveBeenCalledWith('ACME', { quotesCount: 0, newsCount: 10 }, expect.objectContaining({ validateResult: false }))
    expect(got).toEqual({
      items: [
        { title: 'Acme crece', link: 'https://news.google.com/rss/articles/a1?oc=5', source: 'Diario Uno', publishedAt: '2026-10-30T09:00:46.000Z', lang: 'es' },
        { title: 'Acme beats estimates', link: 'https://finance.yahoo.com/a', source: 'Wire Daily', publishedAt: '2026-10-30T14:00:00.000Z', lang: 'en' },
      ],
      sources: { es: 'ok', en: 'ok' },
    })
  })

  it('asks Yahoo for a BYMA listing by the company name without accents: it files no news under .BA symbols', async () => {
    const { deps, search } = fakes()
    await run('BCBA:ACMA', deps)
    expect(search.mock.calls[0][0]).toBe('Acme Argentina')
    expect(new URL(deps.fetch.mock.calls[0][0]).searchParams.get('q')).toBe('"Acmé Argentina"')
  })

  it('searches the name the press uses: without a legal form such as "Sociedad Anónima" or "S.A.I.C."', async () => {
    const { deps, search } = fakes()
    await run('BCBA:YPEF', deps)
    await run('BCBA:ALUM', deps)
    expect(deps.fetch.mock.calls.map(([u]) => new URL(u).searchParams.get('q'))).toEqual(['"Ypefe"', '"Alumi Argentino"'])
    expect(search.mock.calls.map(([q]) => q)).toEqual(['Ypefe', 'Alumi Argentino'])
  })

  it('searches a coin by its own name, without the quote currency Yahoo appends (T10)', async () => {
    const { deps, search } = fakes()
    deps.fetch.mockResolvedValue(new Response(rss(rssItem('Sube el USD en Rosario - Diario Uno'), rssItem('Cae el bitcoin - Diario Uno')), { status: 200 }))
    const got = await run('BTCUSDT', deps)
    expect(new URL(deps.fetch.mock.calls[0][0]).searchParams.get('q')).toBe('"Bitcoin"')
    expect(search.mock.calls[0][0]).toBe('BTC-USD')
    // "USD" alone does not name the coin.
    expect(got.items.filter((i) => i.lang === 'es').map((i) => i.title)).toEqual(['Cae el bitcoin'])
  })

  it('keeps only headlines that name the company: a word of its name, spaces and accents aside, or a word starting with its symbol', async () => {
    const { deps, search } = fakes()
    deps.fetch.mockResolvedValue(new Response(rss(
      rssItem('La nena que juega al fútbol - Spam'),
      rssItem('TSMC gana más que nunca - Diario Uno'),
      rssItem('Las acciones de Taiwán Semiconductor suben - Diario Dos', { source: 'Diario Dos' }),
    )))
    search.mockResolvedValue({ news: [
      { title: 'Cathie Wood buys more chips', publisher: 'W', link: 'https://finance.yahoo.com/x', providerPublishTime: new Date(NOW) },
      { title: 'TSM: record quarter', publisher: 'W', link: 'https://finance.yahoo.com/y', providerPublishTime: new Date(NOW) },
    ] })
    const got = await run('TSM', deps)
    expect(got.items.map((i) => i.title)).toEqual(['TSMC gana más que nunca', 'Las acciones de Taiwán Semiconductor suben', 'TSM: record quarter'])
  })

  it('drops the quote pages Google indexes as Spanish news, by their shape; keeps real articles and English ones', async () => {
    const { deps, search } = fakes()
    const page = (title: string, source: string) => rssItem(`${title} - ${source}`, { source })
    deps.fetch.mockResolvedValue(new Response(rss(
      page('Gráfico de rentabilidades estacionales de Acme Inc. (ACME)', 'Yahoo'),
      page('Gráfico de acciones interactivo de Acme Inc.(7203.T)', 'Yahoo'),
      page('Deuda total de Acme Class B – BCBA:ACMA', 'TradingView'),
      page('Previsión de ACME: precio objetivo 2027, TV', 'TradingView'),
      page('Precio de Acme Inc (Derivative) hoy', 'Binance'),
      page('Acme lanza su tablet (2026) con más batería', 'Diario Uno'),
      page('Acme vuelve a la deuda global con bonos a 2036', 'Yahoo Finanzas'),
    )))
    search.mockResolvedValue({ news: [{ title: 'Acme Inc. (ACME) is trending', publisher: 'W', link: 'https://finance.yahoo.com/z', providerPublishTime: new Date(NOW) }] })
    const got = await run('ACME', deps)
    expect(got.items.map((i) => i.title)).toEqual(['Acme lanza su tablet (2026) con más batería', 'Acme vuelve a la deuda global con bonos a 2036', 'Acme Inc. (ACME) is trending'])
  })

  it('caches only the newest 20 headlines per source', async () => {
    const { deps, cache } = fakes()
    const days = Array.from({ length: 30 }, (_, i) => new Date(NOW - i * 3_600_000).toUTCString())
    deps.fetch.mockResolvedValue(new Response(rss(...days.map((date, i) => rssItem(`Acme noticia ${i} - Diario Uno`, { date })))))
    await run('ACME', deps)
    const copy = JSON.parse(cache.store.get('fund:v1:news:ACME:es')!).value as NewsItem[]
    expect(copy.map((i) => i.title)).toEqual(Array.from({ length: 20 }, (_, i) => `Acme noticia ${i}`))
  })

  it('answers with the other source when one fails (thrown, HTTP error or Yahoo error)', async () => {
    const down = fakes()
    down.deps.fetch.mockRejectedValue(new Error('timeout'))
    expect(await run('ACME', down.deps)).toMatchObject({ items: [{ lang: 'en' }], sources: { es: 'error', en: 'ok' } })

    const http = fakes()
    http.deps.fetch.mockResolvedValue(new Response('busy', { status: 503 }))
    expect((await run('ACME', http.deps)).sources).toEqual({ es: 'error', en: 'ok' })

    const yahoo = fakes()
    yahoo.search.mockRejectedValue(new Error('HTTP 429'))
    expect(await run('ACME', yahoo.deps)).toMatchObject({ items: [{ lang: 'es' }], sources: { es: 'ok', en: 'error' } })
  })

  it('caches each source for a day under fund:v1:news:<ticker>:<lang> and serves it fresh for 30 minutes', async () => {
    const { deps, cache, search, later } = fakes()
    const first = await run('ACME', deps)
    expect(cache.writes).toEqual([{ key: 'fund:v1:news:ACME:es', ttl: 86_400 }, { key: 'fund:v1:news:ACME:en', ttl: 86_400 }])

    later(29 * MINUTE_MS)
    expect(await run('ACME', deps)).toEqual(first)
    expect(deps.fetch).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledTimes(1)

    later(2 * MINUTE_MS)
    await run('ACME', deps)
    expect(deps.fetch).toHaveBeenCalledTimes(2)
  })

  it('after 30 minutes, a failing source serves its last copy as stale and is not asked again for 5 minutes', async () => {
    const { deps, cache, later } = fakes()
    const first = await run('ACME', deps)
    later(31 * MINUTE_MS)
    deps.fetch.mockRejectedValue(new Error('timeout'))

    const stale = await run('ACME', deps)
    expect(stale).toEqual({ items: first.items, sources: { es: 'stale', en: 'ok' } })
    expect(cache.writes.filter((w) => w.key.startsWith('fund:v1:failed:'))).toEqual([{ key: 'fund:v1:failed:news:ACME:es', ttl: 300 }])

    later(MINUTE_MS)
    expect((await run('ACME', deps)).sources.es).toBe('stale')
    expect(deps.fetch).toHaveBeenCalledTimes(2)
  })

  it('writes no news copy while Redis is at half its memory or more, and still answers', async () => {
    const { deps, cache } = fakes()
    deps.memoryShare.mockResolvedValue(0.5)
    expect((await run('ACME', deps)).items).toHaveLength(2)
    expect(cache.writes.filter((w) => w.key.startsWith('fund:v1:news:'))).toEqual([])
  })

  it('refuses a bad ticker before anything, and an unknown one before any source or write', async () => {
    const { deps, cache } = fakes()
    await expect(run('ACME; DROP', deps)).rejects.toEqual(new AssetError('invalid'))
    expect(deps.resolveIdentity).not.toHaveBeenCalled()

    await expect(run('ZZZZQ', deps)).rejects.toEqual(new AssetError('not_found'))
    expect(deps.fetch).not.toHaveBeenCalled()
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.writes).toEqual([])
  })
})
