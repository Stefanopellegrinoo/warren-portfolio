import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { loadOnAnalyses } from '@/lib/on-catalog'
import { analyzePortfolio } from '@/lib/on-portfolio-analytics'
import { MAX_ITEMS, MAX_PORTFOLIOS, PortfolioNameSchema } from '@/lib/schemas/test-portfolio'
import { BAD_ID, dbFail, fail, NOT_FOUND, parseBody, toItem, validId, type ItemRow } from '@/lib/test-portfolios'
import { argentinaDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }
const COLS = 'id, name, created_at, updated_at'
const view = (p: any) => ({ id: p.id, name: p.name, createdAt: p.created_at, updatedAt: p.updated_at })

/** GET /api/test-portfolios/[id]: the portfolio, its items and the computed analysis (nothing derived is stored). */
export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  if (!validId(params.id)) return BAD_ID()

  const { data: portfolio, error } = await auth.supabase.from('test_portfolios').select(COLS).eq('id', params.id).maybeSingle()
  if (error) return dbFail(error, 'portfolio')
  if (!portfolio) return NOT_FOUND()
  const { data: rows, error: itemsError } = await auth.supabase.from('test_portfolio_items').select('id, isin, input_mode, amount, manual_price, created_at').eq('portfolio_id', params.id).order('created_at', { ascending: true })
  if (itemsError) return dbFail(itemsError, 'item')

  try {
    const items = ((rows ?? []) as ItemRow[]).map(toItem)
    const { analyses, asOf, stale, prices } = await loadOnAnalyses(auth.supabase)
    const analysis = analyzePortfolio({ items, analyses, today: argentinaDate() })
    return NextResponse.json({ portfolio: view(portfolio), items, analysis, asOf, stale, prices, limits: { portfolios: MAX_PORTFOLIOS, items: MAX_ITEMS } })
  } catch (e) {
    console.error('[Test portfolios API] Failed to compute the portfolio:', e)
    return fail('No se pudo calcular la cartera', 500)
  }
}

/** PATCH /api/test-portfolios/[id] {name}: rename. */
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  if (!validId(params.id)) return BAD_ID()
  const [body, bad] = await parseBody(req, PortfolioNameSchema)
  if (bad) return bad

  const { data, error } = await auth.supabase.from('test_portfolios').update({ name: body.name }).eq('id', params.id).select(COLS).maybeSingle()
  if (error) return dbFail(error, 'portfolio')
  if (!data) return NOT_FOUND()
  return NextResponse.json({ portfolio: view(data) })
}

/** DELETE /api/test-portfolios/[id]: items go with it (ON DELETE CASCADE). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  if (!validId(params.id)) return BAD_ID()

  const { data, error } = await auth.supabase.from('test_portfolios').delete().eq('id', params.id).select('id')
  if (error) return dbFail(error, 'portfolio')
  if (!data || data.length === 0) return NOT_FOUND()
  return new NextResponse(null, { status: 204 })
}
