import { NextRequest, NextResponse } from 'next/server'
import { getMarketDataProvider } from '@/lib/market-data'
import { MarketDataError } from '@/lib/market-data/types'
import { requireUser, isAuthFailure } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export interface WatchlistItem {
  id: string
  symbol: string
  added_at: string
  price: number | null
  changePercent: number | null
}

// ── GET /api/watchlist?watchlistId= ──────────────────────────────────────────
export async function GET(req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { user, supabase } = authResult

  const watchlistId = req.nextUrl.searchParams.get('watchlistId')
  if (!watchlistId) {
    return NextResponse.json({ error: 'watchlistId query param is required' }, { status: 400 })
  }

  // Verify ownership
  const { data: watchlist, error: ownershipError } = await supabase
    .from('watchlists')
    .select('id, user_id, name')
    .eq('id', watchlistId)
    .eq('user_id', user.id)
    .single()

  if (ownershipError || !watchlist) {
    return NextResponse.json({ error: 'Watchlist not found' }, { status: 404 })
  }

  const { data: rows, error } = await supabase
    .from('watchlist_items')
    .select('id, symbol, added_at')
    .eq('watchlist_id', watchlistId)
    .order('added_at', { ascending: true })

  if (error) {
    console.error('[GET /api/watchlist] Supabase error:', error)
    return NextResponse.json({ error: 'Failed to fetch watchlist items' }, { status: 500 })
  }

  const provider = getMarketDataProvider()

  const items: WatchlistItem[] = await Promise.all(
    (rows ?? []).map(async (row) => {
      try {
        const quote = await provider.getQuote(row.symbol)
        return {
          id: row.id,
          symbol: row.symbol,
          added_at: row.added_at,
          price: quote.price,
          changePercent: quote.changePercent,
        }
      } catch {
        return {
          id: row.id,
          symbol: row.symbol,
          added_at: row.added_at,
          price: null,
          changePercent: null,
        }
      }
    })
  )

  return NextResponse.json({ items })
}

// ── POST /api/watchlist ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { user, supabase } = authResult

  let body: { symbol?: string; watchlistId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const symbol = body.symbol?.trim()
  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  }

  const watchlistId = body.watchlistId
  if (!watchlistId) {
    return NextResponse.json({ error: 'watchlistId is required' }, { status: 400 })
  }

  // Verify ownership
  const { data: watchlist, error: ownershipError } = await supabase
    .from('watchlists')
    .select('id, user_id, name')
    .eq('id', watchlistId)
    .eq('user_id', user.id)
    .single()

  if (ownershipError || !watchlist) {
    return NextResponse.json({ error: 'Watchlist not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('watchlist_items')
    .insert({ watchlist_id: watchlistId, symbol })
    .select()

  if (error) {
    // Postgres unique violation code
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Already in watchlist' }, { status: 409 })
    }
    console.error('[POST /api/watchlist] Supabase error:', error)
    return NextResponse.json({ error: 'Failed to add to watchlist' }, { status: 500 })
  }

  return NextResponse.json({ symbol, watchlistId }, { status: 201 })
}

// ── DELETE /api/watchlist?symbol=&watchlistId= ────────────────────────────────
export async function DELETE(req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { user, supabase } = authResult

  const symbol = req.nextUrl.searchParams.get('symbol')
  if (!symbol) {
    return NextResponse.json({ error: 'symbol query param is required' }, { status: 400 })
  }

  const watchlistId = req.nextUrl.searchParams.get('watchlistId')
  if (!watchlistId) {
    return NextResponse.json({ error: 'watchlistId query param is required' }, { status: 400 })
  }

  // Verify ownership
  const { data: watchlist, error: ownershipError } = await supabase
    .from('watchlists')
    .select('id, user_id, name')
    .eq('id', watchlistId)
    .eq('user_id', user.id)
    .single()

  if (ownershipError || !watchlist) {
    return NextResponse.json({ error: 'Watchlist not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('watchlist_items')
    .delete()
    .eq('watchlist_id', watchlistId)
    .eq('symbol', symbol)
    .select('id')

  if (error) {
    console.error('[DELETE /api/watchlist] Supabase error:', error)
    return NextResponse.json({ error: 'Failed to delete from watchlist' }, { status: 500 })
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Symbol not found in watchlist' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
