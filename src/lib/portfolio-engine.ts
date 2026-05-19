import type { Transaction, Position, ClosedTrade, TransactionInput, Quote, PortfolioSummary, AssetType, Moneda, ONPosition, ONClosedTrade } from '@/types'
import { createServerClientInstance, createServiceClient } from './supabase-server'
import { getRedis, isRedisReady } from './redis'
import { updateWithOptimisticLock } from './concurrency'
import { processCashMovement, rebuildCashBalance } from './cash-engine'
import { rebuildONPosition } from './on-engine'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * SECURITY: Explicitly validate userId to prevent data corruption.
 */
function assertUserId(userId: unknown): asserts userId is string {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error(
      '[Security] userId inválido o ausente. Operación cancelada para prevenir corrupción de datos.'
    )
  }
}

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
 * 3. If position closes, write to closed_trades (handled by RPC)
 */
export async function processTransaction(
  supabase: SupabaseClient,
  userId: string,
  input: TransactionInput,
): Promise<{ transaction: Transaction; position: Position | null; closedTrade: ClosedTrade | null }> {
  assertUserId(userId)

  // 0. Check for background import lock
  if (isRedisReady()) {
    const redis = getRedis()
    const isImporting = await redis?.get(`importing:${userId}`)
    if (isImporting) {
      throw new Error('Hay una importación masiva en curso para este usuario. Por favor, espere a que finalice para realizar cambios manuales.')
    }
  }

  // 1. Call the atomic RPC — retry up to 3× on concurrent modification conflicts
  const RPC_MAX_RETRIES = 3
  let rpcData: any
  for (let attempt = 1; attempt <= RPC_MAX_RETRIES; attempt++) {
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
      p_user_id: userId,
    })

    if (!rpcErr) { rpcData = data; break }

    const isConcurrentConflict = rpcErr.message?.includes('Concurrent modification')
    if (isConcurrentConflict && attempt < RPC_MAX_RETRIES) {
      console.warn(`[Portfolio Engine] Concurrent modification — retrying (${attempt}/${RPC_MAX_RETRIES})`)
      await new Promise(r => setTimeout(r, 50 * Math.pow(2, attempt - 1)))
      continue
    }

    console.error('[Portfolio Engine] RPC Error:', rpcErr)
    throw rpcErr
  }

  const { transaction_id } = rpcData

  // 2. Fetch results to return to frontend
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
    } catch (cacheErr) {}
  }

  // 5. ✅ CRITICAL: Warm up price immediately + enqueue reliable worker job (runs outside market hours too)
  const tickerClean = input.ticker.toUpperCase().trim()
  try {
    const { fetchQuotesWithFallback } = await import('./yahoo-finance')
    console.log(`[Portfolio Engine] Warming up price for ${tickerClean}...`)
    await fetchQuotesWithFallback([tickerClean])
  } catch (priceError) {
    console.warn(`[Portfolio Engine] Failed to warm up price for ${tickerClean}:`, priceError)
  }
  try {
    const { addPriceUpdateJob } = await import('./queue')
    await addPriceUpdateJob([tickerClean])
  } catch (queueErr) {
    console.warn(`[Portfolio Engine] Failed to enqueue price update for ${tickerClean}:`, queueErr)
  }

  return { 
    transaction: txRes.data, 
    position: posRes.data ?? null, 
    closedTrade: ctRes.data ?? null 
  }
}

/**
 * Calculates a complete portfolio summary given positions and current quotes.
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

  // 3. Calculate summary totals
  const stocksWithPrices = enrichedStocks.filter(p => p.market_value !== undefined)
  const stock_market_value = stocksWithPrices.reduce((s, p) => s + (p.market_value ?? 0), 0)
  const stock_invested = stocksWithPrices.reduce((s, p) => s + p.total_invested, 0)
  const stock_pnl = stock_market_value - stock_invested
  const stock_pnl_pct = stock_invested > 0 ? stock_pnl / stock_invested : 0
  const stock_day_pnl = stocksWithPrices.reduce((s, p) => s + (p.day_change ?? 0), 0)

  const onsWithPrices = enrichedONs.filter(p => p.market_value !== undefined)
  const on_market_value = onsWithPrices.reduce((s, p) => s + (p.market_value ?? 0), 0)
  const on_invested = onsWithPrices.reduce((s, p) => s + p.total_invested, 0)
  const on_pnl = on_market_value - on_invested
  const on_pnl_pct = on_invested > 0 ? on_pnl / on_invested : 0
  const on_day_pnl = onsWithPrices.reduce((s, p) => s + (p.day_change ?? 0), 0)

  const total_market_value = stock_market_value + on_market_value + cashBalance
  const total_invested = stock_invested + on_invested
  const realized_pnl = stockRealizedPnl + onRealizedPnl

  const sortedStocks = [...stocksWithPrices].sort((a, b) => (b.pnl_pct ?? 0) - (a.pnl_pct ?? 0))

  return {
    positions: enrichedStocks,
    onPositions: enrichedONs,
    summary: {
      total_market_value,
      total_invested,
      open_pnl: stock_pnl + on_pnl,
      open_pnl_pct: total_invested > 0 ? (stock_pnl + on_pnl) / total_invested : 0,
      day_pnl: stock_day_pnl + on_day_pnl,
      day_pnl_pct: total_invested > 0 ? (stock_day_pnl + on_day_pnl) / total_invested : 0,
      realized_pnl,
      realized_pnl_pct: total_invested > 0 ? realized_pnl / total_invested : 0,
      positions_count: enrichedStocks.length + enrichedONs.length,
      best_performer: sortedStocks[0] ?? null,
      worst_performer: sortedStocks[sortedStocks.length - 1] ?? null,
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
 */
