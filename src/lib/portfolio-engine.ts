import type { Transaction, Position, ClosedTrade, TransactionInput } from '@/types'
import { createServiceClient } from './supabase-server'
import redisClient from './redis'
import { addPriceUpdateJob } from './queue'

const PRICE_CACHE_PREFIX = 'stock-price:'
const PRICE_CACHE_TTL = 3600 // 1 hour

/**
 * THE CORE ENGINE
 * 
 * Calculates running weighted average cost correctly:
 * - COMPRA: new_avg = (old_cost_basis + qty*price) / (old_qty + qty)
 * - VENTA:  avg_cost doesn't change — only qty reduces
 * - When qty → 0: position closes, cost basis resets to 0
 * 
 * This is the ONLY correct way — no spreadsheet formula can do this.
 */
export function calculateRunningAvgCost(
  transactions: Pick<Transaction, 'operation' | 'quantity' | 'price'>[],
): { avgCost: number; quantity: number; costBasis: number } {
  let quantity = 0
  let costBasis = 0

  for (const tx of transactions) {
    const qty = Math.abs(tx.quantity)

    if (tx.operation === 'COMPRA') {
      costBasis += qty * tx.price
      quantity += qty
    } else if (tx.operation === 'VENTA') {
      if (quantity > 0) {
        const avgCost = costBasis / quantity
        costBasis -= qty * avgCost   // reduce cost basis proportionally
        quantity -= qty
        if (quantity < 0.0001) {    // position fully closed
          quantity = 0
          costBasis = 0
        }
      }
    }
    // DIVIDENDO: no effect on cost basis
  }

  const avgCost = quantity > 0.0001 ? costBasis / quantity : 0
  return { avgCost, quantity, costBasis }
}

/**
 * Process a new transaction:
 * 1. Insert into transactions table
 * 2. Recalculate position for that ticker
 * 3. If position closes, write to closed_trades
 * 4. Update positions table
 */
export async function processTransaction(
  userId: string,
  input: TransactionInput,
): Promise<{ transaction: Transaction; position: Position | null; closedTrade: ClosedTrade | null }> {
  const supabase = createServiceClient()

  // 1. Get ALL existing transactions for this ticker (ordered by date)
  const { data: existing, error: fetchErr } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('ticker', input.ticker.toUpperCase().trim())
    .order('date', { ascending: true })
    .order('created_at', { ascending: true })

  if (fetchErr) throw fetchErr

  // 2. Build the full transaction list including the new one
  const allTx = [
    ...(existing || []),
    {
      operation: input.operation,
      quantity: input.operation === 'VENTA' ? -Math.abs(input.quantity) : Math.abs(input.quantity),
      price: input.price,
    },
  ]

  // 3. Calculate running avg cost after new transaction
  const { avgCost, quantity, costBasis } = calculateRunningAvgCost(allTx)

  // 4. Insert the transaction
  const { data: newTx, error: insertErr } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      date: input.date,
      ticker: input.ticker.toUpperCase().trim(),
      operation: input.operation,
      quantity: input.operation === 'VENTA' ? -Math.abs(input.quantity) : Math.abs(input.quantity),
      price: input.price,
      commission: input.commission ?? 0,
      notes: input.notes ?? null,
      avg_cost_after: avgCost,
    })
    .select()
    .single()

  if (insertErr) throw insertErr

  let closedTrade: ClosedTrade | null = null
  let updatedPosition: Position | null = null

  // 5. Get current position before update (for closed trade calculation)
  const { data: currentPos } = await supabase
    .from('positions')
    .select('*')
    .eq('user_id', userId)
    .eq('ticker', input.ticker.toUpperCase().trim())
    .single()

  if (quantity <= 0.0001) {
    // Position fully closed — write closed trade
    if (currentPos && input.operation === 'VENTA') {
      const { data: ct, error: ctErr } = await supabase
        .from('closed_trades')
        .insert({
          user_id: userId,
          ticker: input.ticker.toUpperCase().trim(),
          open_date: currentPos.first_bought,
          close_date: input.date,
          avg_cost: currentPos.avg_cost,
          close_price: input.price,
          quantity: Math.abs(input.quantity),
          invested: currentPos.total_invested,
          proceeds: Math.abs(input.quantity) * input.price - (input.commission ?? 0),
        })
        .select()
        .single()
      if (!ctErr) closedTrade = ct
    }

    // Delete position
    await supabase
      .from('positions')
      .delete()
      .eq('user_id', userId)
      .eq('ticker', input.ticker.toUpperCase().trim())

  } else {
    // Upsert position
    const firstBought = currentPos?.first_bought ?? input.date

    const { data: pos, error: posErr } = await supabase
      .from('positions')
      .upsert({
        user_id: userId,
        ticker: input.ticker.toUpperCase().trim(),
        quantity,
        avg_cost: avgCost,
        total_invested: costBasis,
        first_bought: firstBought,
        last_updated: new Date().toISOString(),
      }, { onConflict: 'user_id,ticker' })
      .select()
      .single()

    if (!posErr) updatedPosition = pos
  }

  return { transaction: newTx, position: updatedPosition, closedTrade }
}

