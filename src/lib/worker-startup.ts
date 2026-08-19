import { ensureRedisConnected } from './redis'
import { scheduleRepeatingPriceJob, scheduleDailySnapshotJob, scheduleTickerAuditJob } from './queue'
import { scheduleSignalsEvaluationJobs } from './signals-queue'

export type StartupResult =
  | { ok: true }
  | { ok: false; reason: 'redis-unreachable' }
  | { ok: false; reason: 'schedule-failed'; error: unknown }

/** What the caller should do about a StartupResult. Kept separate from the
 *  process.exit call itself so the mapping is unit-testable. */
export type StartupOutcome =
  | { exit: false }
  | { exit: true; code: number; message: string }

/** Maps a startup result to an exit decision. A non-zero exit is what lets
 *  Docker's restart policy retry instead of leaving the worker hung. */
export function resolveStartupOutcome(result: StartupResult): StartupOutcome {
  if (result.ok) return { exit: false }

  if (result.reason === 'redis-unreachable') {
    return {
      exit: true,
      code: 1,
      message: '[Worker] Redis unreachable — cannot schedule jobs, exiting for restart',
    }
  }

  const detail = result.error instanceof Error ? result.error.message : String(result.error)
  return {
    exit: true,
    code: 1,
    message: `[Worker] Failed to schedule jobs — exiting for restart: ${detail}`,
  }
}

/** Ensures Redis is reachable, then schedules the repeating price + signals jobs.
 *  Returns a status instead of exiting so it can be unit-tested; the caller
 *  (price-worker main) decides to process.exit. */
export async function ensureRedisAndScheduleJobs(): Promise<StartupResult> {
  const ready = await ensureRedisConnected()
  if (!ready) return { ok: false, reason: 'redis-unreachable' }
  try {
    await scheduleRepeatingPriceJob(5)
    await scheduleDailySnapshotJob()
    await scheduleTickerAuditJob()
    await scheduleSignalsEvaluationJobs()
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: 'schedule-failed', error }
  }
}
