/**
 * Reuse for the worker's per-minute cycle (odd/tasks/supabase-efficiency.md S2-S3): what only a write
 * changes (every ledger, the ON schedules, the trade-date FX) is read again only when the ledger version
 * moved (invalidateUserCache moves it on every user write), on a new Argentine day, or after MAX_AGE_MS,
 * the bound for a write that skips the bump (a script, a half-failed write). With Redis unable to give
 * the version it reads every time, as before.
 *
 * WORKER-SAFE: relative value imports only.
 */
import { readAlertsVersion, readLedgerVersion } from './redis'
import { argentinaDate } from './utils'

export const MAX_AGE_MS = 60 * 60_000

interface Clock {
  version: () => Promise<string | null>
  today: () => string
  now: () => number
}
const clockOf = (version: () => Promise<string | null>): Clock => ({ version, today: () => argentinaDate(), now: () => Date.now() })

/** Every ledger-derived read: moved by invalidateUserCache on every user write. */
export const memoByLedgerVersion = <T>(load: () => Promise<T>) => memoByVersion(load, clockOf(async () => readLedgerVersion()))
/** The active price alerts: moved by bumpAlertsVersion on every alert write (odd/tasks/supabase-efficiency.md S4). */
export const memoByAlertsVersion = <T>(load: () => Promise<T>) => memoByVersion(load, clockOf(async () => readAlertsVersion()))

export function memoByVersion<T>(load: () => Promise<T>, clock: Clock): () => Promise<T> {
  let memo: { key: string; at: number; value: Promise<T> } | null = null
  return async () => {
    // Read before loading: a write that lands during the load moves the version past this key.
    const version = await clock.version().catch(() => null)
    if (version === null) return load()
    const key = `${version}|${clock.today()}`
    if (memo && memo.key === key && clock.now() - memo.at < MAX_AGE_MS) return memo.value
    const value = load()
    const entry = { key, at: clock.now(), value }
    memo = entry
    // A failed read is not kept: the next cycle reads again.
    value.catch(() => { if (memo === entry) memo = null })
    return value
  }
}
