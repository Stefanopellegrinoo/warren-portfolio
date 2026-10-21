import { NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { MAX_ITEMS, MAX_PORTFOLIOS, PortfolioNameSchema } from '@/lib/schemas/test-portfolio'
import { dbFail, parseBody } from '@/lib/test-portfolios'

export const dynamic = 'force-dynamic'

const LIMITS = { portfolios: MAX_PORTFOLIOS, items: MAX_ITEMS }

/** GET /api/test-portfolios: the signed-in user's saved test portfolios (RLS scopes the rows). */
export async function GET() {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error

  const { data, error } = await auth.supabase
    .from('test_portfolios')
    .select('id, name, created_at, updated_at, test_portfolio_items(count)')
    .order('updated_at', { ascending: false })
    .limit(MAX_PORTFOLIOS)
  if (error) return dbFail(error, 'portfolio')
  const portfolios = (data ?? []).map((p: any) => ({ id: p.id, name: p.name, itemCount: p.test_portfolio_items?.[0]?.count ?? 0, createdAt: p.created_at, updatedAt: p.updated_at }))
  return NextResponse.json({ portfolios, limits: LIMITS })
}

/** POST /api/test-portfolios {name}: the owner is always the session user, never a body field. */
export async function POST(req: Request) {
  const auth = await requireUser()
  if (isAuthFailure(auth)) return auth.error
  const [body, bad] = await parseBody(req, PortfolioNameSchema)
  if (bad) return bad

  const { data, error } = await auth.supabase.from('test_portfolios').insert({ user_id: auth.user.id, name: body.name }).select('id, name, created_at, updated_at').single()
  if (error) return dbFail(error, 'portfolio')
  return NextResponse.json({ portfolio: { id: data.id, name: data.name, createdAt: data.created_at, updatedAt: data.updated_at } }, { status: 201 })
}
