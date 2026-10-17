// src/lib/derive-history.ts
/**
 * The portfolio history as a formula: ledger + prices in, one snapshot-shaped
 * row per market day out. Pure — no DB, no network, never throws.
 *
 * Reuses buildBackfillRows (replay + buildSnapshotRow), so a derived row and a
 * measured snapshot cannot mean two different things. The only thing added here
 * is the ON valuation precedence and the "today" point.
 *
 * WORKER-SAFE: relative value imports only.
 */
import type { Quote } from '@/types'
import { buildSnapshotRow, type SnapshotRow } from './portfolio-snapshots'
import { buildBackfillRows, marketDaysFrom } from './backfill-snapshots'
import { replayPortfolioAt, type ReplayMovement, type ReplayTransaction } from './portfolio-replay'
import { splitQuotesByAssetClass } from './portfolio-valuation'
import type { DailyBar } from './historical-prices'

export type DerivedRow = SnapshotRow & { source: 'live' | 'estimated' }

export interface OnMark {
  ons_value: number
  ons_invested: number
}

export interface DeriveFlags {
  /** Worst day the replayed cash sits below -$1 (funding side missing), else null. */
  negativeCash: { date: string; cash: number } | null
  /** Stocks held with no bars at all — valued at cost on every day. */
  costMarkedStocks: string[]
  /** Positions with no price and no usable cost, dropped from the row. */
  vanished: string[]
  /** Days an ON aggregate mark stood in for per-ticker prices (informational). */
  onAggregateMarkDays: number
  /** Positions held today with no usable quote. */
  todayUnpriced: string[]
  /** Set when the derivation stopped early; rows hold what was computed before. */
  failure: string | null
}

export interface DeriveInput {
  userId: string
  transactions: ReplayTransaction[]
  movements: ReplayMovement[]
  /** Portfolio ticker -> un-adjusted USD closes. Bars dated today or later are ignored. */
  barsByTicker: Map<string, DailyBar[]>
  /** ON ticker -> recorded closes (on_price_history). */
  onPricesByTicker: Map<string, DailyBar[]>
  /** Date -> live snapshot ONs aggregate, the fallback when no ON price is recorded. */
  onMarks: Map<string, OnMark>
  today: string
  todayQuotes: Map<string, Quote>
}

/** Same $1 tolerance as the cash guard in buildBackfillRows. */
const TOLERANCE = 1

const day = (d: string) => String(d).slice(0, 10)

/** Replaces the ONs value with an aggregate mark, keeping the row's identities (total, pnl). */
function withOnMark(row: SnapshotRow, mark: OnMark): SnapshotRow {
  const delta = mark.ons_value - row.ons_value
  const pnl = row.pnl + delta
  return {
    ...row,
    ons_value: mark.ons_value,
    total_value: row.total_value + delta,
    pnl,
    pnl_pct: row.total_invested > 0 ? pnl / row.total_invested : 0,
  }
}

