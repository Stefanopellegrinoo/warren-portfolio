import { NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { fetchData912Prices } from '@/lib/data912-client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createServerClientInstance()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

// Get ON tickers that user has positions in
  const { data: positions } = await supabase
    .from('on_positions')
    .select('ticker')
    .eq('user_id', user.id)
  
  const tickers: string[] = Array.from(new Set((positions || []).map((p: any) => String(p.ticker))))
  
  if (tickers.length === 0) {
    return NextResponse.json({ quotes: {} })
  }
  
  const quotes = await fetchData912Prices(tickers)

  return NextResponse.json({ quotes: Object.fromEntries(quotes) })
}