/**
 * Whether a portfolio_snapshots row was reconstructed by the backfill.
 *
 * The history and statistics now derive every day from the ledger core
 * (odd/tasks/nucleo-ledger.md T4.1), so nothing on screen is "reconstructed"
 * any more. Only the retroactive-entry warning still reads stored snapshots;
 * this module goes with it and with portfolio_snapshots (T5.2).
 *
 * WORKER-SAFE: no imports at all.
 */

/** The minimum shape the check needs. Callers satisfy it structurally. */
export interface DatedSourcePoint {
  snapshot_date: string
  source?: 'live' | 'estimated'
}

/** A row with NO source counts as live (migration 033: not null default 'live'). */
export function isEstimated(point: DatedSourcePoint): boolean {
  return point.source === 'estimated'
}
