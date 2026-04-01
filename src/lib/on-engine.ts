import type { ONPosition, ONClosedTrade, ONOperation } from '@/types'
import { createServiceClient } from './supabase-server'
import { getRedis, isRedisReady } from './redis'
import { rebuildCashBalance } from './cash-engine'
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
 * - CUPON: create a cash_movement of type CUPON, then update cash balance
 * 
 * CONCURRENCY STRATEGY:
 * - Uses OPTIMISTIC LOCKING for position updates (fast path)
 * - Falls back to rebuildONPosition on first transaction or lock conflicts
 */
export async function processONTransaction(
  userId: string,
  input: ONTransactionInput
): Promise<{ position: ONPosition | null; closedTrade: ONClosedTrade | null }> {
  const supabase = createServiceClient()
  
  const ticker = input.ticker.toUpperCase().trim()
  
  // Validation: ON tickers MUST end with 'D' (Dollar-MEP bonds only)
  if (!ticker.endsWith('D')) {
    throw new Error(`ON tickers must end with 'D' for Dollar-MEP bonds. '${ticker}' is invalid.`)
  }
  
  // User already enters converted values:
  // - Quantity: nominales / 100 (e.g., 20000 nominales → 20)
  // - Price: price × 100 (e.g., 1.00 → 100)
  // No further normalization needed
  
  // Ensure ON exists in ons table (auto-insert if not)
  const { data: existingON } = await supabase
    .from('ons')
    .select('ticker')
    .eq('ticker', ticker)
    .single()
    
  if (!existingON) {
    // Auto-insert into ons table
    const { error: insertError } = await supabase
      .from('ons')
      .upsert({
        ticker,
        currency: 'USD', // Default assumption
        created_at: new Date().toISOString()
      }, {
        onConflict: 'ticker',
        ignoreDuplicates: true
      })
    
    if (insertError) {
      console.error(`[ON Engine] Failed to insert ${ticker}:`, insertError)
    } else {
      console.log(`[ON Engine] Auto-inserted ${ticker} into ons table`)
    }
  }

  if (input.operation === 'CUPON') {
    // Cupones go to cash_movements, not transactions
    // For coupons, quantity is already in converted value (nominales / 100), price is rate (e.g., 0.05 for 5%)
    const couponAmount = input.quantity * input.price // bonds × rate
    await supabase
      .from('cash_movements')
      .insert({
        user_id: userId,
        date: input.date,
        type: 'CUPON',
        amount: couponAmount,
        description: `Cupón ${input.ticker}`,
        ticker: input.ticker.toUpperCase().trim(),
      })

    await rebuildCashBalance(userId)

    // Return current position (unchanged by CUPON)
    const { data: currentPosition } = await supabase
      .from('on_positions')
      .select('*')
      .eq('user_id', userId)
      .eq('ticker', input.ticker.toUpperCase().trim())
      .single()

    return { position: currentPosition ?? null, closedTrade: null }
  }

  // COMPRA or VENTA: insert into transactions table
  const { error: insertErr } = await supabase
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
      avg_cost_after: 0, // will be recalculated
      asset_type: 'ON',
      moneda: 'USD',
    })

  if (insertErr) throw insertErr

  // Try optimistic lock update first (fast path for concurrent operations)
  let updatedPosition: ONPosition | null = null
  let closedTrade: ONClosedTrade | null = null

  try {
    updatedPosition = await updateONPositionIncremental(userId, input.ticker, input)
  } catch (error) {
    // FALLBACK: First transaction OR too much contention → rebuild from scratch
    console.warn('[ON Engine] Incremental update failed, rebuilding position:', error)
    await rebuildONPosition(userId, input.ticker)

    // Fetch the rebuilt position
    const { data: pos } = await supabase
      .from('on_positions')
      .select('*')
      .eq('user_id', userId)
      .eq('ticker', input.ticker.toUpperCase().trim())
      .single()

    updatedPosition = pos ?? null
  }

  // Fetch latest closed trade if VENTA
  if (input.operation === 'VENTA') {
    const { data: ct } = await supabase
      .from('on_closed_trades')
      .select('*')
      .eq('user_id', userId)
      .eq('ticker', input.ticker.toUpperCase().trim())
      .order('close_date', { ascending: false })
      .limit(1)
      .single()
    closedTrade = ct ?? null
  }

  return { position: updatedPosition, closedTrade }
}

/**
 * Incremental position update with optimistic locking.
 * 
 * FAST PATH for concurrent operations:
 * - Reads current position + version
 * - Calculates new avg_cost, quantity, total_invested
 * - Updates with WHERE version = current_version
 * - Retries on conflict
 * 
 * LIMITATIONS:
 * - Only works for simple COMPRA/VENTA (not partial sells that create closed trades)
 * - Falls back to rebuildONPosition for complex scenarios
 * 
 * @throws Error if position doesn't exist (first transaction) or too complex
 */
async function updateONPositionIncremental(
  userId: string,
  ticker: string,
  input: ONTransactionInput
): Promise<ONPosition> {
  const normalizedTicker = ticker.toUpperCase().trim()

  return await updateWithOptimisticLock<ONPosition>(
    'on_positions',
    userId,
    normalizedTicker,
    (currentPosition) => {
      const qty = Math.abs(input.quantity)

      if (input.operation === 'COMPRA') {
        // Weighted average cost calculation
        const newCostBasis = currentPosition.total_invested + (qty * input.price)
        const newQuantity = currentPosition.quantity + qty
        const newAvgCost = newCostBasis / newQuantity

        return {
          quantity: newQuantity,
          avg_cost: newAvgCost,
          total_invested: newCostBasis,
          first_bought: currentPosition.first_bought || input.date,
          last_updated: new Date().toISOString(),
        }
      } else if (input.operation === 'VENTA') {
        // Simple sell: reduce quantity, keep avg_cost
        const newQuantity = currentPosition.quantity - qty
        const newCostBasis = currentPosition.total_invested - (qty * currentPosition.avg_cost)

        // If position closes or goes negative, throw to trigger rebuild
        // (rebuild handles closed trades correctly)
        if (newQuantity <= 0.0001) {
          throw new Error('Position closing — needs rebuildONPosition for closed_trade logic')
        }

        return {
          quantity: newQuantity,
          total_invested: newCostBasis,
          last_updated: new Date().toISOString(),
        }
      }

      throw new Error(`Unknown operation: ${input.operation}`)
    },
    { maxRetries: 3 }
  )
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
