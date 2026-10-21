import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { getOnPrices, loadOnAnalyses } from '@/lib/on-catalog'
import { loadOnHoldings } from '@/lib/on-holdings'
import { buildMyOnPortfolio } from '@/lib/on-my-portfolio'
import { argentinaDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/** GET /api/ons/mi-cartera: the user's current ON holdings projected forward. READ ONLY; nothing derived is stored. */
export async function GET() {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  try {
    const [holdings, { analyses, asOf, stale, prices }, feed] = await Promise.all([loadOnHoldings(auth.supabase, auth.user.id), loadOnAnalyses(auth.supabase), getOnPrices()])
    // Each held ticker at its own line's quote, like the dashboard; yields stay on the payment-plaza price line.
    const ownPrices = feed ? Object.fromEntries(feed.prices) : {}
    const { analysis, unmapped } = buildMyOnPortfolio({ holdings, analyses, today: argentinaDate(), ownPrices })
    return NextResponse.json({ analysis, unmapped, asOf, stale, prices })
  } catch (error) {
    console.error('[ONs mi-cartera API] Failed to build the portfolio:', error)
    return NextResponse.json({ error: 'No se pudo calcular tu cartera de ONs' }, { status: 500 })
  }
}
