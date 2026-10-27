/**
 * When Supabase does not answer, the auth client retries each session refresh for up to 30 s (auth-js 2.99:
 * network errors and 502/503/504, backoff 200 ms doubling), and every page request and prefetch goes through
 * the middleware's refresh: 7,845 token requests in 2 minutes during the 2026-10-27 restart
 * (odd/tasks/supabase-efficiency.md S5). After TRIP_AFTER refreshes in a row fail that way, the next ones
 * fail at once, without the network, for OPEN_MS; then one goes through to probe, and the rest wait for its
 * answer behind a new pause (a probe that hangs only holds one pause). A healthy server is never limited, so
 * in a slow outage the refreshes already in flight before the first failure still reach it. A single blip
 * never trips it: auth-js's own next attempt absorbs it, as before. The failure they see is the same kind (a
 * network error), so nothing about the session changes: only requests that could not have succeeded are not
 * sent.
 */
export const OPEN_MS = 30_000
export const TRIP_AFTER = 3

/** A token refresh that failed because the auth server could not answer, not because it refused. */
const unavailable = (status: number) => status === 502 || status === 503 || status === 504 || status >= 520

export function authBreakerFetch(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  now: () => number = Date.now,
): typeof fetch {
  let openUntil = 0
  let failures = 0
  const failed = () => {
    if (++failures < TRIP_AFTER) return
    if (now() >= openUntil) console.warn(`[auth] Supabase auth is not answering: session refreshes skipped for ${OPEN_MS / 1000} s`)
    openUntil = now() + OPEN_MS
  }
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    // Refreshes only: a sign-in or a code exchange always reaches the auth server.
    if (!url.includes('/auth/v1/token') || !url.includes('grant_type=refresh_token')) return fetchImpl(input, init)
    if (now() < openUntil) throw new TypeError('Supabase auth is not answering: refresh skipped')
    // Tripped before: this one is the only probe until it answers.
    if (failures >= TRIP_AFTER) openUntil = now() + OPEN_MS
    try {
      const res = await fetchImpl(input, init)
      if (unavailable(res.status)) failed()
      else {
        failures = 0
        openUntil = 0
      }
      return res
    } catch (err) {
      failed()
      throw err
    }
  }
}
