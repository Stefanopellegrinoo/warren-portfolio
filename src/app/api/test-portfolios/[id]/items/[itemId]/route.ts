import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { loadOnAnalyses } from '@/lib/on-catalog'
import { ItemUpdateSchema } from '@/lib/schemas/test-portfolio'
import { BAD_ID, dbFail, fail, itemRefusal, parseBody, toItem, validId, type ItemRow } from '@/lib/test-portfolios'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string; itemId: string } }
const COLS = 'id, isin, input_mode, amount, manual_price'

/** PATCH /api/test-portfolios/[id]/items/[itemId]: edits mode, amount or manual price; the merged item is re-validated. */
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  if (!validId(params.id) || !validId(params.itemId)) return BAD_ID()
  const [body, bad] = await parseBody(req, ItemUpdateSchema)
  if (bad) return bad

  const { data: current, error: readError } = await auth.supabase.from('test_portfolio_items').select(COLS).eq('id', params.itemId).eq('portfolio_id', params.id).maybeSingle()
  if (readError) return dbFail(readError, 'item')
  if (!current) return fail('Esa ON no está en la cartera', 404)
  const merged = { ...toItem(current as ItemRow), ...body }

  try {
    const { analyses } = await loadOnAnalyses(auth.supabase, { isin: merged.isin })
    const analysis = analyses[0]
    if (!analysis) return fail('No encontramos esa ON en el catálogo', 404)
    const refusal = itemRefusal(analysis, merged)
    if (refusal) return fail(refusal, 422)
  } catch (e) {
    console.error('[Test portfolios API] Failed to load the catalog:', e)
    return fail('No se pudo cargar el catálogo de ONs', 500)
  }

  const patch: Record<string, unknown> = {}
  if (body.mode !== undefined) patch.input_mode = body.mode
  if (body.amount !== undefined) patch.amount = body.amount
  if (body.manualPrice !== undefined) patch.manual_price = body.manualPrice
  const { data, error } = await auth.supabase.from('test_portfolio_items').update(patch).eq('id', params.itemId).eq('portfolio_id', params.id).select(COLS).maybeSingle()
  if (error) return dbFail(error, 'item')
  if (!data) return fail('Esa ON no está en la cartera', 404)
  return NextResponse.json({ item: toItem(data as ItemRow) })
}

/** DELETE /api/test-portfolios/[id]/items/[itemId] */
export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  if (!validId(params.id) || !validId(params.itemId)) return BAD_ID()

  const { data, error } = await auth.supabase.from('test_portfolio_items').delete().eq('id', params.itemId).eq('portfolio_id', params.id).select('id')
  if (error) return dbFail(error, 'item')
  if (!data || data.length === 0) return fail('Esa ON no está en la cartera', 404)
  return new NextResponse(null, { status: 204 })
}
