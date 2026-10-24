import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isAuthFailure } from '@/lib/api-auth'
import { serverError } from '@/lib/api/errors'
import { INVALID_JSON } from '@/lib/api/validation'

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
    return NextResponse.json({ error: INVALID_JSON }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length < 1 || name.length > 50) {
    return NextResponse.json(
      { error: 'El nombre de la lista tiene que tener entre 1 y 50 caracteres' },
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
      return NextResponse.json({ error: 'No encontramos esa lista' }, { status: 404 })
    }
    return serverError('PATCH /api/watchlist/lists/[id]', error)
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
    return NextResponse.json({ error: 'No encontramos esa lista' }, { status: 404 })
  }

  // Check last-list guard
  const { data: allLists, error: countError } = await supabase
    .from('watchlists')
    .select('id')
    .eq('user_id', user.id)

  if (countError) {
    return serverError('DELETE /api/watchlist/lists/[id]', countError)
  }

  if ((allLists ?? []).length <= 1) {
    return NextResponse.json(
      { error: 'No podés borrar tu única lista' },
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
    return serverError('DELETE /api/watchlist/lists/[id]', deleteError)
  }

  return NextResponse.json({ success: true })
}
