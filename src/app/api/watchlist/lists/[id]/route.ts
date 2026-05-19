import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

type RouteContext = { params: { id: string } }

// ── PATCH /api/watchlist/lists/[id] ──────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: RouteContext) {
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

  const { data, error } = await supabase
    .from('watchlists')
    .update({ name })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !data) {
    if (error?.code === 'PGRST116' || !data) {
      return NextResponse.json({ error: 'Watchlist not found' }, { status: 404 })
    }
    console.error('[PATCH /api/watchlist/lists/[id]] Supabase error:', error)
    return NextResponse.json({ error: 'Failed to update watchlist' }, { status: 500 })
  }

  return NextResponse.json({ id: data.id, name: data.name })
}

// ── DELETE /api/watchlist/lists/[id] ─────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { user, supabase } = authResult

  // Verify ownership
  const { data: watchlist, error: ownershipError } = await supabase
    .from('watchlists')
    .select('id, user_id, name')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (ownershipError || !watchlist) {
    return NextResponse.json({ error: 'Watchlist not found' }, { status: 404 })
  }

  // Check last-list guard
  const { data: allLists, error: countError } = await supabase
    .from('watchlists')
    .select('id')
    .eq('user_id', user.id)

  if (countError) {
    console.error('[DELETE /api/watchlist/lists/[id]] Count error:', countError)
    return NextResponse.json({ error: 'Failed to check watchlist count' }, { status: 500 })
  }

  if ((allLists ?? []).length <= 1) {
    return NextResponse.json(
      { error: 'Cannot delete the last watchlist' },
      { status: 422 }
    )
  }

  // Delete (cascade removes watchlist_items)
  const { error: deleteError } = await supabase
    .from('watchlists')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (deleteError) {
    console.error('[DELETE /api/watchlist/lists/[id]] Delete error:', deleteError)
    return NextResponse.json({ error: 'Failed to delete watchlist' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
