import type { ONPosition, ONClosedTrade, ONOperation } from '@/types'
import { createServerClientInstance, createServiceClient } from './supabase-server'
import { getRedis, isRedisReady } from './redis'
import { rebuildCashBalance, processCashMovement } from './cash-engine'
import { updateWithOptimisticLock } from './concurrency'

export interface ONTransactionInput {
  date: string
  ticker: string
  operation: ONOperation
  quantity: number
  price: number
  commission?: number
  notes?: string
}

/**
 * Process an ON (Obligación Negociable) transaction:
 * - COMPRA/VENTA: insert into transactions table with asset_type='ON', then update position
 * - CUPON: create a transaction record AND a cash_movement of type CUPON, then update cash balance
 * 
 * CONCURRENCY STRATEGY:
 * - Uses ATOMIC SQL RPC (fast path & consistency guaranteed)
 */
export async function processONTransaction(
  userId: string,
  input: ONTransactionInput
): Promise<{ position: ONPosition | null; closedTrade: ONClosedTrade | null }> {
  const supabase = createServerClientInstance()
  
  const ticker = input.ticker.toUpperCase().trim()
  
  // Validation: ON tickers MUST end with 'D' (Dollar-MEP bonds only)
  if (!ticker.endsWith('D')) {
    throw new Error(`ON tickers must end with 'D' for Dollar-MEP bonds. '${ticker}' is invalid.`)
  }
  
  // 1. Call the atomic RPC to handle everything in one DB transaction
  // (CUPON is now handled atomically by the RPC)
  const { data, error: rpcErr } = await supabase.rpc('process_transaction_atomic', {
    p_date: input.date,
    p_ticker: ticker,
    p_operation: input.operation,
    p_quantity: Math.abs(input.quantity),
    p_price: input.price,
    p_commission: input.commission ?? 0,
    p_notes: input.notes ?? null,
    p_asset_type: 'ON',
    p_moneda: 'USD',
  })

  if (rpcErr) {
    console.error('[ON Engine] RPC Error:', rpcErr)
    throw rpcErr
  }

  // 2. Rebuild position if it was a VENTA to handle closed_trades logic
  if (input.operation === 'VENTA') {
    await rebuildONPosition(userId, ticker)
  }

  // 3. Fetch results to return
  const [posRes, ctRes] = await Promise.all([
    supabase.from('on_positions').select('*').eq('user_id', userId).eq('ticker', ticker).single(),
    input.operation === 'VENTA' 
      ? supabase.from('on_closed_trades').select('*').eq('user_id', userId).eq('ticker', ticker).order('close_date', { ascending: false }).limit(1).single()
      : Promise.resolve({ data: null })
  ])

  // 4. Fetch current ON price (non-critical, background operation)
  try {
    const { fetchQuotesWithFallback } = await import('./yahoo-finance')
    await fetchQuotesWithFallback([ticker])
  } catch (priceError) {
    console.warn(`[ON Engine] Failed to fetch price for ${ticker}:`, priceError)
  }

  return { position: posRes.data ?? null, closedTrade: ctRes.data ?? null }
}

/**
 * Rebuild ON position from scratch using all transactions for this ticker.
 * 
 * Same weighted average cost logic as stocks:
 * - COMPRA: new_avg = (old_cost_basis + qty*price) / (old_qty + qty)
 * - VENTA:  avg_cost doesn't change, only qty reduces
 * 
 * WHEN TO USE:
 * - Data initialization (first transaction for a ticker)
 * - Data correction (when position is inconsistent)
 * - Batch operations (imports, migrations)
 * - FALLBACK when optimistic locking fails (position closes, too much contention)
 * - Complex scenarios (partial sells creating closed_trades)
 * 
 * WHEN NOT TO USE:
 * - Normal concurrent operations (processONTransaction uses optimistic locking fast path)
 */
export async function rebuildONPosition(userId: string, ticker: string): Promise<void> {
  const supabase = createServiceClient()
  const normalizedTicker = ticker.toUpperCase().trim()

  // Fetch all ON transactions for this ticker
  const { data: allTx, error: fetchErr } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('ticker', normalizedTicker)
    .eq('asset_type', 'ON')
    .order('date', { ascending: true })
    .order('created_at', { ascending: true })

  if (fetchErr) throw fetchErr

  // Wipe existing closed trades for this ticker — rebuild from scratch
  await supabase
    .from('on_closed_trades')
    .delete()
    .eq('user_id', userId)
    .eq('ticker', normalizedTicker)

  if (!allTx || allTx.length === 0) {
    // No transactions left — delete position
    await supabase
      .from('on_positions')
      .delete()
      .eq('user_id', userId)
      .eq('ticker', normalizedTicker)

    if (isRedisReady()) await getRedis()?.del(`summary:${userId}`)
    return
  }

  let quantity = 0
  let costBasis = 0
  let firstBought: string | null = null
  let avgCost = 0
  const closedTradeRows: object[] = []

  for (const tx of allTx) {
    const qty = Math.abs(tx.quantity)

    if (tx.operation === 'COMPRA') {
      if (quantity === 0) firstBought = tx.date
      costBasis += qty * tx.price
      quantity += qty
      avgCost = costBasis / quantity

    } else if (tx.operation === 'VENTA') {
      if (quantity > 0) {
        const sellQty = Math.min(qty, quantity)
        const proceeds = sellQty * tx.price - (tx.commission || 0)

        // Record a closed_trade for every sell
        closedTradeRows.push({
          user_id: userId,
          ticker: normalizedTicker,
          open_date: firstBought || tx.date,
          close_date: tx.date,
          avg_cost: avgCost,
          close_price: tx.price,
          quantity: sellQty,
          invested: sellQty * avgCost,
          proceeds,
        })

        costBasis -= sellQty * avgCost
        quantity -= sellQty

        if (quantity <= 0.0001) {
          quantity = 0
          costBasis = 0
          firstBought = null
        }
      }
    }
  }

  // Bulk insert closed trades
  if (closedTradeRows.length > 0) {
    await supabase.from('on_closed_trades').insert(closedTradeRows)
  }

  // Upsert or delete final position
  if (quantity <= 0.0001) {
    await supabase
      .from('on_positions')
      .delete()
      .eq('user_id', userId)
      .eq('ticker', normalizedTicker)
  } else {
    avgCost = costBasis / quantity
    await supabase
      .from('on_positions')
      .upsert({
        user_id: userId,
        ticker: normalizedTicker,
        quantity,
        avg_cost: avgCost,
        total_invested: costBasis,
        first_bought: firstBought || new Date().toISOString(),
        last_updated: new Date().toISOString(),
      }, { onConflict: 'user_id,ticker' })
  }

  // Invalidate Redis cache
  if (isRedisReady()) {
    try {
      await getRedis()?.del(`summary:${userId}`)
    } catch (e) {
      console.error('Redis cache invalidation failed:', e)
    }
  }
}
