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
  /** Days an ON aggregate mark stood in for per-ticker prices (circular against those snapshots). */
  onAggregateMarkDates: string[]
  /** Days where EVERY held ON was valued from a recorded on_price_history close (the only independent ON values). */
  onRecordedDates: string[]
  /** Subset of onRecordedDates where every held ON has a close dated exactly that day (not carried from an earlier session). */
  onExactCloseDates: string[]
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

function hasCloseOn(barsByTicker: Map<string, DailyBar[]>, ticker: string, date: string): boolean {
  const t = ticker.trim().toUpperCase()
  return Array.from(barsByTicker).some(([k, bars]) => k.trim().toUpperCase() === t && bars.some(b => b.date === date))
}

export function deriveHistory(input: DeriveInput): { rows: DerivedRow[]; flags: DeriveFlags } {
  const flags: DeriveFlags = {
    negativeCash: null, costMarkedStocks: [], vanished: [], onAggregateMarkDates: [], onRecordedDates: [], onExactCloseDates: [], todayUnpriced: [], failure: null,
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
      if (heldOns.length > 0 && unpricedOns.length === heldOns.length && mark) {
        if (Math.abs(row.ons_invested - mark.ons_invested) <= TOLERANCE) {
          row = withOnMark(row, mark)
          onsAtCost = false
          flags.onAggregateMarkDates.push(date)
        }
      }
      if (heldOns.length > 0 && unpricedOns.length === 0) {
        flags.onRecordedDates.push(date)
        if (heldOns.every(t => hasCloseOn(onPricesByTicker, t, date))) flags.onExactCloseDates.push(date)
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

export type LedgerReason = 'late-loaded' | 'date-shift'

/** The nightly snapshot job runs at 02:00 UTC (23:00 ART): what it saw was created before that. */
const nextCutoff = (d: string) => `${new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)}T02:00:00Z`

/**
 * The ledger as the snapshot of `date` could have seen it (shadow compare):
 *  - late-loaded: rows inserted after D's cutoff are dropped
 *  - date-shift:  rows dated > D but inserted by D's cutoff (evening entry in Argentina time, or
 *    entered ahead of time) were already visible to D's snapshot, so they are re-dated to D
 * `reason` is null when nothing changed. It only labels the change: whether it explains
 * a diff is decided by re-deriving over this ledger and comparing (derive-gate). Pure.
 */
export function knownLedgerAt(
  date: string,
  txs: ReplayTransaction[],
  movements: ReplayMovement[]
): { transactions: ReplayTransaction[]; movements: ReplayMovement[]; reason: LedgerReason | null } {
  const cutoff = Date.parse(nextCutoff(date))
  let dropped = false
  let shifted = false

  // created_at is compared as an instant (PostgREST may send offsets or fractional seconds).
  // Anything dated after D that the snapshot could already see (created <= cutoff) was counted at D
  // by the positions tables, so it is re-dated to D whenever it was entered.
  const known = <T extends { date: string; created_at?: string | null }>(rows: T[]): T[] =>
    rows.flatMap(r => {
      const created = r.created_at ? Date.parse(String(r.created_at)) : NaN
      if (Number.isNaN(created)) return [r]
      if (created > cutoff) {
        if (day(r.date) <= date) dropped = true
        return []
      }
      if (day(r.date) > date) {
        shifted = true
        return [{ ...r, date }]
      }
      return [r]
    })

  const transactions = known(txs)
  const kept = known(movements)
  return { transactions, movements: kept, reason: dropped ? 'late-loaded' : shifted ? 'date-shift' : null }
}

/** The derived row of a date over only what that date's snapshot could have known. */
export interface KnownAt { row: DerivedRow; reason: LedgerReason }

/**
 * Builds the gate's `knownAt(date)` from the input of a derivation. null = the ledger was fully
 * known by then (nothing late), or the date cannot be derived without the late rows.
 */
export function knownAtFrom(input: DeriveInput): (date: string) => KnownAt | null {
  return date => {
    const k = knownLedgerAt(date, input.transactions, input.movements)
    if (!k.reason) return null
    // today = D+1 keeps deriveHistory to the days up to D (it emits days < today, plus a today row we ignore)
    const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    // No aggregate marks: they come from the snapshots under comparison, so with them the known row would
    // match the snapshot by construction (circular). ONs without a recorded close stay at cost, which can
    // never excuse an ON/total diff that is really a market-vs-cost gap.
    const { rows } = deriveHistory({ ...input, transactions: k.transactions, movements: k.movements, onMarks: new Map(), today: next })
    const row = rows.find(r => r.snapshot_date === date)
    return row ? { row, reason: k.reason } : null
  }
}
