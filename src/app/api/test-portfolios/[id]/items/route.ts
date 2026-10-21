import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { loadOnAnalyses } from '@/lib/on-catalog'
import { ItemCreateSchema } from '@/lib/schemas/test-portfolio'
import { BAD_ID, dbFail, fail, itemRefusal, parseBody, toItem, validId } from '@/lib/test-portfolios'

export const dynamic = 'force-dynamic'

/** POST /api/test-portfolios/[id]/items: adds an ON. Floating, non-USD and lot-rule violations are rejected here (A7, A8, R4.1). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  if (!validId(params.id)) return BAD_ID()
  const [body, bad] = await parseBody(req, ItemCreateSchema)
  if (bad) return bad

  let refusal: string | null
  try {
    const { analyses } = await loadOnAnalyses(auth.supabase, { isin: body.isin })
    const analysis = analyses[0]
    if (!analysis) return fail('ON no encontrada en el catálogo', 404)
    refusal = itemRefusal(analysis, body)
  } catch (e) {
    console.error('[Test portfolios API] Failed to load the catalog:', e)
    return fail('No se pudo cargar el catálogo de ONs', 500)
  }
  if (refusal) return fail(refusal, 422)

  const { data, error } = await auth.supabase
    .from('test_portfolio_items')
    .insert({ portfolio_id: params.id, isin: body.isin, input_mode: body.mode, amount: body.amount, manual_price: body.manualPrice })
    .select('id, isin, input_mode, amount, manual_price')
    .single()
  if (error) return dbFail(error, 'item')
  return NextResponse.json({ item: toItem(data) }, { status: 201 })
}