export async function getFullPortfolio(
  supabase: SupabaseClient,
  userId: string
): Promise<FullPortfolio> {
  assertUserId(userId)

  const [stockPositionsRes, onPositionsRes, stockClosedRes, onClosedRes, cashBalanceRes] = await Promise.all([
    supabase.from('positions').select('*').eq('user_id', userId).order('total_invested', { ascending: false }),
    supabase.from('on_positions').select('*').eq('user_id', userId).order('total_invested', { ascending: false }),
    supabase.from('closed_trades').select('*').eq('user_id', userId),
    supabase.from('on_closed_trades').select('*').eq('user_id', userId),
    supabase.from('cash_balance').select('balance').eq('user_id', userId).single(),
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
 * Recalculate closed trades for a ticker using incremental UPSERT.
 */
export async function rebuildClosedTrades(supabase: SupabaseClient, userId: string, ticker: string) {
  assertUserId(userId)
  const cleanTicker = ticker.toUpperCase().trim()

  const { data: allTx, error: fetchErr } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('ticker', cleanTicker)
    .order('date', { ascending: true })
    .order('created_at', { ascending: true })

  if (fetchErr) throw fetchErr
  if (!allTx || allTx.length === 0) {
    await supabase.from('closed_trades').delete().eq('user_id', userId).eq('ticker', cleanTicker)
    return
  }

  let quantity = 0
  let costBasis = 0
  let firstBought: string | null = null
  let avgCost = 0
  const closedTradeRows: any[] = []

  for (const tx of allTx) {
    const qty = Math.abs(tx.quantity)
    const comm = tx.commission || 0

    if (tx.operation === 'COMPRA') {
      if (quantity === 0) firstBought = tx.date
      costBasis += (qty * tx.price) + comm
      quantity += qty
      avgCost = costBasis / quantity
    } else if (tx.operation === 'VENTA') {
      if (quantity > 0) {
        const sellQty = Math.min(qty, quantity)
        const proceeds = sellQty * tx.price - comm
        closedTradeRows.push({
          user_id: userId,
          ticker: cleanTicker,
          open_date: firstBought || tx.date,
          close_date: tx.date,
          avg_cost: avgCost,
          close_price: tx.price,
          quantity: sellQty,
          invested: sellQty * avgCost,
          proceeds,
          transaction_id: tx.id
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

  if (closedTradeRows.length > 0) {
    await supabase.from('closed_trades').upsert(closedTradeRows, { onConflict: 'transaction_id' })
  }
}

/**
 * Recalculate a single position from scratch.
 */
export async function rebuildPosition(supabase: SupabaseClient, userId: string, ticker: string) {
  assertUserId(userId)
  const cleanTicker = ticker.toUpperCase().trim()

  await rebuildClosedTrades(supabase, userId, cleanTicker)

  const { data: allTx, error: fetchErr } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('ticker', cleanTicker)
    .order('date', { ascending: true })
    .order('created_at', { ascending: true })

  if (fetchErr) throw fetchErr

  if (!allTx || allTx.length === 0) {
    await supabase.from('positions').delete().eq('user_id', userId).eq('ticker', cleanTicker)
    return null
  }

  const { avgCost, quantity, costBasis } = calculateRunningAvgCost(allTx)
  const firstBought = allTx.find(t => t.operation === 'COMPRA')?.date || allTx[0].date

  if (quantity <= 0.0001) {
    await supabase.from('positions').delete().eq('user_id', userId).eq('ticker', cleanTicker)
  } else {
    await supabase.from('positions').upsert({
      user_id: userId,
      ticker: cleanTicker,
      quantity,
      avg_cost: avgCost,
      total_invested: costBasis,
      first_bought: firstBought,
      last_updated: new Date().toISOString(),
    }, { onConflict: 'user_id,ticker' })
  }
}

export function splitTickersByAssetType(
  inputs: Array<{ ticker: string; assetType?: string }>
): { stockTickers: string[]; onTickers: string[] } {
  const tickerAssetType = new Map<string, string>()
  for (const input of inputs) {
    tickerAssetType.set(input.ticker.toUpperCase().trim(), input.assetType ?? 'ACCION')
  }
  const tickers = Array.from(new Set(inputs.map(i => i.ticker.toUpperCase().trim())))
  return {
    stockTickers: tickers.filter(t => tickerAssetType.get(t) !== 'ON'),
    onTickers: tickers.filter(t => tickerAssetType.get(t) === 'ON'),
  }
}

/**
 * Bulk import transactions.
 */
export async function processTransactionBatch(
  supabase: SupabaseClient,
  userId: string,
  inputs: TransactionInput[],
  replace: boolean = false,
  onProgress?: (percentage: number, message: string) => void | Promise<void>
): Promise<{ 
  success: boolean
  imported: number
  failed: number
  errors: Array<{ line: number; ticker: string; error: string }>
}> {
  assertUserId(userId)

  if (isRedisReady()) {
    const redis = getRedis()
    const existingLock = await redis?.get(`import-lock:${userId}`)
    if (existingLock) {
      return {
        success: false,
        imported: 0,
        failed: inputs.length,
        errors: [{ line: 0, ticker: 'BATCH', error: 'Import already in progress. Please wait.' }],
      }
    }
  }

  try {
    if (onProgress) await onProgress(10, 'Validating and sorting transactions...')
    const sortedInputs = [...inputs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    // Convert to JSONB for RPC
    const transactionsJson = sortedInputs.map(input => ({
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

    if (onProgress) {
      const msg = replace ? `Replacing portfolio with ${sortedInputs.length} transactions...` : `Importing ${sortedInputs.length} transactions...`
      await onProgress(20, msg)
    }

    const rpcName = replace ? 'replace_portfolio_atomic' : 'import_transactions_atomic'
    const { data, error } = await supabase.rpc(rpcName, {
      p_user_id: userId,
      p_transactions: transactionsJson as any,
    })

    if (error) throw error
    const result = Array.isArray(data) ? data[0] : data
    if (!result.success) return { success: false, imported: 0, failed: result.failed, errors: result.error_details }

    if (onProgress) await onProgress(60, 'Rebuilding positions...')
    const tickers = Array.from(new Set(sortedInputs.map(i => i.ticker.toUpperCase().trim())))
    const { stockTickers, onTickers } = splitTickersByAssetType(sortedInputs as any[])

    await Promise.all([
      ...stockTickers.map((ticker: string) => rebuildPosition(supabase, userId, ticker)),
      ...onTickers.map((ticker: string) => rebuildONPosition(supabase, userId, ticker)),
    ])
    await rebuildCashBalance(supabase, userId)

    // Warm up prices for all new tickers in batch
    try {
      const { fetchQuotesWithFallback } = await import('./yahoo-finance')
      await fetchQuotesWithFallback(tickers)
    } catch (e) {}

    return { success: true, imported: result.imported, failed: 0, errors: [] }
  } catch (err: any) {
    return { success: false, imported: 0, failed: inputs.length, errors: [{ line: 0, ticker: 'BATCH', error: err.message }] }
  }
}

/**
 * FIFO Lots Logic
 */
export function calculatePositionLotsDefinition(transactions: Transaction[]): any[] {
  const sorted = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const buys = sorted.filter(t => t.operation === 'COMPRA').map(t => {
    const qty = Math.abs(t.quantity)
    return { id: t.id, date: t.date, remaining_quantity: qty, buy_price: ((qty * t.price) + (t.commission || 0)) / qty }
  })
  const sells = sorted.filter(t => t.operation === 'VENTA')
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

export function enrichLots(lots: any[], currentPrice: number): any[] {
  return lots.map(lot => {
    const market_value = lot.remaining_quantity * currentPrice
    const invested = lot.remaining_quantity * lot.buy_price
    return { ...lot, quantity: lot.remaining_quantity, current_price: currentPrice, market_value, invested, pnl: market_value - invested, pnl_pct: invested > 0 ? (market_value - invested) / invested : 0 }
  })
}

export function calculatePositionLots(transactions: Transaction[], currentPrice: number): any[] {
  return enrichLots(calculatePositionLotsDefinition(transactions), currentPrice)
}
