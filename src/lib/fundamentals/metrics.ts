/**
 * Every Números metric, today and through time (odd/tasks/asset-page.md T3, S3 S4 S5 S7).
 *
 * Pure: no fetch, no cache, no clock. The service passes the sources, the FX rates and the
 * listing's prices; the company and each peer go through the same `computeMetrics`. Decisions
 * in the task's L11: amounts go to USD at each period end before any ratio; a metric reads one
 * source only; ARS reporters keep Yahoo quarterly only; share counts and EPS are never converted.
 *
 * Reads rates through daily-bars, not fx.ts (which reaches the CCL table and Yahoo), so the
 * page's client code can import the helpers below.
 */
import { closeOnOrBefore, type DailyBar } from '../daily-bars'
import { METRICS, type Frame, type MetricId, type MetricUnit } from './catalog'
import type { TvHistory, TvHistoryLine, TvSnapshot } from './tradingview'
import type { YahooLine, YahooLines, YahooStatements } from './yahoo'
import type { Point, Series } from './types'

export interface MetricsInput {
  /** YYYY-MM-DD: the "hoy" point's date and the rate date for today's market cap. */
  today: string
  /** Today's close and market cap in `currency` (the price's), and TradingView's snapshot rows. */
  snapshot: Pick<TvSnapshot, 'close' | 'marketCap' | 'currency' | 'fields'>
  tv: TvHistory | null
  yahoo: YahooStatements | null
  /** Units of each currency per US dollar by date, as fetchUsdRates returns them; USD needs none. */
  rates: Map<string, Map<string, number>>
  /** The listing's close on or before a date, in the price's currency. */
  priceOn: (date: string) => number | null
}

export const PERIOD_MODES = ['quarterly', 'ttm', 'annual'] as const
export type PeriodMode = (typeof PERIOD_MODES)[number]

export interface MetricValue {
  id: MetricId
  /** The list value: the latest TTM flows and latest balances with today's market cap and price. */
  today: number | null
  /**
   * Oldest first. Each series with periods ends with the "hoy" point, `{ end: today, value: today }`,
   * except the quarterly series of a period flow (catalog `periodFlow`): a quarter's flow is about a
   * fourth of hoy's 12 months, so that chart ends at its last quarter. The TTM series always has hoy.
   */
  history: Record<PeriodMode, Series>
  /** First year with data in any mode, for "historia desde". */
  since: string | null
  /**
   * The latest statements' period end the list value is built on: the anchor of its change in a year.
   * Set also when `today` is null: that period lacks an input.
   */
  asOf: string | null
  source: 'tradingview' | 'yahoo' | 'snapshot'
}

export type Metrics = Record<MetricId, MetricValue>

type N = number | null
type Lines<L extends string> = Partial<Record<L, Series>>

/** One source's statements, and how to read its ordinary share count over a period. */
interface Book<L extends string> {
  currency: string | null
  quarterly: Lines<L>
  annual: Lines<L>
  /** Ordinary shares over the period ending at `end`, from the unconverted lines: counts and EPS never convert. */
  shares: (lines: Lines<L>, end: string) => N
}

interface Ctx {
  today: string
  rateOn: (currency: string | null, date: string) => N
  priceUsd: (date: string) => N
  now: { mcap: N; units: N }
}

const DAY_MS = 86_400_000
const QUARTER_DAYS = 91
const YEAR_DAYS = 365
// One source's period ends line up within days (52/53-week years drift); periods are ≥ ~90 days apart.
const TOLERANCE_DAYS = 20
const EMPTY: Record<PeriodMode, Series> = { quarterly: [], ttm: [], annual: [] }

const dayOf = (end: string) => Date.parse(end) / DAY_MS
const positive = (x: N): N => (x !== null && x > 0 ? x : null)
const finite = (x: N | undefined): N => (typeof x === 'number' && Number.isFinite(x) ? x : null)

/** The value of the point ending `daysBack` days before `end`, give or take TOLERANCE_DAYS. */
function near(series: Series | undefined, end: string, daysBack = 0): N {
  const target = dayOf(end) - daysBack
  return series?.find((p) => Math.abs(dayOf(p.end) - target) <= TOLERANCE_DAYS)?.value ?? null
}

function endsOf<L extends string>(lines: Lines<L>): string[] {
  return [...new Set(Object.values<Series | undefined>(lines).flatMap((s) => s?.map((p) => p.end) ?? []))].sort()
}

// A line's plausible move from one period to the next, and how much smaller a converted point must get.
const SAME_SIZE = { min: 0.2, max: 5 }
const SHRINK = 100

