import type { Transaction, Position, ClosedTrade, TransactionInput, Quote, PortfolioSummary, AssetType, Moneda, ONPosition, ONClosedTrade } from '@/types'
import { createServiceClient } from './supabase-server'
import { getRedis, isRedisReady } from './redis'
import { updateWithOptimisticLock } from './concurrency'

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-ASSET PORTFOLIO TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface FullPortfolio {
  stockPositions: Position[]
  onPositions: ONPosition[]
  stockClosedTrades: ClosedTrade[]
  onClosedTrades: ONClosedTrade[]
  cashBalance: number
}

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
 * 2. Update position (with optimistic locking for concurrency)
 * 3. If position closes, write to closed_trades
 * 4. Update positions table
 * 
 * CONCURRENCY STRATEGY:
 * - Uses OPTIMISTIC LOCKING for position updates (fast path)
 * - Falls back to rebuildPosition on first transaction or lock conflicts
 */
export async function processTransaction(
  userId: string,
  input: TransactionInput,
): Promise<{ transaction: Transaction; position: Position | null; closedTrade: ClosedTrade | null }> {
  const supabase = createServiceClient()

  // 1. Insert the transaction first
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
      avg_cost_after: 0, // will be recalculated
      asset_type: (input as any).assetType ?? 'ACCION',
      moneda: (input as any).moneda ?? 'USD',
    })
    .select()
    .single()

  if (insertErr) throw insertErr

  // 2. Try optimistic lock update first (fast path for concurrent operations)
  let updatedPosition: Position | null = null
  let closedTrade: ClosedTrade | null = null

  try {
    updatedPosition = await updatePositionIncremental(userId, input.ticker, input)
  } catch (error) {
    // FALLBACK: First transaction OR too much contention → rebuild from scratch
    console.warn('[Portfolio Engine] Incremental update failed, rebuilding position:', error)
    await rebuildPosition(userId, input.ticker)

    // Fetch the rebuilt position
    const { data: pos } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId)
      .eq('ticker', input.ticker.toUpperCase().trim())
      .single()

    updatedPosition = pos ?? null
  }

  // 4. Fetch the latest closed trade for this ticker if it was a VENTA
  if (input.operation === 'VENTA') {
    const { data: ct } = await supabase
      .from('closed_trades')
      .select('*')
      .eq('user_id', userId)
      .eq('ticker', input.ticker.toUpperCase().trim())
      .order('close_date', { ascending: false })
      .limit(1)
      .single()
    closedTrade = ct ?? null
  }

  return { transaction: newTx, position: updatedPosition ?? null, closedTrade }
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
 * - Falls back to rebuildPosition for complex scenarios
 * 
 * @throws Error if position doesn't exist (first transaction) or too complex
 */
