import type { Transaction, Position, ClosedTrade, TransactionInput, Quote, PortfolioSummary, AssetType, Moneda, ONPosition, ONClosedTrade } from '@/types'
import { createServerClientInstance, createServiceClient } from './supabase-server'
import { getRedis, isRedisReady } from './redis'
import { updateWithOptimisticLock } from './concurrency'
import { processCashMovement, rebuildCashBalance } from './cash-engine'

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
  transactions: Pick<Transaction, 'operation' | 'quantity' | 'price' | 'commission'>[],
): { avgCost: number; quantity: number; costBasis: number } {
  let quantity = 0
  let costBasis = 0

  for (const tx of transactions) {
    const qty = Math.abs(tx.quantity)
    const comm = tx.commission || 0

    if (tx.operation === 'COMPRA') {
      // Net Cost Basis: Include commission
      costBasis += (qty * tx.price) + comm
      quantity += qty
    } else if (tx.operation === 'VENTA') {
      if (quantity > 0) {
        const avgCost = costBasis / quantity
        // Proportionally reduce cost basis (commissions on sell affect realized PnL, not cost basis)
        costBasis -= qty * avgCost
        quantity -= qty
        if (quantity < 0.0001) {
          quantity = 0
          costBasis = 0
        }
      }
    }
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
 * - Uses ATOMIC SQL RPC (fast path & consistency guaranteed)
 */
export async function processTransaction(
  userId: string,
  input: TransactionInput,
): Promise<{ transaction: Transaction; position: Position | null; closedTrade: ClosedTrade | null }> {
  const supabase = createServerClientInstance()

  // 1. Call the atomic RPC to handle everything in one DB transaction
  const { data, error: rpcErr } = await supabase.rpc('process_transaction_atomic', {
    p_date: input.date,
    p_ticker: input.ticker.toUpperCase().trim(),
    p_operation: input.operation,
    p_quantity: Math.abs(input.quantity),
    p_price: input.price,
    p_commission: input.commission ?? 0,
    p_notes: input.notes ?? null,
    p_asset_type: (input as any).assetType ?? 'ACCION',
    p_moneda: (input as any).moneda ?? 'USD',
  })

  if (rpcErr) {
    console.error('[Portfolio Engine] RPC Error:', rpcErr)
    throw rpcErr
  }

  const { transaction_id } = data

  // 2. Rebuild position if it was a VENTA to handle closed_trades logic
  // (The RPC handles quantity and cost but doesn't manage the closed_trades table yet)
  if (input.operation === 'VENTA') {
    await rebuildPosition(userId, input.ticker)
  }

  // 3. Fetch results to return to frontend
  const [txRes, posRes, ctRes] = await Promise.all([
    supabase.from('transactions').select('*').eq('id', transaction_id).single(),
    supabase.from('positions').select('*').eq('user_id', userId).eq('ticker', input.ticker.toUpperCase().trim()).single(),
    input.operation === 'VENTA' 
      ? supabase.from('closed_trades').select('*').eq('user_id', userId).eq('ticker', input.ticker.toUpperCase().trim()).order('close_date', { ascending: false }).limit(1).single()
      : Promise.resolve({ data: null })
  ])

  // 4. Invalidate Redis cache for this user
  if (isRedisReady()) {
    try {
      const redis = getRedis()
      await redis?.del(`summary:${userId}`)
      console.log(`[Portfolio Engine] Cache invalidated for user ${userId}`)
    } catch (cacheErr) {
      console.warn('[Portfolio Engine] Failed to invalidate cache:', cacheErr)
    }
  }

  // 5. Fetch current price for the ticker (non-critical, background operation)
  try {
    const { fetchQuotesWithFallback } = await import('./yahoo-finance')
    await fetchQuotesWithFallback([input.ticker.toUpperCase().trim()])
  } catch (priceError) {
    console.warn(`[Portfolio Engine] Failed to fetch price for ${input.ticker}:`, priceError)
  }

  return { 
    transaction: txRes.data, 
    position: posRes.data ?? null, 
    closedTrade: ctRes.data ?? null 
  }
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
      .select('*')
      .eq('user_id', userId),
    // ON closed trades
    supabase
      .from('on_closed_trades')
      .select('*')
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
    const comm = tx.commission || 0

    if (tx.operation === 'COMPRA') {
      if (quantity === 0) firstBought = tx.date
      // Net Cost Basis: Include commission
      costBasis += (qty * tx.price) + comm
      quantity += qty
      avgCost = costBasis / quantity

    } else if (tx.operation === 'VENTA') {
      if (quantity > 0) {
        const sellQty = Math.min(qty, quantity)
        // Proceeds: subtract commission of the sell
        const proceeds = sellQty * tx.price - comm

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

        // Reduce cost basis proportionally
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
    const { error: upsertError } = await supabase
      .from('positions')
      .upsert({
        user_id: userId,
        ticker: ticker.toUpperCase().trim(),
        quantity,
        avg_cost: avgCost,
        total_invested: costBasis,
        first_bought: firstBought || new Date().toISOString(),
        last_updated: new Date().toISOString(),
        version: 1, // Required for new positions (migration 004)
      }, { onConflict: 'user_id,ticker' })
    
    if (upsertError) {
      console.error(`[rebuildPosition] Failed to upsert position for ${ticker}:`, upsertError)
      throw new Error(`Failed to upsert position for ${ticker}: ${upsertError.message}`)
    }
  }

  if (isRedisReady()) {
    try { await getRedis()?.del(`summary:${userId}`) } catch {}
  }
}

/**
 * Bulk import: atomically insert all transactions + cash_movements, then rebuild positions.
 * 
 * ATOMICITY:
 * - Uses Postgres stored procedure (import_transactions_atomic) with BEGIN/COMMIT/ROLLBACK
 * - If ANY transaction fails validation or insert, the ENTIRE batch is rolled back
 * - No partial imports = data consistency guaranteed
 * 
 * FEATURES:
 * - Detailed error reporting with line numbers
 * - Creates cash_movements linked to transactions
 * - Rebuilds positions after successful import
 * - Rebuilds cash balance after successful import
 * 
 * PROGRESS CALLBACK:
 * - Optional onProgress(percentage, message) for real-time tracking
 */
export async function processTransactionBatch(
  userId: string,
  inputs: TransactionInput[],
  onProgress?: (percentage: number, message: string) => void | Promise<void>
): Promise<{ 
  success: boolean
  imported: number
  failed: number
  errors: Array<{ line: number; ticker: string; error: string }>
}> {
  const supabase = createServiceClient()

  try {
    // Report initial progress
    if (onProgress) await onProgress(10, 'Validating transactions...')

    // Convert inputs to JSONB format for stored procedure
    const transactionsJson = inputs.map(input => ({
      date: input.date,
      ticker: input.ticker,
      operation: input.operation,
      quantity: input.quantity,
      price: input.price,
      commission: input.commission ?? 0,
      notes: input.notes ?? null,
      assetType: (input as any).assetType ?? 'ACCION',
      moneda: (input as any).moneda ?? 'USD',
    }))

    if (onProgress) await onProgress(15, 'Ensuring tickers exist in activos...')

    // Auto-create missing tickers in activos table
    // This prevents FK constraint violations when creating positions
    const uniqueTickers = Array.from(new Set(inputs.map(i => i.ticker.toUpperCase().trim())))
    
    for (const ticker of uniqueTickers) {
      const { error: activoError } = await supabase
        .from('activos')
        .upsert(
          { 
            ticker, 
            nombre: ticker // Fallback: use ticker as name (TODO: fetch from Yahoo Finance)
          },
          { onConflict: 'ticker', ignoreDuplicates: true }
        )
      
      if (activoError) {
        console.warn(`[Batch Import] Failed to upsert activo ${ticker}:`, activoError)
        // Don't fail the import - the stored procedure will catch FK violations if needed
      } else {
        console.log(`[Batch Import] ✓ Ensured activo exists: ${ticker}`)
      }
    }

    if (onProgress) await onProgress(20, `Importing ${inputs.length} transactions...`)

    // Call atomic stored procedure
    const { data, error } = await supabase.rpc('import_transactions_atomic', {
      p_user_id: userId,
      p_transactions: transactionsJson as any,
    })

    if (error) {
      console.error('[Batch Import] Stored procedure error:', error)
      
      // Extract line number and details from Postgres error message
      let parsedErrors: any[] = []
      const errorMessage = error.message || 'Unknown error during batch import'
      
      // Try to parse "Line N:" pattern from error message
      const lineMatch = errorMessage.match(/Line (\d+):/)
      if (lineMatch) {
        const lineNumber = parseInt(lineMatch[1])
        const cleanError = errorMessage.replace(/^Line \d+:\s*/, '')
        parsedErrors = [{
          line: lineNumber,
          ticker: 'UNKNOWN',
          error: cleanError
        }]
      } else {
        // Generic error without line number
        parsedErrors = [{ 
          line: 0, 
          ticker: 'UNKNOWN', 
          error: errorMessage
        }]
      }
      
      return {
        success: false,
        imported: 0,
        failed: inputs.length,
        errors: parsedErrors,
      }
    }

    // Parse stored procedure result
    const result = Array.isArray(data) ? data[0] : data
    
    console.log('[Batch Import] Stored procedure result:', JSON.stringify(result, null, 2))
    
    if (!result.success) {
      // Batch failed, rollback happened
      const errorDetails = typeof result.error_details === 'string' 
        ? JSON.parse(result.error_details)
        : result.error_details || []

      console.log('[Batch Import] Import failed, rollback triggered. Errors:', errorDetails)

      return {
        success: false,
        imported: 0,
        failed: result.failed || inputs.length,
        errors: Array.isArray(errorDetails) ? errorDetails : [],
      }
    }

    console.log(`[Batch Import] Import successful! Imported: ${result.imported}, now rebuilding positions...`)

    // Success! Now rebuild positions and cash in parallel for performance
    if (onProgress) await onProgress(60, 'Rebuilding positions...')

    const tickers = Array.from(new Set(inputs.map(i => i.ticker.toUpperCase().trim())))
    const tickerErrors: Array<{ line: number; ticker: string; error: string }> = []

    // Rebuild all positions in parallel
    await Promise.all(tickers.map(async (ticker) => {
      try {
        console.log(`[Batch Import] Rebuilding position for ${ticker}...`)
        await rebuildPosition(userId, ticker)
        console.log(`[Batch Import] ✓ Successfully rebuilt ${ticker}`)
      } catch (err) {
        console.error(`[Batch Import] ✗ Rebuild failed for ${ticker}:`, err)
        tickerErrors.push({
          line: 0,
          ticker,
          error: `Position rebuild failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        })
      }
    }))

    // Rebuild cash balance
    if (onProgress) await onProgress(85, 'Rebuilding cash balance...')
    
    try {
      await rebuildCashBalance(userId)
    } catch (err) {
      console.error('[Batch Import] Cash balance rebuild failed:', err)
      tickerErrors.push({
        line: 0,
        ticker: 'CASH',
        error: `Cash balance rebuild failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      })
    }

    if (onProgress) await onProgress(95, 'Finalizing import...')

    return {
      success: true,
      imported: result.imported || 0,
      failed: tickerErrors.length,
      errors: tickerErrors,
    }

  } catch (err) {
    console.error('[Batch Import] Unexpected error:', err)
    return {
      success: false,
      imported: 0,
      failed: inputs.length,
      errors: [{ 
        line: 0, 
        ticker: 'UNKNOWN', 
        error: err instanceof Error ? err.message : 'Unexpected error during import' 
      }],
    }
  }
}

/**
 * CALCULATE POSITION LOTS DEFINITION (FIFO)
 * 
 * Determines the static structure of open lots (date, quantity, buy_price)
 * without calculating PnL. This part is cached long-term.
 */
export function calculatePositionLotsDefinition(
  transactions: Transaction[]
): any[] {
  // 1. Sort transactions chronologically
  const sorted = [...transactions].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime() ||
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  // 2. Separate into Buys and Sells
  const buys = sorted.filter(t => t.operation === 'COMPRA').map(t => {
    const qty = Math.abs(t.quantity)
    const comm = t.commission || 0
    // Net buy price includes commission per unit
    const netBuyPrice = ((qty * t.price) + comm) / qty

    return {
      id: t.id,
      date: t.date,
      original_quantity: qty,
      remaining_quantity: qty,
      buy_price: netBuyPrice,
    }
  })

  const sells = sorted.filter(t => t.operation === 'VENTA')

  // 3. Apply Sells via FIFO
  for (const sell of sells) {
    let sellQty = Math.abs(sell.quantity)
    
    for (const buy of buys) {
      if (buy.remaining_quantity <= 0) continue
      
      const consume = Math.min(sellQty, buy.remaining_quantity)
      buy.remaining_quantity -= consume
      sellQty -= consume
      
      if (sellQty <= 0) break
    }
  }

  return buys.filter(b => b.remaining_quantity > 0.0001)
}

/**
 * ENRICH LOTS WITH PERFORMANCE
 * 
 * Takes lot definitions and calculates PnL based on current price.
 */
export function enrichLots(lots: any[], currentPrice: number): any[] {
  return lots.map(lot => {
    const market_value = lot.remaining_quantity * currentPrice
    const invested = lot.remaining_quantity * lot.buy_price
    const pnl = market_value - invested
    const pnl_pct = invested > 0 ? pnl / invested : 0

    return {
      ...lot,
      quantity: lot.remaining_quantity,
      current_price: currentPrice,
      market_value,
      invested,
      pnl,
      pnl_pct
    }
  })
}

/**
 * Legacy wrapper for calculatePositionLots (to maintain compatibility if needed)
 */
export function calculatePositionLots(
  transactions: Transaction[],
  currentPrice: number
): any[] {
  const defs = calculatePositionLotsDefinition(transactions)
  return enrichLots(defs, currentPrice)
}
