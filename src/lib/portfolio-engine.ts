import type { Transaction, Position, ClosedTrade, TransactionInput, Quote, PortfolioSummary, AssetType, Moneda, ONPosition, ONClosedTrade } from '@/types'
import { createServerClientInstance } from './supabase-server'
import { getRedis, isRedisReady } from './redis'
import { normalizeError } from './errors'
import type { SupabaseClient } from '@supabase/supabase-js'
import { tradeRecordRpcParams, type TradeRecord } from './trade-record'
import { loadPortfolioNow } from './ledger-now'
import { argentinaDate } from './utils'
import { assertNoNewOversell, OversellError, pendingTrade, stateAfterWrite } from './ledger-write'

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
 * Legacy pure average cost. The write path and every reader use the ledger core
 * (src/lib/ledger-core.ts) since T5.1; its only caller is portfolio-replay (the snapshot
 * backfill), which T5.2 removes together with this function.
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
 * Process a new transaction (odd/tasks/nucleo-ledger.md T5.1, S5):
 * 1. A sale is validated by the ledger core on the ledger after the write
 * 2. The RPC inserts the transaction and its linked cash movement — nothing else
 * 3. The position and the sale come back from the core, as the old RPC's tables did
 */
export async function processTransaction(
  supabase: SupabaseClient,
  userId: string,
  input: TransactionInput & { tradeRecord?: TradeRecord },
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

  const ticker = input.ticker.toUpperCase().trim()
  const assetType = (input as any).assetType ?? 'ACCION'
  if (input.operation === 'VENTA') {
    const pending = pendingTrade({ ...input, assetType })
    await assertNoNewOversell(supabase, userId, rows => [...rows, pending])
  }

  const { data: rpcData, error: rpcErr } = await supabase.rpc('process_transaction_atomic', {
    p_date: input.date,
    p_ticker: ticker,
    p_operation: input.operation,
    p_quantity: Math.abs(input.quantity),
    p_price: input.price,
    p_commission: input.commission ?? 0,
    p_notes: input.notes ?? null,
    p_asset_type: assetType,
    p_moneda: (input as any).moneda ?? 'USD',
    p_user_id: userId,
    // Only callers with a broker ticket send these (migration 044); every
    // other caller keeps the exact pre-044 call.
    ...(input.tradeRecord ? tradeRecordRpcParams(input.tradeRecord) : {}),
  })
  if (rpcErr) {
    console.error('[Portfolio Engine] RPC Error:', rpcErr)
    throw normalizeError(rpcErr)
  }

  const { data: transaction, error: txErr } = await supabase.from('transactions').select('*').eq('id', rpcData.transaction_id).single()
  if (txErr) throw normalizeError(txErr)
  const { position, closedTrade } = await stateAfterWrite(supabase, userId, ticker, assetType === 'ON' ? 'ON' : 'STOCK', input.operation === 'VENTA')

  // Warm up price cache and enqueue background price update job
  try {
    const { fetchQuotesWithFallback } = await import('./yahoo-finance')
    console.log(`[Portfolio Engine] Warming up price for ${ticker}...`)
    await fetchQuotesWithFallback([ticker])
  } catch (priceError) {
    console.warn(`[Portfolio Engine] Failed to warm up price for ${ticker}:`, priceError)
  }
  try {
    const { addPriceUpdateJob } = await import('./queue')
    await addPriceUpdateJob([ticker])
  } catch (queueErr) {
    console.warn(`[Portfolio Engine] Failed to enqueue price update for ${ticker}:`, queueErr)
  }

  // Cache invalidation is the caller's (the route), after this returns.
  return { transaction, position, closedTrade }
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
      price_as_of: quote?.updatedAt,
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
      price_as_of: quote?.updatedAt,
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
 * The user's portfolio now, from the ledger core (odd/tasks/nucleo-ledger.md T4.2b):
 * never from the stored positions / closed-trade / cash tables. Throws on a failed read.
 */
export async function getFullPortfolio(
  supabase: SupabaseClient,
  userId: string,
  today: string = argentinaDate()
): Promise<FullPortfolio> {
  assertUserId(userId)
  return loadPortfolioNow(supabase, userId, today)
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

    // The core's sale rule on the ledger after the import (a replace: the file alone).
    // The RPC stamps one created_at on the whole batch, so the pending rows share one too.
    const at = new Date().toISOString()
    const pending = sortedInputs.map(i => ({ ...pendingTrade({ ...i, assetType: (i as any).assetType }), created_at: at }))
    await assertNoNewOversell(supabase, userId, rows => (replace ? pending : [...rows, ...pending]), rows => (replace ? [] : rows))

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

    if (error) throw normalizeError(error)
    const result = Array.isArray(data) ? data[0] : data
    if (!result.success) return { success: false, imported: 0, failed: result.failed, errors: result.error_details }

    const tickers = Array.from(new Set(sortedInputs.map(i => i.ticker.toUpperCase().trim())))

    // Warm up prices for all new tickers in batch
    try {
      const { fetchQuotesWithFallback } = await import('./yahoo-finance')
      await fetchQuotesWithFallback(tickers)
    } catch (e) {}

    return { success: true, imported: result.imported, failed: 0, errors: [] }
  } catch (err: any) {
    const ticker = err instanceof OversellError ? err.issue.ticker : 'BATCH'
    return { success: false, imported: 0, failed: inputs.length, errors: [{ line: 0, ticker, error: err.message }] }
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