/**
 * Each amount at its period end's rate; a point with no rate is dropped, never converted at an invented one.
 * A period already in USD inside a non-USD series is kept as is: BCBA:YPFD's TradingView history is labeled
 * ARS, but its 2026-09-30 quarter is in USD (L21 a). A line votes USD when its raw value is within
 * ×0.2–×5 of its previous point in USD while converting it would make it >100× smaller; most of the
 * period's lines with a previous point must vote so, then every line of that period stays as is.
 * ponytail: a heuristic over the previous point only. A series that starts in USD is converted, and a real
 * fall of >100× in most lines of a high-rate currency would read as USD. Read the period's currency from
 * the source if it ever gives one.
 */
function toUsd<L extends string>(lines: Lines<L>, rateOn: (end: string) => N): Lines<L> {
  const out: Record<string, Point[]> = Object.fromEntries(Object.keys(lines).map((line) => [line, []]))
  for (const end of endsOf(lines)) {
    const rate = rateOn(end)
    if (rate === null) continue
    const here = Object.entries<Series | undefined>(lines).flatMap(([line, s]) => {
      const p = s?.find((q) => q.end === end)
      return p ? [{ line, value: p.value, before: out[line].at(-1)?.value }] : []
    })
    const compared = here.filter((h) => h.before)
    const usd = compared.filter(({ value, before }) => {
      const r = value / before!
      return r >= SAME_SIZE.min && r <= SAME_SIZE.max && rate > SHRINK * r
    })
    const already = usd.length * 2 > compared.length
    for (const { line, value } of here) out[line].push({ end, value: already ? value : value / rate })
  }
  return out as Lines<L>
}

function tvBook(tv: TvHistory): Book<TvHistoryLine> {
  return {
    currency: tv.currency,
    quarterly: tv.quarterly,
    annual: tv.annual,
    // ponytail: net income ÷ diluted EPS is the period's weighted diluted count, not the count at its
    // end, and it gets noisy when EPS rounds near zero; take the median of nearby quarters if that shows.
    shares: (lines, end) => {
      const ni = near(lines.netIncome, end)
      const eps = near(lines.epsDiluted, end)
      return ni === null || !eps ? null : positive(ni / eps)
    },
  }
}

function yahooBook(y: YahooStatements): Book<YahooLine> {
  // One share line per company, never a per-period fallback.
  const line = y.quarterly.ordinarySharesNumber || y.annual.ordinarySharesNumber ? 'ordinarySharesNumber' : 'dilutedAverageShares'
  return {
    currency: y.currency,
    quarterly: y.quarterly,
    // ARS annual mixes as-reported years with IAS 29 restated comparatives (L11); quarterly is as reported.
    annual: y.currency === 'ARS' ? {} : y.annual,
    shares: (lines, end) => positive(near(lines[line], end)),
  }
}

/** Evaluates formulas over one source: every period of every mode, and today. */
function evaluator<L extends string>(book: Book<L>, ctx: Ctx) {
  const rateOn = (end: string) => ctx.rateOn(book.currency, end)
  const usd = { quarterly: toUsd(book.quarterly, rateOn), annual: toUsd(book.annual, rateOn) }
  const ends = { quarterly: endsOf(book.quarterly), ttm: endsOf(book.quarterly), annual: endsOf(book.annual) }

  // Listing ratio (L11 #4): ordinary shares now ÷ listed units now. Units then = ordinary shares then ÷ ratio.
  const latestShares = (lines: Lines<L>, at: string[]) =>
    [...at].reverse().map((e) => book.shares(lines, e)).find((s) => s !== null) ?? null
  const sharesNow = latestShares(book.quarterly, ends.quarterly) ?? latestShares(book.annual, ends.annual)
  const ratio = sharesNow !== null && ctx.now.units !== null ? sharesNow / ctx.now.units : null

  function frame(mode: PeriodMode, end: string, quote?: Ctx['now']): Frame<L> {
    const lines = mode === 'annual' ? usd.annual : usd.quarterly
    // The period's flow ending `back` days before `end`.
    const flowAt = (line: L, back: number): N => {
      if (mode !== 'ttm') return near(lines[line], end, back)
      const quarters = [0, 1, 2, 3].map((k) => near(lines[line], end, back + k * QUARTER_DAYS))
      return quarters.includes(null) ? null : (quarters as number[]).reduce((a, b) => a + b, 0)
    }
    const flow = (line: L) => flowAt(line, 0)
    const bal = (line: L) => near(lines[line], end)
    let units = quote?.units ?? null
    let mcap = quote?.mcap ?? null
    if (!quote) {
      const shares = book.shares(mode === 'annual' ? book.annual : book.quarterly, end)
      const price = ctx.priceUsd(end)
      units = shares !== null && ratio !== null ? shares / ratio : null
      mcap = units !== null && price !== null ? price * units : null
    }
    return {
      flow,
      yearAgo: (line) => flowAt(line, YEAR_DAYS),
      yearly: (line) => {
        const v = flow(line)
        return v !== null && mode === 'quarterly' ? v * 4 : v
      },
      bal,
      avg: (line) => {
        const a = bal(line)
        const b = near(lines[line], end, mode === 'quarterly' ? QUARTER_DAYS : YEAR_DAYS)
        return a === null || b === null ? null : (a + b) / 2
      },
      mcap,
      units,
    }
  }

  const frames = Object.fromEntries(
    PERIOD_MODES.map((mode) => [mode, ends[mode].filter((end) => end < ctx.today).map((end) => ({ end, f: frame(mode, end) }))]),
  ) as Record<PeriodMode, { end: string; f: Frame<L> }[]>

  // "Hoy" is the latest period, its 12 months, priced today: a value is "—" only when that period lacks an input.
  const latest = frames.ttm.at(-1)
  const todayFrame = latest ? frame('ttm', latest.end, ctx.now) : null

  return (formula: (f: Frame<L>) => N, periodFlow = false) => {
    const today = finite(todayFrame && formula(todayFrame))
    const history = Object.fromEntries(
      PERIOD_MODES.map((mode) => {
        const points: Series = frames[mode].flatMap(({ end, f }) => {
          const value = finite(formula(f))
          return value === null ? [] : [{ end, value }]
        })
        const sameScale = !(periodFlow && mode === 'quarterly')
        if (points.length > 0 && today !== null && sameScale) points.push({ end: ctx.today, value: today })
        return [mode, points]
      }),
    ) as Record<PeriodMode, Series>
    const first = PERIOD_MODES.map((mode) => history[mode][0]?.end).filter(Boolean).sort()[0]
    return { today, history, since: first ? first.slice(0, 4) : null, asOf: latest?.end ?? null }
  }
}

