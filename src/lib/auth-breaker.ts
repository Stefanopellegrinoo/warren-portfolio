/**
 * When Supabase does not answer, the auth client retries each session refresh for up to 30 s (auth-js 2.99:
 * network errors and 502/503/504, backoff 200 ms doubling), and every page request and prefetch goes through
 * the middleware's refresh: 7,845 token requests in 2 minutes during the 2026-10-27 restart
 * (odd/tasks/supabase-efficiency.md S5). After a refresh fails that way, the next ones fail at once, without
 * the network, for OPEN_MS. The failure they see is the same kind (a network error), so nothing about the
 * session changes: only the requests that could not have succeeded are not sent.
 */
export const OPEN_MS = 30_000

/** A token refresh that failed because the auth server could not answer, not because it refused. */
const unavailable = (status: number) => status === 502 || status === 503 || status === 504 || status >= 520

export function authBreakerFetch(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  now: () => number = Date.now,
): typeof fetch {
  let openUntil = 0
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.includes('/auth/v1/token')) return fetchImpl(input, init)
    if (now() < openUntil) throw new TypeError('Supabase auth is not answering: refresh skipped')
    try {
      const res = await fetchImpl(input, init)
      if (unavailable(res.status)) openUntil = now() + OPEN_MS
      return res
    } catch (err) {
      openUntil = now() + OPEN_MS
      throw err
    }
  }
}
