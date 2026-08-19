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
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { supabase, user: session.user }
}

export function isAuthFailure(result: AuthSuccess | AuthFailure): result is AuthFailure {
  return 'error' in result
}
