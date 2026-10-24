import { NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'
import { isAuthRetryableFetchError, type SupabaseClient, type User } from '@supabase/supabase-js'

// Global budget per user across every authenticated route (S5).
const USER_LIMIT = 300
const USER_WINDOW_SEC = 60

/** The 401 every authenticated route answers when there is no valid session. */
export const SESSION_EXPIRED = 'Tu sesión venció. Volvé a ingresar.'

interface AuthSuccess {
  supabase: SupabaseClient
  user: User
}

interface AuthFailure {
  error: NextResponse
}

/** Verifies the session with the Auth server, then applies the per-user rate limit (401 / 503 / 429). */
export async function requireUser(): Promise<AuthSuccess | AuthFailure> {
  const supabase = createServerClientInstance()
  // getUser() asks the Auth server to verify the JWT; getSession() trusts the
  // cookie as-is, so a forged cookie would pass (odd/tasks/security-hardening.md S1).
  const { data: { user }, error } = await supabase.auth.getUser()
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
