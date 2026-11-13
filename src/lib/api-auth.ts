import { NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'

// Global budget per user across every authenticated route (S5).
const USER_LIMIT = 300
const USER_WINDOW_SEC = 60

/** The 401 every authenticated route answers when there is no valid session. */
export const SESSION_EXPIRED = 'Tu sesión venció. Volvé a ingresar.'

interface AuthSuccess {
  supabase: SupabaseClient
  /** The verified JWT's subject: every route only needs the id. */
  user: { id: string }
}

interface AuthFailure {
  error: NextResponse
}

// What getClaims() throws (instead of returning) for a JWT that is expired or malformed: a bad
// session. Anything else it throws (an SDK or WebCrypto failure) is a server fault, not a logout.
const BAD_JWT = new Set(['JWT has expired', 'Missing exp claim', 'Invalid alg claim'])

function badJwtAsUnauthorized(err: unknown): { data: null; error: { message: string; status: number } } {
  const malformed = err instanceof SyntaxError || (typeof DOMException !== 'undefined' && err instanceof DOMException)
  if (malformed || (err instanceof Error && BAD_JWT.has(err.message))) {
    return { data: null, error: { message: (err as Error).message, status: 401 } }
  }
  throw err
}

/** Verifies the session's JWT signature, then applies the per-user rate limit (401 / 503 / 429). */
export async function requireUser(): Promise<AuthSuccess | AuthFailure> {
  const supabase = createServerClientInstance()
  // getSession() alone trusts the cookie as-is, so a forged cookie would pass
  // (odd/tasks/security-hardening.md S1). getClaims() verifies the JWT's ES256 signature and
  // expiry against the project's JWKS (cached 10 min), with no Auth round trip per request.
  // ponytail: a signed-out or banned user's JWT stays valid until it expires (1 h); switch
  // back to getUser() if immediate revocation ever matters more than ~100-600 ms per call.
  const { data, error } = await supabase.auth.getClaims().catch(badJwtAsUnauthorized)
  const user = data?.claims?.sub ? { id: data.claims.sub } : null
  // An Auth outage is not a bad session: 503 tells the client to retry, not to log in again.
  if (error && (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500)) {
    console.error('[requireUser] Auth server unavailable:', error.message)
    return { error: NextResponse.json({ error: 'No se pudo verificar tu sesión. Probá de nuevo en unos minutos.' }, { status: 503 }) }
  }
  if (error || !user) {
    return { error: NextResponse.json({ error: SESSION_EXPIRED }, { status: 401 }) }
  }
  if (!(await rateLimit(`rl:user:${user.id}`, USER_LIMIT, USER_WINDOW_SEC))) {
    return { error: tooManyRequests(USER_WINDOW_SEC) }
  }
  return { supabase, user }
}

export function isAuthFailure(result: AuthSuccess | AuthFailure): result is AuthFailure {
  return 'error' in result
}
