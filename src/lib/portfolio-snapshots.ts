import { createServiceClient } from './supabase-server'
import { fetchQuotes } from './yahoo-finance'
import { loadUserPortfolios, type UserPortfolioInputs } from './user-portfolios'
import type { Quote } from '@/types'
import { splitQuotesByAssetClass, valuePortfolio } from './portfolio-valuation'
import { loadPortfolioNow } from './ledger-now'

export { splitQuotesByAssetClass }

export interface SnapshotResult {
  written: number
  failed: number
}

/** A portfolio_snapshots row as computed (no id — the DB assigns it). */
export interface SnapshotRow {
  user_id: string
  snapshot_date: string
  total_value: number
  total_invested: number
  pnl: number
  pnl_pct: number
  /**
   * Per-asset-class breakdown. valuePortfolio already computes all five; they
   * were being discarded here, which left the app unable to compute a metric
   * over the classes it can actually measure.
   */
  stocks_value: number
  stocks_invested: number
  ons_value: number
  ons_invested: number
  cash_value: number
}

/** Maps one user's portfolio to a portfolio_snapshots row. */
export function buildSnapshotRow(
  portfolio: UserPortfolioInputs,
  stockQuotes: Map<string, Quote>,
  onQuotes: Map<string, Quote>,
  snapshotDate: string
): SnapshotRow {
  const { summary } = valuePortfolio(
    {
      positions: portfolio.positions,
      onPositions: portfolio.onPositions,
      cashBalance: portfolio.cashBalance,
      realized: portfolio.realized,
      onRealized: portfolio.onRealized,
    },
    { stockQuotes, onQuotes }
  )

  return {
    user_id: portfolio.userId,
    snapshot_date: snapshotDate,
    // total_market_value already includes cash; total_invested deliberately does not
    total_value: summary.total_market_value,
    total_invested: summary.total_invested,
    pnl: summary.open_pnl,
    pnl_pct: summary.open_pnl_pct,
    // The breakdown the summary already carries. Both writers (snapshotAllUsers
    // and snapshotUser) go through this function, so both get it.
    stocks_value: summary.stocks.market_value,
    stocks_invested: summary.stocks.invested,
    ons_value: summary.ons.market_value,
    ons_invested: summary.ons.invested,
    cash_value: summary.cash.balance,
  }
}

/**
 * Writes one portfolio_snapshots row per user for the given date.
 *
 * These rows are the ONLY source for the max-drawdown statistic, so the job
 * favours recording something over recording nothing: one user's failed write
 * never aborts the rest, and missing quotes degrade to cost rather than zero.
 */
export async function snapshotAllUsers(
  stockQuotes: Map<string, Quote>,
  onQuotes: Map<string, Quote>,
  snapshotDate: string
): Promise<SnapshotResult> {
  const portfolios = await loadUserPortfolios()
  if (portfolios.length === 0) {
    console.log('[Snapshot] No users with positions or cash — nothing to snapshot')
    return { written: 0, failed: 0 }
  }

  const supabase = createServiceClient()
  let written = 0
  let failed = 0

  for (const portfolio of portfolios) {
    const row = buildSnapshotRow(portfolio, stockQuotes, onQuotes, snapshotDate)

    try {
      const { error } = await supabase
        .from('portfolio_snapshots')
        .upsert(row, { onConflict: 'user_id,snapshot_date' })

      if (error) {
        failed++
        console.error(`[Snapshot] Failed for ${portfolio.userId}:`, error.message ?? error)
      } else {
        written++
      }
    } catch (err) {
      failed++
      console.error(`[Snapshot] Threw for ${portfolio.userId}:`, err)
    }
  }

  console.log(`[Snapshot] ${snapshotDate}: ${written} written, ${failed} failed`)
  return { written, failed }
}

export type SnapshotUserResult =
  | { ok: true; snapshot: any }
  | { ok: false; error: string; status: number }

/**
 * Computes one user's portfolio_snapshots row for a date WITHOUT writing it.
 *
 * Shared by snapshotUser (compute + write) and the history endpoint's live
 * intraday point (compute only), so both value the portfolio identically:
 * stocks + ONs + cash, missing quotes marked at cost via buildSnapshotRow.
 * Returns null when the user has nothing to value.
 */
export async function computeLiveSnapshotRow(
  supabase: any,
  userId: string,
  snapshotDate: string
): Promise<SnapshotRow | null> {
  // From the ledger core; a failed read throws (T4.2b) — a wrong row upserted here poisons Max Drawdown.
  const now = await loadPortfolioNow(supabase, userId, snapshotDate)
  const positions = now.stockPositions
  const onPositions = now.onPositions
  const cashBalance = now.cashBalance

  if (positions.length === 0 && onPositions.length === 0 && cashBalance === 0) {
    return null
  }

  const tickers = [
    ...positions.map((p: any) => p.ticker),
    ...onPositions.map((p: any) => p.ticker),
  ]
  const { stockQuotes, onQuotes } = splitQuotesByAssetClass(
    await fetchQuotes(tickers),
    onPositions.map((p: any) => p.ticker)
  )

  return buildSnapshotRow(
    {
      userId,
      positions,
      onPositions,
      realized: now.stockClosedTrades.reduce((s, t) => s + t.pnl, 0),
      onRealized: now.onClosedTrades.reduce((s, t) => s + t.pnl, 0),
      cashBalance,
    },
    stockQuotes,
    onQuotes,
    snapshotDate
  )
}

/**
 * Snapshots a single user, using the CALLER's Supabase client so the request's
 * RLS scope still applies — this is the manual path behind
 * POST /api/portfolio-history, not a privileged background job.
 */
export async function snapshotUser(
  supabase: any,
  userId: string,
  snapshotDate: string
): Promise<SnapshotUserResult> {
  const row = await computeLiveSnapshotRow(supabase, userId, snapshotDate)
  if (!row) return { ok: false, error: 'Nothing to snapshot', status: 400 }

  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .upsert(row, { onConflict: 'user_id,snapshot_date' })
    .select()
    .single()

  if (error) return { ok: false, error: error.message, status: 500 }
  return { ok: true, snapshot: data }
}