/**
 * Fetch quotes from Yahoo Finance for a list of tickers
 */
export async function fetchQuotes(tickers: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>()
  if (!tickers.length) return prices

  const unique = Array.from(new Set(tickers))
  const missing: string[] = []

  // 1. Try to get from Redis
  try {
    const cached = await redisClient.mget(...unique.map(t => `${PRICE_CACHE_PREFIX}${t}`))
    unique.forEach((ticker, i) => {
      if (cached[i]) {
        prices.set(ticker, parseFloat(cached[i]!))
      } else {
        missing.push(ticker)
      }
    })
  } catch (err) {
    console.error('Redis cache error:', err)
    missing.push(...unique)
  }

  // 2. If missing, fetch from Yahoo and cache
  if (missing.length > 0) {
    try {
      const yahooModule = await import('yahoo-finance2')
      const YahooFinance = (yahooModule as any).default || yahooModule
      const yahooFinance = typeof YahooFinance === 'function' ? new YahooFinance() : YahooFinance

      // Set a real browser User-Agent to avoid 429s
      if (typeof (yahooFinance as any).setGlobalConfig === 'function') {
        (yahooFinance as any).setGlobalConfig({
          fetchOptions: {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            }
          }
        })
      }

      if (typeof (yahooFinance as any).suppressNotices === 'function') {
        (yahooFinance as any).suppressNotices(['yahooSurvey'])
      }

      // Map our tickers to Yahoo symbols
      const symbolToTicker = new Map<string, string>()
      const symbols = missing.map(ticker => {
        const symbol = normalizeTickerForYahoo(ticker)
        symbolToTicker.set(symbol, ticker)
        return symbol
      })

      // Fetch ALL at once
      const quotes: any[] = await (yahooFinance as any).quote(symbols, {}, { return: 'array' })

      for (const quote of quotes) {
        if (quote?.regularMarketPrice) {
          const ticker = symbolToTicker.get(quote.symbol)
          if (ticker) {
            const price = quote.regularMarketPrice
            prices.set(ticker, price)
            // Cache in Redis
            await redisClient.setex(`${PRICE_CACHE_PREFIX}${ticker}`, PRICE_CACHE_TTL, price.toString())
          }
        }
      }
    } catch (err) {
      console.error('Yahoo Finance overall error:', err)
    }
  }

  return prices
}

/**
 * Force a background refresh of quotes via BullMQ
 */
export async function refreshQuotes(tickers: string[]) {
  if (!tickers.length) return
  await addPriceUpdateJob(tickers)
}

export function normalizeTickerForYahoo(ticker: string): string {
  const parts = ticker.split(':')
  if (parts.length === 1) return ticker

  const [exchange, symbol] = parts
  switch (exchange.toUpperCase()) {
    case 'BCBA': return `${symbol}.BA`    // Buenos Aires
    case 'NYSE':
    case 'NASDAQ':
    case 'NYSEARCA':
    case 'AMEX': return symbol
    default: return symbol
  }
}