export function deriveHistory(input: DeriveInput): { rows: DerivedRow[]; flags: DeriveFlags } {
  const flags: DeriveFlags = {
    negativeCash: null, costMarkedStocks: [], vanished: [], onAggregateMarkDays: 0, todayUnpriced: [], failure: null,
  }
  const rows: DerivedRow[] = []

  try {
    const { userId, transactions, movements, barsByTicker, onPricesByTicker, onMarks, today, todayQuotes } = input
    if (transactions.length === 0) return { rows, flags }

    const tickersWithBars = new Set(
      Array.from(barsByTicker).filter(([, b]) => b.length > 0).map(([t]) => t.trim().toUpperCase())
    )
    const firstTxDate = transactions.map(t => day(t.date)).sort()[0]

    const calendarSource = new Map<string, DailyBar[]>(barsByTicker)
    onPricesByTicker.forEach((b, t) => calendarSource.set(`ON:${t}`, b))
    const dates = marketDaysFrom(calendarSource, firstTxDate, today).filter(d => d < today)

    const noBars = new Set<string>()
    const vanished = new Set<string>()

    for (const date of dates) {
      const [d] = buildBackfillRows({
        userId, transactions, movements, dates: [date], barsByTicker,
        onBarsByTicker: onPricesByTicker, allowNegativeCash: true, allowVanished: true,
      })
      // The replay's own classification — never re-derive it from the raw rows.
      const onToday = new Set(d.heldOnTickers)
      const heldOns = d.heldOnTickers
      const unpricedOns = d.unpricedTickers.filter(t => onToday.has(t))

      d.unpricedTickers.filter(t => !onToday.has(t)).forEach(t => {
        if (!tickersWithBars.has(t)) noBars.add(t)
      })
      d.vanished.forEach(t => vanished.add(t))

      let row: SnapshotRow = d.row
      let onsAtCost = unpricedOns.length > 0
      const mark = onMarks.get(date)
      if (heldOns.length > 0 && unpricedOns.length === heldOns.length && mark &&
          Math.abs(row.ons_invested - mark.ons_invested) <= TOLERANCE) {
        row = withOnMark(row, mark)
        onsAtCost = false
        flags.onAggregateMarkDays++
      }
      rows.push({ ...row, source: onsAtCost ? 'estimated' : 'live' })
    }

    // Today: the replayed state at live quotes (bars never include today).
    const state = replayPortfolioAt(transactions, movements, today)
    const { stockQuotes, onQuotes } = splitQuotesByAssetClass(todayQuotes, state.onPositions.map(p => p.ticker))
    const priced = (p: { ticker: string }) =>
      Number((stockQuotes.get(p.ticker) ?? onQuotes.get(p.ticker))?.price) > 0
    flags.todayUnpriced = [...state.positions, ...state.onPositions].filter(p => !priced(p)).map(p => p.ticker)
    rows.push({
      ...buildSnapshotRow(
        { userId, positions: state.positions as any[], onPositions: state.onPositions as any[], realized: 0, onRealized: 0, cashBalance: state.cashBalance },
        stockQuotes, onQuotes, today
      ),
      source: 'live',
    })

    for (const r of rows) {
      if (r.cash_value < -TOLERANCE && (!flags.negativeCash || r.cash_value < flags.negativeCash.cash)) {
        flags.negativeCash = { date: r.snapshot_date, cash: r.cash_value }
      }
    }
    flags.costMarkedStocks = Array.from(noBars).sort()
    flags.vanished = Array.from(vanished).sort()
  } catch (err) {
    flags.failure = err instanceof Error ? err.message : String(err)
  }

  return { rows, flags }
}

export type DiffReason = 'late-loaded' | 'date-shift' | 'split' | 'misprice'
export interface SplitEvent { ticker: string; date: string }

/**
 * Tickers whose transaction price was typed wrong (measured 2026-07-28, 7 rows): they
 * dirty cost and P&L from their transaction date on, never the stocks+cash value.
 */
export const MISPRICED_TICKERS: readonly string[] = ['AMD', 'BABA', 'CAH', 'META', 'NIO', 'NU', 'MU']

/** The nightly snapshot job runs at 02:00 UTC (23:00 ART): what it saw was created before that. */
const nextCutoff = (d: string) => `${new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)}T02:00:00Z`
const norm = (t: string) => String(t).trim().toUpperCase()

/**
 * Why a measured snapshot for `date` may legitimately differ from the derived row.
 * null = unexplained. First match wins; the order is also the order of likelihood.
 *  - late-loaded: a row dated <= D that was only inserted after D's snapshot ran
 *  - date-shift:  a row dated > D inserted during D (evening entry in Argentina time)
 *    that D's snapshot already saw
 *  - split:       a held ticker split after D (the snapshot is at the raw, pre-split price)
 *  - misprice:    a held ticker from MISPRICED_TICKERS
 */
export function explainDiff(
  date: string,
  txs: ReplayTransaction[],
  movements: ReplayMovement[],
  splits: SplitEvent[]
): DiffReason | null {
  const cutoff = nextCutoff(date)
  const dayStart = `${date}T03:00:00Z`
  const dated = [...txs, ...movements]
  const created = (r: { created_at?: string | null }) => (r.created_at ? String(r.created_at) : null)

  if (dated.some(r => day(r.date) <= date && (created(r) ?? '') > cutoff)) return 'late-loaded'
  if (dated.some(r => {
    const c = created(r)
    return day(r.date) > date && c !== null && c >= dayStart && c <= cutoff
  })) return 'date-shift'

  const held = new Set(txs.filter(t => day(t.date) <= date).map(t => norm(t.ticker)))
  if (splits.some(s => s.date > date && held.has(norm(s.ticker)))) return 'split'
  if (MISPRICED_TICKERS.some(t => held.has(t))) return 'misprice'
  return null
}