/** Every catalog metric for one company. Peers go through this same function with their own inputs. */
export function computeMetrics(input: MetricsInput): Metrics {
  const bars = new Map<string, DailyBar[]>()
  const rateOn = (currency: string | null, date: string): N => {
    if (currency === 'USD') return 1
    const rates = currency === null ? undefined : input.rates.get(currency)
    if (!currency || !rates) return null
    if (!bars.has(currency)) bars.set(currency, Array.from(rates, ([d, close]) => ({ date: d, close })))
    return positive(closeOnOrBefore(bars.get(currency)!, date))
  }
  const { close, marketCap, currency } = input.snapshot
  const usdAt = (value: N, date: string): N => {
    const rate = rateOn(currency, date)
    return value === null || rate === null ? null : value / rate
  }
  // Listed units now: TradingView's share count is per listed unit (an ADR counts ADRs); market
  // cap ÷ price only as a fallback, since an ADR's market cap follows its home-market price.
  const units = positive(input.snapshot.fields.total_shares_outstanding ?? (marketCap !== null && close ? marketCap / close : null))
  const ctx: Ctx = {
    today: input.today,
    rateOn,
    priceUsd: (date) => usdAt(input.priceOn(date), date),
    now: { mcap: usdAt(units !== null && close ? close * units : marketCap, input.today), units },
  }
  const t = input.tv && evaluator(tvBook(input.tv), ctx)
  const y = input.yahoo && evaluator(yahooBook(input.yahoo), ctx)
  const none = { today: null, history: EMPTY, since: null, asOf: null }

  return Object.fromEntries(
    METRICS.map((def): [MetricId, MetricValue] => {
      if (def.group === 'snapshot') {
        return [def.id, { id: def.id, ...none, today: input.snapshot.fields[def.field] ?? null, source: 'snapshot' }]
      }
      if (def.group === 'quote') return [def.id, { id: def.id, ...none, today: ctx.now.mcap, source: 'snapshot' }]
      const periodFlow = 'periodFlow' in def
      const value = def.group === 'T' ? t?.(def.formula, periodFlow) : y?.(def.formula, periodFlow)
      return [def.id, { id: def.id, ...(value ?? none), source: def.group === 'T' ? 'tradingview' : 'yahoo' }]
    }),
  ) as Metrics
}

/**
 * The last point against the same period a year before the one it is built on: its own end, or
 * `asOf` for the "hoy" point (dated after every period). Percentage points for percent metrics,
 * % change for the rest; null without that period, or over a base ≤ 0. Pass the TTM series and the
 * metric's `asOf` to compare the list value.
 */
export function changeVsYearAgo(series: Series, unit: MetricUnit, asOf: string | null = null): N {
  const last = series.at(-1)
  if (!last) return null
  const then = near(series, asOf !== null && last.end > asOf ? asOf : last.end, YEAR_DAYS)
  if (then === null) return null
  if (unit === 'percent') return last.value - then
  return then > 0 ? (last.value / then - 1) * 100 : null
}

/** The point the chart marks: the highest, or the lowest for metrics where lower is better. */
export function bestPoint(series: Series, better: 'higher' | 'lower'): Point | null {
  if (series.length === 0) return null
  return series.reduce((best, p) => ((better === 'higher' ? p.value > best.value : p.value < best.value) ? p : best))
}

/** The median of the peers' values, skipping the missing ones. */
export function peersMedian(values: N[]): N {
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
