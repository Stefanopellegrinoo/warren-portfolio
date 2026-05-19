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

// ── GET /api/watchlist ────────────────────────────────────────────────────────
export async function GET(_req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { user, supabase } = authResult

  const { data: rows, error } = await supabase
    .from('watchlist')
    .select('id, symbol, added_at')
    .eq('user_id', user.id)
    .order('added_at', { ascending: true })

  if (error) {
    console.error('[GET /api/watchlist] Supabase error:', error)
    return NextResponse.json({ error: 'Failed to fetch watchlist' }, { status: 500 })
  }

  const provider = getMarketDataProvider()

  const watchlist: WatchlistItem[] = await Promise.all(
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

  return NextResponse.json({ watchlist })
}

// ── POST /api/watchlist ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { user, supabase } = authResult

  let body: { symbol?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const symbol = body.symbol?.trim()
  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('watchlist')
    .insert({ user_id: user.id, symbol })
    .select()

  if (error) {
    // Postgres unique violation code
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Already in watchlist' }, { status: 409 })
    }
    console.error('[POST /api/watchlist] Supabase error:', error)
    return NextResponse.json({ error: 'Failed to add to watchlist' }, { status: 500 })
  }

  return NextResponse.json({ watchlist: data }, { status: 201 })
}

// ── DELETE /api/watchlist?symbol= ─────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const authResult = await requireUser()
  if (isAuthFailure(authResult)) return authResult.error
  const { user, supabase } = authResult

  const symbol = req.nextUrl.searchParams.get('symbol')
  if (!symbol) {
    return NextResponse.json({ error: 'symbol query param is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('watchlist')
    .delete()
    .eq('user_id', user.id)
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
