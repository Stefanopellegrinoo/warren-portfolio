import { fetchQuotes } from './src/lib/yahoo-finance'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function test() {
  const { data: pos } = await supabase.from('positions').select('*')
  console.log("Positions:", pos)
  
  if (pos && pos.length > 0) {
    const tickers = pos.map((p: any) => p.ticker)
    const quotes = await fetchQuotes(tickers)
    console.log("Quotes:", Array.from(quotes.entries()))
    
    for (const p of pos) {
      const q = quotes.get(p.ticker)
      if (q) {
        const mv = p.quantity * q.price
        const pnl = mv - p.total_invested
        console.log(`[${p.ticker}] Qty: ${p.quantity} | AvgCost: ${p.avg_cost} | Total Inv: ${p.total_invested}`)
        console.log(`          Price: ${q.price} | MV: ${mv} | PNL: ${pnl} (${(pnl/p.total_invested*100).toFixed(2)}%)`)
      }
    }
  }
}

test()
