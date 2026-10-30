/**
 * TradingView scanner source for the asset page (odd/tasks/asset-page.md, T1).
 *
 * `POST scanner.tradingview.com/{market}/scan` is public, keyless and unofficial:
 * every answer is parsed defensively. No caching here — the service layer owns it.
 */
import { FundamentalsSourceError, type Market, type Series } from './types'

const TIMEOUT_MS = 10_000

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Content-Type': 'application/json',
  Origin: 'https://www.tradingview.com',
  Referer: 'https://www.tradingview.com/',
}

const NOT_OTC = { left: 'exchange', operation: 'not_in_range', right: ['OTC'] }
// On BYMA, CEDEARs and other foreign receipts are type `dr`; local companies are `stock`.
const LOCAL_STOCKS = { left: 'type', operation: 'equal', right: 'stock' }
const BY_MARKET_CAP = { sortBy: 'market_cap_basic', sortOrder: 'desc' }
// ponytail: one page of an industry; enough unless >50 listings precede the 5th distinct company.
const PEER_SCAN_RANGE = [0, 50]

/** Today's catalog values. Verified live 2026-10-30 on NASDAQ:MELI and BCBA:YPFD. */
export const TV_SNAPSHOT_FIELDS = [
  'total_shares_outstanding', 'float_shares_outstanding', 'number_of_employees',
  'price_earnings_ttm', 'price_revenue_ttm', 'price_sales_current', 'price_cash_flow_current',
  'price_free_cash_flow_ttm', 'price_book_fq', 'enterprise_value_current', 'enterprise_value_ebitda_ttm',
  'enterprise_value_to_revenue_ttm', 'enterprise_value_to_ebit_ttm', 'price_earnings_fwd', 'price_sales_fwd',
  'price_book_fwd', 'enterprise_value_ebitda_fwd', 'return_on_assets', 'return_on_equity',
  'return_on_invested_capital', 'gross_margin', 'operating_margin', 'ebitda_margin_ttm', 'net_margin',
  'quick_ratio', 'current_ratio', 'invent_turnover_current', 'asset_turnover_current', 'debt_to_asset_fq',
  'debt_to_equity', 'long_term_debt_to_assets_fq', 'long_term_debt_to_equity_fq', 'revenue_per_share_ttm',
  'operating_cash_flow_per_share_ttm', 'free_cash_flow_per_share_ttm', 'ebit_per_share_ttm',
  'ebitda_per_share_ttm', 'book_value_per_share_fq', 'total_debt_per_share_fq', 'cash_per_share_fq',
  'book_tangible_per_share_fq', 'working_capital_per_share_fq', 'capex_per_share_ttm',
  'earnings_per_share_forecast_next_fy', 'revenue_forecast_next_fy', 'revenue_forecast_fq',
  'price_target_average', 'beta_1_year', 'beta_5_year', 'net_debt_fq', 'cash_n_short_term_invest_fq',
  'total_equity_fq', 'total_liabilities_fq', 'oper_income_ttm', 'research_and_dev_ratio_ttm',
  'dividend_payout_ratio_ttm',
  'earnings_release_next_date', // unix seconds
] as const

export type TvSnapshotField = (typeof TV_SNAPSHOT_FIELDS)[number]

export interface TvSnapshot {
  tvSymbol: string
  name: string | null
  sector: string | null
  industry: string | null
  /** Currency of `close`. */
  currency: string | null
  /** Currency of the statements behind the fields. */
  fundamentalCurrency: string | null
  close: number | null
  marketCap: number | null
  /** The company: shared by its listings (NYSE:YPF and BCBA:YPFD are both `ypf`). */
  logoid: string | null
  /** `stock`, or `dr` for an ADR or a CEDEAR. */
  type: string | null
  country: string | null
  fields: Record<TvSnapshotField, number | null>
}

/** The eight lines TradingView keeps history for: `<field>_fq_h` (32 quarters) and `<field>_fy_h` (20 years). */
const HISTORY_LINES = {
  revenue: 'total_revenue',
  netIncome: 'net_income',
  grossProfit: 'gross_profit',
  ebitda: 'ebitda',
  totalAssets: 'total_assets',
  totalDebt: 'total_debt',
  freeCashFlow: 'free_cash_flow',
  epsDiluted: 'earnings_per_share_diluted',
} as const

export type TvHistoryLine = keyof typeof HISTORY_LINES

export interface TvHistory {
  /** `fundamental_currency_code`: the currency every value below is in. */
  currency: string | null
  quarterly: Record<TvHistoryLine, Series>
  annual: Record<TvHistoryLine, Series>
}

export interface TvPeer {
  tvSymbol: string
  market: Market
}

interface Row {
  s: string
  v: Record<string, unknown>
}

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const str = (x: unknown) => (typeof x === 'string' && x !== '' ? x : null)
const fail = (code: FundamentalsSourceError['code'], message: string) =>
  new FundamentalsSourceError('tradingview', code, message)

