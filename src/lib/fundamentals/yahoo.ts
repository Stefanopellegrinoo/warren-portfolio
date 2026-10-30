/**
 * Yahoo source for the asset page (odd/tasks/asset-page.md T2, S4 S5): normalized statements
 * (group Y history: ~5 years, ~6 quarters) and the company profile.
 *
 * No caching here: the service caches what these return, never a raw response. Statements
 * come from fundamentalsTimeSeries; quoteSummary's statement modules are empty since Nov 2024.
 */
import { getYahooFinanceInstance } from '../yahoo-finance'
import { isUnknownSymbolError } from '../ticker-identity'
import { FundamentalsSourceError, type Series } from './types'

/**
 * Page line → the one Yahoo field that carries it. One field per line, never a per-period
 * fallback, so a series never mixes definitions. Probed live 2026-10-30 on MELI, GGAL.BA, JPM,
 * TSM, BABA, ITUB, NU, KO, BRK-B, YPFD.BA, 7203.T: banks and insurers lack the gross/operating/
 * EBITDA/current lines, and an absent line is simply absent.
 */
const LINES = {
  revenue: 'totalRevenue',
  costOfRevenue: 'costOfRevenue',
  grossProfit: 'grossProfit',
  operatingIncome: 'operatingIncome',
  ebit: 'EBIT',
  // As reported; normalizedEBITDA adds back unusual items.
  ebitda: 'EBITDA',
  // What P/E and EPS divide: after preferred dividends (JPM's differ from netIncome).
  netIncome: 'netIncomeCommonStockholders',
  dilutedEps: 'dilutedEPS',
  dilutedAverageShares: 'dilutedAverageShares',
  totalAssets: 'totalAssets',
  totalLiabilities: 'totalLiabilitiesNetMinorityInterest',
  stockholdersEquity: 'stockholdersEquity',
  cashAndCashEquivalents: 'cashAndCashEquivalents',
  cashAndShortTermInvestments: 'cashCashEquivalentsAndShortTermInvestments',
  currentAssets: 'currentAssets',
  currentLiabilities: 'currentLiabilities',
  inventory: 'inventory',
  totalDebt: 'totalDebt',
  longTermDebt: 'longTermDebt',
  investedCapital: 'investedCapital',
  tangibleBookValue: 'tangibleBookValue',
  workingCapital: 'workingCapital',
  ordinarySharesNumber: 'ordinarySharesNumber',
  operatingCashFlow: 'operatingCashFlow',
  capitalExpenditure: 'capitalExpenditure',
  freeCashFlow: 'freeCashFlow',
} as const

export type YahooLine = keyof typeof LINES
export type YahooLines = Partial<Record<YahooLine, Series>>

export interface YahooStatements {
  /** The statements' ISO currency. It can differ from the price's: TSM is TWD, YPFD.BA is USD. */
  currency: string | null
  quarterly: YahooLines
  annual: YahooLines
}

export interface YahooEarnings {
  /** YYYY-MM-DD */
  quarterEnd: string
  epsEstimate: number | null
  epsActual: number | null
}

export interface YahooProfile {
  longName: string | null
  sector: string | null
  industry: string | null
  country: string | null
  website: string | null
  fullTimeEmployees: number | null
  /** The price's currency. */
  currency: string | null
  /** The statements' currency. */
  financialCurrency: string | null
  marketCap: number | null
  fiftyTwoWeekLow: number | null
  fiftyTwoWeekHigh: number | null
  regularMarketPrice: number | null
  targetMeanPrice: number | null
  numberOfAnalystOpinions: number | null
  recommendationKey: string | null
  sharesOutstanding: number | null
  floatShares: number | null
  beta: number | null
  /** YYYY-MM-DD, today or later. */
  nextEarningsDate: string | null
  /** The last four reported quarters, oldest first. */
  earnings: YahooEarnings[]
}

interface Deps {
  getYahoo?: () => Promise<any>
}

const HISTORY_YEARS = 6
const NO_VALIDATION = { validateResult: false }
const PROFILE_MODULES = [
  'assetProfile', 'price', 'summaryDetail', 'financialData', 'defaultKeyStatistics', 'calendarEvents', 'earningsHistory',
]

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