async function updatePositionIncremental(
  userId: string,
  ticker: string,
  input: TransactionInput
): Promise<Position> {
  const normalizedTicker = ticker.toUpperCase().trim()

  return await updateWithOptimisticLock<Position>(
    'positions',
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
          throw new Error('Position closing — needs rebuildPosition for closed_trade logic')
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
 * Calculates a complete portfolio summary given positions and current quotes.
 * This is used for Dashboard rendering and proactively caching.
 * 
 * PHASE 4: Multi-asset support — stocks, ONs, and cash.
 */
export function calculatePortfolioSummary(
  stockPositions: Position[],
  onPositions: ONPosition[],
  stockQuotes: Map<string, Quote>,
  onQuotes: Map<string, Quote>,
  cashBalance: number,
  stockRealizedPnl: number = 0,
  onRealizedPnl: number = 0
): { positions: Position[]; onPositions: ONPosition[]; summary: PortfolioSummary } {
  // 1. Enrich stock positions
  const enrichedStocks: Position[] = stockPositions.map((pos) => {
    const quote = stockQuotes.get(pos.ticker)
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

  // 2. Enrich ON positions
  const enrichedONs: ONPosition[] = onPositions.map((pos) => {
    const quote = onQuotes.get(pos.ticker)
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

  // 3. Calculate stock summary
  const stocksWithPrices = enrichedStocks.filter(p => p.market_value !== undefined)
  const stock_market_value = stocksWithPrices.reduce((s, p) => s + (p.market_value ?? 0), 0)
  const stock_invested = enrichedStocks.reduce((s, p) => s + p.total_invested, 0)
  const stock_pnl = stock_market_value - stock_invested
  const stock_pnl_pct = stock_invested > 0 ? stock_pnl / stock_invested : 0
  const stock_day_pnl = stocksWithPrices.reduce((s, p) => s + (p.day_change ?? 0), 0)

  // 4. Calculate ON summary
  const onsWithPrices = enrichedONs.filter(p => p.market_value !== undefined)
  const on_market_value = onsWithPrices.reduce((s, p) => s + (p.market_value ?? 0), 0)
  const on_invested = enrichedONs.reduce((s, p) => s + p.total_invested, 0)
  const on_pnl = on_market_value - on_invested
  const on_pnl_pct = on_invested > 0 ? on_pnl / on_invested : 0
  const on_day_pnl = onsWithPrices.reduce((s, p) => s + (p.day_change ?? 0), 0)

  // 5. Calculate totals (stocks + ONs + cash)
  const total_market_value = stock_market_value + on_market_value + cashBalance
  const total_invested = stock_invested + on_invested
  const open_pnl = stock_pnl + on_pnl
  const open_pnl_pct = total_invested > 0 ? open_pnl / total_invested : 0
  const day_pnl = stock_day_pnl + on_day_pnl
  const realized_pnl = stockRealizedPnl + onRealizedPnl

  // Sort stocks by performance (best first) for best/worst performer
  const sortedStocks = [...stocksWithPrices].sort((a, b) => (b.pnl_pct ?? 0) - (a.pnl_pct ?? 0))

  return {
    positions: enrichedStocks,
    onPositions: enrichedONs,
    summary: {
      total_market_value,
      total_invested,
      open_pnl,
      open_pnl_pct,
      day_pnl,
      day_pnl_pct: total_invested > 0 ? day_pnl / total_invested : 0,
      realized_pnl,
      realized_pnl_pct: total_invested > 0 ? realized_pnl / total_invested : 0,
      positions_count: enrichedStocks.length + enrichedONs.length,
      best_performer: sortedStocks[0] ?? null,
      worst_performer: sortedStocks[sortedStocks.length - 1] ?? null,
      // Multi-asset breakdown
      stocks: {
        market_value: stock_market_value,
        invested: stock_invested,
        pnl: stock_pnl,
        pnl_pct: stock_pnl_pct,
        day_pnl: stock_day_pnl,
        day_pnl_pct: stock_invested > 0 ? stock_day_pnl / stock_invested : 0,
        positions_count: enrichedStocks.length,
      },
      ons: {
        market_value: on_market_value,
        invested: on_invested,
        pnl: on_pnl,
        pnl_pct: on_pnl_pct,
        day_pnl: on_day_pnl,
        day_pnl_pct: on_invested > 0 ? on_day_pnl / on_invested : 0,
        positions_count: enrichedONs.length,
      },
      cash: {
        balance: cashBalance,
      },
    }
  }
}

/**
 * Fetch all portfolio data in parallel for a user.
 * Returns stocks, ONs, closed trades, and cash balance.
 */
export async function getFullPortfolio(userId: string): Promise<FullPortfolio> {
  const supabase = createServiceClient()

  // Run all queries in parallel for performance
  const [
    stockPositionsRes,
    onPositionsRes,
    stockClosedRes,
    onClosedRes,
    cashBalanceRes,
  ] = await Promise.all([
    // Stock positions
    supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId)
      .order('total_invested', { ascending: false }),
    // ON positions
    supabase
      .from('on_positions')
      .select('*')
      .eq('user_id', userId)
      .order('total_invested', { ascending: false }),
    // Stock closed trades
    supabase
      .from('closed_trades')
      .select('pnl')
      .eq('user_id', userId),
    // ON closed trades
    supabase
      .from('on_closed_trades')
      .select('pnl')
      .eq('user_id', userId),
    // Cash balance
    supabase
      .from('cash_balance')
      .select('balance')
      .eq('user_id', userId)
      .single(),
  ])

  return {
    stockPositions: stockPositionsRes.data ?? [],
    onPositions: onPositionsRes.data ?? [],
    stockClosedTrades: stockClosedRes.data ?? [],
    onClosedTrades: onClosedRes.data ?? [],
    cashBalance: cashBalanceRes.data?.balance ?? 0,
  }
}

/**
 * Recalculate a single position from scratch.
 * 
 * 1. Fetch all remaining transactions for the ticker.
 * 2. Recalculate cost basis and quantity.
 * 3. Upsert or delete the position.
 * 4. Update closed_trades if needed.
 * 
 * WHEN TO USE:
 * - Data initialization (first transaction for a ticker)
 * - Data correction (when position is inconsistent)
 * - Batch operations (imports, migrations)
 * - FALLBACK when optimistic locking fails (position closes, too much contention)
 * - After deleting a transaction
 * - Complex scenarios (partial sells creating closed_trades)
 * 
 * WHEN NOT TO USE:
 * - Normal concurrent operations (processTransaction uses optimistic locking fast path)
 */
export async function rebuildPosition(userId: string, ticker: string) {
  const supabase = createServiceClient()

  const { data: allTx, error: fetchErr } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('ticker', ticker.toUpperCase().trim())
    .order('date', { ascending: true })
    .order('created_at', { ascending: true })

  if (fetchErr) throw fetchErr

  // Wipe existing closed trades for this ticker — rebuild from scratch
  await supabase
    .from('closed_trades')
    .delete()
    .eq('user_id', userId)
    .eq('ticker', ticker.toUpperCase().trim())

  if (!allTx || allTx.length === 0) {
    await supabase
      .from('positions')
      .delete()
      .eq('user_id', userId)
      .eq('ticker', ticker.toUpperCase().trim())

    if (isRedisReady()) await getRedis()?.del(`summary:${userId}`)
    return null
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

        // Record a closed_trade for EVERY sell, partial or full
        closedTradeRows.push({
          user_id: userId,
          ticker: ticker.toUpperCase().trim(),
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

  // Bulk insert all closed trades for this ticker
  if (closedTradeRows.length > 0) {
    await supabase.from('closed_trades').insert(closedTradeRows)
  }

  // Upsert or delete final position
  if (quantity <= 0.0001) {
    await supabase
      .from('positions')
      .delete()
      .eq('user_id', userId)
      .eq('ticker', ticker.toUpperCase().trim())
  } else {
    avgCost = costBasis / quantity
    await supabase
      .from('positions')
      .upsert({
        user_id: userId,
        ticker: ticker.toUpperCase().trim(),
        quantity,
        avg_cost: avgCost,
        total_invested: costBasis,
        first_bought: firstBought || new Date().toISOString(),
        last_updated: new Date().toISOString(),
      }, { onConflict: 'user_id,ticker' })
  }

  if (isRedisReady()) {
    try { await getRedis()?.del(`summary:${userId}`) } catch {}
  }
}

/**
 * Bulk import: insert all transactions at once, then rebuild each affected ticker once.
 * This avoids the race condition with the price worker during sequential imports.
 */
export async function processTransactionBatch(
  userId: string,
  inputs: TransactionInput[],
): Promise<{ imported: number; errors: number; details: string[] }> {
  const supabase = createServiceClient()

  const results = { imported: 0, errors: 0, details: [] as string[] }

  // 1. Bulk insert all transactions in one shot
  const rows = inputs.map(input => ({
    user_id: userId,
    date: input.date,
    ticker: input.ticker.toUpperCase().trim(),
    operation: input.operation,
    quantity: input.operation === 'VENTA' ? -Math.abs(input.quantity) : Math.abs(input.quantity),
    price: input.price,
    commission: input.commission ?? 0,
    notes: input.notes ?? null,
    avg_cost_after: 0, // rebuilt below
    asset_type: input.assetType ?? 'ACCION',
    moneda: input.moneda ?? 'USD',
  }))

  const { error: insertErr } = await supabase
    .from('transactions')
    .insert(rows)

  if (insertErr) {
    results.errors = inputs.length
    results.details.push(`Bulk insert failed: ${insertErr.message}`)
    return results
  }

  results.imported = rows.length

  // 2. Rebuild each affected ticker ONCE — after ALL inserts are done
 const tickers = Array.from(new Set(inputs.map(i => i.ticker.toUpperCase().trim())))

  for (const ticker of tickers) {
    try {
      await rebuildPosition(userId, ticker)
    } catch (err) {
      results.errors++
      results.details.push(`Rebuild failed for ${ticker}: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  return results
}
