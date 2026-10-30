// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  resolveTvSymbol,
  fetchTvSnapshot,
  fetchTvSnapshots,
  findBymaListing,
  fetchTvHistory,
  fetchTvPeers,
  TV_SNAPSHOT_FIELDS,
} from '../tradingview'
import { FundamentalsSourceError } from '../types'
import meliSnapshot from './fixtures/tradingview-snapshot-meli.json'
import history from './fixtures/tradingview-history.json'

type FakeRow = { s: string } & Record<string, unknown>

/**
 * A fake scanner: answers each call with `rowsFor(call)` laid out in the columns the
 * request asked for, as the real scanner does. A `symbols` request only gets its tickers.
 */
function scanner(...rowsPerCall: FakeRow[][]) {
  let call = 0
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    const rows = (rowsPerCall[call++] ?? []).filter(
      (r) => !body.symbols || body.symbols.tickers.includes(r.s),
    )
    const data = rows.map((r) => ({ s: r.s, d: body.columns.map((c: string) => r[c] ?? null) }))
    return new Response(JSON.stringify({ totalCount: data.length, data }), { status: 200 })
  })
}

const sent = (f: ReturnType<typeof scanner>, i = 0) => {
  const [url, init] = f.mock.calls[i]
  return { url, init: init!, body: JSON.parse(String(init!.body)) }
}

const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => e as FundamentalsSourceError,
  )

describe('resolveTvSymbol', () => {
  it('maps argentina tickers to their BCBA listing without asking the network', async () => {
    const f = scanner()
    expect(await resolveTvSymbol('ggal', 'argentina', f)).toBe('BCBA:GGAL')
    expect(await resolveTvSymbol('BCBA:YPFD', 'argentina', f)).toBe('BCBA:YPFD')
    expect(f).not.toHaveBeenCalled()
  })

  it('asks america for the non-OTC listings of that name, largest first, with browser headers', async () => {
    const f = scanner([{ s: 'NYSE:TSM' }, { s: 'NASDAQ:TSM' }])

    expect(await resolveTvSymbol(' tsm ', 'america', f)).toBe('NYSE:TSM')

    const { url, init, body } = sent(f)
    expect(url).toBe('https://scanner.tradingview.com/america/scan')
    expect(init.method).toBe('POST')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Origin: 'https://www.tradingview.com',
      Referer: 'https://www.tradingview.com/',
      'User-Agent': expect.stringContaining('Mozilla/5.0'),
    })
    expect(body.filter).toEqual([
      { left: 'name', operation: 'equal', right: 'TSM' },
      { left: 'exchange', operation: 'not_in_range', right: ['OTC'] },
    ])
    expect(body.sort).toEqual({ sortBy: 'market_cap_basic', sortOrder: 'desc' })
  })

  it('returns null when america has no non-OTC listing', async () => {
    expect(await resolveTvSymbol('TCEHY', 'america', scanner([]))).toBeNull()
  })
})

