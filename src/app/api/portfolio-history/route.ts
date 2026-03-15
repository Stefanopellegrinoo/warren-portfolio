import { NextRequest, NextResponse } from 'next/server'
import { createServerClientInstance } from '@/lib/supabase-server'
import { fetchQuotes, fetchHistoricalQuotes } from '@/lib/yahoo-finance'
import { getCachedRoute, cacheRoute } from '@/lib/redis'
import type { Position, Transaction } from '@/types'

// GET: Generate dynamic portfolio history from transactions & historical prices
export async function GET(req: NextRequest) {
  const supabase = createServerClientInstance()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const daysParam = searchParams.get('days') ?? '90'

  // Check Cache First
  const cacheKey = `history:${user.id}:${daysParam}`
  const cachedHistory = await getCachedRoute(cacheKey)
  if (cachedHistory) {
    console.log(`[Cache Hit] Portfolio History for ${user.id} (${daysParam} days)`)
    return NextResponse.json(cachedHistory)
  }
  
  // 1. Fetch all transactions
  const { data: txs, error: txErr } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: true })

  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 })
  const transactions = (txs || []) as Transaction[]

  if (transactions.length === 0) {
    return NextResponse.json({ data: [] })
  }

  // 2. Determine date range
  const today = new Date()
  let fromDate = new Date(transactions[0].date) // Default to first transaction date

  if (daysParam !== 'all') {
    const days = parseInt(daysParam)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    if (cutoff > fromDate) {
      fromDate = cutoff
    }
  }

  // Set times to midnight for clean comparison
  fromDate.setHours(0, 0, 0, 0)
  today.setHours(23, 59, 59, 999)

  // 3. Get all unique tickers
  const tickers = Array.from(new Set(transactions.map(t => t.ticker)))

  // 4. Fetch historical prices for all tickers
  // We need prices from the very first transaction to accurately calculate value, 
  // even if the chart only shows the last 30 days.
  const firstTxDate = new Date(transactions[0].date)
  
  const historicalData = new Map<string, Map<string, number>>() // Map<Ticker, Map<DateString, Price>>
  
  await Promise.all(tickers.map(async (ticker) => {
    const quotes = await fetchHistoricalQuotes(ticker, firstTxDate, today)
    const priceMap = new Map<string, number>()
    
    // Fill the map, tracking the last known price to fill gaps (weekends/holidays)
    let lastPrice = 0
    // We recreate dates to ensure we have a price for everyday
    const current = new Date(firstTxDate)
    let qIdx = 0
    
    while (current <= today) {
      const dateStr = current.toISOString().split('T')[0]
      
      // If we have a quote for this exact date, use it
      if (qIdx < quotes.length && quotes[qIdx].date === dateStr) {
        lastPrice = quotes[qIdx].close
        qIdx++
      }
      
      priceMap.set(dateStr, lastPrice)
      current.setDate(current.getDate() + 1)
    }
    
    historicalData.set(ticker, priceMap)
  }))

  // 5. Generate daily snapshots
  const data: any[] = []
  
  // Track running balances
  const holdings = new Map<string, number>() // ticker -> quantity
  const invested = new Map<string, number>() // ticker -> total invested
  
  let txIdx = 0
  const loopDate = new Date(firstTxDate)
  loopDate.setHours(0, 0, 0, 0)

  while (loopDate <= today) {
    const dateStr = loopDate.toISOString().split('T')[0]
    
    // Apply any transactions that happened on or before this date
    while (txIdx < transactions.length && transactions[txIdx].date.split('T')[0] <= dateStr) {
      const tx = transactions[txIdx]
      const t = tx.ticker
      const currentQty = holdings.get(t) || 0
      const currentInv = invested.get(t) || 0
      
      if (tx.operation === 'COMPRA') {
        holdings.set(t, currentQty + tx.quantity)
        invested.set(t, currentInv + tx.total)
      } else if (tx.operation === 'VENTA') {
        // VENTA quantity is negative, so adding a negative reduces it (or abs subtraction)
        const qtyToReduce = Math.abs(tx.quantity)
        const remainingQty = currentQty - qtyToReduce
        
        if (remainingQty <= 0) {
          holdings.set(t, 0)
          invested.set(t, 0)
        } else {
          holdings.set(t, remainingQty)
          const ratio = remainingQty / currentQty
          invested.set(t, currentInv * ratio)
        }
      }
      txIdx++
    }

    // Only add to output if it's within the requested date range
    if (loopDate >= fromDate || daysParam === 'all') {
      let total_value = 0
      let total_invested = 0

      // Calculate value based on holdings and historical price for this day
      const holdingEntries = Array.from(holdings.entries())
      for (let i = 0; i < holdingEntries.length; i++) {
        const [t, qty] = holdingEntries[i]
        if (qty > 0) {
          const prices = historicalData.get(t)
          // If it's the exact 'today' date, try to use the live quote!
          let price = prices?.get(dateStr) || 0
          
          if (dateStr === today.toISOString().split('T')[0]) {
             // In a perfect world we would await fetchQuotes[T] here, but to avoid an N+1 await in a daily loop, 
             // we will instead patch today's exact LIVE value outside the loop!
          }

          total_value += qty * price
          total_invested += (invested.get(t) || 0)
        }
      }

      const pnl = total_value - total_invested
      const pnl_pct = total_invested > 0 ? pnl / total_invested : 0

      data.push({
        snapshot_date: dateStr,
        total_value,
        total_invested,
        pnl,
        pnl_pct
      })
    }

    loopDate.setDate(loopDate.getDate() + 1)
  }

  // 6. HOTFIX LIVE QUOTE (Redis)
  // To ensure the very last datapoint always perfectly matches the live Dashboard,
  // we patch the last entry using the live Redis quotes `fetchQuotes`
  if (data.length > 0) {
     const lastData = data[data.length - 1]
     const liveQuotes = await fetchQuotes(tickers) // Hits extremely fast Redis Memory cache 
     
     let live_total_value = 0
     
     const holdingEntries = Array.from(holdings.entries())
     for (let i = 0; i < holdingEntries.length; i++) {
       const [t, qty] = holdingEntries[i]
       if (qty > 0) {
         const liveQuote = liveQuotes.get(t)
         // If a live quote doesn't exist (market closed/err), fallback to the last historical price
         const priceToUse = liveQuote?.price || historicalData.get(t)?.get(lastData.snapshot_date) || 0
         live_total_value += qty * priceToUse
       }
     }
     
     // Recalculate PNL for the last point
     lastData.total_value = live_total_value
     lastData.pnl = live_total_value - lastData.total_invested
     lastData.pnl_pct = lastData.total_invested > 0 ? lastData.pnl / lastData.total_invested : 0
  }

  const responseData = { data }
  await cacheRoute(cacheKey, responseData, 300) // General 5m cache for the final constructed graph

  return NextResponse.json(responseData)
}

// POST: take a snapshot of current portfolio value (call daily via cron or manually)
export async function POST(req: NextRequest) {
  const supabase = createServerClientInstance()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: positions } = await supabase
    .from('positions')
    .select('*')
    .eq('user_id', user.id)

  if (!positions?.length) return NextResponse.json({ error: 'No positions' }, { status: 400 })

  const tickers = positions.map((p: Position) => p.ticker)
  const quotes = await fetchQuotes(tickers)

  const total_value = positions.reduce((s: number, p: Position) => {
    const quote = quotes.get(p.ticker)
    const price = quote?.price ?? p.avg_cost
    return s + price * p.quantity
  }, 0)

  const total_invested = positions.reduce((s: number, p: Position) => s + p.total_invested, 0)
  const pnl = total_value - total_invested
  const pnl_pct = total_invested > 0 ? pnl / total_invested : 0

  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .upsert({
      user_id: user.id,
      snapshot_date: today,
      total_value,
      total_invested,
      pnl,
      pnl_pct,
    }, { onConflict: 'user_id,snapshot_date' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
