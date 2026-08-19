/**
 * Canonical read path for portfolio_snapshots.
 *
 * The single way /api/statistics and /api/portfolio-history load the snapshot
 * series — one query shape, one ordering, one error contract. These rows are
 * the ONLY source for Max Drawdown and (post-S1) the evolution chart.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeError } from './errors'
import type { PortfolioSnapshot } from '@/types'

export type { PortfolioSnapshot }

export interface SnapshotSeriesRange {
  /** Inclusive YYYY-MM-DD lower bound. */
  fromDate?: string
  /** Inclusive YYYY-MM-DD upper bound. */
  toDate?: string
}

/**
 * PostgREST caps a response at 1000 rows.
 *
 * A user accumulating one measured snapshot a day takes years to reach that,
 * so this read was safe until the historical backfill — which writes ~1123 rows
 * per user in one go and pushes past the cap immediately. Unpaginated, the
 * ordering guarantees the WORST possible truncation: /api/statistics and
 * /api/portfolio-history would receive the OLDEST 1000 rows and silently drop
 * the newest ~120 days — every measured row among them — while presenting as
 * current. Same PAGE walk as scripts/backfill-snapshots.ts and
 * scripts/audit-ticker-names.ts.
 */
const PAGE = 1000

export async function fetchSnapshotSeries(
  supabase: SupabaseClient,
  userId: string,
  range: SnapshotSeriesRange = {}
): Promise<PortfolioSnapshot[]> {
  const rows: PortfolioSnapshot[] = []

  for (let offset = 0; ; offset += PAGE) {
    let query = supabase
      .from('portfolio_snapshots')
      .select('*')
      .eq('user_id', userId)

    if (range.fromDate) query = query.gte('snapshot_date', range.fromDate)
    if (range.toDate) query = query.lte('snapshot_date', range.toDate)

    // The order clause is re-applied on every page ON PURPOSE: it is what makes
    // the pages concatenate into one ascending series instead of an arbitrary
    // interleaving. Without it Postgres guarantees nothing across two
    // LIMIT/OFFSET reads.
    const { data, error } = await query
      .order('snapshot_date', { ascending: true })
      .range(offset, offset + PAGE - 1)

    if (error) throw normalizeError(error)

    const page = (data ?? []) as PortfolioSnapshot[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}
