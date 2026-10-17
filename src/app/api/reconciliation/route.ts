import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { reconcileLedger } from '@/lib/ledger-reconciliation'
import { normalizeError } from '@/lib/errors'

export const dynamic = 'force-dynamic'

/** Does replaying the caller's ledger reproduce what the app stores? Read-only, RLS-scoped. */
export async function GET() {
  try {
    const authResult = await requireUser()
    if (isAuthFailure(authResult)) return authResult.error
    const { supabase, user } = authResult

    return NextResponse.json(await reconcileLedger(supabase, user.id))
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: normalizeError(err).message }, { status: 500 })
  }
}
