import type { Transaction, Position, ClosedTrade, TransactionInput, Quote, PortfolioSummary } from '@/types'
import { createServiceClient } from './supabase-server'
import { getRedis, isRedisReady } from './redis'

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

  // 6. INVALIDATE CACHE
  if (isRedisReady()) {
    try {
      await getRedis()?.del(`summary:${userId}`)
      console.log(`[Cache] Invalidated summary for ${userId} due to new transaction`)
    } catch (err) {
      console.error('[Cache] Error invalidating summary:', err)
    }
  }

  return { transaction: newTx, position: updatedPosition, closedTrade }
}

/**
 * Calculates a complete portfolio summary given positions and current quotes.
 * This is used for Dashboard rendering and proactively caching.
 */
export function calculatePortfolioSummary(
  positions: Position[],
  quotes: Map<string, Quote>,
  realizedPnl: number = 0
): { positions: Position[]; summary: PortfolioSummary } {
  // 1. Enrich positions
  const enriched: Position[] = positions.map((pos) => {
    const quote = quotes.get(pos.ticker)
    const price = quote?.price
    const market_value = price ? price * pos.quantity : undefined
    const pnl = market_value !== undefined ? market_value - pos.total_invested : undefined
    const pnl_pct = pnl !== undefined && pos.total_invested > 0 ? pnl / pos.total_invested : undefined
    
    const day_change = quote ? quote.change * pos.quantity : undefined
    const day_change_pct = quote ? quote.changePercent : undefined

    return { 
      ...pos, 
      current_price: price, 
      market_value, 
      pnl, 
      pnl_pct,
      day_change,
      day_change_pct
    }
  })

  // 2. Aggregate Summary
  const withPrices = enriched.filter(p => p.market_value !== undefined)
  const total_market_value = withPrices.reduce((s, p) => s + (p.market_value ?? 0), 0)
  const total_invested = enriched.reduce((s, p) => s + p.total_invested, 0)
  const open_pnl = total_market_value - total_invested
  const open_pnl_pct = total_invested > 0 ? open_pnl / total_invested : 0
  const day_pnl = withPrices.reduce((s, p) => s + (p.day_change ?? 0), 0)

  // Sort by performance (best first)
  const sorted = [...withPrices].sort((a, b) => (b.pnl_pct ?? 0) - (a.pnl_pct ?? 0))

  return {
    positions: enriched,
    summary: {
      total_market_value,
      total_invested,
      open_pnl,
      open_pnl_pct,
      day_pnl,
      day_pnl_pct: total_invested > 0 ? day_pnl / total_invested : 0,
      realized_pnl: realizedPnl,
      realized_pnl_pct: total_invested > 0 ? realizedPnl / total_invested : 0,
      positions_count: enriched.length,
      best_performer: sorted[0] ?? null,
      worst_performer: sorted[sorted.length - 1] ?? null,
    }
  }
}
