// Where signing in sends the user back to, and the login URL that remembers it. Pure, so the
// middleware (edge), the auth callback, the login page and client fetch wrappers share it.

export const DEFAULT_AFTER_LOGIN = '/dashboard'

/**
 * `raw` as a same-origin path (path, query and hash), or the Resumen when it would leave `origin`.
 * A prefix check misses `/\evil.com` and `/<tab>/evil.com`, which browsers resolve off-site, so the
 * target is resolved against our origin, then resolved again the way the redirect will: dot
 * segments (`/..//evil.com`) collapse to `//evil.com` (odd/tasks/security-hardening.md S7).
 */
export function safeNextPath(raw: string | null | undefined, origin: string): string {
  if (!raw) return DEFAULT_AFTER_LOGIN
  try {
    const target = new URL(raw, origin)
    const path = target.pathname + target.search + target.hash
    if (target.origin === origin && new URL(path, origin).origin === origin) return path
  } catch {
    // unparsable target: keep the default
  }
  return DEFAULT_AFTER_LOGIN
}

/** The login page that returns to `next` after signing in; `expired` makes it say the session ran out. */
export function loginPath(next: string, expired: boolean): string {
  const params = new URLSearchParams({ next })
  if (expired) params.set('motivo', 'sesion')
  return `/auth/login?${params}`
}
