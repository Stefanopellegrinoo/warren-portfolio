import { NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import type { SupabaseClient, User } from '@supabase/supabase-js'

interface AuthSuccess {
  supabase: SupabaseClient
  user: User
}

interface AuthFailure {
  error: NextResponse
}

export async function requireUser(): Promise<AuthSuccess | AuthFailure> {
  const supabase = createServerClientInstance()
  // getUser() asks the Auth server to verify the JWT; getSession() trusts the
  // cookie as-is, so a forged cookie would pass (odd/tasks/security-hardening.md S1).
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { supabase, user }
}

export function isAuthFailure(result: AuthSuccess | AuthFailure): result is AuthFailure {
  return 'error' in result
}
