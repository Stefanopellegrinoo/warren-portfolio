import { NextRequest, NextResponse } from 'next/server'
import { fetchQuotes, fetchQuotesWithFallback } from '@/lib/yahoo-finance'
import { createServerClientInstance } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const raw = searchParams.get('tickers') ?? searchParams.get('ticker') ?? ''
  const tickers = raw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)

  if (tickers.length === 0) {
    return NextResponse.json({ error: 'tickers required' }, { status: 400 })
  }

  const supabase = createServerClientInstance()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    let quotes = await fetchQuotes(tickers)
    const missing = tickers.filter(t => !quotes.get(t))
    if (missing.length > 0) {
      const fresh = await fetchQuotesWithFallback(missing)
      fresh.forEach((v, k) => quotes.set(k, v))
    }

    const result = tickers.map(t => {
      const q = quotes.get(t)
      return {
        ticker: t,
        price: q?.price ?? null,
        change_pct: q?.changePercent ?? null,
        last_updated: q?.updatedAt ?? null,
      }
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[/api/quote]', err)
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 })
  }
}
