/**
 * The one snapshot read behind the retroactive-entry warning.
 *
 * Two routes write a transaction — POST /api/transactions (stocks, CEDEARs) and
 * POST /api/on-positions (ONs, including CUPON). They share no client helper,
 * which is exactly how they drift, so the read and the warning shape live here
 * once. The RULE itself lives in `retroactive-entry.ts`; this file only feeds it.
 *
 * The read itself goes through `fetchSnapshotSeries` — the canonical,
 * PAGINATED path `/api/statistics` and `/api/portfolio-history` already use.
 * A hand-rolled `.select()` here once truncated at PostgREST's 1000-row cap:
 * ascending order means the cut drops the NEWEST rows, which are exactly the
 * `live` ones (the `estimated` rows are the old backfilled span), so a user
 * past 1000 snapshots at-or-after `entryDate` would have gotten a page of
 * nothing but `estimated` rows and the feature would have silently become a
 * no-op. The backfill writes ~1123 rows per user in one go, so that cap is not
 * hypothetical. See `src/lib/api/__tests__/retroactive-warning.test.ts` for the
 * regression test.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { staleSnapshots } from '../retroactive-entry'
import { fetchSnapshotSeries } from '../snapshot-series'

export interface RetroactiveWarning {
  code: 'RETROACTIVE_ENTRY'
  entryDate: string
  staleSnapshots: string[]
}

/**
 * Never throws. The caller has already committed the transaction, and a warning
 * is never worth turning a write that happened into a response saying it did not.
 */
export async function retroactiveWarnings(
  supabase: SupabaseClient,
  userId: string,
  entryDate: string
): Promise<RetroactiveWarning[]> {
  try {
    // `fromDate` is an optimisation on the query, not the rule — staleSnapshots
    // re-checks the date and owns the live/estimated decision.
    const data = await fetchSnapshotSeries(supabase, userId, { fromDate: entryDate })

    const stale = staleSnapshots(entryDate, new Date(), data)
    return stale.length === 0
      ? []
      : [{ code: 'RETROACTIVE_ENTRY', entryDate, staleSnapshots: stale }]
  } catch (err) {
    console.error('[RetroactiveWarning] snapshot read failed:', { userId, entryDate, err })
    return []
  }
}
