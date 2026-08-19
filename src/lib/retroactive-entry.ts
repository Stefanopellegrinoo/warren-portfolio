/**
 * Which measured snapshots an entry invalidated.
 *
 * `portfolio_snapshots` records the state of the SYSTEM, not the state of the
 * world: the daily job values whatever `positions`, `on_positions` and
 * `cash_balance` hold at 23:00 ART. An operation entered later than it happened
 * was missing from every measured row in between, and nothing recomputes a
 * measured row.
 *
 * Measured case: DNCBD (25,125.00) dated 2026-07-02, entered 2026-07-24 18:20
 * UTC. The 2026-07-23 row's `total_invested` is 25,125.00 low, and the
 * arithmetic closes exactly against the next day's.
 *
 * WORKER-SAFE: the only import is series-provenance, which imports nothing.
 */
import { isEstimated, type DatedSourcePoint } from './series-provenance'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * When the daily job wrote the row stamped `snapshotDate`.
 *
 * The job runs `0 2 * * 2-6` UTC (`src/lib/queue.ts`), which is 23:00 ART of
 * the day it stamps — so the row for day S is written at 02:00 UTC on S+1.
 *
 * This is a convention, not a stored fact: `portfolio_snapshots` has no
 * `created_at`, and adding one would default the existing rows to `now()` and
 * claim they were all written today, which is false for every one of them. The
 * convention is wrong only if the cron changes, in which case the job's own
 * comment block — which explains why the hour is load-bearing — changes with it.
 */
export function snapshotWriteTime(snapshotDate: string): Date {
  return new Date(new Date(`${snapshotDate}T02:00:00.000Z`).getTime() + DAY_MS)
}

/**
 * The measured snapshots that had already been written when this entry arrived.
 *
 * NO LAG THRESHOLD APPEARS HERE, and that is the point. Comparing each entry
 * against the write time of THAT row excludes the bulk import on its own: those
 * rows carry operation dates years old but were created long before any live
 * snapshot existed. Measured on the live DB 2026-08-03: 1 of 28 live rows
 * flagged, zero false positives, where a naive `lag > 30d` rule flags 118.
 *
 * `entryRecordedAt` is `created_at` for the historical pass and `now` at POST
 * time — where the comparison is satisfied by every row the query returns,
 * because a row exists only after it was written. One rule, two vantage points.
 *
 * Reconstructed rows are out of scope: their write time is when the backfill
 * ran, which is not stored, and unlike a measured row they can be reconstructed
 * again.
 */
export function staleSnapshots(
  entryDate: string,
  entryRecordedAt: Date,
  snapshots: DatedSourcePoint[]
): string[] {
  const recordedAt = entryRecordedAt.getTime()
  // An unparseable timestamp must warn about NOTHING rather than about
  // everything: `NaN > x` is false, so the filter below already fails this way,
  // and the guard makes that intent explicit rather than incidental.
  if (!Number.isFinite(recordedAt)) return []

  return snapshots
    .filter(
      (point) =>
        !isEstimated(point) &&
        // Both sides are YYYY-MM-DD, so lexicographic order IS chronological
        // order — the same TZ-proof string comparison `trade-stats.ts` uses.
        point.snapshot_date >= entryDate &&
        recordedAt > snapshotWriteTime(point.snapshot_date).getTime()
    )
    .map((point) => point.snapshot_date)
    .sort()
}
