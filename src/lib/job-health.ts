/**
 * Worker heartbeat + job-failure alerts.
 *
 * Worker context: relative imports only — no @/ aliases.
 * Nothing here may break the caller: every function swallows its own errors.
 * Every Redis write carries an expiry (Redis runs maxmemory 128MB, noeviction).
 */

import { getRedis } from './redis'
import { escapeHtml, sendTelegram } from './notifications'

const HEARTBEAT_KEY = 'heartbeat:worker'
/** 3 missed 5-minute price cycles. */
export const HEARTBEAT_TTL_S = 900
/** One alert per worker+job per hour. */
export const ALERT_COOLDOWN_S = 3600

/** Record that the price worker finished a job. Never throws. */
export async function beat(): Promise<void> {
  try {
    await getRedis()?.setex(HEARTBEAT_KEY, HEARTBEAT_TTL_S, new Date().toISOString())
  } catch (e) {
    console.error('[job-health] heartbeat write failed:', e)
  }
}

/** Written every price cycle. Expires so it cannot outlive a dead worker. */
const LAST_REFRESH_TTL_S = 86400

/** Mark the price cache as refreshed. Never throws. */
export async function recordRefresh(): Promise<void> {
  try {
    await getRedis()?.setex('system:last-refresh', LAST_REFRESH_TTL_S, new Date().toISOString())
  } catch (e) {
    console.error('[job-health] last-refresh write failed:', e)
  }
}

/** Stale = key expired (or Redis unreadable). Never throws. */
export async function readBeat(): Promise<{ lastBeat: string | null; stale: boolean }> {
  try {
    const lastBeat = (await getRedis()?.get(HEARTBEAT_KEY)) ?? null
    return { lastBeat, stale: lastBeat === null }
  } catch {
    return { lastBeat: null, stale: true }
  }
}

/** Telegram alert for a failed job, deduped per worker+job. Never throws. */
export async function alertJobFailure(worker: string, jobName: string, err: unknown): Promise<void> {
  try {
    try {
      const claimed = await getRedis()?.set(
        `alert:job-failed:${worker}:${jobName}`, '1', 'EX', ALERT_COOLDOWN_S, 'NX',
      )
      // null = key already exists -> alert sent within the cooldown
      if (claimed === null) return
    } catch (e) {
      // Redis down: better a possible duplicate alert than a silent failure
      console.error('[job-health] alert dedupe failed:', e)
    }
    const reason = escapeHtml((err instanceof Error ? err.message : String(err)).slice(0, 500))
    const r = await sendTelegram(`Job failed: ${escapeHtml(worker)}/${escapeHtml(jobName)}: ${reason}`)
    if (!r?.ok) console.error('[job-health] Telegram alert not delivered:', r?.error)
  } catch (e) {
    console.error('[job-health] alert failed:', e)
  }
}
