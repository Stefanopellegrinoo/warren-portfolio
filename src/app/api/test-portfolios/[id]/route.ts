import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { PortfolioNameSchema } from '@/lib/schemas/test-portfolio'
import { BAD_ID, dbFail, NOT_FOUND, parseBody, validId } from '@/lib/test-portfolios'
import { portfolioOf, portfolioView, PORTFOLIO_COLS } from './view'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

/** GET /api/test-portfolios/[id]: the portfolio, its items and the computed analysis (nothing derived is stored). */
export async function GET(_req: Request, { params }: Ctx) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  if (!validId(params.id)) return BAD_ID()

  const r = await portfolioView(auth.supabase, params.id)
  return 'view' in r ? NextResponse.json(r.view) : r.error
}

/** PATCH /api/test-portfolios/[id] {name}: rename. */
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  if (!validId(params.id)) return BAD_ID()
  const [body, bad] = await parseBody(req, PortfolioNameSchema)
  if (bad) return bad

  const { data, error } = await auth.supabase.from('test_portfolios').update({ name: body.name }).eq('id', params.id).select(PORTFOLIO_COLS).maybeSingle()
  if (error) return dbFail(error, 'portfolio')
  if (!data) return NOT_FOUND()
  return NextResponse.json({ portfolio: portfolioOf(data) })
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