describe('fetchTvSnapshot', () => {
  it("reads today's catalog values for one symbol, unreadable values as null", async () => {
    const f = scanner([{ ...meliSnapshot, beta_5_year: 'n/a', price_target_average: null, change: -0.7746, change_abs: -12.96 }])

    const snap = await fetchTvSnapshot('NASDAQ:MELI', 'america', f)

    const { url, body } = sent(f)
    expect(url).toBe('https://scanner.tradingview.com/america/scan')
    expect(body.symbols).toEqual({ tickers: ['NASDAQ:MELI'] })
    expect(body.columns).toEqual(expect.arrayContaining([...TV_SNAPSHOT_FIELDS, 'description', 'close', 'change', 'change_abs']))
    expect(snap).toMatchObject({
      tvSymbol: 'NASDAQ:MELI',
      name: 'MercadoLibre, Inc.',
      sector: 'Retail Trade',
      industry: 'Internet Retail',
      currency: 'USD',
      fundamentalCurrency: 'USD',
      close: 1660.13,
      // Verified live 2026-10-30: `change` is the day's percent, `change_abs` the amount.
      changePct: -0.7746,
      changeAbs: -12.96,
      marketCap: 84163279217.00002,
    })
    expect(Object.keys(snap.fields).sort()).toEqual([...TV_SNAPSHOT_FIELDS].sort())
    expect(snap.fields.total_shares_outstanding).toBe(50696800)
    expect(snap.fields.number_of_employees).toBe(123670)
    expect(snap.fields.beta_5_year).toBeNull()
    expect(snap.fields.price_target_average).toBeNull()
  })

  it('throws not_found when the symbol is absent from the answer', async () => {
    const err = await errorOf(fetchTvSnapshot('NASDAQ:ZZZZQ', 'america', scanner([])))
    expect(err).toBeInstanceOf(FundamentalsSourceError)
    expect(err).toMatchObject({ source: 'tradingview', code: 'not_found' })
  })

  it('reads the company id, listing type and country that pick the BYMA listing of an ADR', async () => {
    const f = scanner([{ ...meliSnapshot, s: 'NASDAQ:GGAL', logoid: 'gpo-fin-galicia', type: 'dr', country: 'Argentina' }])
    const snap = await fetchTvSnapshot('NASDAQ:GGAL', 'america', f)
    expect(snap).toMatchObject({ logoid: 'gpo-fin-galicia', type: 'dr', country: 'Argentina' })
  })
})