async function scan(market: Market, columns: string[], query: object, fetchImpl: typeof fetch): Promise<Row[]> {
  let res: Response
  try {
    res = await fetchImpl(`https://scanner.tradingview.com/${market}/scan`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ ...query, columns }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw fail('unavailable', err instanceof Error ? err.message : String(err))
  }
  if (!res.ok) throw fail('unavailable', `HTTP ${res.status}`)

  const data = await res.json().then((j) => j?.data, () => undefined)
  // A row with a different number of values than columns would shift every value onto the wrong field.
  const ok =
    Array.isArray(data) &&
    data.every((r) => typeof r?.s === 'string' && Array.isArray(r.d) && r.d.length === columns.length)
  if (!ok) throw fail('bad_shape', `unexpected ${market} scan answer`)
  return data.map((r: { s: string; d: unknown[] }) => ({
    s: r.s,
    v: Object.fromEntries(columns.map((c, i) => [c, r.d[i]])),
  }))
}

/**
 * The TradingView symbol of an app ticker: BYMA listings are `BCBA:<TICKER>`; in america,
 * the largest non-OTC listing with that exact name, or null when there is none.
 */
export async function resolveTvSymbol(
  ticker: string,
  market: Market,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const name = ticker.trim().toUpperCase().replace(/^BCBA:/, '')
  if (market === 'argentina') return `BCBA:${name}`
  const rows = await scan(
    'america',
    ['market_cap_basic'],
    { filter: [{ left: 'name', operation: 'equal', right: name }, NOT_OTC], sort: BY_MARKET_CAP, range: [0, 10] },
    fetchImpl,
  )
  return rows[0]?.s ?? null
}

/** Today's values for many symbols of one market in one request, keyed by symbol; unknown ones are left out. */
export async function fetchTvSnapshots(
  tvSymbols: string[],
  market: Market,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, TvSnapshot>> {
  // An empty ticker list would make the scanner answer the whole market.
  if (tvSymbols.length === 0) return new Map()
  const meta = [
    'description', 'sector', 'industry', 'currency', 'fundamental_currency_code', 'close', 'market_cap_basic',
    'logoid', 'type', 'country',
  ]
  const rows = await scan(market, [...meta, ...TV_SNAPSHOT_FIELDS], { symbols: { tickers: tvSymbols } }, fetchImpl)
  return new Map(
    rows
      .filter((r) => tvSymbols.includes(r.s))
      .map(({ s, v }): [string, TvSnapshot] => [
        s,
        {
          tvSymbol: s,
          name: str(v.description),
          sector: str(v.sector),
          industry: str(v.industry),
          currency: str(v.currency),
          fundamentalCurrency: str(v.fundamental_currency_code),
          close: num(v.close),
          marketCap: num(v.market_cap_basic),
          logoid: str(v.logoid),
          type: str(v.type),
          country: str(v.country),
          fields: Object.fromEntries(TV_SNAPSHOT_FIELDS.map((f) => [f, num(v[f])])) as TvSnapshot['fields'],
        },
      ]),
  )
}

/** Today's values for one symbol. Throws `not_found` when TradingView does not know it. */
export async function fetchTvSnapshot(
  tvSymbol: string,
  market: Market,
  fetchImpl: typeof fetch = fetch,
): Promise<TvSnapshot> {
  const snap = (await fetchTvSnapshots([tvSymbol], market, fetchImpl)).get(tvSymbol)
  if (!snap) throw fail('not_found', `${tvSymbol} not in ${market}`)
  return snap
}

/**
 * The company's own BYMA listing (`BCBA:YPFD` for logoid `ypf`), or null when it has none there:
 * local stocks only, so a CEDEAR (type `dr`) never counts. Its plain listing is the shortest symbol.
 */
export async function findBymaListing(logoid: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const rows = await scan(
    'argentina',
    ['logoid'],
    { filter: [{ left: 'logoid', operation: 'equal', right: logoid }, LOCAL_STOCKS], sort: BY_MARKET_CAP, range: [0, 20] },
    fetchImpl,
  )
  return rows.map((r) => r.s).sort((a, b) => a.length - b.length)[0] ?? null
}

/** Last day of the month `monthsBack` months before the month of `unixSec` (UTC), as YYYY-MM-DD. */
function monthEnd(unixSec: number, monthsBack: number): string {
  const d = new Date(unixSec * 1000)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsBack + 1, 0)).toISOString().slice(0, 10)
}

/** History arrays are newest first and undated; `endOf(i)` dates item i. Returns oldest first, nulls dropped. */
function toSeries(values: unknown, endOf: (i: number) => string | null): Series {
  if (!Array.isArray(values)) return []
  const out: Series = []
  values.forEach((x, i) => {
    const value = num(x)
    const end = endOf(i)
    if (value !== null && end !== null) out.push({ end, value })
  })
  return out.reverse()
}

