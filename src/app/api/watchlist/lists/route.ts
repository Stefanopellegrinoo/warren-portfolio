import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

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
    console.error('[GET /api/watchlist/lists] Supabase error:', error)
    return NextResponse.json({ error: 'Failed to fetch watchlists' }, { status: 500 })
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
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length < 1 || name.length > 50) {
    return NextResponse.json(
      { error: 'name must be between 1 and 50 characters' },
      { status: 422 }
    )
  }

  // Check 10-list cap
  const { data: existing, error: countError } = await supabase
    .from('watchlists')
    .select('id')
    .eq('user_id', user.id)

  if (countError) {
    console.error('[POST /api/watchlist/lists] Count error:', countError)
    return NextResponse.json({ error: 'Failed to check watchlist count' }, { status: 500 })
  }

  if ((existing ?? []).length >= 10) {
    return NextResponse.json(
      { error: 'Maximum of 10 watchlists reached' },
      { status: 422 }
    )
  }

  const { data, error } = await supabase
    .from('watchlists')
    .insert({ user_id: user.id, name })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/watchlist/lists] Insert error:', error)
    return NextResponse.json({ error: 'Failed to create watchlist' }, { status: 500 })
  }

  return NextResponse.json({ id: data.id, name: data.name, item_count: 0 }, { status: 201 })
}
