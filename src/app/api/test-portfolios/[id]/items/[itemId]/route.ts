import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { loadOnAnalyses } from '@/lib/on-catalog'
import { ItemUpdateSchema } from '@/lib/schemas/test-portfolio'
import { BAD_ID, dbFail, fail, itemRefusal, parseBody, toItem, validId, type ItemRow } from '@/lib/test-portfolios'
import { viewAfterEdit, type Catalog } from '../../view'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string; itemId: string } }
const COLS = 'id, isin, input_mode, amount, manual_price'

/**
 * PATCH /api/test-portfolios/[id]/items/[itemId]: edits mode, amount or manual price; the merged item is re-validated.
 * Answers `{ item, view }`: the view is GET's body, so the page does not ask again (absent if it could not be built).
 */
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

  let catalog: Catalog
  try {
    // The whole catalog, once: it validates the edit and computes the view.
    catalog = await loadOnAnalyses(auth.supabase)
    const analysis = catalog.analyses.find((a) => a.row.isin === merged.isin)
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
  return NextResponse.json({ item: toItem(data as ItemRow), ...await viewAfterEdit(auth.supabase, params.id, catalog) })
}

/** DELETE /api/test-portfolios/[id]/items/[itemId]: 204; with `?view=1`, 200 with `{ view }` (GET's body) when it can be built. */
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  if (!validId(params.id) || !validId(params.itemId)) return BAD_ID()

  const { data, error } = await auth.supabase.from('test_portfolio_items').delete().eq('id', params.itemId).eq('portfolio_id', params.id).select('id')
  if (error) return dbFail(error, 'item')
  if (!data || data.length === 0) return fail('Esa ON no está en la cartera', 404)
  if (new URL(req.url).searchParams.get('view') === '1') {
    const { view } = await viewAfterEdit(auth.supabase, params.id)
    if (view) return NextResponse.json({ view })
  }
  return new NextResponse(null, { status: 204 })
}
