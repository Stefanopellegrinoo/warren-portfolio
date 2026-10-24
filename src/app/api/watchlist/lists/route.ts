import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { serverError } from '@/lib/api/errors'
import { INVALID_JSON } from '@/lib/api/validation'

export const dynamic = 'force-dynamic'

export interface Watchlist {
  id: string
  name: string
  created_at: string
  item_count: number
}

// ── GET /api/watchlist/lists ──────────────────────────────────────────────────
export async function GET(_req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { user, supabase } = authResult

  const { data, error } = await supabase
    .from('watchlists')
    .select('id, name, created_at, watchlist_items(count)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) {
    return serverError('GET /api/watchlist/lists', error)
  }

  const lists: Watchlist[] = (data ?? []).map((row: { id: string; name: string; created_at: string; watchlist_items: Array<{ count: number }> }) => ({
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    item_count: row.watchlist_items?.[0]?.count ?? 0,
  }))

  return NextResponse.json({ lists })
}

// ── POST /api/watchlist/lists ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { user, supabase } = authResult

  let body: { name?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: INVALID_JSON }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length < 1 || name.length > 50) {
    return NextResponse.json(
      { error: 'El nombre de la lista tiene que tener entre 1 y 50 caracteres' },
      { status: 422 }
    )
  }

  // Check 10-list cap
  const { data: existing, error: countError } = await supabase
    .from('watchlists')
    .select('id')
    .eq('user_id', user.id)

  if (countError) {
    return serverError('POST /api/watchlist/lists', countError)
  }

  if ((existing ?? []).length >= 10) {
    return NextResponse.json(
      { error: 'Llegaste al máximo de 10 listas. Borrá una para crear otra.' },
      { status: 422 }
    )
  }

  const { data, error } = await supabase
    .from('watchlists')
    .insert({ user_id: user.id, name })
    .select()
    .single()

  if (error) {
    return serverError('POST /api/watchlist/lists', error)
  }

  return NextResponse.json({ id: data.id, name: data.name, item_count: 0 }, { status: 201 })
}