function parseHistory(v: Record<string, unknown>): TvHistory {
  // Quarters: only the latest end is given, so step back 3 calendar months per item.
  // ponytail: assumes 13-week quarters; uneven ones (Costco's 12/12/12/16) get approximate ends.
  const lastQuarter = num(v.fiscal_period_end_fq)
  const quarterEnd = (i: number) => (lastQuarter === null ? null : monthEnd(lastQuarter, 3 * i))

  // Years: `fiscal_period_fy_h` labels each item and `fiscal_period_end_fy` is the latest one's end.
  // Labels differ by convention (NVDA's year to Jan 2026 is "2025", MSFT's to Jun 2026 is "2026"),
  // so date each year by its distance in labels from the latest one, which skips any gap.
  const lastYear = num(v.fiscal_period_end_fy)
  const labels = Array.isArray(v.fiscal_period_fy_h) ? v.fiscal_period_fy_h : []
  const latestLabel = num(labels[0])
  const yearEnd = (i: number) => {
    const label = num(labels[i])
    return lastYear === null || latestLabel === null || label === null
      ? null
      : monthEnd(lastYear, 12 * (latestLabel - label))
  }

  const lines = Object.entries(HISTORY_LINES) as [TvHistoryLine, string][]
  return {
    currency: str(v.fundamental_currency_code),
    quarterly: Object.fromEntries(lines.map(([k, f]) => [k, toSeries(v[`${f}_fq_h`], quarterEnd)])) as TvHistory['quarterly'],
    annual: Object.fromEntries(lines.map(([k, f]) => [k, toSeries(v[`${f}_fy_h`], yearEnd)])) as TvHistory['annual'],
  }
}

/**
 * History of the eight lines for many symbols of one market in one request, keyed by symbol.
 * A symbol TradingView does not know is left out; `not_found` only when none is known.
 */
export async function fetchTvHistory(
  tvSymbols: string[],
  market: Market,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, TvHistory>> {
  // An empty ticker list would make the scanner answer the whole market.
  if (tvSymbols.length === 0) return new Map()
  const columns = [
    'fundamental_currency_code', 'fiscal_period_end_fq', 'fiscal_period_end_fy', 'fiscal_period_fy_h',
    ...Object.values(HISTORY_LINES).flatMap((f) => [`${f}_fq_h`, `${f}_fy_h`]),
  ]
  const rows = await scan(market, columns, { symbols: { tickers: tvSymbols } }, fetchImpl)
  if (rows.length === 0) throw fail('not_found', `${tvSymbols.join(',')} not in ${market}`)
  return new Map(rows.map((r) => [r.s, parseHistory(r.v)]))
}

/** One company can have several listings (GOOG/GOOGL; BYMA's YPFD, YPFD.CI, YPFDB…); `logoid` names the company. */
const companyOf = (r: Row) => str(r.v.logoid) ?? r.s

async function industryPeers(
  market: Market,
  industry: string,
  exclude: Set<string>,
  limit: number,
  fetchImpl: typeof fetch,
): Promise<TvPeer[]> {
  const rows = await scan(
    market,
    ['logoid'],
    {
      filter: [{ left: 'industry', operation: 'equal', right: industry }, market === 'argentina' ? LOCAL_STOCKS : NOT_OTC],
      sort: BY_MARKET_CAP,
      range: PEER_SCAN_RANGE,
    },
    fetchImpl,
  )
  // Market-cap order by company; per company its shortest symbol, the plain listing (YPFD over YPFD.CI).
  const best = new Map<string, Row>()
  for (const r of rows) {
    const company = companyOf(r)
    const current = best.get(company)
    if (!exclude.has(company) && (!current || r.s.length < current.s.length)) best.set(company, r)
  }
  const picked = [...best].slice(0, limit)
  picked.forEach(([company]) => exclude.add(company))
  return picked.map(([, r]) => ({ tvSymbol: r.s, market }))
}

/**
 * Up to `limit` companies of the same industry and market by market cap. A BYMA industry with
 * fewer than 3 is filled from the same industry in america (ratios are currency-neutral).
 */
export async function fetchTvPeers(
  tvSymbol: string,
  market: Market,
  limit = 5,
  fetchImpl: typeof fetch = fetch,
): Promise<TvPeer[]> {
  const [self] = (await scan(market, ['industry', 'logoid'], { symbols: { tickers: [tvSymbol] } }, fetchImpl)).filter(
    (r) => r.s === tvSymbol,
  )
  if (!self) throw fail('not_found', `${tvSymbol} not in ${market}`)
  const industry = str(self.v.industry)
  if (!industry) return []

  const exclude = new Set([companyOf(self)])
  const peers = await industryPeers(market, industry, exclude, limit, fetchImpl)
  if (market === 'argentina' && peers.length < 3) {
    peers.push(...(await industryPeers('america', industry, exclude, limit - peers.length, fetchImpl)))
  }
  return peers
}
