import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { loadOnAnalyses } from '@/lib/on-catalog'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ons: the ON explorer list. READ ONLY. Analytics are computed per
 * request from the stored catalog, overrides and the live data912 D price
 * (never persisted); the detail data (schedule, terms) stays on /api/ons/[isin].
 */
export async function GET() {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  try {
    const { analyses, asOf, stale, prices } = await loadOnAnalyses(auth.supabase)
    return NextResponse.json({ rows: analyses.map((a) => a.row), asOf, stale, prices })
  } catch (error) {
    console.error('[ONs API] Failed to load the ON catalog:', error)
    return NextResponse.json({ error: 'No se pudo cargar el catálogo de ONs' }, { status: 500 })
  }
}
