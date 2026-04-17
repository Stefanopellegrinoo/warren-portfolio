import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { calculatePositionLotsDefinition, enrichLots } from '@/lib/portfolio-engine'
import { fetchQuotes } from '@/lib/yahoo-finance'
import { cached } from '@/lib/cache'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  try {
    const supabase = createServerClientInstance()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const ticker = params.ticker.toUpperCase().trim()

    // 1. Get STATIC LOT DEFINITIONS (Cached for 7 days, invalidated on transactions)
    const lotDefinitions = await cached(
      `lots:def:${user.id}:${ticker}`,
      604800, // 7 days
      async () => {
        const { data: transactions, error: txErr } = await supabase
          .from('transactions')
          .select('*')
          .eq('user_id', user.id)
          .eq('ticker', ticker)
          .in('operation', ['COMPRA', 'VENTA'])

        if (txErr) throw txErr
        return calculatePositionLotsDefinition(transactions || [])
      }
    )

    // 2. Get CURRENT PRICE (Cached by Worker)
    const quotes = await fetchQuotes([ticker])
    const currentPrice = quotes.get(ticker)?.price || 0

    // 3. ENRICH WITH LIVE PERFORMANCE
    const enrichedLots = enrichLots(lotDefinitions, currentPrice)

    return NextResponse.json({ lots: enrichedLots })
  } catch (err: any) {
    console.error(`[Lots API] Error for ${params.ticker}:`, err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
