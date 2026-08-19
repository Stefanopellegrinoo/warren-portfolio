import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { resolveTickerIdentity } from '@/lib/ticker-identity'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error

  const ticker = new URL(req.url).searchParams.get('ticker')
  if (!ticker || !ticker.trim()) {
    return NextResponse.json({ error: 'ticker is required' }, { status: 400 })
  }

  try {
    return NextResponse.json(await resolveTickerIdentity(ticker))
  } catch (err) {
    // Never answer "unverified but proceed" — the caller must know verification
    // was impossible, not that the ticker was fine.
    console.error('[TickerResolve] resolution failed:', err)
    return NextResponse.json(
      { error: 'Could not verify the ticker right now. Try again shortly.' },
      { status: 503 }
    )
  }
}