describe('fetchTvSnapshots', () => {
  it('reads many symbols of one market in one request, leaving out the unknown ones', async () => {
    const f = scanner([meliSnapshot, { ...meliSnapshot, s: 'NASDAQ:AMZN', description: 'Amazon.com, Inc.' }])

    const snaps = await fetchTvSnapshots(['NASDAQ:MELI', 'NASDAQ:AMZN', 'NASDAQ:ZZZZQ'], 'america', f)

    expect(f).toHaveBeenCalledTimes(1)
    expect(sent(f).body.symbols).toEqual({ tickers: ['NASDAQ:MELI', 'NASDAQ:AMZN', 'NASDAQ:ZZZZQ'] })
    expect([...snaps.keys()]).toEqual(['NASDAQ:MELI', 'NASDAQ:AMZN'])
    expect(snaps.get('NASDAQ:AMZN')!.name).toBe('Amazon.com, Inc.')
    expect(snaps.get('NASDAQ:MELI')).toEqual(await fetchTvSnapshot('NASDAQ:MELI', 'america', scanner([meliSnapshot])))
  })

  it('never sends an empty ticker list', async () => {
    const f = scanner()
    expect((await fetchTvSnapshots([], 'america', f)).size).toBe(0)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('findBymaListing', () => {
  it("asks argentina for the company's local stock listings and picks the plain one", async () => {
    // Live 2026-10-30: logoid `ypf` on BYMA is YPFDB, YPFD, YPFD.CI, YPFDD, YPFDC (all type stock).
    const f = scanner([
      { s: 'BCBA:YPFDB', logoid: 'ypf' },
      { s: 'BCBA:YPFD', logoid: 'ypf' },
      { s: 'BCBA:YPFD.CI', logoid: 'ypf' },
    ])

    expect(await findBymaListing('ypf', f)).toBe('BCBA:YPFD')

    const { url, body } = sent(f)
    expect(url).toBe('https://scanner.tradingview.com/argentina/scan')
    expect(body.filter).toEqual([
      { left: 'logoid', operation: 'equal', right: 'ypf' },
      { left: 'type', operation: 'equal', right: 'stock' },
    ])
  })

  it('returns null when the company has no local stock on BYMA (MELI is only a CEDEAR there)', async () => {
    expect(await findBymaListing('mercadolibre', scanner([]))).toBeNull()
  })
})

describe('fetchTvHistory', () => {
  it('asks once for many symbols and dates quarters back from the latest quarter end, oldest first', async () => {
    const f = scanner(history)

    const result = await fetchTvHistory(['NASDAQ:MELI', 'NASDAQ:MSFT', 'NASDAQ:NVDA'], 'america', f)

    expect(f).toHaveBeenCalledTimes(1)
    expect(sent(f).body.symbols.tickers).toEqual(['NASDAQ:MELI', 'NASDAQ:MSFT', 'NASDAQ:NVDA'])
    const meli = result.get('NASDAQ:MELI')!
    expect(meli.currency).toBe('USD')
    // fiscal_period_end_fq = 2026-06-30; MELI's four 2025 quarters add up to its 2025 annual revenue.
    expect(meli.quarterly.revenue).toEqual([
      { end: '2025-03-31', value: 5935000000.00006 },
      { end: '2025-06-30', value: 6790000000 },
      { end: '2025-09-30', value: 7409000000 },
      { end: '2025-12-31', value: 8759000000 },
      { end: '2026-03-31', value: 8845000000 },
      { end: '2026-06-30', value: 10169000000 },
    ])
    const sum2025 = meli.quarterly.revenue.slice(0, 4).reduce((s, p) => s + p.value, 0)
    expect(sum2025).toBeCloseTo(meli.annual.revenue.at(-1)!.value, -3)
    expect(Object.keys(meli.quarterly).sort()).toEqual(
      ['ebitda', 'epsDiluted', 'freeCashFlow', 'grossProfit', 'netIncome', 'revenue', 'totalAssets', 'totalDebt'],
    )
    expect(meli.quarterly.epsDiluted.at(-1)!.end).toBe('2026-06-30')
  })

  it('dates years from their labels and the fiscal-year-end month, also when the FY is not December', async () => {
    const result = await fetchTvHistory(['NASDAQ:MELI', 'NASDAQ:MSFT', 'NASDAQ:NVDA'], 'america', scanner(history))

    expect(result.get('NASDAQ:MELI')!.annual.revenue.map((p) => p.end)).toEqual(['2023-12-31', '2024-12-31', '2025-12-31'])
    // MSFT: FY ends in June and TradingView labels it by its end year.
    expect(result.get('NASDAQ:MSFT')!.annual.revenue).toEqual([
      { end: '2024-06-30', value: 245122000000 },
      { end: '2025-06-30', value: 281724000000 },
      { end: '2026-06-30', value: 331839000000 },
    ])
    // NVDA: FY ends in January and TradingView labels it by its start year (2025 → Jan 2026).
    expect(result.get('NASDAQ:NVDA')!.annual.revenue.map((p) => p.end)).toEqual(['2024-01-31', '2025-01-31', '2026-01-31'])
    // Its four quarters to Jan 2026 add up to that year.
    const nvda = result.get('NASDAQ:NVDA')!
    const fy = nvda.quarterly.revenue.filter((p) => p.end > '2025-01-31' && p.end <= '2026-01-31')
    expect(fy.map((p) => p.end)).toEqual(['2025-04-30', '2025-07-31', '2025-10-31', '2026-01-31'])
    expect(fy.reduce((s, p) => s + p.value, 0)).toBe(nvda.annual.revenue.at(-1)!.value)
  })

  it('drops nulls, skips a year whose label is missing, and leaves undatable lines empty', async () => {
    const row: FakeRow = {
      s: 'BCBA:YPFD',
      fundamental_currency_code: 'ARS',
      fiscal_period_end_fq: Date.UTC(2026, 5, 30) / 1000,
      fiscal_period_end_fy: Date.UTC(2025, 11, 31) / 1000,
      fiscal_period_fy_h: [2025, 2023, null],
      total_revenue_fq_h: [30, null, 10],
      total_revenue_fy_h: [3, 2, 1],
      net_income_fy_h: 'garbage',
    }
    const ypfd = (await fetchTvHistory(['BCBA:YPFD', 'BCBA:NONE'], 'argentina', scanner([row]))).get('BCBA:YPFD')!

    expect(ypfd.currency).toBe('ARS')
    expect(ypfd.quarterly.revenue).toEqual([
      { end: '2025-12-31', value: 10 },
      { end: '2026-06-30', value: 30 },
    ])
    expect(ypfd.annual.revenue).toEqual([
      { end: '2023-12-31', value: 2 },
      { end: '2025-12-31', value: 3 },
    ])
    expect(ypfd.annual.netIncome).toEqual([])
    expect(ypfd.quarterly.totalDebt).toEqual([])
  })

  it('leaves quarters empty when the latest quarter end is unknown', async () => {
    const row: FakeRow = { s: 'NASDAQ:X', total_revenue_fq_h: [1, 2] }
    const x = (await fetchTvHistory(['NASDAQ:X'], 'america', scanner([row]))).get('NASDAQ:X')!
    expect(x.quarterly.revenue).toEqual([])
  })

  it('leaves a missing symbol out of the batch, and throws not_found when none is there', async () => {
    const result = await fetchTvHistory(['NASDAQ:MELI', 'NASDAQ:ZZZZQ'], 'america', scanner(history))
    expect([...result.keys()]).toEqual(['NASDAQ:MELI'])

    const err = await errorOf(fetchTvHistory(['NASDAQ:ZZZZQ'], 'america', scanner([])))
    expect(err).toMatchObject({ source: 'tradingview', code: 'not_found' })
  })

  it('never sends an empty ticker list (the scanner would answer the whole market)', async () => {
    const f = scanner()
    expect((await fetchTvHistory([], 'america', f)).size).toBe(0)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('fetchTvPeers', () => {
  const industry = 'Internet Software/Services'

  it('lists same-industry companies by market cap, without itself, OTC or a second listing of one company', async () => {
    const f = scanner(
      [{ s: 'NASDAQ:GOOGL', industry, logoid: 'alphabet' }],
      [
        { s: 'NASDAQ:GOOG', logoid: 'alphabet' },
        { s: 'NASDAQ:META', logoid: 'meta-platforms' },
        { s: 'NYSE:BRK.B', logoid: 'berkshire' },
        { s: 'NYSE:BRK.A', logoid: 'berkshire' },
        { s: 'NASDAQ:BIDU', logoid: '' },
        { s: 'NASDAQ:PDD', logoid: null },
        { s: 'NYSE:SPOT', logoid: 'spotify' },
      ],
    )

    const peers = await fetchTvPeers('NASDAQ:GOOGL', 'america', 4, f)

    expect(peers).toEqual([
      { tvSymbol: 'NASDAQ:META', market: 'america' },
      { tvSymbol: 'NYSE:BRK.B', market: 'america' },
      { tvSymbol: 'NASDAQ:BIDU', market: 'america' },
      { tvSymbol: 'NASDAQ:PDD', market: 'america' },
    ])
    expect(sent(f, 0).body.symbols.tickers).toEqual(['NASDAQ:GOOGL'])
    const { url, body } = sent(f, 1)
    expect(url).toBe('https://scanner.tradingview.com/america/scan')
    expect(body.filter).toEqual([
      { left: 'industry', operation: 'equal', right: industry },
      { left: 'exchange', operation: 'not_in_range', right: ['OTC'] },
    ])
    expect(body.sort).toEqual({ sortBy: 'market_cap_basic', sortOrder: 'desc' })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('defaults to 5 peers', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ s: `NYSE:P${i}`, logoid: `p${i}` }))
    const f = scanner([{ s: 'NYSE:X', industry, logoid: 'x' }], rows)
    expect(await fetchTvPeers('NYSE:X', 'america', undefined, f)).toHaveLength(5)
  })

  it('in argentina keeps local stocks only, one listing per company, and fills from america under 3', async () => {
    const f = scanner(
      [{ s: 'BCBA:YPFD', industry: 'Integrated Oil', logoid: 'ypf' }],
      [
        { s: 'BCBA:YPFD.CI', logoid: 'ypf' },
        { s: 'BCBA:PAMP.CI', logoid: 'pampa' },
        { s: 'BCBA:PAMPB', logoid: 'pampa' },
        { s: 'BCBA:PAMP', logoid: 'pampa' },
      ],
      [
        { s: 'NYSE:XOM', logoid: 'exxon' },
        { s: 'NYSE:YPF', logoid: 'ypf' },
        { s: 'NYSE:CVX', logoid: 'chevron' },
        { s: 'NYSE:SHEL', logoid: 'shell' },
        { s: 'NYSE:PAM', logoid: 'pampa' },
        { s: 'NYSE:TTE', logoid: 'total' },
        { s: 'NYSE:BP', logoid: 'bp' },
      ],
    )

    const peers = await fetchTvPeers('BCBA:YPFD', 'argentina', 5, f)

    expect(peers).toEqual([
      { tvSymbol: 'BCBA:PAMP', market: 'argentina' },
      { tvSymbol: 'NYSE:XOM', market: 'america' },
      { tvSymbol: 'NYSE:CVX', market: 'america' },
      { tvSymbol: 'NYSE:SHEL', market: 'america' },
      { tvSymbol: 'NYSE:TTE', market: 'america' },
    ])
    const local = sent(f, 1)
    expect(local.url).toBe('https://scanner.tradingview.com/argentina/scan')
    // CEDEARs and other DRs are type `dr` on BYMA; local companies are `stock`.
    expect(local.body.filter).toEqual([
      { left: 'industry', operation: 'equal', right: 'Integrated Oil' },
      { left: 'type', operation: 'equal', right: 'stock' },
    ])
    const fill = sent(f, 2)
    expect(fill.url).toBe('https://scanner.tradingview.com/america/scan')
    expect(fill.body.filter).toEqual([
      { left: 'industry', operation: 'equal', right: 'Integrated Oil' },
      { left: 'exchange', operation: 'not_in_range', right: ['OTC'] },
    ])
  })

  it('does not fill from america when argentina has 3 or more', async () => {
    const rows = ['A', 'B', 'C'].map((n) => ({ s: `BCBA:${n}`, logoid: n }))
    const f = scanner([{ s: 'BCBA:X', industry: 'Major Banks', logoid: 'x' }], rows)
    expect(await fetchTvPeers('BCBA:X', 'argentina', 5, f)).toHaveLength(3)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('returns no peers when the company has no industry, and not_found when it is unknown', async () => {
    expect(await fetchTvPeers('AMEX:SPY', 'america', 5, scanner([{ s: 'AMEX:SPY', logoid: 'spdr' }]))).toEqual([])
    const err = await errorOf(fetchTvPeers('NASDAQ:ZZZZQ', 'america', 5, scanner([])))
    expect(err).toMatchObject({ source: 'tradingview', code: 'not_found' })
  })
})

describe('errors', () => {
  const run = (f: typeof fetch) => fetchTvSnapshot('NASDAQ:MELI', 'america', f)
  const respond = (body: string, status = 200) => vi.fn(async () => new Response(body, { status }))

  it('throws unavailable on a network failure or timeout', async () => {
    const f = vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    expect(await errorOf(run(f))).toMatchObject({ source: 'tradingview', code: 'unavailable' })
  })

  it('throws unavailable on a non-2xx answer', async () => {
    expect(await errorOf(run(respond('{"error":"x"}', 429)))).toMatchObject({ code: 'unavailable' })
  })

  it('throws bad_shape when the answer is not { data: [{ s, d: [...] }] } with one value per column', async () => {
    for (const body of ['<html>', '{}', '{"data":{}}', '{"data":[{"s":"NASDAQ:MELI"}]}', '{"data":[{"s":"NASDAQ:MELI","d":[1]}]}']) {
      expect(await errorOf(run(respond(body)))).toMatchObject({ source: 'tradingview', code: 'bad_shape' })
    }
  })
})