function isoDate(v: unknown): string | null {
  if (!(v instanceof Date) && typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** Every failure leaves as a FundamentalsSourceError; only "no such symbol" is an answer. */
function toSourceError(err: unknown): FundamentalsSourceError {
  if (err instanceof FundamentalsSourceError) return err
  const message = err instanceof Error ? err.message : String(err)
  if (isUnknownSymbolError(err)) return new FundamentalsSourceError('yahoo', 'not_found', message)
  // yahoo-finance2's own words when the payload lacks its timeseries or mixes period types.
  if (/unexpected result|periodType mismatch/i.test(message)) return new FundamentalsSourceError('yahoo', 'bad_shape', message)
  return new FundamentalsSourceError('yahoo', 'unavailable', message)
}

function normalize(rows: unknown): YahooLines {
  if (!Array.isArray(rows)) throw new FundamentalsSourceError('yahoo', 'bad_shape', 'statements are not a list')
  const dated = rows
    .map(row => ({ row, end: isoDate(row?.date) }))
    .filter((r): r is { row: any; end: string } => r.end !== null)
    .sort((a, b) => (a.end < b.end ? -1 : 1))
  const out: YahooLines = {}
  for (const [line, field] of Object.entries(LINES) as [YahooLine, string][]) {
    const series = dated.flatMap(({ row, end }) => {
      const value = num(row[field])
      return value === null ? [] : [{ end, value }]
    })
    if (series.length > 0) out[line] = series
  }
  return out
}

export async function fetchYahooStatements(symbol: string, deps: Deps = {}): Promise<YahooStatements> {
  try {
    const yf = await (deps.getYahoo ?? getYahooFinanceInstance)()
    const period1 = new Date()
    period1.setUTCFullYear(period1.getUTCFullYear() - HISTORY_YEARS)
    const statements = (type: 'quarterly' | 'annual') =>
      yf.fundamentalsTimeSeries(symbol, { period1, type, module: 'all' }, NO_VALIDATION)
    const [quarterlyRows, annualRows, summary] = await Promise.all([
      statements('quarterly'),
      statements('annual'),
      yf.quoteSummary(symbol, { modules: ['financialData'] }, NO_VALIDATION),
    ])
    const quarterly = normalize(quarterlyRows)
    const annual = normalize(annualRows)
    // Yahoo answers an unknown symbol or an ETF with empty periods, not with an error.
    if (Object.keys(quarterly).length === 0 && Object.keys(annual).length === 0) {
      throw new FundamentalsSourceError('yahoo', 'not_found', `no statements for ${symbol}`)
    }
    return { currency: str(summary?.financialData?.financialCurrency), quarterly, annual }
  } catch (err) {
    throw toSourceError(err)
  }
}

export async function fetchYahooProfile(symbol: string, deps: Deps = {}): Promise<YahooProfile> {
  try {
    const yf = await (deps.getYahoo ?? getYahooFinanceInstance)()
    const r = await yf.quoteSummary(symbol, { modules: PROFILE_MODULES }, NO_VALIDATION)
    if (!r || typeof r !== 'object') throw new FundamentalsSourceError('yahoo', 'bad_shape', `profile of ${symbol} is not an object`)
    const [ap, price, sd, fd, ks] = ['assetProfile', 'price', 'summaryDetail', 'financialData', 'defaultKeyStatistics']
      .map(module => r[module] ?? {})
    const today = new Date().toISOString().slice(0, 10)
    const earningsDates: unknown[] = r.calendarEvents?.earnings?.earningsDate ?? []
    const history: any[] = r.earningsHistory?.history ?? []
    return {
      longName: str(price.longName) ?? str(price.shortName),
      sector: str(ap.sector),
      industry: str(ap.industry),
      country: str(ap.country),
      website: str(ap.website),
      fullTimeEmployees: num(ap.fullTimeEmployees),
      currency: str(price.currency),
      financialCurrency: str(fd.financialCurrency),
      marketCap: num(price.marketCap),
      fiftyTwoWeekLow: num(sd.fiftyTwoWeekLow),
      fiftyTwoWeekHigh: num(sd.fiftyTwoWeekHigh),
      regularMarketPrice: num(price.regularMarketPrice),
      targetMeanPrice: num(fd.targetMeanPrice),
      numberOfAnalystOpinions: num(fd.numberOfAnalystOpinions),
      recommendationKey: str(fd.recommendationKey),
      sharesOutstanding: num(ks.sharesOutstanding),
      floatShares: num(ks.floatShares),
      beta: num(sd.beta),
      // Yahoo can keep a past date there until the next one is set.
      nextEarningsDate: earningsDates.map(isoDate).filter((d): d is string => d !== null && d >= today).sort()[0] ?? null,
      earnings: history
        .map(h => ({ quarterEnd: isoDate(h?.quarter), epsEstimate: num(h?.epsEstimate), epsActual: num(h?.epsActual) }))
        .filter((e): e is YahooEarnings => e.quarterEnd !== null)
        .sort((a, b) => (a.quarterEnd < b.quarterEnd ? -1 : 1))
        .slice(-4),
    }
  } catch (err) {
    throw toSourceError(err)
  }
}
