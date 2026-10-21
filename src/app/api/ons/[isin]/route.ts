import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { loadOnAnalyses, loadPriceHistory } from '@/lib/on-catalog'

export const dynamic = 'force-dynamic'

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/

/** GET /api/ons/[isin]: full analysis of one ON (terms, schedule, analytics) plus the D-line price history. READ ONLY. */
export async function GET(_req: Request, { params }: { params: { isin: string } }) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const isin = params.isin.toUpperCase()
  if (!ISIN.test(isin)) return NextResponse.json({ error: 'ISIN inválido' }, { status: 400 })

  try {
    const { analyses, asOf, stale, prices } = await loadOnAnalyses(auth.supabase, { isin })
    const analysis = analyses[0]
    if (!analysis) return NextResponse.json({ error: 'ON no encontrada en el catálogo' }, { status: 404 })
    const history = await loadPriceHistory(auth.supabase, analysis.row.tickerD)
    return NextResponse.json({ analysis, history, asOf, stale, prices })
  } catch (error) {
    console.error('[ONs API] Failed to load ON detail:', error)
    return NextResponse.json({ error: 'No se pudo cargar la ON' }, { status: 500 })
  }
}
