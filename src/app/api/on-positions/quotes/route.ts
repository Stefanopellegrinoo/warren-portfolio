import { NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { fetchData912Prices } from '@/lib/data912-client'
import { fetchQuotes, cachePrice } from '@/lib/yahoo-finance'
import type { ONPosition } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createServerClientInstance()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. Get ON tickers that user has positions in
  const { data: positions } = await supabase
    .from('on_positions')
    .select('ticker')
    .eq('user_id', user.id)
  
  const tickers: string[] = Array.from(
    new Set(
      ((positions as Pick<ONPosition, 'ticker'>[] | null) || [])
        .map((p: Pick<ONPosition, 'ticker'>) => String(p.ticker))
    )
  )
  
  if (tickers.length === 0) {
    return NextResponse.json({ quotes: {} })
  }

  // 2. Try loading from Redis LKP first
  const cachedQuotes = await fetchQuotes(tickers)
  
  // 3. Identify missing tickers
  const missingTickers = tickers.filter(t => !cachedQuotes.has(t))
  
  if (missingTickers.length > 0) {
    console.log(`[ON Quotes API] Cache miss for ${missingTickers.length} tickers, fetching from Data912:`, missingTickers)
    try {
      const freshQuotes = await fetchData912Prices(missingTickers)
      
      // Merge and cache fresh quotes
      freshQuotes.forEach((quote, ticker) => {
        cachedQuotes.set(ticker, quote)
        cachePrice(ticker, quote).catch(e => console.error(`[ON Quotes API] Cache error for ${ticker}:`, e))
      })
    } catch (error) {
      console.error('[ON Quotes API] Failed to fetch missing quotes from Data912:', error)
      // Return whatever we have in cache
    }
  }

  return NextResponse.json({ quotes: Object.fromEntries(cachedQuotes) })
}